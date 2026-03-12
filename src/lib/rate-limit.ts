import type express from 'express';

type RateLimitConfig = {
  windowMs: number;
  max: number;
  keyPrefix: string;
  message: string;
  shouldApply?: (req: express.Request) => boolean;
  keyGenerator?: (req: express.Request) => string;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

function pruneExpired(store: Map<string, RateLimitBucket>, now: number): void {
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

function normalizeRequestKey(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : 'anonymous';
}

export function createRateLimiter(config: RateLimitConfig): express.RequestHandler {
  const store = new Map<string, RateLimitBucket>();
  let requestCounter = 0;

  return (req, res, next) => {
    if (config.shouldApply && !config.shouldApply(req)) {
      next();
      return;
    }

    if (config.windowMs <= 0 || config.max <= 0) {
      next();
      return;
    }

    const now = Date.now();
    requestCounter += 1;
    if (requestCounter % 500 === 0 || store.size > 5000) {
      pruneExpired(store, now);
    }

    const requestKey = normalizeRequestKey(config.keyGenerator?.(req) ?? req.ip);
    const bucketKey = `${config.keyPrefix}:${requestKey}`;
    const current = store.get(bucketKey);

    let bucket: RateLimitBucket;
    if (!current || current.resetAt <= now) {
      bucket = {
        count: 0,
        resetAt: now + config.windowMs
      };
      store.set(bucketKey, bucket);
    } else {
      bucket = current;
    }

    bucket.count += 1;

    const remaining = Math.max(0, config.max - bucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    res.setHeader('X-RateLimit-Limit', String(config.max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));

    if (bucket.count > config.max) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({
        message: config.message,
        errorCode: 'RATE_LIMITED',
        details: {
          retryAfterSeconds
        }
      });
      return;
    }

    next();
  };
}
