import type { IncomingMessage, ServerResponse } from 'node:http';
import { GraphError, type Graph } from './graph.js';
import { readBody, sendJson } from './http.js';

const MAX_JSON = 64 * 1024;
/** International format without "+", as expected by the Cloud API. */
const PHONE = /^\d{8,15}$/;

const MiB = 1024 * 1024;

/** Message type and size limit (WhatsApp's own caps) derived from the MIME type. */
function classify(mimeType: string): { type: 'image' | 'audio' | 'document'; limit: number } {
  if (mimeType.startsWith('image/')) return { type: 'image', limit: 5 * MiB };
  if (mimeType.startsWith('audio/')) return { type: 'audio', limit: 16 * MiB };
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

/** Sends the request body as a media message: `POST /media?to=...[&filename=...][&caption=...][&voice=true]`. */
export async function sendMedia(req: IncomingMessage, res: ServerResponse, graph: Graph): Promise<void> {
  const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const to = params.get('to');
  const mimeType = req.headers['content-type']?.trim();
  if (!to || !PHONE.test(to)) return sendJson(res, 400, { error: '"to" must be digits only, in international format' });
  if (!mimeType) return sendJson(res, 400, { error: 'Content-Type must be the file MIME type' });

  const { type, limit } = classify(mimeType);
  const bytes = await readBody(req, res, limit);
  if (!bytes) return;
  if (!bytes.length) return sendJson(res, 400, { error: 'Empty body' });

  const voice = params.get('voice') === 'true';
  const problem = voice && (type !== 'audio' ? 'Voice messages must be audio/ogg' : voiceProblem(bytes, mimeType));
  if (problem) return sendJson(res, 400, { error: problem });

  const filename = params.get('filename') ?? 'file';
  const caption = params.get('caption');
  try {
    const mediaId = await graph.upload(bytes, mimeType, filename);
    const media = {
      id: mediaId,
      ...(caption && type !== 'audio' && { caption }),
      ...(voice && { voice: true }),
      ...(type === 'document' && { filename }),
    };
    sendJson(res, 200, { id: await graph.sendMessage({ to, type, [type]: media }) });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}

export async function sendText(req: IncomingMessage, res: ServerResponse, graph: Graph): Promise<void> {
  const raw = await readBody(req, res, MAX_JSON);
  if (!raw) return;

  let input: { to?: unknown; text?: unknown };
  try {
    input = JSON.parse(raw.toString());
  } catch {
    return sendJson(res, 400, { error: 'Body must be JSON' });
  }
  const { to, text } = input;
  if (typeof to !== 'string' || !PHONE.test(to)) {
    return sendJson(res, 400, { error: '"to" must be digits only, in international format' });
  }
  if (typeof text !== 'string' || !text || text.length > 4096) {
    return sendJson(res, 400, { error: '"text" must be a string of 1 to 4096 characters' });
  }

  try {
    const id = await graph.sendMessage({ to, type: 'text', text: { body: text } });
    sendJson(res, 200, { id });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}
