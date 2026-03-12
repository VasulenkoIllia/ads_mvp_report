import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/http.js';
import { createAppSessionToken, setAppSessionCookie } from '../auth/auth.service.js';
import {
  completeGoogleOAuth,
  disconnectGoogleOAuth,
  getGoogleAdsAccountById,
  getGoogleIntegrationStatus,
  listGoogleAdsAccounts,
  startGoogleOAuth,
  syncMccAccounts,
  updateGoogleAdsAccount
} from './google.service.js';

export const googleRouter = Router();

const startOAuthQuerySchema = z.object({
  redirectPath: z.string().trim().max(300).optional()
});

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

const listAccountsQuerySchema = z.object({
  q: z.string().trim().max(220).optional(),
  isInMcc: z.enum(['true', 'false']).optional(),
  ingestionEnabled: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(500).optional()
});

const updateAccountSchema = z
  .object({
    ingestionEnabled: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No fields to update.'
  });

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }

  return parsed.data;
}

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }

  return parsed.data;
}

function safeRedirectPath(value: string | null | undefined): string {
  if (!value) {
    return '/';
  }

  const normalized = value.trim();
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return '/';
  }

  return normalized;
}

googleRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const result = await getGoogleIntegrationStatus();
    res.status(200).json(result);
  })
);

googleRouter.get(
  '/oauth/start',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(startOAuthQuerySchema, req.query);
    const result = await startGoogleOAuth(payload.redirectPath);
    res.status(200).json(result);
  })
);

googleRouter.get(
  '/oauth/callback',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(callbackQuerySchema, req.query);
    const result = await completeGoogleOAuth(payload);
    const session = createAppSessionToken(result.grantedEmail ?? '');
    setAppSessionCookie(res, session.token, session.expiresAt);

    // If callback was opened directly in browser, close it back to dashboard.
    if (req.headers.accept?.includes('text/html')) {
      const redirectPath = safeRedirectPath(result.redirectPath);
      res.redirect(302, redirectPath);
      return;
    }

    res.status(200).json({
      ...result,
      session: {
        email: session.email,
        expiresAt: session.expiresAt.toISOString()
      }
    });
  })
);

googleRouter.post(
  '/oauth/disconnect',
  asyncHandler(async (_req, res) => {
    const result = await disconnectGoogleOAuth();
    res.status(200).json(result);
  })
);

googleRouter.post(
  '/accounts/sync',
  asyncHandler(async (_req, res) => {
    const result = await syncMccAccounts();
    res.status(200).json(result);
  })
);

googleRouter.get(
  '/accounts',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listAccountsQuerySchema, req.query);
    const result = await listGoogleAdsAccounts({
      q: payload.q,
      isInMcc: payload.isInMcc === undefined ? undefined : payload.isInMcc === 'true',
      ingestionEnabled: payload.ingestionEnabled === undefined ? undefined : payload.ingestionEnabled === 'true',
      take: payload.take
    });

    res.status(200).json(result);
  })
);

googleRouter.get(
  '/accounts/:accountId',
  asyncHandler(async (req, res) => {
    const result = await getGoogleAdsAccountById(req.params.accountId);
    res.status(200).json(result);
  })
);

googleRouter.patch(
  '/accounts/:accountId',
  asyncHandler(async (req, res) => {
    const payload = parseBody(updateAccountSchema, req.body);
    const result = await updateGoogleAdsAccount(req.params.accountId, {
      ingestionEnabled: payload.ingestionEnabled
    });

    res.status(200).json(result);
  })
);
