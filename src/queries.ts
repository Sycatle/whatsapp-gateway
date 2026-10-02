import { rm } from 'node:fs/promises';
import { sendJson } from './http.js';
import type { Context } from './router.js';
import type { Store } from './store.js';

/** Phone numbers, group ids and BSUIDs (`US.123abc`). */
const CHAT = /^[\w.=-]+$/;

const intParam = (value: string | null, fallback: number, max: number): number => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};

export function listConversations({ res, url }: Context, store: Store): void {
  sendJson(res, 200, { conversations: store.conversations(intParam(url.searchParams.get('limit'), 50, 500)) });
}

/** Newest first; pass the last message's `timestamp` and `id` as `before` and `before_id` to page back. */
export function listMessages({ res, url, params }: Context, store: Store): void {
  if (!CHAT.test(params.chat!)) return sendJson(res, 400, { error: 'Invalid chat' });
  const before = url.searchParams.get('before');
  const beforeId = url.searchParams.get('before_id');
  if (before !== null && !/^\d{1,15}$/.test(before)) return sendJson(res, 400, { error: '"before" must be a timestamp' });
  if (beforeId !== null && before === null) return sendJson(res, 400, { error: '"before_id" needs "before"' });
  sendJson(res, 200, {
    messages: store.messages(
      params.chat!,
      intParam(url.searchParams.get('limit'), 50, 500),
      before === null ? undefined : Number(before),
      beforeId,
    ),
  });
}

export function listContacts({ res }: Context, store: Store): void {
  sendJson(res, 200, { contacts: store.contacts() });
}

/** Erases a chat: its messages, its contact entry and its downloaded files. */
export async function deleteConversation({ res, params }: Context, store: Store): Promise<void> {
  if (!CHAT.test(params.chat!)) return sendJson(res, 400, { error: 'Invalid chat' });
  const files = store.deleteChat(params.chat!);
  await Promise.all(files.map((path) => rm(path, { force: true })));
  sendJson(res, 200, { deletedFiles: files.length });
}
