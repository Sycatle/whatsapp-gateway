import { loadConfig } from './config.js';
import { createApp } from './server.js';

const config = loadConfig();
createApp(config).listen(config.port, '127.0.0.1', () => console.log(`Serveur sur http://127.0.0.1:${config.port}`));
