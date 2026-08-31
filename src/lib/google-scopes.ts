/**
 * Helpers around Google OAuth scope grants.
 *
 * Kept dependency-free (no env/prisma/axios) so it stays unit-testable and can
 * be imported from any layer.
 */

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

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

/** Required scopes that are absent from the granted list. */
export function getMissingScopes(granted: string[], required: string[]): string[] {
  const have = new Set(granted.map((item) => item.trim()).filter((item) => item.length > 0));
  return required
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !have.has(item));
}

/**
 * True only for Google's "the token lacks the scope" 403 — NOT for ordinary
 * permission 403s (a suspended account, a spreadsheet the user cannot open).
 * Matching on the error text rather than the bare status code keeps the
 * existing per-account 403 semantics intact: this is a cross-cutting
 * credential problem, not a per-entity one.
 */
export function isInsufficientScopeError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as {
    response?: { status?: number; data?: unknown };
    statusCode?: number;
    message?: unknown;
  };

  const status = candidate.response?.status ?? candidate.statusCode;
  if (status !== 403) {
    return false;
  }

  const haystack = `${toText(candidate.response?.data)} ${toText(candidate.message)}`;
  return /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(haystack);
}
