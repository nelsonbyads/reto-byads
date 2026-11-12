import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { scheduleMaintenance } from './maintenance.js';

const config = loadConfig();
const app = await buildApp(config);

try {
  await app.deps.storage.ensureBuckets();
} catch (error) {
  // The storage volume may be missing; /api/ready reports it and uploads fail loudly.
  app.log.error({ err: error.message }, 'could not ensure storage buckets');
}

const stopMaintenance = scheduleMaintenance({
  pool: app.deps.pool,
  log: app.log,
  intervalMs: config.maintenance.intervalMinutes * 60 * 1000,
  retention: config.maintenance.retention,
});

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  stopMaintenance();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.port, host: config.host });
