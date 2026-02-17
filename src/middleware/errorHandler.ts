import { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { ApiError } from '../types';

/**
 * Custom application error with HTTP status code.
 */
export class AppError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function notFound(message = 'Resource not found'): AppError {
  return new AppError(404, message);
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, message, details);
}

export function conflict(message: string): AppError {
  return new AppError(409, message);
}

/**
 * Global error-handling middleware.
 * Must have 4 parameters for Express to recognize it as an error handler.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ApiError = {
      status: err.status,
      message: err.message,
    };
    if (err.details) body.details = err.details;
    res.status(err.status).json(body);
    return;
  }

  // PostgreSQL unique violation
  if ((err as NodeJS.ErrnoException & { code?: string }).code === '23505') {
    res.status(409).json({
      status: 409,
      message: 'Duplicate entry. A record with the same unique key already exists.',
    });
    return;
  }

  // PostgreSQL foreign key violation
  if ((err as NodeJS.ErrnoException & { code?: string }).code === '23503') {
    res.status(400).json({
      status: 400,
      message: 'Referenced resource does not exist.',
    });
    return;
  }

  console.error('Unhandled error:', err);

  const body: ApiError = {
    status: 500,
    message: config.isProduction
      ? 'Internal server error'
      : err.message || 'Internal server error',
  };

  if (!config.isProduction) {
    body.details = err.stack;
  }

  res.status(500).json(body);
}

/**
 * Async route handler wrapper — catches rejected promises and forwards to error middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
