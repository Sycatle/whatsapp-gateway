import { loadConfig } from './config.js';
import { createApp } from './server.js';

const config = loadConfig();
const server = createApp(config);

server.on('error', (error) => {
  console.error(`Server error: ${error.message}`);
  process.exit(1);
});
server.listen(config.port, '127.0.0.1', () => console.log(`Listening on http://127.0.0.1:${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    console.log(`${signal} received, shutting down`);
    // Stop accepting webhooks, then finish what was already acknowledged before closing the store.
    server.close(() => void server.shutdown().then(() => process.exit(0)));
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 30_000).unref();
  });
}
