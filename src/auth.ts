import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** `sha256=<hex>`, the format of Meta's `X-Hub-Signature-256` header. */
export function sign(body: string | Buffer, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function verifySignature(body: Buffer, header: string | undefined, appSecret: string): boolean {
  return safeEqual(header ?? '', sign(body, appSecret));
}

export function hasBearer(header: string | undefined, apiKey: string): boolean {
  return safeEqual(header ?? '', `Bearer ${apiKey}`);
}
