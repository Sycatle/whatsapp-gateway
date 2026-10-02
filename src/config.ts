export interface GraphConfig {
  accessToken: string;
  phoneNumberId: string;
  /** Needed only for the `/waba` gateway (templates, subscriptions...). */
  businessAccountId?: string;
  version: string;
}

export interface EventsConfig {
  url: string;
  secret: string;
}

export interface TranscribeConfig {
  /** Full URL of an OpenAI-compatible `/v1/audio/transcriptions` endpoint. */
  url: string;
  model: string;
  apiKey?: string;
  /** ISO 639-1 hint; detected automatically when absent. */
  language?: string;
}

export interface Config {
  port: number;
  verifyToken: string;
  appSecret: string;
  downloadsDir: string;
  dbPath: string;
  /** Bearer key for every route except the webhook and `/health`; those routes answer 503 without it. */
  apiKey?: string;
  /** Speech-to-text for voice notes and audio; absent when not configured. */
  transcribe?: TranscribeConfig;
  /** Where to forward processed events; absent when not configured. */
  events?: EventsConfig;
  /** Present only when sending is configured. */
  graph?: GraphConfig;
}

function httpUrl(name: string, value: string): string {
  try {
    if (/^https?:$/.test(new URL(value).protocol)) return value;
  } catch {
    // reported below
  }
  throw new Error(`${name} must be a valid http:// or https:// URL`);
}

function parsePort(value: string | undefined): number {
  const port = value === undefined || value === '' ? 3000 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535');
  return port;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { WHATSAPP_VERIFY_TOKEN: verifyToken, META_APP_SECRET: appSecret } = env;
  if (!verifyToken || !appSecret) throw new Error('WHATSAPP_VERIFY_TOKEN and META_APP_SECRET are required');
  const config: Config = {
    port: parsePort(env.PORT),
    verifyToken,
    appSecret,
    downloadsDir: env.DOWNLOADS_DIR ?? 'downloads',
    dbPath: env.DB_PATH ?? 'data/gateway.db',
  };

  const { EVENTS_URL: eventsUrl, EVENTS_SECRET: eventsSecret } = env;
  if (eventsUrl) {
    if (!eventsSecret) throw new Error('EVENTS_SECRET is required when EVENTS_URL is set');
    config.events = { url: httpUrl('EVENTS_URL', eventsUrl), secret: eventsSecret };
  }

  const { TRANSCRIBE_URL: transcribeUrl } = env;
  if (transcribeUrl) {
    config.transcribe = { url: httpUrl('TRANSCRIBE_URL', transcribeUrl), model: env.TRANSCRIBE_MODEL ?? 'whisper-1' };
    if (env.TRANSCRIBE_API_KEY) config.transcribe.apiKey = env.TRANSCRIBE_API_KEY;
    if (env.TRANSCRIBE_LANGUAGE) config.transcribe.language = env.TRANSCRIBE_LANGUAGE;
  }

  const { WHATSAPP_ACCESS_TOKEN: accessToken, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, API_KEY: apiKey } = env;
  if (apiKey) config.apiKey = apiKey;
  if (accessToken) {
    if (!phoneNumberId || !apiKey) {
      throw new Error('WHATSAPP_PHONE_NUMBER_ID and API_KEY are required when WHATSAPP_ACCESS_TOKEN is set');
    }
    config.graph = { accessToken, phoneNumberId, version: env.GRAPH_API_VERSION ?? 'v25.0' };
    if (env.WHATSAPP_BUSINESS_ACCOUNT_ID) config.graph.businessAccountId = env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  }
  return config;
}
