import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { sign } from './auth.js';
import { emptyEvent } from './events.js';
import { createSink } from './sink.js';

const config = { url: 'https://app.example/events', secret: 'shh' };
const event = { ...emptyEvent(), statuses: [{ id: 'w', status: 'read', recipient: '1', timestamp: 1 }] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => mock.restoreAll());

describe('createSink', () => {
  it('is disabled without configuration', () => {
    assert.equal(createSink(undefined), undefined);
  });

  it('posts the event signed with the shared secret', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
    createSink(config)!(event);
    await settle();
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    assert.equal(url, config.url);
    assert.equal((init.headers as Record<string, string>)['X-Hub-Signature-256'], sign(init.body as string, 'shh'));
    assert.deepEqual(JSON.parse(init.body as string).statuses, event.statuses);
  });

  it('retries failures, then gives up', async () => {
    mock.method(console, 'error', () => {});
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('no', { status: 500 }));
    createSink(config, [1, 1])!(event);
    await settle();
    assert.equal(fetchMock.mock.calls.length, 3);
  });

  it('stops retrying once delivered', async () => {
    mock.method(console, 'error', () => {});
    let calls = 0;
    mock.method(globalThis, 'fetch', async () => (++calls < 2 ? new Response('no', { status: 502 }) : new Response('ok')));
    createSink(config, [1, 1, 1])!(event);
    await settle();
    assert.equal(calls, 2);
  });

  it('skips empty events', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('ok'));
    createSink(config)!(emptyEvent());
    await settle();
    assert.equal(fetchMock.mock.calls.length, 0);
  });
});
