import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGraph } from './graph.js';
import { saveMedia } from './media.js';

const graph = createGraph({ accessToken: 'tok', phoneNumberId: '1', version: 'v25.0', apiKey: 'k' });
const file = Buffer.from('fake image bytes');
const sha256 = createHash('sha256').update(file).digest('hex');

function stubGraph(info: object) {
  return mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).endsWith('/555')
      ? new Response(JSON.stringify({ url: 'https://lookaside.example/file', mime_type: 'image/jpeg', ...info }))
      : new Response(file));
}

afterEach(() => mock.restoreAll());

describe('saveMedia', () => {
  it('ignores messages without media', async () => {
    assert.equal(await saveMedia(graph, '/nowhere', { type: 'text', content: { body: 'hi' } }), null);
  });

  it('downloads with the bearer token and writes a private file named after the id', async () => {
    const fetchMock = stubGraph({ sha256 });
    const dir = join(await mkdtemp(join(tmpdir(), 'wa-')), 'downloads');
    const path = await saveMedia(graph, dir, { type: 'image', content: { id: '555', mime_type: 'image/jpeg' } });
    assert.equal(path, join(dir, '555.jpg'));
    assert.deepEqual(await readFile(path!), file);
    assert.equal((await stat(path!)).mode & 0o777, 0o600);
    const [, init] = fetchMock.mock.calls[1]!.arguments as [string, RequestInit];
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer tok');
  });

  it('rejects a checksum mismatch', async () => {
    stubGraph({ sha256: 'deadbeef' });
    const message = { type: 'image', content: { id: '555', mime_type: 'image/jpeg' } };
    await assert.rejects(saveMedia(graph, await mkdtemp(join(tmpdir(), 'wa-')), message), /checksum/);
  });

  it('refuses ids that could escape the directory', async () => {
    const message = { type: 'image', content: { id: '../evil', mime_type: 'image/jpeg' } };
    await assert.rejects(saveMedia(graph, '/nowhere', message), /Unexpected media id/);
  });
});
