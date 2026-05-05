import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.error,
      message: err.message,
      statusCode: err.statusCode,
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Invalid request data',
      statusCode: 400,
      details: err.errors,
    });
    return;
  }

  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'internal_error',
    message: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    statusCode: 500,
  });
}

// Need env for error message visibility
import { env } from '../config/env.js';
