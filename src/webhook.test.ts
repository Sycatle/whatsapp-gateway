import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './server.js';

const config = { port: 0, verifyToken: 'verify', appSecret: 'secret', downloadsDir: 'downloads', dbPath: ':memory:' };
const sign = (body: string) => `sha256=${createHmac('sha256', config.appSecret).update(body).digest('hex')}`;

let server: Server;
let base: string;

before(async () => {
  server = createApp(config);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

describe('GET /webhook', () => {
  it('echoes the challenge for a valid token', async () => {
    const res = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=42`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '42');
  });

  it('rejects a wrong token', async () => {
    const res = await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
    assert.equal(res.status, 403);
  });
});

describe('POST /webhook', () => {
  const post = (body: string, signature?: string) =>
    fetch(`${base}/webhook`, { method: 'POST', body, headers: signature ? { 'x-hub-signature-256': signature } : {} });

  it('accepts a signed event', async () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
    assert.equal((await post(body, sign(body))).status, 200);
  });

  it('rejects a missing or wrong signature', async () => {
    const body = '{}';
    assert.equal((await post(body)).status, 403);
    assert.equal((await post(body, sign('other'))).status, 403);
  });

  it('rejects a signed body that is not JSON', async () => {
    const body = 'not json';
    assert.equal((await post(body, sign(body))).status, 400);
  });

  it('rejects bodies over 16 MiB', async () => {
    const body = 'x'.repeat(16 * 1024 * 1024 + 1);
    assert.equal((await post(body, sign(body))).status, 413);
  });
});
