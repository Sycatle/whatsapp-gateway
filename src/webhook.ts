import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';

const MAX_BODY = 1024 * 1024;

export function verifyHandshake(url: URL, res: ServerResponse, config: Config): void {
  const valid = url.searchParams.get('hub.mode') === 'subscribe'
    && url.searchParams.get('hub.verify_token') === config.verifyToken;
  res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain' });
  res.end(valid ? url.searchParams.get('hub.challenge') ?? '' : 'Forbidden');
  if (valid) console.log('Webhook vérifié par Meta');
}

export async function receiveEvent(req: IncomingMessage, res: ServerResponse, config: Config): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const expected = Buffer.from(`sha256=${createHmac('sha256', config.appSecret).update(body).digest('hex')}`);
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
}
