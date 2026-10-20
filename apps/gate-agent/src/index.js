#!/usr/bin/env node
// Agente de caseta. Ver README: "Caseta física".
import { loadConfig } from './config.js';
import { startAgent } from './agent.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const stop = startAgent(config);
process.stdout.write(`Agente de caseta conectado a ${config.apiUrl}\n`);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
