import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createGraph, GraphError } from './graph.js';

const graph = createGraph({ accessToken: 'tok', phoneNumberId: '123', version: 'v25.0', apiKey: 'k' });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => mock.restoreAll());

describe('sendMessage', () => {
  it('posts to the phone number with the bearer token and returns the id', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => json({ messages: [{ id: 'wamid.9' }] }));
    const id = await graph.sendMessage({ to: '33600000000', type: 'text', text: { body: 'hi' } });
    assert.equal(id, 'wamid.9');
    const [url, init] = fetchMock.mock.calls[0]!.arguments as [string, RequestInit];
    assert.equal(url, 'https://graph.facebook.com/v25.0/123/messages');
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer tok');
    assert.equal(JSON.parse(init.body as string).messaging_product, 'whatsapp');
  });

  it('turns an expired token into a readable error', async () => {
    mock.method(globalThis, 'fetch', async () => json({ error: { code: 190, message: 'Session expired' } }, 401));
    await assert.rejects(graph.sendMessage({}), (e: GraphError) => e.status === 401 && /expired/.test(e.message));
  });

  it('surfaces other Graph errors', async () => {
    mock.method(globalThis, 'fetch', async () => json({ error: { code: 131047, message: 'Re-engagement message' } }, 400));
    await assert.rejects(graph.sendMessage({}), (e: GraphError) => e.code === 131047 && e.message === 'Re-engagement message');
  });
});
