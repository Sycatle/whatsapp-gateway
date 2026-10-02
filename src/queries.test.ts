import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { access, mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './server.js';

describe('read API', () => {
  let server: Server;
  let base: string;
  let dir: string;
  const get = (path: string, method = 'GET', auth: string | null = 'Bearer key') =>
    fetch(`${base}${path}`, { method, headers: auth ? { Authorization: auth } : {} });

  const webhook = async (value: object) => {
    const body = JSON.stringify({ entry: [{ changes: [{ field: 'messages', value }] }] });
    const signature = `sha256=${createHmac('sha256', 's').update(body).digest('hex')}`;
    await fetch(`${base}/webhook`, { method: 'POST', body, headers: { 'x-hub-signature-256': signature } });
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wa-'));
    server = createApp({ port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: dir, dbPath: ':memory:', apiKey: 'key' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  it('requires the API key', async () => {
    assert.equal((await get('/conversations', 'GET', null)).status, 401);
    assert.equal((await get('/contacts', 'GET', 'Bearer nope')).status, 401);
  });

  it('answers 503 without a configured key', async () => {
    const open = createApp({ port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: dir, dbPath: ':memory:' });
    await new Promise<void>((resolve) => open.listen(0, '127.0.0.1', resolve));
    const res = await fetch(`http://127.0.0.1:${(open.address() as AddressInfo).port}/conversations`);
    open.close();
    assert.equal(res.status, 503);
  });

  it('lists conversations, messages and contacts received through the webhook', async () => {
    await webhook({
      contacts: [{ wa_id: '33600000001', profile: { name: 'Ada' } }],
      messages: [
        { id: 'm1', from: '33600000001', timestamp: '1700000000', type: 'text', text: { body: 'one' } },
        { id: 'm2', from: '33600000001', timestamp: '1700000100', type: 'text', text: { body: 'two' } },
      ],
    });
    const { conversations } = await (await get('/conversations')).json() as { conversations: { chat: string; name: string; messages: number }[] };
    assert.deepEqual([conversations[0]!.chat, conversations[0]!.name, conversations[0]!.messages], ['33600000001', 'Ada', 2]);

    const page = await (await get('/conversations/33600000001/messages?limit=1')).json() as { messages: { id: string }[] };
    assert.deepEqual(page.messages.map((m) => m.id), ['m2']);
    const older = await (await get('/conversations/33600000001/messages?before=1700000100')).json() as { messages: { id: string }[] };
    assert.deepEqual(older.messages.map((m) => m.id), ['m1']);

    assert.deepEqual((await (await get('/contacts')).json() as { contacts: unknown[] }).contacts, [{ phone: '33600000001', name: null, profileName: 'Ada' }]);
  });

  it('rejects malformed chat ids', async () => {
    assert.equal((await get('/conversations/a%20b/messages')).status, 400);
  });

  it('rejects an invalid pagination cursor', async () => {
    assert.equal((await get('/conversations/33600000001/messages?before=abc')).status, 400);
    assert.equal((await get('/conversations/33600000001/messages?before_id=m1')).status, 400);
  });

  it('pages through messages sharing a timestamp without skipping any', async () => {
    await webhook({
      messages: ['a', 'b', 'c'].map((id) => ({ id, from: '33600000009', timestamp: '1700000500', type: 'text', text: { body: id } })),
    });
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const { messages } = await (await get(`/conversations/33600000009/messages?limit=1${cursor}`)).json() as { messages: { id: string; timestamp: number }[] };
      if (!messages.length) break;
      seen.push(messages[0]!.id);
      cursor = `&before=${messages[0]!.timestamp}&before_id=${messages[0]!.id}`;
    }
    assert.deepEqual(seen, ['a', 'b', 'c']);
  });

  it('survives a request URL the parser rejects', async () => {
    const { connect } = await import('node:net');
    const { port } = server.address() as AddressInfo;
    const status = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => socket.write('GET // HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'));
      let data = '';
      socket.on('data', (chunk) => (data += chunk));
      socket.on('end', () => resolve(data.split('\r\n')[0]!));
      socket.on('error', reject);
    });
    assert.equal(status, 'HTTP/1.1 400 Bad Request');
    assert.equal((await get('/conversations')).status, 200);
  });

  it('erases a conversation and its downloaded file', async () => {
    const realFetch = globalThis.fetch;
    mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith(base)) return realFetch(url, init);
      return String(url).endsWith('/55')
        ? new Response(JSON.stringify({ url: 'https://cdn.example/f', mime_type: 'image/png' }))
        : new Response('png');
    });
    const withGraph = createApp({
      port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: dir, dbPath: ':memory:', apiKey: 'key',
      graph: { accessToken: 't', phoneNumberId: '1', version: 'v25.0' },
    });
    await new Promise<void>((resolve) => withGraph.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(withGraph.address() as AddressInfo).port}`;

    await webhook({ messages: [{ id: 'img', from: '33600000009', timestamp: '1', type: 'image', image: { id: '55' } }] });
    await access(join(dir, '55.png'));
    const res = await get('/conversations/33600000009', 'DELETE');
    assert.deepEqual(await res.json(), { deletedFiles: 1 });
    await assert.rejects(access(join(dir, '55.png')));
    assert.deepEqual((await (await get('/conversations')).json() as { conversations: unknown[] }).conversations, []);
    withGraph.close();
    mock.restoreAll();
  });
});
