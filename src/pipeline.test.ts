import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEvent } from './events.js';
import { createGraph } from './graph.js';
import { createPipeline } from './pipeline.js';
import { openStore } from './store.js';

const graph = createGraph({ accessToken: 'tok', phoneNumberId: '1', version: 'v25.0', apiKey: 'k' });
const wrap = (value: object, field = 'messages') => parseEvent({ entry: [{ changes: [{ field, value }] }] });

afterEach(() => mock.restoreAll());

describe('pipeline', () => {
  it('stores messages and statuses, and downloads media of live messages', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
      String(url).endsWith('/77')
        ? new Response(JSON.stringify({ url: 'https://cdn.example/f', mime_type: 'video/mp4' }))
        : new Response('bytes'));
    const dir = await mkdtemp(join(tmpdir(), 'wa-'));
    const store = openStore(':memory:');
    const process = createPipeline({ downloadsDir: dir, store, graph });

    await process(wrap({ messages: [{ id: 'v', from: '1', type: 'video', video: { id: '77' } }] }));
    assert.deepEqual(await readdir(dir), ['77.mp4']);
    assert.equal(store.messages('1')[0]!.mediaPath, join(dir, '77.mp4'));

    await process(wrap({ statuses: [{ id: 'v', status: 'read', recipient_id: '1' }] }));
    assert.equal(store.messages('1')[0]!.status, 'read');
  });

  it('still records a message whose media download fails', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 500 }));
    mock.method(console, 'error', () => {});
    const store = openStore(':memory:');
    await createPipeline({ downloadsDir: '/nowhere', store, graph })(
      wrap({ messages: [{ id: 'i', from: '1', type: 'image', image: { id: '5' } }] }));
    assert.equal(store.messages('1')[0]!.mediaPath, null);
  });

  it('works without a Graph client and removes the file of a deleted message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wa-'));
    const store = openStore(':memory:');
    const process = createPipeline({ downloadsDir: dir, store });
    await process(wrap({ messages: [{ id: 't', from: '1', type: 'text', text: { body: 'x' } }] }));
    assert.equal(store.messages('1').length, 1);

    const file = join(dir, 'x.jpg');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, 'x');
    store.setMediaPath('t', file);
    await process(wrap({ messages: [{ id: 'r', from: '1', type: 'revoke', revoke: { original_message_id: 't' } }] }));
    await assert.rejects(access(file));
    assert.equal(store.messages('1')[0]!.deleted, true);
  });
});
