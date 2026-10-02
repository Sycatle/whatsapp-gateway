import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function verifySignature(body: Buffer, header: string | undefined, appSecret: string): boolean {
  const expected = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
  return safeEqual(header ?? '', expected);
}

export function hasBearer(header: string | undefined, apiKey: string): boolean {
  return safeEqual(header ?? '', `Bearer ${apiKey}`);
}
