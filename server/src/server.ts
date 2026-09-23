import type { Server } from 'node:http';
import { connectDB, disconnectDB } from './config/db.js';
import { API_PREFIX } from './config/constants.js';
import { config } from './config/env.js';
import { createApp } from './app.js';
import { logger, serializeError } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function start() {
  await connectDB();

  const app = createApp();
  const server: Server = app.listen(config.port, () => {
    logger.info(
      `API listening on http://localhost:${config.port}${API_PREFIX} (${config.nodeEnv})`,
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down: no longer accepting connections');

    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    server.close(async () => {
      try {
        await disconnectDB();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err: serializeError(err) }, 'Error during shutdown');
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: serializeError(reason) }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: serializeError(err) }, 'Uncaught exception');
  process.exit(1);
});

start().catch((err) => {
  logger.fatal({ err: serializeError(err) }, 'Failed to start server');
  process.exit(1);
});
