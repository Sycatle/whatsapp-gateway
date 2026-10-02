import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Reads the whole request body, or answers 413 and closes the connection once
 * `limit` bytes are exceeded. Returns null when the response was already sent.
 */
export function readBody(req: IncomingMessage, res: ServerResponse, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const tooLarge = () => {
      req.off('data', onData);
      res.once('finish', () => req.destroy());
      res.writeHead(413, { Connection: 'close' }).end();
      resolve(null);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) return tooLarge();
      chunks.push(chunk);
    };
    if (Number(req.headers['content-length']) > limit) return tooLarge();
    req.on('data', onData);
    req.once('end', () => resolve(Buffer.concat(chunks)));
    req.once('error', reject);
  });
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
}
