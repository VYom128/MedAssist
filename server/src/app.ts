import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type Request, type Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { API_PREFIX, BODY_LIMIT } from './config/constants.js';
import { config } from './config/env.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { notFound } from './middlewares/notFound.js';
import { rejectOperatorKeys } from './middlewares/rejectOperatorKeys.js';
import { apiLimiter } from './middlewares/rateLimiters.js';
import { requestId } from './middlewares/requestId.js';
import apiRoutes from './routes/index.js';
import { logger } from './utils/logger.js';

export interface CreateAppOptions {
  /** Test-only routes, mounted after the API routes and before notFound/errorHandler. */
  extraRoutes?: Router;
}

/** Builds the Express app (middleware, routes, error handling) without listening. */
export function createApp({ extraRoutes }: CreateAppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Behind proxies (spec §18): how many X-Forwarded-For hops to trust for the client IP –
  // on Render 3 alone, 4 with the Vercel rewrite in front (TRUST_PROXY, measured: D207).
  app.set('trust proxy', config.trustProxy);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as Request).id,
      // Health checks are polled often; keep them out of dev logs.
      autoLogging: config.isDev
        ? { ignore: (req) => (req as Request).originalUrl.startsWith(`${API_PREFIX}/health`) }
        : true,
      // Log method, path and status only – never bodies, headers or query strings (queries can
      // hold search terms such as patient names; spec §10.3).
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url.split('?')[0],
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
  // Content-Disposition: the client names downloads (reports, PDFs) as the server does.
  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(cookieParser());
  app.use(rejectOperatorKeys);

  app.use('/api', apiLimiter);
  app.use(API_PREFIX, apiRoutes);
  if (extraRoutes) app.use(extraRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
