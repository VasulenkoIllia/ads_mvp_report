import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/http.js';
import {
  listCampaigns,
  listCampaignSyncRuns,
  syncCampaignsForAccount,
  syncCampaignsForAllAccounts
} from './campaigns.service.js';

export const campaignsRouter = Router();

const syncSchema = z.object({
  accountId: z.string().min(1).optional()
});

const listCampaignsSchema = z.object({
  accountId: z.string().min(1).optional(),
  status: z.string().min(1).optional(),
  q: z.string().optional(),
  take: z.coerce.number().int().min(1).max(5000).optional()
});

const listSyncRunsSchema = z.object({
  accountId: z.string().min(1).optional(),
  take: z.coerce.number().int().min(1).max(200).optional()
});

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }
  return parsed.data;
}

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }
  return parsed.data;
}

campaignsRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const payload = parseBody(syncSchema, req.body);

    if (payload.accountId) {
      const result = await syncCampaignsForAccount(payload.accountId);
      res.status(200).json(result);
    } else {
      const result = await syncCampaignsForAllAccounts();
      res.status(200).json(result);
    }
  })
);

campaignsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listCampaignsSchema, req.query);
    const result = await listCampaigns({
      accountId: payload.accountId,
      status: payload.status,
      q: payload.q,
      take: payload.take
    });
    res.status(200).json(result);
  })
);

campaignsRouter.get(
  '/sync-runs',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listSyncRunsSchema, req.query);
    const result = await listCampaignSyncRuns({
      accountId: payload.accountId,
      take: payload.take
    });
    res.status(200).json(result);
  })
);
