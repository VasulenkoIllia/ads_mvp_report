import cors from 'cors';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { Prisma } from '@prisma/client';
import { env } from './config/env.js';
import { ApiError, asyncHandler } from './lib/http.js';
import { prisma } from './lib/prisma.js';
import { createRateLimiter } from './lib/rate-limit.js';
import { authRouter } from './modules/auth/auth.route.js';
import { ensureAppSession, getAppSessionFromRequest } from './modules/auth/auth.service.js';
import { googleRouter } from './modules/google/google.route.js';
import { ingestionRouter } from './modules/ingestion/ingestion.route.js';
import { schedulerRouter } from './modules/scheduler/scheduler.route.js';
import { startSchedulers } from './modules/scheduler/scheduler.service.js';
import { sheetsRouter } from './modules/sheets/sheets.route.js';

const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    censor: '[REDACTED]'
  }
});

function isJsonBodyParseError(error: unknown): boolean {
  if (!(error instanceof SyntaxError)) {
    return false;
  }

  const candidate = error as SyntaxError & {
    status?: number;
    type?: string;
    body?: unknown;
  };

  return candidate.status === 400 || candidate.type === 'entity.parse.failed' || candidate.body !== undefined;
}

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === '/auth/session' ||
    pathname === '/auth/login/start' ||
    pathname === '/auth/logout' ||
    pathname === '/google/oauth/callback'
  );
}

const WRITE_RATE_LIMIT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isWriteRateLimitedPath(pathname: string): boolean {
  return (
    pathname === '/auth/logout' ||
    pathname === '/google/oauth/disconnect' ||
    pathname === '/google/accounts/sync' ||
    pathname === '/ingestion/runs' ||
    pathname === '/scheduler/settings' ||
    pathname === '/sheets/runs' ||
    pathname === '/sheets/runs/manual' ||
    pathname === '/sheets/manual-range-runs' ||
    pathname.startsWith('/google/accounts/') ||
    pathname.startsWith('/sheets/configs/')
  );
}

function shouldApplyWriteRateLimit(req: express.Request): boolean {
  const method = req.method.toUpperCase();
  if (!WRITE_RATE_LIMIT_METHODS.has(method)) {
    return false;
  }

  return isWriteRateLimitedPath(req.path);
}

function resolveRateLimitIdentity(req: express.Request): string {
  try {
    const session = getAppSessionFromRequest(req);
    if (session?.email) {
      return `email:${session.email}`;
    }
  } catch {
    // Fall back to IP key when session cookie is invalid.
  }

  return `ip:${req.ip || 'unknown'}`;
}

function getCorsOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return origins.length > 0 ? origins : ['http://localhost:4010', 'http://localhost:5173'];
}

function requireAuthenticatedSession(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (isPublicApiPath(req.path)) {
    next();
    return;
  }

  const session = ensureAppSession(req, res);
  if (!session) {
    res.status(401).json({
      message: 'Unauthorized. Login with allowed Google account.'
    });
    return;
  }

  next();
}

async function bootstrap() {
  const app = express();
  app.set('trust proxy', 1);
  const corsOrigins = getCorsOrigins(env.CORS_ORIGIN);
  const loginStartRateLimiter = createRateLimiter({
    windowMs: env.RATE_LIMIT_AUTH_LOGIN_START_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_LOGIN_START_MAX,
    keyPrefix: 'auth-login-start',
    message: 'Too many login attempts. Please retry shortly.',
    shouldApply: (req) => req.method === 'GET' && req.path === '/auth/login/start',
    keyGenerator: (req) => `ip:${req.ip || 'unknown'}`
  });
  const writeRateLimiter = createRateLimiter({
    windowMs: env.RATE_LIMIT_WRITE_WINDOW_MS,
    max: env.RATE_LIMIT_WRITE_MAX,
    keyPrefix: 'api-write',
    message: 'Too many write requests. Please retry shortly.',
    shouldApply: shouldApplyWriteRateLimit,
    keyGenerator: resolveRateLimitIdentity
  });

  app.use(
    pinoHttp({
      logger
    })
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new ApiError(403, `CORS blocked origin: ${origin}`));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: '1mb' }));

  app.get(
    '/healthz',
    asyncHandler(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ ok: true, db: 'up' });
    })
  );

  app.use('/api/v1', loginStartRateLimiter);
  app.use('/api/v1', writeRateLimiter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', requireAuthenticatedSession);
  app.use('/api/v1/google', googleRouter);
  app.use('/api/v1/ingestion', ingestionRouter);
  app.use('/api/v1/sheets', sheetsRouter);
  app.use('/api/v1/scheduler', schedulerRouter);

  app.get('/api/v1', (_req, res) => {
    res.status(200).json({
      message: 'Ads MVP Report API',
      version: '0.1.0'
    });
  });

  if (env.DASHBOARD_ENABLED) {
    const webDistDir = path.resolve(process.cwd(), 'web/dist');
    const webDistIndex = path.join(webDistDir, 'index.html');

    if (existsSync(webDistIndex)) {
      app.use(express.static(webDistDir, { index: false }));

      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path === '/healthz') {
          next();
          return;
        }

        res.sendFile(webDistIndex);
      });
    } else {
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path === '/healthz') {
          next();
          return;
        }

        res.status(503).json({
          message: 'Dashboard build is missing. Run `npm run web:build` or start `npm run web:dev`.'
        });
      });
    }
  }

  app.use((req, res) => {
    res.status(404).json({
      message: `Route not found: ${req.method} ${req.originalUrl}`
    });
  });

  app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (isJsonBodyParseError(error)) {
      req.log.warn({ error }, 'Invalid JSON body');
      res.status(400).json({
        message: 'Invalid JSON body.',
        details: null
      });
      return;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021') {
      req.log.error({ error }, 'Database schema is missing tables');
      res.status(500).json({
        message: 'Database schema is outdated. Run `npm run db:push` and restart API.',
        errorCode: 'DB_SCHEMA_OUTDATED'
      });
      return;
    }

    if (error instanceof ApiError) {
      req.log.warn({ error }, 'API error');
      res.status(error.statusCode).json({
        message: error.message,
        errorCode: error.errorCode,
        details: error.details ?? null
      });
      return;
    }

    req.log.error({ error }, 'Unhandled API error');
    res.status(500).json({
      message: 'Internal server error'
    });
  });

  const scheduler = startSchedulers(logger);
  const server = app.listen(env.PORT, () => {
    logger.info(`API is running on http://localhost:${env.PORT}`);
  });

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;

    logger.info({ signal }, 'Shutting down gracefully...');

    scheduler.stop();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await prisma.$disconnect();
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

bootstrap().catch((error) => {
  logger.error({ error }, 'Failed to bootstrap app');
  process.exitCode = 1;
});
