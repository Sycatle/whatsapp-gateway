import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const port = Number(process.env.PORT ?? 3000);
const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const appSecret = process.env.META_APP_SECRET;
if (!verifyToken || !appSecret) throw new Error('WHATSAPP_VERIFY_TOKEN et META_APP_SECRET requis');

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const valid = url.searchParams.get('hub.mode') === 'subscribe'
      && url.searchParams.get('hub.verify_token') === verifyToken;
    res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain' });
    res.end(valid ? url.searchParams.get('hub.challenge') ?? '' : 'Forbidden');
    if (valid) console.log('Webhook vérifié par Meta');
    return;
  }
  if (req.method === 'POST' && url.pathname === '/webhook') {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const expected = Buffer.from(`sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`);
      const supplied = Buffer.from(String(req.headers['x-hub-signature-256'] ?? ''));
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        res.writeHead(403).end('Invalid signature');
        return;
      }
      const event: unknown = JSON.parse(body.toString());
      res.writeHead(200).end('EVENT_RECEIVED');
      console.log(JSON.stringify({ receivedAt: new Date().toISOString(), event }, null, 2));
    } catch (error) {
      console.error(error);
      if (!res.headersSent) res.writeHead(400).end('Invalid request');
    }
    return;
  }
  res.writeHead(404).end('Not found');
}).listen(port, '127.0.0.1', () => console.log(`Serveur sur http://127.0.0.1:${port}`));
