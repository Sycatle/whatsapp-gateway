import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Message } from './events.js';
import { GraphError, type Graph } from './graph.js';
import { readBody, sendJson } from './http.js';
import type { Store } from './store.js';

const MAX_JSON = 64 * 1024;
/** International format without "+", as expected by the Cloud API. */
const PHONE = /^\d{8,15}$/;
/** Business-scoped user ID: country code, a period, then alphanumerics (`US.13491208655302741918`, `US.ENT.118...`). */
const BSUID = /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$/;
const isRecipient = (value: unknown): value is string => typeof value === 'string' && (PHONE.test(value) || BSUID.test(value));
const RECIPIENT_ERROR = '"to" must be a phone number (digits only, international format) or a business-scoped user id';
const GROUP_ID = /^[\w=-]+$/;

export interface SendDeps {
  graph: Graph;
  store: Store;
}

/** Message types the Cloud API accepts, all sent through the same `messages` endpoint. */
const TYPES = ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'template', 'reaction'];

/** Sends a message object and keeps a copy in the store. */
async function deliver(
  { graph, store }: SendDeps,
  res: ServerResponse,
  target: { to: string; group: boolean },
  type: string,
  content: unknown,
  replyTo?: string,
): Promise<void> {
  try {
    const id = await graph.sendMessage({
      ...(target.group && { recipient_type: 'group' }),
      // Users known only by BSUID are addressed with `recipient`, everyone else with `to`.
      ...(BSUID.test(target.to) ? { recipient: target.to } : { to: target.to }),
      type,
      [type]: content,
      ...(replyTo && { context: { message_id: replyTo } }),
    });
    const stored: Message = {
      id, chat: store.resolveChat(target.to), from: 'api', direction: 'out', source: 'api', type,
      timestamp: Math.floor(Date.now() / 1000), content: Array.isArray(content) ? { items: content } : (content as Message['content']),
      status: 'pending',
    };
    if (replyTo) stored.contextId = replyTo;
    store.saveMessages([stored]);
    sendJson(res, 200, { id });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}

const MiB = 1024 * 1024;

/** Message type and size limit (WhatsApp's own caps) derived from the MIME type. */
function classify(mimeType: string, sticker: boolean): { type: 'image' | 'audio' | 'video' | 'document' | 'sticker'; limit: number } {
  if (sticker) return { type: 'sticker', limit: 500 * 1024 };
  if (mimeType.startsWith('image/')) return { type: 'image', limit: 5 * MiB };
  if (mimeType.startsWith('audio/')) return { type: 'audio', limit: 16 * MiB };
  if (mimeType.startsWith('video/')) return { type: 'video', limit: 16 * MiB };
  return { type: 'document', limit: 100 * MiB };
}

/** WhatsApp voice notes must be mono Ogg/Opus; returns why a file is not, or null. */
function voiceProblem(bytes: Buffer, mimeType: string): string | null {
  if (!mimeType.startsWith('audio/ogg')) return 'Voice messages must be audio/ogg';
  const head = bytes.subarray(0, 256);
  const opus = head.indexOf('OpusHead');
  if (head.toString('latin1', 0, 4) !== 'OggS' || opus < 0) return 'Voice messages must be Ogg encoded with Opus';
  if (head[opus + 9] !== 1) return 'Voice messages must be mono';
  return null;
}

/**
 * Sends the request body as a media message:
 * `POST /media?to=...[&filename=...][&caption=...][&voice=true][&sticker=true][&reply_to=...]`.
 */
export async function sendMedia(req: IncomingMessage, res: ServerResponse, deps: SendDeps): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const to = params.get('to');
  const mimeType = req.headers['content-type']?.trim();
  if (!isRecipient(to)) return sendJson(res, 400, { error: RECIPIENT_ERROR });
  if (!mimeType) return sendJson(res, 400, { error: 'Content-Type must be the file MIME type' });

  const sticker = params.get('sticker') === 'true';
  if (sticker && mimeType !== 'image/webp') return sendJson(res, 400, { error: 'Stickers must be image/webp' });
  const { type, limit } = classify(mimeType, sticker);
  const bytes = await readBody(req, res, limit);
  if (!bytes) return;
  if (!bytes.length) return sendJson(res, 400, { error: 'Empty body' });

  const voice = params.get('voice') === 'true';
  const problem = voice && (type !== 'audio' ? 'Voice messages must be audio/ogg' : voiceProblem(bytes, mimeType));
  if (problem) return sendJson(res, 400, { error: problem });

  const filename = params.get('filename') ?? 'file';
  const caption = params.get('caption');
  let mediaId: string;
  try {
    mediaId = await deps.graph.upload(bytes, mimeType, filename);
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    return sendJson(res, 502, { error: error.message, code: error.code });
  }
  const media = {
    id: mediaId,
    ...(caption && (type === 'image' || type === 'video' || type === 'document') && { caption }),
    ...(voice && { voice: true }),
    ...(type === 'document' && { filename }),
  };
  await deliver(deps, res, { to, group: false }, type, media, params.get('reply_to') ?? undefined);
}

