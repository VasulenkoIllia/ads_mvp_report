import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly details?: unknown;
  readonly errorCode?: string;

  constructor(statusCode: number, message: string, details?: unknown, errorCode?: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.errorCode = errorCode;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
