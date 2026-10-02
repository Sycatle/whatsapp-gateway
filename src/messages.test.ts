import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './server.js';

const graph = { accessToken: 'tok', phoneNumberId: '123', version: 'v25.0', apiKey: 'key' };
const open = { port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: 'downloads' };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('POST /messages', () => {
  const servers: Server[] = [];
  let base: string;
  const realFetch = globalThis.fetch;

  before(async () => {
    const server = createApp({ ...open, graph });
    servers.push(server);
    base = await listen(server);
  });
  after(() => servers.forEach((s) => s.close()));
  afterEach(() => mock.restoreAll());

  const post = (body: unknown, auth: string | null = 'Bearer key') =>
    realFetch(`${base}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: auth ? { Authorization: auth } : {},
    });

  it('requires the API key', async () => {
    assert.equal((await post({}, null)).status, 401);
    assert.equal((await post({}, 'Bearer wrong')).status, 401);
  });

  it('validates the input', async () => {
    assert.equal((await post({ to: '+33 6', text: 'hi' })).status, 400);
    assert.equal((await post({ to: '33600000000', text: '' })).status, 400);
  });

  it('sends a text through the Graph API', async () => {
    const calls: unknown[] = [];
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith(base)) return realFetch(url, init);
      calls.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.7' }] }));
    });
    const res = await post({ to: '33600000000', text: 'hello' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 'wamid.7' });
    assert.deepEqual(calls[0], {
      messaging_product: 'whatsapp', to: '33600000000', type: 'text', text: { body: 'hello' },
    });
  });

  it('reports Graph failures as 502', async () => {
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) =>
      String(url).startsWith(base)
        ? realFetch(url, init)
        : new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message' } }), { status: 400 }));
    const res = await post({ to: '33600000000', text: 'late' });
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'Re-engagement message', code: 131047 });
  });

  it('answers 503 when sending is not configured', async () => {
    const server = createApp(open);
    servers.push(server);
    const res = await realFetch(`${await listen(server)}/messages`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 503);
  });
});
