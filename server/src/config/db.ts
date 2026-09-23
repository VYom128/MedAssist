import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export type DBState = 'connected' | 'disconnected' | 'connecting' | 'disconnecting';

const STATES: Record<number, DBState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

let listenersAttached = false;

/** Logs connection events. Only the database name is logged – never the URI (it holds credentials). */
function attachListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const conn = mongoose.connection;
  conn.on('connected', () => logger.info({ db: conn.name }, 'MongoDB connected'));
  conn.on('disconnected', () => logger.warn({ db: conn.name }, 'MongoDB disconnected'));
  conn.on('reconnected', () => logger.info({ db: conn.name }, 'MongoDB reconnected'));
  conn.on('error', (err: Error) =>
    logger.error({ err: { name: err.name, message: err.message } }, 'MongoDB connection error'),
  );
}

/**
 * Connects Mongoose to MONGO_URI (or `uri`).
 * @param uri Defaults to MONGO_URI from config.
 */
export async function connectDB(uri = config.mongoUri): Promise<typeof mongoose> {
  if (!uri) throw new Error('MONGO_URI is not set');
  attachListeners();
  return mongoose.connect(uri, {
    // Indexes are synced on boot outside production; production uses a migration script (spec §18).
    autoIndex: !config.isProd,
    serverSelectionTimeoutMS: 10_000,
  });
}

/** Closes the Mongoose connection (used by graceful shutdown). */
export async function disconnectDB(): Promise<void> {
  await mongoose.connection.close();
}

/** Current connection state from `mongoose.connection.readyState`. */
export function getDBState(): DBState {
  return STATES[mongoose.connection.readyState] ?? 'disconnected';
}
