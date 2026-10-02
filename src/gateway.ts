import { readBody, sendJson } from './http.js';
import type { Graph } from './graph.js';
import type { Context } from './router.js';

const MAX_BODY = 1024 * 1024;
const SEGMENT = /^[\w.-]+$/;
/** These have typed routes that also keep the store up to date. */
const TYPED = new Set(['messages', 'media']);

/**
 * Reaches the rest of the Cloud API (templates, business profile, blocking, groups, calls, coexistence sync,
 * subscriptions, flows, QR codes...) without opening the whole Graph API: `/phone/<path>` maps to
 * `/<phone number id>/<path>` and `/waba/<path>` to `/<business account id>/<path>`, with the server's token.
 * Graph's status and body are relayed unchanged.
 */
export async function gateway({ req, res, url, params }: Context, graph: Graph, target: 'phone' | 'waba'): Promise<void> {
  const id = target === 'phone' ? graph.phoneNumberId : graph.businessAccountId;
  if (!id) return sendJson(res, 503, { error: 'WHATSAPP_BUSINESS_ACCOUNT_ID is not configured' });

  const segments = (params.rest ?? '').split('/').filter(Boolean);
  if (segments.some((segment) => !SEGMENT.test(segment) || segment === '.' || segment === '..')) {
    return sendJson(res, 400, { error: 'Invalid path' });
  }
  if (target === 'phone' && TYPED.has(segments[0] ?? '')) {
    return sendJson(res, 400, { error: `Use POST /${segments[0]} instead` });
  }

  let body: Buffer<ArrayBuffer> | undefined;
  if (req.method === 'POST') {
    const read = await readBody(req, res, MAX_BODY);
    if (!read) return;
    body = read;
  }

  const query = new URLSearchParams(url.search);
  query.delete('access_token');
  const search = query.size ? `?${query}` : '';
  const upstream = await graph.raw([id, ...segments].join('/') + search, {
    method: req.method,
    ...(body && { body, headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json' } }),
  });
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' });
  res.end(Buffer.from(await upstream.arrayBuffer()));
}
