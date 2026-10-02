import { createHash } from 'node:crypto';
import type { GraphConfig } from './config.js';

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

export type Graph = ReturnType<typeof createGraph>;

export function createGraph(config: GraphConfig) {
  const base = `https://graph.facebook.com/${config.version}`;

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(path.startsWith('https://') ? path : `${base}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.accessToken}`, ...init.headers },
    });
    if (res.ok) return res;
    const { error } = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
    const message = error?.code === 190
      ? 'WhatsApp access token expired or invalid; generate a new one'
      : error?.message ?? `Graph API error ${res.status}`;
    throw new GraphError(message, res.status, error?.code);
  }

  return {
    /** Sends a message object and returns the WhatsApp message id. */
    async sendMessage(message: Record<string, unknown>): Promise<string> {
      const res = await request(`${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...message }),
      });
      const { messages } = (await res.json()) as { messages: { id: string }[] };
      return messages[0]!.id;
    },
    /** Marks an inbound message as read, optionally showing the typing indicator for up to 25 seconds. */
    async markRead(messageId: string, typing = false): Promise<void> {
      await request(`${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
          ...(typing && { typing_indicator: { type: 'text' } }),
        }),
      });
    },
    /** Uploads a file and returns its media id. */
    async upload(bytes: Buffer<ArrayBuffer>, mimeType: string, filename: string): Promise<string> {
      const form = new FormData();
      form.set('messaging_product', 'whatsapp');
      form.set('type', mimeType);
      form.set('file', new Blob([bytes], { type: mimeType }), filename);
      const res = await request(`${config.phoneNumberId}/media`, { method: 'POST', body: form });
      return ((await res.json()) as { id: string }).id;
    },
    /** Downloads a received media file, refusing anything above `maxBytes` or with a wrong checksum. */
    async download(mediaId: string, maxBytes: number): Promise<{ bytes: Buffer; mimeType: string }> {
      const info = (await (await request(mediaId)).json()) as {
        url: string; mime_type: string; sha256?: string; file_size?: number;
      };
      if ((info.file_size ?? 0) > maxBytes) throw new Error(`Media ${mediaId} is larger than ${maxBytes} bytes`);
      const bytes = Buffer.from(await (await request(info.url)).arrayBuffer());
      if (bytes.length > maxBytes) throw new Error(`Media ${mediaId} is larger than ${maxBytes} bytes`);
      if (info.sha256 && createHash('sha256').update(bytes).digest('hex') !== info.sha256) {
        throw new Error(`Media ${mediaId} failed its checksum`);
      }
      return { bytes, mimeType: info.mime_type };
    },
    request,
  };
}
