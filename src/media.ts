import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './events.js';
import { GraphError, type Graph } from './graph.js';
import { sendJson } from './http.js';
import type { Context } from './router.js';

const MAX_BYTES = 100 * 1024 * 1024;

const MEDIA_TYPES = ['image', 'audio', 'video', 'document', 'sticker'];

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'text/plain': 'txt',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** Saves the media attached to a message, if any, and returns its path. */
export async function saveMedia(graph: Graph, dir: string, message: Pick<Message, 'type' | 'content'>): Promise<string | null> {
  const id = MEDIA_TYPES.includes(message.type) ? message.content.id : undefined;
  if (typeof id !== 'string') return null;
  // Ids come from the network and end up in a path: never trust them.
  if (!/^\w+$/.test(id)) throw new Error('Unexpected media id');

  const { bytes, mimeType } = await graph.download(id, MAX_BYTES);
  const extension = EXTENSIONS[mimeType.split(';')[0]!.trim()] ?? 'bin';
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${id}.${extension}`);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

const MEDIA_ID = /^\w+$/;

/** `GET /media/:id`: downloads a media file from Meta (ids come from received messages or uploads). */
export async function fetchMedia({ res, params }: Context, graph: Graph): Promise<void> {
  if (!MEDIA_ID.test(params.id!)) return sendJson(res, 400, { error: 'Invalid media id' });
  try {
    const { bytes, mimeType } = await graph.download(params.id!, MAX_BYTES);
    res.writeHead(200, { 'Content-Type': mimeType, 'Content-Length': bytes.length }).end(bytes);
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}

/** `DELETE /media/:id`: removes an uploaded file from Meta's servers. */
export async function deleteMedia({ res, params }: Context, graph: Graph): Promise<void> {
  if (!MEDIA_ID.test(params.id!)) return sendJson(res, 400, { error: 'Invalid media id' });
  try {
    await graph.request(params.id!, { method: 'DELETE' });
    sendJson(res, 200, { ok: true });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}
