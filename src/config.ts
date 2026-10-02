export interface Config {
  port: number;
  verifyToken: string;
  appSecret: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const { WHATSAPP_VERIFY_TOKEN: verifyToken, META_APP_SECRET: appSecret } = env;
  if (!verifyToken || !appSecret) throw new Error('WHATSAPP_VERIFY_TOKEN et META_APP_SECRET requis');
  return { port: Number(env.PORT ?? 3000), verifyToken, appSecret };
}
