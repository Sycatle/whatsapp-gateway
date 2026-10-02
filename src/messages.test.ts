import { after, afterEach, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './server.js';

const graph = { accessToken: 'tok', phoneNumberId: '123', version: 'v25.0' };
const open = { port: 0, verifyToken: 'v', appSecret: 's', downloadsDir: 'downloads', dbPath: ':memory:' };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('POST /messages', () => {
  const servers: Server[] = [];
  let base: string;
  const realFetch = globalThis.fetch;

  before(async () => {
    const server = createApp({ ...open, apiKey: 'key', graph });
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

  describe('message types', () => {
    let sent = 0;
    const capture = () => {
      const calls: Record<string, unknown>[] = [];
      mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        calls.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ messages: [{ id: `wamid.sent${++sent}` }] }));
      });
      return calls;
    };

    it('sends a quoted reply with a link preview', async () => {
      const calls = capture();
      await post({ to: '33600000000', text: 'see https://x.io', reply_to: 'wamid.in', preview_url: true });
      assert.deepEqual(calls[0], {
        messaging_product: 'whatsapp', to: '33600000000', type: 'text',
        text: { body: 'see https://x.io', preview_url: true }, context: { message_id: 'wamid.in' },
      });
    });

    it('passes the Cloud API object of every other type through', async () => {
      const calls = capture();
      const bodies = [
        { type: 'reaction', reaction: { message_id: 'wamid.in', emoji: '👍' } },
        { type: 'location', location: { latitude: 48.85, longitude: 2.35, name: 'Paris' } },
        { type: 'contacts', contacts: [{ name: { formatted_name: 'Ada' }, phones: [{ phone: '+33600000001' }] }] },
        { type: 'template', template: { name: 'hello', language: { code: 'fr' } } },
        { type: 'interactive', interactive: { type: 'button', body: { text: 'ok?' }, action: { buttons: [] } } },
        { type: 'sticker', sticker: { id: '9' } },
        { type: 'video', video: { link: 'https://x.io/v.mp4' } },
      ];
      for (const body of bodies) assert.equal((await post({ to: '33600000000', ...body })).status, 200);
      assert.deepEqual(calls.map((c) => c.type), bodies.map((b) => b.type));
      assert.deepEqual(calls[2]!.contacts, bodies[2]!.contacts);
    });

    it('addresses users known only by BSUID with recipient', async () => {
      const calls = capture();
      assert.equal((await post({ to: 'US.13491208655302741918', text: 'hi' })).status, 200);
      assert.deepEqual([calls[0]!.recipient, calls[0]!.to], ['US.13491208655302741918', undefined]);
      assert.equal((await post({ to: 'us.nope', text: 'hi' })).status, 400);
    });

    it('sends to a group', async () => {
      const calls = capture();
      await post({ group: 'GROUPID', text: 'hi all' });
      assert.deepEqual([calls[0]!.recipient_type, calls[0]!.to], ['group', 'GROUPID']);
    });

    it('rejects unknown types and ambiguous recipients', async () => {
      assert.equal((await post({ to: '33600000000', type: 'poll', poll: {} })).status, 400);
      assert.equal((await post({ to: '33600000000', group: 'G', text: 'x' })).status, 400);
      assert.equal((await post({ text: 'x' })).status, 400);
      assert.equal((await post({ to: '33600000000', type: 'location', location: 'nope' })).status, 400);
      assert.equal((await post({ to: '33600000000', type: 'contacts', contacts: {} })).status, 400);
    });

    it('keeps sent messages in the conversation, as pending', async () => {
      capture();
      await post({ to: '33600000042', text: 'stored' });
      const res = await realFetch(`${base}/conversations/33600000042/messages`, { headers: { Authorization: 'Bearer key' } });
      const { messages } = await res.json() as { messages: { direction: string; source: string; status: string; content: unknown }[] };
      assert.deepEqual([messages[0]!.direction, messages[0]!.source, messages[0]!.status, messages[0]!.content], ['out', 'api', 'pending', { body: 'stored' }]);
    });
  });

  describe('POST /read', () => {
    const read = (body: unknown) => realFetch(`${base}/read`, { method: 'POST', body: JSON.stringify(body), headers: { Authorization: 'Bearer key' } });
    const capture = () => {
      const calls: Record<string, unknown>[] = [];
      mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        calls.push(JSON.parse(init!.body as string));
        return new Response(JSON.stringify({ success: true }));
      });
      return calls;
    };

    it('marks a message as read', async () => {
      const calls = capture();
      assert.equal((await read({ message_id: 'wamid.in' })).status, 200);
      assert.deepEqual(calls[0], { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.in' });
    });

    it('can show the typing indicator', async () => {
      const calls = capture();
      await read({ message_id: 'wamid.in', typing: true });
      assert.deepEqual(calls[0]!.typing_indicator, { type: 'text' });
    });

    it('requires a message id', async () => {
      assert.equal((await read({})).status, 400);
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

  describe('media', () => {
    const stubGraph = () => {
      const calls: { url: string; body: unknown }[] = [];
      mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        calls.push({ url: String(url), body: init!.body });
        return new Response(JSON.stringify(String(url).endsWith('/media') ? { id: 'media.1' } : { messages: [{ id: 'wamid.8' }] }));
      });
      return calls;
    };
    const upload = (query: string, mime: string, body: BodyInit = 'bytes') =>
      realFetch(`${base}/media?${query}`, { method: 'POST', body, headers: { Authorization: 'Bearer key', 'Content-Type': mime } });

    it('uploads then sends an image with its caption', async () => {
      const calls = stubGraph();
      const res = await upload('to=33600000000&caption=Look', 'image/png');
      assert.deepEqual(await res.json(), { id: 'wamid.8' });
      assert.equal(calls[0]!.url, 'https://graph.facebook.com/v25.0/123/media');
      assert.equal((calls[0]!.body as FormData).get('type'), 'image/png');
      assert.deepEqual(JSON.parse(calls[1]!.body as string), {
        messaging_product: 'whatsapp', to: '33600000000', type: 'image', image: { id: 'media.1', caption: 'Look' },
      });
    });

    it('sends other types as documents with a filename', async () => {
      const calls = stubGraph();
      await upload('to=33600000000&filename=invoice.pdf', 'application/pdf');
      assert.deepEqual(JSON.parse(calls[1]!.body as string).document, { id: 'media.1', filename: 'invoice.pdf' });
    });

    const ogg = (channels: number) =>
      new Blob([Buffer.concat([Buffer.from('OggS'), Buffer.alloc(24), Buffer.from('OpusHead'), Buffer.from([1, channels])])]);

    it('sends mono Ogg/Opus as a voice message', async () => {
      const calls = stubGraph();
      const res = await upload('to=33600000000&voice=true', 'audio/ogg', ogg(1));
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(calls[1]!.body as string).audio, { id: 'media.1', voice: true });
    });

    it('rejects voice messages that are not mono Ogg/Opus', async () => {
      stubGraph();
      const stereo = ogg(2);
      assert.equal((await upload('to=33600000000&voice=true', 'audio/ogg', stereo)).status, 400);
      assert.equal((await upload('to=33600000000&voice=true', 'audio/mpeg')).status, 400);
      assert.equal((await upload('to=33600000000&voice=true', 'audio/ogg', 'not ogg')).status, 400);
      assert.equal((await upload('to=33600000000&voice=true', 'image/png')).status, 400);
    });

    it('sends videos as videos and stickers as stickers, quoting when asked', async () => {
      const calls = stubGraph();
      await upload('to=33600000000&caption=Clip&reply_to=wamid.q', 'video/mp4');
      assert.deepEqual(JSON.parse(calls[1]!.body as string).video, { id: 'media.1', caption: 'Clip' });
      assert.deepEqual(JSON.parse(calls[1]!.body as string).context, { message_id: 'wamid.q' });
      await upload('to=33600000000&sticker=true', 'image/webp');
      assert.deepEqual(JSON.parse(calls[3]!.body as string).sticker, { id: 'media.1' });
      assert.equal((await upload('to=33600000000&sticker=true', 'image/png')).status, 400);
    });

    it('fetches and deletes media by id', async () => {
      const calls: { url: string; method?: string }[] = [];
      mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).startsWith(base)) return realFetch(url, init);
        calls.push({ url: String(url), method: init?.method });
        return String(url).endsWith('/321') && init?.method !== 'DELETE'
          ? new Response(JSON.stringify({ url: 'https://cdn.example/f', mime_type: 'image/png' }))
          : String(url).includes('cdn.example') ? new Response('png-bytes') : new Response(JSON.stringify({ success: true }));
      });
      const auth = { Authorization: 'Bearer key' };
      const got = await realFetch(`${base}/media/321`, { headers: auth });
      assert.deepEqual([got.status, got.headers.get('content-type'), await got.text()], [200, 'image/png', 'png-bytes']);
      assert.equal((await realFetch(`${base}/media/321`, { method: 'DELETE', headers: auth })).status, 200);
      assert.equal(calls.at(-1)!.method, 'DELETE');
      assert.equal((await realFetch(`${base}/media/..%2Fx`, { headers: auth })).status, 400);
    });

    it('requires a recipient and a body', async () => {
      assert.equal((await upload('to=abc', 'image/png')).status, 400);
      assert.equal((await upload('to=33600000000', 'image/png', '')).status, 400);
    });

    it('enforces the image size cap', async () => {
      assert.equal((await upload('to=33600000000', 'image/png', 'x'.repeat(5 * 1024 * 1024 + 1))).status, 413);
    });
  });
});
