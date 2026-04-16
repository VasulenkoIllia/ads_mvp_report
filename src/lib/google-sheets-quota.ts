type UnknownObject = Record<string, unknown>;

export type GoogleSheetsQuotaExhaustedMeta = {
  retryAfterSeconds: number | null;
  quotaMetric: string | null;
  quotaLimit: string | null;
  quotaLimitValue: number | null;
  quotaUnit: string | null;
  quotaLocation: string | null;
  service: string | null;
  consumer: string | null;
  reason: string | null;
};

export class GoogleSheetsQuotaExhaustedError extends Error {
  readonly meta: GoogleSheetsQuotaExhaustedMeta;

  constructor(meta: GoogleSheetsQuotaExhaustedMeta) {
    super(formatGoogleSheetsQuotaMessage(meta));
    this.name = 'GoogleSheetsQuotaExhaustedError';
    this.meta = meta;
  }
}

function isObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null;
}

function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractStringField(text: string, field: string): string | null {
  const pattern = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`, 'i');
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractNumberField(text: string, field: string): number | null {
  const raw = extractStringField(text, field);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.ceil(parsed);
}

function extractHeaderRetryAfterSeconds(error: unknown): number | null {
  if (!isObject(error) || !isObject(error.response) || !isObject(error.response.headers)) {
    return null;
  }

  const retryAfter = error.response.headers['retry-after'];
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return null;
  }

  const text = String(raw).trim();
  if (!text) {
    return null;
  }

  const parsed = Number.parseFloat(text);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.ceil(parsed);
  }

  const asDate = new Date(text);
  if (!Number.isNaN(asDate.getTime())) {
    const seconds = Math.ceil((asDate.getTime() - Date.now()) / 1000);
    return seconds > 0 ? seconds : null;
  }

  return null;
}

function extractSecondsByPattern(text: string, pattern: RegExp): number[] {
  const values: number[] = [];
  const matches = text.matchAll(pattern);

  for (const match of matches) {
    const raw = match[1];
    if (!raw) {
      continue;
    }

    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }

    values.push(Math.ceil(parsed));
  }

  return values;
}

export function extractGoogleSheetsRetryAfterSeconds(source: unknown): number | null {
  const text = toText(source);
  const values = [
    ...extractSecondsByPattern(text, /"retryAfter"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/gi),
    ...extractSecondsByPattern(text, /Retry in\s+([0-9]+(?:\.[0-9]+)?)\s+seconds?/gi),
    ...extractSecondsByPattern(text, /retryAfter(?:Seconds)?\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/gi)
  ];

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

export function isGoogleSheetsQuotaErrorSource(source: unknown): boolean {
  return /Quota exceeded for quota metric|RATE_LIMIT_EXCEEDED|ReadRequestsPerMinutePerUser|sheets\.googleapis\.com\/read_requests|RESOURCE_EXHAUSTED/i.test(
    toText(source)
  );
}

export function parseGoogleSheetsQuotaExhaustedMeta(error: unknown): GoogleSheetsQuotaExhaustedMeta | null {
  if (!isObject(error)) {
    return null;
  }

  const response = isObject(error.response) ? error.response : null;
  const status = typeof response?.status === 'number' ? response.status : null;
  if (status !== 429) {
    return null;
  }

  const responseData = response?.data;
  const message = typeof error.message === 'string' ? error.message : '';
  const sourceText = `${toText(responseData)} ${message}`;

  if (!isGoogleSheetsQuotaErrorSource(sourceText)) {
    return null;
  }

  return {
    retryAfterSeconds:
      extractHeaderRetryAfterSeconds(error) ??
      extractGoogleSheetsRetryAfterSeconds(responseData) ??
      extractGoogleSheetsRetryAfterSeconds(message),
    quotaMetric: extractStringField(sourceText, 'quota_metric'),
    quotaLimit: extractStringField(sourceText, 'quota_limit'),
    quotaLimitValue: extractNumberField(sourceText, 'quota_limit_value'),
    quotaUnit: extractStringField(sourceText, 'quota_unit'),
    quotaLocation: extractStringField(sourceText, 'quota_location'),
    service: extractStringField(sourceText, 'service'),
    consumer: extractStringField(sourceText, 'consumer'),
    reason: extractStringField(sourceText, 'reason')
  };
}

export function resolveGoogleSheetsQuotaRetryDelayMs(
  meta: GoogleSheetsQuotaExhaustedMeta,
  fallbackDelayMs: number
): number {
  const retryAfterMs = meta.retryAfterSeconds && meta.retryAfterSeconds > 0 ? meta.retryAfterSeconds * 1000 : 0;

  const isReadPerMinuteLimit =
    meta.quotaMetric === 'sheets.googleapis.com/read_requests' &&
    meta.quotaLimit === 'ReadRequestsPerMinutePerUser';

  if (isReadPerMinuteLimit) {
    return Math.max(fallbackDelayMs, retryAfterMs, 65_000);
  }

  return Math.max(fallbackDelayMs, retryAfterMs);
}

export function formatGoogleSheetsQuotaMessage(meta: GoogleSheetsQuotaExhaustedMeta): string {
  const segments = ['Google Sheets quota exhausted'];

  if (meta.retryAfterSeconds && meta.retryAfterSeconds > 0) {
    segments.push(`retryAfter=${meta.retryAfterSeconds}s`);
  }

  if (meta.quotaMetric) {
    segments.push(`quotaMetric=${meta.quotaMetric}`);
  }

  if (meta.quotaLimit) {
    segments.push(`quotaLimit=${meta.quotaLimit}`);
  }

  if (meta.quotaLimitValue && meta.quotaLimitValue > 0) {
    segments.push(`quotaLimitValue=${meta.quotaLimitValue}`);
  }

  if (meta.reason) {
    segments.push(`reason=${meta.reason}`);
  }

  return segments.join('; ');
}
