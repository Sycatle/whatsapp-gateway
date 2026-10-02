import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTranscriber } from './transcribe.js';

const config = { url: 'http://stt.local/v1/audio/transcriptions', model: 'whisper-1' };

async function audioFile(): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), 'wa-')), 'note.ogg');
  await writeFile(path, 'ogg bytes');
  return path;
}

afterEach(() => mock.restoreAll());

describe('createTranscriber', () => {
  it('is disabled without configuration', () => {
    assert.equal(createTranscriber(undefined), undefined);
  });

  it('posts the file as OpenAI-style multipart and returns the trimmed text', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ text: ' Salut ! ' })));
    const transcribe = createTranscriber({ ...config, apiKey: 'k', language: 'fr' })!;
    assert.equal(await transcribe(await audioFile(), 'm1'), 'Salut !');
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    const form = init.body as FormData;
    assert.equal(url, config.url);
    assert.deepEqual([form.get('model'), form.get('language'), (form.get('file') as File).name], ['whisper-1', 'fr', 'note.ogg']);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer k');
  });

  it('gives up quietly when the service fails or answers nothing', async () => {
    mock.method(console, 'error', () => {});
    const transcribe = createTranscriber(config)!;
    mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }));
    assert.equal(await transcribe(await audioFile(), 'm1'), undefined);
    mock.restoreAll();
    mock.method(console, 'error', () => {});
    mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ text: '  ' })));
    assert.equal(await transcribe(await audioFile(), 'm1'), undefined);
    assert.equal(await transcribe('/does/not/exist', 'm1'), undefined);
  });
});
