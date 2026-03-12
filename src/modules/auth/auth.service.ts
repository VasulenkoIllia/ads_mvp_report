import crypto from 'crypto';
import type express from 'express';
import { ApiError } from '../../lib/http.js';
import { env } from '../../config/env.js';

const SESSION_COOKIE_NAME = 'ads_mvp_session';
const DAY_MS = 24 * 60 * 60 * 1000;

type SessionPayload = {
  email: string;
  iat: number;
  exp: number;
  nonce: string;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function parseCookieHeader(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }

  return raw.split(';').reduce<Record<string, string>>((acc, item) => {
    const [name, ...rest] = item.split('=');
    const key = name?.trim();
    if (!key) {
      return acc;
    }

    acc[key] = decodeURIComponent(rest.join('=').trim());
    return acc;
  }, {});
}

function splitCsv(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => normalizeEmail(item))
    .filter((item) => item.length > 0);
}

function getAllowedEmails(): string[] {
  const items = splitCsv(env.APP_ALLOWED_GOOGLE_EMAILS);
  return Array.from(new Set(items));
}

function ensureAllowedEmailsConfigured(): string[] {
  const allowed = getAllowedEmails();
  if (allowed.length === 0) {
    throw new ApiError(500, 'APP_ALLOWED_GOOGLE_EMAILS is empty. Configure at least one allowed Google email.');
  }

  return allowed;
}

function getSessionSecret(): Buffer {
  const source = env.APP_SESSION_SECRET?.trim() || env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || 'change_me';
  return crypto.createHash('sha256').update(source).digest();
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function unbase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(data: string): string {
  return crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
}

function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

function encodeSession(payload: SessionPayload): string {
  const data = base64Url(JSON.stringify(payload));
  const signature = signValue(data);
  return `${data}.${signature}`;
}

function decodeSession(token: string): SessionPayload | null {
  const [data, signature] = token.split('.');
  if (!data || !signature) {
    return null;
  }

  const expected = signValue(data);
  if (!safeEquals(signature, expected)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(unbase64Url(data));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<SessionPayload>;
  if (
    typeof candidate.email !== 'string' ||
    typeof candidate.iat !== 'number' ||
    typeof candidate.exp !== 'number' ||
    typeof candidate.nonce !== 'string'
  ) {
    return null;
  }

  return {
    email: normalizeEmail(candidate.email),
    iat: candidate.iat,
    exp: candidate.exp,
    nonce: candidate.nonce
  };
}

export function assertAllowedGoogleLoginEmail(email: string): string {
  const normalized = normalizeEmail(email);
  const allowed = ensureAllowedEmailsConfigured();

  if (!allowed.includes(normalized)) {
    throw new ApiError(403, `Google account ${normalized} is not allowed to access this service.`);
  }

  return normalized;
}

export function createAppSessionToken(email: string): { token: string; expiresAt: Date; email: string } {
  const normalizedEmail = assertAllowedGoogleLoginEmail(email);
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + env.APP_SESSION_TTL_DAYS * 24 * 60 * 60;

  const token = encodeSession({
    email: normalizedEmail,
    iat: nowSec,
    exp: expSec,
    nonce: crypto.randomBytes(12).toString('base64url')
  });

  return {
    token,
    email: normalizedEmail,
    expiresAt: new Date(expSec * 1000)
  };
}

export function clearAppSessionCookie(res: express.Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/'
  });
}

export function setAppSessionCookie(res: express.Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt
  });
}

export function getAppSessionFromRequest(req: express.Request): {
  email: string;
  expiresAt: string;
  expiresInDays: number;
} | null {
  const cookies = parseCookieHeader(req.header('cookie'));
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const payload = decodeSession(token);
  if (!payload) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp <= nowSec) {
    return null;
  }

  const email = assertAllowedGoogleLoginEmail(payload.email);
  const expiresAt = new Date(payload.exp * 1000);
  const expiresInDays = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / DAY_MS));

  return {
    email,
    expiresAt: expiresAt.toISOString(),
    expiresInDays
  };
}

export function ensureAppSession(req: express.Request, res: express.Response): {
  email: string;
  expiresAt: string;
  expiresInDays: number;
} | null {
  try {
    const session = getAppSessionFromRequest(req);
    if (!session) {
      clearAppSessionCookie(res);
      return null;
    }

    return session;
  } catch {
    clearAppSessionCookie(res);
    return null;
  }
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
