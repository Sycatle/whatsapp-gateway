import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { hasBearer } from './auth.js';
import type { Config } from './config.js';
import { SeenKeys, type ParsedEvent } from './events.js';
import { createGraph, type Graph } from './graph.js';
import { sendJson } from './http.js';
import { saveMedia } from './media.js';
import { sendText } from './messages.js';
import { receiveEvent, verifyHandshake } from './webhook.js';

export function createApp(config: Config): Server {
  const seen = new SeenKeys();
  const graph = config.graph && createGraph(config.graph);

  /** Runs after the webhook was acknowledged; failures are logged, never thrown. */
  const handleEvent = (event: ParsedEvent) => {
    if (!graph) return;
    for (const message of event.messages) {
      saveMedia(graph, config.downloadsDir, message)
        .then((path) => path && console.log(`media saved id=${message.id} path=${path}`))
        .catch((error) => console.error(`media failed id=${message.id}: ${error instanceof Error ? error.message : error}`));
    }
  };

  /** Runs a sending route only for a configured server and an authorized caller. */
  const protectedRoute = (handler: (req: IncomingMessage, res: ServerResponse, graph: Graph) => Promise<void>) =>
    async (req: IncomingMessage, res: ServerResponse) => {
      if (!config.graph || !graph) return sendJson(res, 503, { error: 'Sending is not configured' });
      if (!hasBearer(req.headers.authorization, config.graph.apiKey)) return sendJson(res, 401, { error: 'Unauthorized' });
      await handler(req, res, graph);
    };

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => void | Promise<void>> = {
    'GET /health': (_req, res) => sendJson(res, 200, { ok: true }),
    'GET /webhook': (_req, res, url) => verifyHandshake(url, res, config),
    'POST /webhook': (req, res) => receiveEvent(req, res, config, seen, handleEvent),
    'POST /messages': protectedRoute(sendText),
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (route) await route(req, res, url);
      else res.writeHead(404).end('Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    }
  });
}
