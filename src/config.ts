export interface GraphConfig {
  accessToken: string;
  phoneNumberId: string;
  version: string;
  apiKey: string;
}

export interface Config {
  port: number;
  verifyToken: string;
  appSecret: string;
  downloadsDir: string;
  dbPath: string;
  /** Present only when sending is configured. */
  graph?: GraphConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { WHATSAPP_VERIFY_TOKEN: verifyToken, META_APP_SECRET: appSecret } = env;
  if (!verifyToken || !appSecret) throw new Error('WHATSAPP_VERIFY_TOKEN et META_APP_SECRET requis');
  const config: Config = {
    port: Number(env.PORT ?? 3000),
    verifyToken,
    appSecret,
    downloadsDir: env.DOWNLOADS_DIR ?? 'downloads',
    dbPath: env.DB_PATH ?? 'data/handler.db',
  };

  const { WHATSAPP_ACCESS_TOKEN: accessToken, WHATSAPP_PHONE_NUMBER_ID: phoneNumberId, API_KEY: apiKey } = env;
  if (accessToken) {
    if (!phoneNumberId || !apiKey) {
      throw new Error('WHATSAPP_PHONE_NUMBER_ID et API_KEY requis quand WHATSAPP_ACCESS_TOKEN est défini');
    }
    config.graph = { accessToken, phoneNumberId, apiKey, version: env.GRAPH_API_VERSION ?? 'v25.0' };
  }
  return config;
}
