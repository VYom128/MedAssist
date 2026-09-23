import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX, BODY_LIMIT } from './config/constants.js';
import { env, isProduction } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { apiLimiter } from './middlewares/rateLimiters.js';
import { requestId } from './middlewares/requestId.js';
import apiRoutes from './routes.js';
import { logger } from './utils/logger.js';

export interface CreateAppOptions {
  /** Extra routers mounted under /api/v1 before the 404 handler (used by tests). */
  mount?: (app: Express) => void;
}

export function createApp({ mount }: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind Render/Railway proxies in production (spec §18): needed for correct client IPs.
  if (isProduction) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      // Log method, url and status only – never bodies or headers.
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true,
      exposedHeaders: ['X-Request-Id'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use(cookieParser());

  app.use(API_PREFIX, apiLimiter);
  app.use(API_PREFIX, apiRoutes);
  mount?.(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
