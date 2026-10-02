import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEvent, type ParsedEvent } from './events.js';
import { createGraph } from './graph.js';
import { createPipeline } from './pipeline.js';
import { openStore } from './store.js';

const graph = createGraph({ accessToken: 'tok', phoneNumberId: '1', version: 'v25.0' });
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

  it('applies events in arrival order and drains on idle', async () => {
    const store = openStore(':memory:');
    const pipeline = createPipeline({ downloadsDir: 'unused', store });
    pipeline.enqueue(wrap({ messages: [{ id: 'o', from: '1', type: 'text', text: { body: 'x' } }] }));
    pipeline.enqueue(wrap({ statuses: [{ id: 'o', status: 'read', recipient_id: '1' }] }));
    await pipeline.idle();
    assert.equal(store.messages('1')[0]!.status, 'read');
  });

  it('keeps going and still forwards when a step fails', async () => {
    mock.method(console, 'error', () => {});
    const store = openStore(':memory:');
    mock.method(store, 'applyStatus', () => { throw new Error('boom'); });
    const forwarded: ParsedEvent[] = [];
    const pipeline = createPipeline({ downloadsDir: 'unused', store, forward: (e) => forwarded.push(e) });
    await pipeline(wrap({
      messages: [{ id: 'k', from: '1', type: 'text', text: { body: 'x' } }],
      statuses: [{ id: 'k', status: 'read', recipient_id: '1' }],
    }));
    await pipeline(wrap({ messages: [{ id: 'k2', from: '1', type: 'text', text: { body: 'y' } }] }));
    assert.deepEqual(store.messages('1').map((m) => m.id).sort(), ['k', 'k2']);
    assert.equal(forwarded.length, 2);
  });

  it('downloads media that arrives later in the history sync', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
      String(url).endsWith('/88')
        ? new Response(JSON.stringify({ url: 'https://cdn.example/f', mime_type: 'image/jpeg' }))
        : new Response('bytes'));
    const dir = await mkdtemp(join(tmpdir(), 'wa-'));
    const store = openStore(':memory:');
    const process = createPipeline({ downloadsDir: dir, store, graph });
    const history = (message: object) => wrap({ history: [{ threads: [{ id: '1', messages: [message] }] }] }, 'history');

    await process(history({ id: 'h', from: '1', type: 'media_placeholder' }));
    await process(history({ id: 'h', from: '1', type: 'image', image: { id: '88' } }));
    assert.deepEqual(await readdir(dir), ['88.jpg']);
    assert.deepEqual([store.messages('1')[0]!.type, store.messages('1')[0]!.mediaPath], ['image', join(dir, '88.jpg')]);
  });

  it('adds a transcript to voice notes and tolerates its absence', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
      String(url).endsWith('/66')
        ? new Response(JSON.stringify({ url: 'https://cdn.example/f', mime_type: 'audio/ogg; codecs=opus' }))
        : new Response('ogg'));
    const dir = await mkdtemp(join(tmpdir(), 'wa-'));
    const store = openStore(':memory:');
    const seen: string[] = [];
    const transcribe = async (path: string) => { seen.push(path); return 'bonjour'; };
    const voice = { id: 'a', from: '1', type: 'audio', audio: { id: '66', voice: true } };

    await createPipeline({ downloadsDir: dir, store, graph, transcribe })(wrap({ messages: [voice] }));
    assert.deepEqual(store.messages('1')[0]!.content, { id: '66', voice: true, transcript: 'bonjour' });
    assert.deepEqual(seen, [join(dir, '66.ogg')]);

    await createPipeline({ downloadsDir: dir, store, graph, transcribe: async () => undefined })(wrap({ messages: [{ ...voice, id: 'b' }] }));
    const second = store.messages('1').find((m) => m.id === 'b')!;
    assert.equal((second.content as Record<string, unknown>).transcript, undefined);
  });

  it('forwards the processed event without the history backlog', async () => {
    const forwarded: ParsedEvent[] = [];
    const process = createPipeline({ downloadsDir: '/nowhere', store: openStore(':memory:'), forward: (e) => forwarded.push(e) });
    await process(wrap({
      history: [{ metadata: { progress: 10 }, threads: [{ id: '1', messages: [{ id: 'h', from: '1', type: 'text', text: {} }] }] }],
    }, 'history'));
    assert.deepEqual([forwarded[0]!.messages, forwarded[0]!.history], [[], [{ progress: 10, messages: 1 }]]);
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