/**
 * `POST /messages` with `{ to | group, type?, <type>: {...}, reply_to?, preview_url? }`. The `<type>` object is the
 * Cloud API one (`image: { id }`, `template: { name, language }`, `location`, `contacts`, `interactive`, `reaction`...).
 * Plain text can be written `{ to, text: "hello" }`.
 */
export async function sendMessage(req: IncomingMessage, res: ServerResponse, deps: SendDeps): Promise<void> {
  const raw = await readBody(req, res, MAX_JSON);
  if (!raw) return;

  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
    input = parsed as Record<string, unknown>;
  } catch {
    return sendJson(res, 400, { error: 'Body must be a JSON object' });
  }

  const { to, group, reply_to: replyTo } = input;
  if ((to === undefined) === (group === undefined)) return sendJson(res, 400, { error: 'Give either "to" or "group"' });
  if (to !== undefined && !isRecipient(to)) return sendJson(res, 400, { error: RECIPIENT_ERROR });
  if (group !== undefined && (typeof group !== 'string' || !GROUP_ID.test(group))) {
    return sendJson(res, 400, { error: '"group" must be a group id' });
  }
  if (replyTo !== undefined && typeof replyTo !== 'string') return sendJson(res, 400, { error: '"reply_to" must be a message id' });

  const type = input.type ?? 'text';
  if (typeof type !== 'string' || !TYPES.includes(type)) {
    return sendJson(res, 400, { error: `"type" must be one of: ${TYPES.join(', ')}` });
  }

  let content = input[type];
  if (type === 'text' && typeof content === 'string') {
    content = { body: content, ...(input.preview_url === true && { preview_url: true }) };
  }
  if (type === 'text') {
    const body = (content as { body?: unknown } | undefined)?.body;
    if (typeof body !== 'string' || !body || body.length > 4096) {
      return sendJson(res, 400, { error: '"text" must be a string of 1 to 4096 characters' });
    }
  }
  const valid = type === 'contacts' ? Array.isArray(content) : typeof content === 'object' && content !== null && !Array.isArray(content);
  if (!valid) return sendJson(res, 400, { error: `"${type}" must be ${type === 'contacts' ? 'an array' : 'an object'}` });

  await deliver(deps, res, { to: (to ?? group) as string, group: group !== undefined }, type, content, replyTo);
}

/** `POST /read` with `{ message_id, typing? }`: read receipt for a received message, optionally with "typing...". */
export async function markRead(req: IncomingMessage, res: ServerResponse, graph: Graph): Promise<void> {
  const raw = await readBody(req, res, MAX_JSON);
  if (!raw) return;
  let input: { message_id?: unknown; typing?: unknown };
  try {
    input = JSON.parse(raw.toString());
  } catch {
    return sendJson(res, 400, { error: 'Body must be JSON' });
  }
  if (typeof input?.message_id !== 'string' || !input.message_id) {
    return sendJson(res, 400, { error: '"message_id" must be the id of a received message' });
  }
  try {
    await graph.markRead(input.message_id, input.typing === true);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}
