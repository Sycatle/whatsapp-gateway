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
    const res = await fetch(`${base}/${path}`, {
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
    request,
  };
}
