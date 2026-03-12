import {
  SheetColumnMode,
  SheetDataMode,
  SheetRunStatus,
  SheetWriteMode,
  TriggerSource
} from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler } from '../../lib/http.js';
import {
  deleteSheetExportConfig,
  getManualSheetExportRangeRunById,
  getSheetExportColumnsCatalog,
  getSheetExportHealth,
  getSheetExportRunById,
  listManualSheetExportRangeRuns,
  listSheetExportConfigs,
  listSheetExportRuns,
  runManualSheetExportForDate,
  runSheetExports,
  startManualSheetExportRange,
  upsertSheetExportConfig
} from './sheets.service.js';

export const sheetsRouter = Router();

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const listConfigsQuerySchema = z.object({
  accountId: z.string().min(1).optional(),
  active: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(500).optional()
});

const upsertConfigSchema = z.object({
  spreadsheetId: z.string().min(10),
  sheetName: z.string().min(1).max(120),
  writeMode: z.nativeEnum(SheetWriteMode).optional(),
  dataMode: z.nativeEnum(SheetDataMode).optional(),
  columnMode: z.nativeEnum(SheetColumnMode).optional(),
  selectedColumns: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  campaignStatuses: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  active: z.boolean().optional()
});

const runSchema = z.object({
  runDate: z.string().regex(dateRegex).optional(),
  accountId: z.string().min(1).optional()
});

const manualRunSchema = z.object({
  runDate: z.string().regex(dateRegex).optional(),
  accountId: z.string().min(1),
  spreadsheetId: z.string().min(10),
  sheetName: z.string().min(1).max(120),
  writeMode: z.nativeEnum(SheetWriteMode).optional(),
  dataMode: z.nativeEnum(SheetDataMode).optional(),
  columnMode: z.nativeEnum(SheetColumnMode).optional(),
  selectedColumns: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  campaignStatuses: z.array(z.string().trim().min(1).max(40)).max(20).optional()
});

const manualRangeRunSchema = z.object({
  accountId: z.string().min(1),
  dateFrom: z.string().regex(dateRegex),
  dateTo: z.string().regex(dateRegex),
  spreadsheetId: z.string().min(10),
  sheetName: z.string().min(1).max(120),
  writeMode: z.nativeEnum(SheetWriteMode).optional(),
  dataMode: z.nativeEnum(SheetDataMode).optional(),
  columnMode: z.nativeEnum(SheetColumnMode).optional(),
  selectedColumns: z.array(z.string().trim().min(1).max(64)).max(40).optional(),
  campaignStatuses: z.array(z.string().trim().min(1).max(40)).max(20).optional()
});

const listRunsQuerySchema = z.object({
  accountId: z.string().min(1).optional(),
  status: z.nativeEnum(SheetRunStatus).optional(),
  triggerSource: z.nativeEnum(TriggerSource).optional(),
  take: z.coerce.number().int().min(1).max(200).optional()
});

const listManualRangeRunsQuerySchema = z.object({
  accountId: z.string().min(1).optional(),
  status: z.nativeEnum(SheetRunStatus).optional(),
  take: z.coerce.number().int().min(1).max(200).optional()
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

sheetsRouter.get(
  '/options',
  asyncHandler(async (_req, res) => {
    res.status(200).json({
      enums: {
        writeModes: Object.values(SheetWriteMode),
        dataModes: Object.values(SheetDataMode),
        columnModes: Object.values(SheetColumnMode),
        runStatuses: Object.values(SheetRunStatus),
        triggerSources: Object.values(TriggerSource)
      },
      defaults: {
        writeMode: SheetWriteMode.UPSERT,
        dataMode: SheetDataMode.CAMPAIGN,
        columnMode: SheetColumnMode.ALL
      },
      limits: {
        dateFormat: 'YYYY-MM-DD',
        selectedColumnsMax: 40,
        campaignStatusesMax: 20
      }
    });
  })
);

sheetsRouter.get(
  '/columns-catalog',
  asyncHandler(async (_req, res) => {
    const result = await getSheetExportColumnsCatalog();
    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/configs',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listConfigsQuerySchema, req.query);

    const result = await listSheetExportConfigs({
      accountId: payload.accountId,
      active: payload.active === undefined ? undefined : payload.active === 'true',
      take: payload.take
    });

    res.status(200).json(result);
  })
);

sheetsRouter.put(
  '/configs/:accountId',
  asyncHandler(async (req, res) => {
    const payload = parseBody(upsertConfigSchema, req.body);

    const result = await upsertSheetExportConfig({
      adsAccountId: req.params.accountId,
      spreadsheetId: payload.spreadsheetId,
      sheetName: payload.sheetName,
      writeMode: payload.writeMode,
      dataMode: payload.dataMode,
      columnMode: payload.columnMode,
      selectedColumns: payload.selectedColumns,
      campaignStatuses: payload.campaignStatuses,
      active: payload.active
    });

    res.status(200).json(result);
  })
);

sheetsRouter.delete(
  '/configs/:configId',
  asyncHandler(async (req, res) => {
    const result = await deleteSheetExportConfig(req.params.configId);
    res.status(200).json(result);
  })
);

sheetsRouter.post(
  '/runs',
  asyncHandler(async (req, res) => {
    const payload = parseBody(runSchema, req.body);

    const result = await runSheetExports({
      runDate: payload.runDate,
      accountId: payload.accountId,
      triggerSource: TriggerSource.MANUAL
    });

    res.status(200).json(result);
  })
);

sheetsRouter.post(
  '/runs/manual',
  asyncHandler(async (req, res) => {
    const payload = parseBody(manualRunSchema, req.body);

    const result = await runManualSheetExportForDate({
      runDate: payload.runDate,
      accountId: payload.accountId,
      spreadsheetId: payload.spreadsheetId,
      sheetName: payload.sheetName,
      writeMode: payload.writeMode,
      dataMode: payload.dataMode,
      columnMode: payload.columnMode,
      selectedColumns: payload.selectedColumns,
      campaignStatuses: payload.campaignStatuses
    });

    res.status(200).json(result);
  })
);

sheetsRouter.post(
  '/manual-range-runs',
  asyncHandler(async (req, res) => {
    const payload = parseBody(manualRangeRunSchema, req.body);

    const result = await startManualSheetExportRange({
      accountId: payload.accountId,
      dateFrom: payload.dateFrom,
      dateTo: payload.dateTo,
      spreadsheetId: payload.spreadsheetId,
      sheetName: payload.sheetName,
      writeMode: payload.writeMode,
      dataMode: payload.dataMode,
      columnMode: payload.columnMode,
      selectedColumns: payload.selectedColumns,
      campaignStatuses: payload.campaignStatuses
    });

    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/manual-range-runs',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listManualRangeRunsQuerySchema, req.query);
    const result = await listManualSheetExportRangeRuns({
      accountId: payload.accountId,
      status: payload.status,
      take: payload.take
    });
    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/manual-range-runs/:runId',
  asyncHandler(async (req, res) => {
    const result = await getManualSheetExportRangeRunById(req.params.runId);
    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/runs',
  asyncHandler(async (req, res) => {
    const payload = parseQuery(listRunsQuerySchema, req.query);

    const result = await listSheetExportRuns({
      accountId: payload.accountId,
      status: payload.status,
      triggerSource: payload.triggerSource,
      take: payload.take
    });

    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const result = await getSheetExportRunById(req.params.runId);
    res.status(200).json(result);
  })
);

sheetsRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const result = await getSheetExportHealth();
    res.status(200).json(result);
  })
);
