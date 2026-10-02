import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody } from './http.js';
import { safeEqual, verifySignature } from './auth.js';
import type { Config } from './config.js';
import { describe, dropSeen, parseEvent, type ParsedEvent, type SeenKeys } from './events.js';

/** History webhooks can carry thousands of messages in one body. */
const MAX_BODY = 16 * 1024 * 1024;

export function verifyHandshake(url: URL, res: ServerResponse, config: Config): void {
  const valid = url.searchParams.get('hub.mode') === 'subscribe'
    && safeEqual(url.searchParams.get('hub.verify_token') ?? '', config.verifyToken);
  res.writeHead(valid ? 200 : 403, { 'Content-Type': 'text/plain' });
  res.end(valid ? url.searchParams.get('hub.challenge') ?? '' : 'Forbidden');
  if (valid) console.log('Webhook verified by Meta');
}

export async function receiveEvent(req: IncomingMessage, res: ServerResponse, config: Config,
  seen: SeenKeys,
  onEvent: (event: ParsedEvent) => void,
): Promise<void> {
  try {
    const body = await readBody(req, res, MAX_BODY);
    if (!body) return;
    if (!verifySignature(body, req.headers['x-hub-signature-256'] as string | undefined, config.appSecret)) {
      res.writeHead(403).end('Invalid signature');
      return;
    }
    const event = dropSeen(parseEvent(JSON.parse(body.toString())), seen);
    res.writeHead(200).end('EVENT_RECEIVED');
    for (const line of describe(event)) console.log(line);
    onEvent(event);
  } catch (error) {
    console.error(`webhook rejected: ${error instanceof Error ? error.message : error}`);
    if (!res.headersSent) res.writeHead(400).end('Invalid request');
  }
}
