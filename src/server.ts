import { createServer, type Server } from 'node:http';
import type { Config } from './config.js';
import { receiveEvent, verifyHandshake } from './webhook.js';

export function createApp(config: Config): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } else if (req.method === 'GET' && url.pathname === '/webhook') {
      verifyHandshake(url, res, config);
    } else if (req.method === 'POST' && url.pathname === '/webhook') {
      await receiveEvent(req, res, config);
    } else {
      res.writeHead(404).end('Not found');
    }
  });
}
