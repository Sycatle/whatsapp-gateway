import { createHash } from 'node:crypto';
import type { GraphConfig } from './config.js';

/** Generous: uploads and downloads can reach 100 MiB. */
const TIMEOUT_MS = 120_000;

export class GraphError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
  }
}

export type Graph = ReturnType<typeof createGraph>;

export function createGraph(config: GraphConfig) {
  const base = `https://graph.facebook.com/${config.version}`;

  /** Calls the Graph API with the access token and returns the response whatever its status. */
  async function raw(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(path.startsWith('https://') ? path : `${base}/${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${config.accessToken}`, ...init.headers },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // Never relay the raw cause: it is not Meta's answer and may name internal details.
      if (error instanceof Error && error.name === 'TimeoutError') throw new GraphError('Graph API timed out', 504);
      throw new GraphError('Graph API unreachable', 502);
    }
  }

  /** Parses a successful response, failing as a bad gateway when Meta's answer is not what the API documents. */
  async function parse<T>(res: Response, valid: (body: Partial<T> | undefined) => boolean): Promise<T> {
    const body = (await res.json().catch(() => undefined)) as Partial<T> | undefined;
    if (!valid(body)) throw new GraphError('Unexpected response from Graph API', 502);
    return body as T;
  }

  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await raw(path, init);
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
      const { messages } = await parse<{ messages: { id: string }[] }>(res, (b) => typeof b?.messages?.[0]?.id === 'string');
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
      return (await parse<{ id: string }>(res, (b) => typeof b?.id === 'string')).id;
    },
    /** Downloads a received media file, refusing anything above `maxBytes` or with a wrong checksum. */
    async download(mediaId: string, maxBytes: number): Promise<{ bytes: Buffer; mimeType: string }> {
      const info = await parse<{ url: string; mime_type: string; sha256?: string; file_size?: number }>(
        await request(mediaId),
        (b) => typeof b?.url === 'string' && b.url.startsWith('https://') && typeof b.mime_type === 'string',
      );
      if ((info.file_size ?? 0) > maxBytes) throw new GraphError(`Media ${mediaId} is larger than ${maxBytes} bytes`, 502);
      const bytes = Buffer.from(await (await request(info.url)).arrayBuffer());
      if (bytes.length > maxBytes) throw new GraphError(`Media ${mediaId} is larger than ${maxBytes} bytes`, 502);
      if (info.sha256 && createHash('sha256').update(bytes).digest('hex') !== info.sha256) {
        throw new GraphError(`Media ${mediaId} failed its checksum`, 502);
      }
      return { bytes, mimeType: info.mime_type };
    },
    request,
    raw,
    phoneNumberId: config.phoneNumberId,
    businessAccountId: config.businessAccountId,
  };
}
