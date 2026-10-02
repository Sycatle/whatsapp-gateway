import { sign } from './auth.js';
import type { EventsConfig } from './config.js';
import { isEmpty, type ParsedEvent } from './events.js';

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];
const TIMEOUT_MS = 10_000;

/**
 * Forwards events to an external service as a POST signed like Meta's own webhooks
 * (`X-Hub-Signature-256`, keyed with `secret`). Returns undefined when not configured.
 */
export function createSink(config?: EventsConfig, retryDelays = RETRY_DELAYS_MS): ((event: ParsedEvent) => void) | undefined {
  if (!config) return undefined;
  const { url, secret } = config;

  async function deliver(body: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sign(body, secret) },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (res.ok) return;
        throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        const delay = retryDelays[attempt];
        const reason = error instanceof Error ? error.message : String(error);
        if (delay === undefined) {
          console.error(`event forwarding abandoned after ${attempt + 1} attempts: ${reason}`);
          return;
        }
        console.error(`event forwarding failed (${reason}), retrying in ${delay} ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return (event) => {
    if (isEmpty(event)) return;
    void deliver(JSON.stringify({ receivedAt: new Date().toISOString(), ...event }));
  };
}
