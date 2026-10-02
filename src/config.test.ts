import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

const base = { META_APP_SECRET: 's', WHATSAPP_VERIFY_TOKEN: 't' };

describe('loadConfig', () => {
  it('requires the webhook secrets', () => {
    assert.throws(() => loadConfig({}));
  });

  it('validates the port', () => {
    assert.equal(loadConfig(base).port, 3000);
    assert.equal(loadConfig({ ...base, PORT: '8080' }).port, 8080);
    for (const PORT of ['abc', '-1', '70000', '1.5']) assert.throws(() => loadConfig({ ...base, PORT }), /PORT/);
  });

  it('enables the read API with a key alone', () => {
    const config = loadConfig({ ...base, API_KEY: 'k' });
    assert.deepEqual([config.apiKey, config.graph], ['k', undefined]);
  });

  it('leaves sending disabled without an access token', () => {
    assert.equal(loadConfig(base).graph, undefined);
  });

  it('requires a secret with the events URL and validates it', () => {
    assert.throws(() => loadConfig({ ...base, EVENTS_URL: 'https://app.example/e' }));
    assert.throws(() => loadConfig({ ...base, EVENTS_URL: 'ftp://x', EVENTS_SECRET: 's' }));
    assert.deepEqual(loadConfig({ ...base, EVENTS_URL: 'https://app.example/e', EVENTS_SECRET: 's' }).events, { url: 'https://app.example/e', secret: 's' });
  });

  it('configures transcription from a URL alone', () => {
    assert.equal(loadConfig(base).transcribe, undefined);
    assert.throws(() => loadConfig({ ...base, TRANSCRIBE_URL: 'localhost:8178' }));
    assert.deepEqual(loadConfig({ ...base, TRANSCRIBE_URL: 'http://x/v1/audio/transcriptions' }).transcribe, { url: 'http://x/v1/audio/transcriptions', model: 'whisper-1' });
    const full = loadConfig({ ...base, TRANSCRIBE_URL: 'https://x/t', TRANSCRIBE_MODEL: 'm', TRANSCRIBE_API_KEY: 'k', TRANSCRIBE_LANGUAGE: 'fr' });
    assert.deepEqual(full.transcribe, { url: 'https://x/t', model: 'm', apiKey: 'k', language: 'fr' });
  });

  it('requires phone number id and API key once an access token is set', () => {
    assert.throws(() => loadConfig({ ...base, WHATSAPP_ACCESS_TOKEN: 'a' }));
    const config = loadConfig({ ...base, WHATSAPP_ACCESS_TOKEN: 'a', WHATSAPP_PHONE_NUMBER_ID: 'p', API_KEY: 'k' });
    assert.equal(config.graph?.version, 'v25.0');
    assert.equal(config.apiKey, 'k');
  });
});
