import { createServer, type Server } from 'node:http';
import { hasBearer } from './auth.js';
import type { Config } from './config.js';
import { SeenKeys, type ParsedEvent } from './events.js';
import { createGraph, type Graph } from './graph.js';
import { gateway } from './gateway.js';
import { sendJson } from './http.js';
import { deleteMedia, fetchMedia } from './media.js';
import { markRead, sendMedia, sendMessage } from './messages.js';
import { createPipeline } from './pipeline.js';
import { deleteConversation, listContacts, listConversations, listMessages } from './queries.js';
import { createRouter, type Context, type Handler } from './router.js';
import { createSink } from './sink.js';
import { openStore } from './store.js';
import { receiveEvent, verifyHandshake } from './webhook.js';

export function createApp(config: Config): Server {
  const seen = new SeenKeys();
  const graph = config.graph && createGraph(config.graph);
  const store = openStore(config.dbPath);

  const pipeline = createPipeline({ downloadsDir: config.downloadsDir, store, graph, forward: createSink(config.events) });
  const handleEvent = (event: ParsedEvent) => {
    pipeline(event).catch((error) => console.error('event processing failed:', error instanceof Error ? error.message : error));
  };

  /** Everything but the webhook is public through the tunnel: demand the API key (503 if none is configured). */
  const authorized = ({ req, res }: Context): boolean => {
    const failure = !config.apiKey
      ? { status: 503, error: 'API_KEY is not configured' }
      : !hasBearer(req.headers.authorization, config.apiKey)
        ? { status: 401, error: 'Unauthorized' }
        : null;
    if (failure) sendJson(res, failure.status, { error: failure.error });
    return failure === null;
  };
  const protectedRoute = (handler: Handler): Handler => async (ctx) => {
    if (authorized(ctx)) await handler(ctx);
  };
  /** Same, for routes that call the Graph API: 503 unless sending is configured. */
  const sendingRoute = (handler: (ctx: Context, graph: Graph) => void | Promise<void>): Handler => async (ctx) => {
    if (!authorized(ctx)) return;
    if (!graph) return sendJson(ctx.res, 503, { error: 'Sending is not configured' });
    await handler(ctx, graph);
  };

  const gateways: Record<string, Handler> = {};
  for (const target of ['phone', 'waba'] as const) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const handler = sendingRoute((ctx, g) => gateway(ctx, g, target));
      gateways[`${method} /${target}`] = handler;
      gateways[`${method} /${target}/*`] = handler;
    }
  }

  const route = createRouter({
    ...gateways,
    'GET /health': ({ res }) => sendJson(res, 200, { ok: true }),
    'GET /webhook': ({ res, url }) => verifyHandshake(url, res, config),
    'POST /webhook': ({ req, res }) => receiveEvent(req, res, config, seen, handleEvent),
    'GET /conversations': protectedRoute((ctx) => listConversations(ctx, store)),
    'GET /conversations/:chat/messages': protectedRoute((ctx) => listMessages(ctx, store)),
    'DELETE /conversations/:chat': protectedRoute((ctx) => deleteConversation(ctx, store)),
    'GET /contacts': protectedRoute((ctx) => listContacts(ctx, store)),
    'POST /messages': sendingRoute(({ req, res }, g) => sendMessage(req, res, { graph: g, store })),
    'POST /read': sendingRoute(({ req, res }, g) => markRead(req, res, g)),
    'GET /media/:id': sendingRoute(fetchMedia),
    'DELETE /media/:id': sendingRoute(deleteMedia),
    'POST /media': sendingRoute(({ req, res }, g) => sendMedia(req, res, { graph: g, store })),
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = route(req.method ?? '', url.pathname);
    try {
      if (match) await match.handler({ req, res, url, params: match.params });
      else res.writeHead(404).end('Not found');
    } catch (error) {
      console.error(error);
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
    }
  });
  server.on('close', () => store.close());
  return server;
}
