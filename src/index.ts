import { loadConfig } from './config.js';
import { createApp } from './server.js';

const config = loadConfig();
const server = createApp(config);
server.listen(config.port, '127.0.0.1', () => console.log(`Serveur sur http://127.0.0.1:${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} reçu, arrêt`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
