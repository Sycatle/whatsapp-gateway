import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './events.js';
import type { Graph } from './graph.js';

const MAX_BYTES = 100 * 1024 * 1024;

const MEDIA_TYPES = ['image', 'audio', 'document'];

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
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
