import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './server.js';

const config = {
  port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: 'downloads', dbPath: ':memory:', apiKey: 'key',
  graph: { accessToken: 'tok', phoneNumberId: '111', businessAccountId: '222', version: 'v25.0' },
};

describe('gateway', () => {
  let server: Server;
  let base: string;
  const realFetch = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];

  before(async () => {
    server = createApp(config);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  afterEach(() => { mock.restoreAll(); calls.length = 0; });

  const stub = (status = 200, body: unknown = { success: true }) =>
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith(base)) return realFetch(url, init);
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    });
  const call = (method: string, path: string, body?: unknown, auth = 'Bearer key') =>
    realFetch(`${base}${path}`, { method, headers: { Authorization: auth }, ...(body !== undefined && { body: JSON.stringify(body) }) });

  it('requires the API key', async () => {
    assert.equal((await call('GET', '/phone', undefined, 'Bearer no')).status, 401);
  });

  it('maps /phone and /waba to the configured ids and keeps the query', async () => {
    stub();
    await call('GET', '/phone/whatsapp_business_profile?fields=about,email');
    await call('POST', '/waba/message_templates', { name: 'hello' });
    await call('GET', '/phone');
    assert.deepEqual(calls.map((c) => c.url), [
      'https://graph.facebook.com/v25.0/111/whatsapp_business_profile?fields=about%2Cemail',
      'https://graph.facebook.com/v25.0/222/message_templates',
      'https://graph.facebook.com/v25.0/111',
    ]);
    assert.equal((calls[1]!.init!.headers as Record<string, string>).Authorization, 'Bearer tok');
    assert.equal(Buffer.from(calls[1]!.init!.body as Buffer).toString(), '{"name":"hello"}');
  });

  it('relays Graph errors with their status and body', async () => {
    stub(400, { error: { code: 100, message: 'bad template' } });
    const res = await call('POST', '/waba/message_templates', {});
    assert.deepEqual([res.status, await res.json()], [400, { error: { code: 100, message: 'bad template' } }]);
  });

  it('cannot be turned into an open proxy', async () => {
    stub();
    assert.equal((await call('GET', '/phone/..%2F999')).status, 400);
    assert.equal((await call('GET', '/phone/a%2F..%2Fb')).status, 400);
    assert.equal((await call('POST', '/phone/messages', {})).status, 400);
    await call('GET', '/phone/calls?access_token=stolen&limit=1');
    assert.equal(calls[0]!.url.includes('stolen'), false);
    assert.equal(calls[0]!.url.endsWith('/111/calls?limit=1'), true);
  });

  it('needs the business account id for /waba', async () => {
    const bare = createApp({ ...config, graph: { accessToken: 't', phoneNumberId: '1', version: 'v25.0' } });
    await new Promise<void>((resolve) => bare.listen(0, '127.0.0.1', resolve));
    const res = await realFetch(`http://127.0.0.1:${(bare.address() as AddressInfo).port}/waba/subscribed_apps`, { headers: { Authorization: 'Bearer key' } });
    bare.close();
    assert.equal(res.status, 503);
  });
});
