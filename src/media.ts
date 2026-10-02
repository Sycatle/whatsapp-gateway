import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InboundMessage } from './events.js';
import type { Graph } from './graph.js';

const MAX_BYTES = 100 * 1024 * 1024;

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
export async function saveMedia(graph: Graph, dir: string, message: InboundMessage): Promise<string | null> {
  const media = message.image ?? message.audio ?? message.document;
  if (!media) return null;
  // Ids come from the network and end up in a path: never trust them.
  if (!/^\w+$/.test(media.id)) throw new Error('Unexpected media id');

  const { bytes, mimeType } = await graph.download(media.id, MAX_BYTES);
  const extension = EXTENSIONS[mimeType.split(';')[0]!.trim()] ?? 'bin';
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${media.id}.${extension}`);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}
