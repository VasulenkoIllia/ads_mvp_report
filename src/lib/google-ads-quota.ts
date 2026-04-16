type UnknownObject = Record<string, unknown>;

export type GoogleAdsQuotaExhaustedMeta = {
  retryAfterSeconds: number | null;
  rateScope: string | null;
  rateName: string | null;
  requestId: string | null;
};

export class GoogleAdsQuotaExhaustedError extends Error {
  readonly meta: GoogleAdsQuotaExhaustedMeta;

  constructor(meta: GoogleAdsQuotaExhaustedMeta) {
    super(formatGoogleAdsQuotaMessage(meta));
    this.name = 'GoogleAdsQuotaExhaustedError';
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

export function extractGoogleAdsRetryAfterSeconds(source: unknown): number | null {
  const text = toText(source);
  const values = [
    ...extractSecondsByPattern(text, /"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"/gi),
    ...extractSecondsByPattern(text, /Retry in\s+([0-9]+(?:\.[0-9]+)?)\s+seconds?/gi),
    ...extractSecondsByPattern(text, /retryAfter(?:Seconds)?\s*[=:]\s*([0-9]+(?:\.[0-9]+)?)/gi)
  ];

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

export function isGoogleAdsQuotaErrorSource(source: unknown): boolean {
  return /RESOURCE_EXHAUSTED|Google Ads quota exhausted|quotaError/i.test(toText(source));
}

export function parseGoogleAdsQuotaExhaustedMeta(error: unknown): GoogleAdsQuotaExhaustedMeta | null {
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

  if (!isGoogleAdsQuotaErrorSource(sourceText)) {
    return null;
  }

  return {
    retryAfterSeconds: extractGoogleAdsRetryAfterSeconds(responseData) ?? extractGoogleAdsRetryAfterSeconds(message),
    rateScope: extractStringField(sourceText, 'rateScope'),
    rateName: extractStringField(sourceText, 'rateName'),
    requestId: extractStringField(sourceText, 'requestId')
  };
}

export function formatGoogleAdsQuotaMessage(meta: GoogleAdsQuotaExhaustedMeta): string {
  const segments = ['Google Ads quota exhausted'];

  if (meta.retryAfterSeconds && meta.retryAfterSeconds > 0) {
    segments.push(`retryAfter=${meta.retryAfterSeconds}s`);
  }

  if (meta.rateScope) {
    segments.push(`rateScope=${meta.rateScope}`);
  }

  if (meta.rateName) {
    segments.push(`rateName=${meta.rateName}`);
  }

  if (meta.requestId) {
    segments.push(`requestId=${meta.requestId}`);
  }

  return segments.join('; ');
}
