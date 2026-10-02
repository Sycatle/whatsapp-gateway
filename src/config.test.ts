import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const base = { META_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 't' };

describe('loadConfig', () => {
  it('requires the webhook secrets', () => {
    assert.throws(() => loadConfig({}));
  });

  it('leaves sending disabled without an access token', () => {
    assert.equal(loadConfig(base).graph, undefined);
  });

  it('requires a secret with the events URL and validates it', () => {
    assert.throws(() => loadConfig({ ...base, EVENTS_URL: 'https://app.example/e' }));
    assert.throws(() => loadConfig({ ...base, EVENTS_URL: 'ftp://x', EVENTS_SECRET: 's' }));
    assert.deepEqual(loadConfig({ ...base, EVENTS_URL: 'https://app.example/e', EVENTS_SECRET: 's' }).events, { url: 'https://app.example/e', secret: 's' });
  });

  it('requires phone number id and API key once an access token is set', () => {
    assert.throws(() => loadConfig({ ...base, WHATSAPP_ACCESS_TOKEN: 'a' }));
    const config = loadConfig({ ...base, WHATSAPP_ACCESS_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: 'p', API_KEY: 'k' });
    assert.equal(config.graph?.version, 'v25.0');
  });
});
