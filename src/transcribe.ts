import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { TranscribeConfig } from './config.js';

const TIMEOUT_MS = 120_000;

export type Transcriber = (path: string, id: string) => Promise<string | undefined>;

/**
 * Speech-to-text through any OpenAI-compatible `/v1/audio/transcriptions` endpoint: `scripts/whisper-server.py`,
 * speaches, whisper.cpp's server, Groq, OpenAI... Never throws: a failure only means the message has no transcript.
 * Returns undefined when not configured.
 */
export function createTranscriber(config?: TranscribeConfig): Transcriber | undefined {
  if (!config) return undefined;

  return async (path, id) => {
    try {
      const form = new FormData();
      form.set('file', new Blob([await readFile(path)]), basename(path));
      form.set('model', config.model);
      if (config.language) form.set('language', config.language);
      const res = await fetch(config.url, {
        method: 'POST',
        body: form,
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { text } = (await res.json()) as { text?: unknown };
      const transcript = typeof text === 'string' ? text.trim() : '';
      if (transcript) console.log(`transcribed id=${id} chars=${transcript.length}`);
      return transcript || undefined;
    } catch (error) {
      console.error(`transcription failed id=${id}: ${error instanceof Error ? error.message : error}`);
      return undefined;
    }
  };
}
