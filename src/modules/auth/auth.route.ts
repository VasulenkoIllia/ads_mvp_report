import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/http.js';
import { startGoogleOAuth } from '../google/google.service.js';
import { clearAppSessionCookie, ensureAppSession } from './auth.service.js';

export const authRouter = Router();

const loginStartQuerySchema = z.object({
  redirectPath: z.string().trim().max(300).optional()
});

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }

  return parsed.data;
}

authRouter.get(
  '/session',
  asyncHandler(async (req, res) => {
    const session = ensureAppSession(req, res);
    if (!session) {
      res.status(401).json({
        authenticated: false,
        message: 'Unauthorized. Login required.'
      });
      return;
    }

    res.status(200).json({
      authenticated: true,
      ...session
    });
  })
);

authRouter.get(
  '/login/start',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(loginStartQuerySchema, req.query);
    const result = await startGoogleOAuth(payload.redirectPath);
    res.status(200).json(result);
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    clearAppSessionCookie(res);
    res.status(200).json({
      status: 'logged_out'
    });
  })
);
