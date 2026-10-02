import type { IncomingMessage, ServerResponse } from 'node:http';
import { GraphError, type Graph } from './graph.js';
import { readBody, sendJson } from './http.js';

const MAX_JSON = 64 * 1024;
/** International format without "+", as expected by the Cloud API. */
const PHONE = /^\d{8,15}$/;

export async function sendText(req: IncomingMessage, res: ServerResponse, graph: Graph): Promise<void> {
  const raw = await readBody(req, res, MAX_JSON);
  if (!raw) return;

  let input: { to?: unknown; text?: unknown };
  try {
    input = JSON.parse(raw.toString());
  } catch {
    return sendJson(res, 400, { error: 'Body must be JSON' });
  }
  const { to, text } = input;
  if (typeof to !== 'string' || !PHONE.test(to)) {
    return sendJson(res, 400, { error: '"to" must be digits only, in international format' });
  }
  if (typeof text !== 'string' || !text || text.length > 4096) {
    return sendJson(res, 400, { error: '"text" must be a string of 1 to 4096 characters' });
  }

  try {
    const id = await graph.sendMessage({ to, type: 'text', text: { body: text } });
    sendJson(res, 200, { id });
  } catch (error) {
    if (!(error instanceof GraphError)) throw error;
    sendJson(res, 502, { error: error.message, code: error.code });
  }
}
