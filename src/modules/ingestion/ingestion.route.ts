import { IngestionRunStatus, TriggerSource } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError, asyncHandler } from '../../lib/http.js';
import {
  getActiveIngestionRun,
  getGoogleAdsIngestionHealth,
  getGoogleAdsIngestionRunById,
  getIngestionCoverage,
  listCampaignDailyFacts,
  listGoogleAdsIngestionRuns,
  preflightGoogleAdsIngestion,
  previewCampaignDailyFacts,
  runGoogleAdsIngestion
} from './ingestion.service.js';

export const ingestionRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function optionalBooleanParam() {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (!normalized) {
        return undefined;
      }
      if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
      }
      if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
      }
    }

    return value;
  }, z.boolean().optional());
}

const runSchema = z.object({
  runDate: z.string().regex(dateRegex).optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  accountId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  takeAccounts: z.coerce.number().int().min(1).max(20000).optional(),
  batchSize: z.coerce.number().int().min(10).max(500).optional(),
  enabledOnly: optionalBooleanParam(),
  includeInactiveAccounts: optionalBooleanParam()
});

const preflightSchema = z.object({
  runDate: z.string().regex(dateRegex).optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  accountId: z.string().min(1).optional(),
  takeAccounts: z.coerce.number().int().min(1).max(20000).optional(),
  batchSize: z.coerce.number().int().min(10).max(500).optional(),
  enabledOnly: optionalBooleanParam(),
  includeInactiveAccounts: optionalBooleanParam()
});

const listRunsSchema = z.object({
  status: z.nativeEnum(IngestionRunStatus).optional(),
  triggerSource: z.nativeEnum(TriggerSource).optional(),
  runDate: z.string().regex(dateRegex).optional(),
  take: z.coerce.number().int().min(1).max(100).optional()
});

const listFactsSchema = z.object({
  accountId: z.string().min(1).optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  take: z.coerce.number().int().min(1).max(2000).optional()
});

const previewFactsSchema = z.object({
  accountId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  dateFrom: z.string().regex(dateRegex).optional(),
  dateTo: z.string().regex(dateRegex).optional(),
  take: z.coerce.number().int().min(1).max(500).optional()
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

ingestionRouter.get(
  '/options',
  asyncHandler(async (_req, res) => {
    res.status(200).json({
      enums: {
        runStatuses: Object.values(IngestionRunStatus),
        triggerSources: Object.values(TriggerSource)
      },
      limits: {
        dateFormat: 'YYYY-MM-DD',
        maxRangeDays: env.INGESTION_MAX_RANGE_DAYS,
        takeAccounts: { min: 1, max: 20000, default: 5000 },
        batchSize: { min: 10, max: 500, default: 100 }
      }
    });
  })
);

ingestionRouter.post(
  '/runs',
  asyncHandler(async (req, res) => {
    const payload = parseBody(runSchema, req.body);

    const result = await runGoogleAdsIngestion({
      runDate: payload.runDate,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      accountId: payload.accountId,
      campaignId: payload.campaignId,
      takeAccounts: payload.takeAccounts,
      batchSize: payload.batchSize,
      enabledOnly: payload.enabledOnly,
      includeInactiveAccounts: payload.includeInactiveAccounts,
      triggerSource: TriggerSource.MANUAL
    });

    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/preflight',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(preflightSchema, req.query);

    const result = await preflightGoogleAdsIngestion({
      runDate: payload.runDate,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      accountId: payload.accountId,
      takeAccounts: payload.takeAccounts,
      batchSize: payload.batchSize,
      enabledOnly: payload.enabledOnly,
      includeInactiveAccounts: payload.includeInactiveAccounts
    });

    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listRunsSchema, req.query);

    const result = await listGoogleAdsIngestionRuns({
      status: payload.status,
      triggerSource: payload.triggerSource,
      runDate: payload.runDate,
      take: payload.take
    });

    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/runs/active',
  asyncHandler(async (_req, res) => {
    const result = await getActiveIngestionRun();
    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const result = await getGoogleAdsIngestionRunById(req.params.runId);
    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/facts',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listFactsSchema, req.query);

    const result = await listCampaignDailyFacts({
      accountId: payload.accountId,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      take: payload.take
    });

    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(previewFactsSchema, req.query);

    const result = await previewCampaignDailyFacts({
      accountId: payload.accountId,
      campaignId: payload.campaignId,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      take: payload.take
    });

    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/coverage',
  asyncHandler(async (_req, res) => {
    const result = await getIngestionCoverage();
    res.status(200).json(result);
  })
);

ingestionRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const result = await getGoogleAdsIngestionHealth();
    res.status(200).json(result);
  })
);
