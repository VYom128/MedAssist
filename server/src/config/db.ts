import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

/**
 * Connects Mongoose and wires connection event logging.
 * @param uri Defaults to MONGO_URI from config.
 */
export async function connectDB(uri = config.mongoUri): Promise<typeof mongoose> {
  if (!uri) throw new Error('MONGO_URI is not set');

  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));

  const conn = await mongoose.connect(uri, {
    // Indexes are synced on boot outside production; production uses a migration script (spec §18).
    autoIndex: !config.isProd,
    serverSelectionTimeoutMS: 10_000,
  });
  logger.info({ db: conn.connection.name }, 'MongoDB connected');
  return conn;
}

/** Closes the Mongoose connection (used by graceful shutdown). */
export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
}

/** True when Mongoose reports a live connection. */
export function isDBConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}
