import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/http.js';
import { getSchedulerHealth, getSchedulerSettings, updateSchedulerSettings } from './scheduler.service.js';

export const schedulerRouter = Router();

const updateSettingsSchema = z
  .object({
    timezone: z.string().min(2).max(64).optional(),
    ingestionEnabled: z.boolean().optional(),
    ingestionHour: z.coerce.number().int().min(0).max(23).optional(),
    ingestionMinute: z.coerce.number().int().min(0).max(59).optional(),
    ingestionMaxDailyAttempts: z.coerce.number().int().min(1).max(10).optional(),
    ingestionRetryDelayMin: z.coerce.number().int().min(1).max(180).optional(),
    ingestionBatchSize: z.coerce.number().int().min(10).max(500).optional(),
    ingestionMaxAccounts: z.coerce.number().int().min(1).max(20000).optional(),
    sheetsEnabled: z.boolean().optional(),
    sheetsHour: z.coerce.number().int().min(0).max(23).optional(),
    sheetsMinute: z.coerce.number().int().min(0).max(59).optional(),
    sheetsMaxDailyAttempts: z.coerce.number().int().min(1).max(10).optional(),
    sheetsRetryDelayMin: z.coerce.number().int().min(1).max(180).optional(),
    sheetsMaxConfigsPerTick: z.coerce.number().int().min(1).max(2000).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'No fields to update.'
  });

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Validation error', parsed.error.issues);
  }

  return parsed.data;
}

schedulerRouter.get(
  '/settings',
  asyncHandler(async (_req, res) => {
    const result = await getSchedulerSettings();
    res.status(200).json(result);
  })
);

schedulerRouter.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const payload = parseBody(updateSettingsSchema, req.body);
    const result = await updateSchedulerSettings(payload);
    res.status(200).json(result);
  })
);

schedulerRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const result = await getSchedulerHealth();
    res.status(200).json(result);
  })
);
