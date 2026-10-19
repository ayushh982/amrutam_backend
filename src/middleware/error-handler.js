import { ZodError } from 'zod';
import { logger } from '../observability/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (err, req, res, next) => {
  const requestId = req.id || 'unknown';

  // 1. Zod Validation Error
  if (err instanceof ZodError) {
    const formattedErrors = err.issues.map((e) => ({
      path: e.path.join('.'),
      message: e.message,
      code: e.code,
    }));

    logger.warn({ requestId, errors: formattedErrors }, 'Validation error');
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request payload validation failed',
        details: formattedErrors,
      },
      requestId,
    });
  }

  // 2. Custom AppError
  if (err instanceof AppError) {
    logger.warn(
      { requestId, statusCode: err.statusCode, code: err.code, message: err.message },
      'Application handled error'
    );
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
    });
  }

  // 3. Prisma Known Request Error
  if (err?.code && typeof err.code === 'string' && err.code.startsWith('P')) {
    let statusCode = 400;
    let message = 'Database operation failed';
    let code = 'DATABASE_ERROR';

    if (err.code === 'P2002') {
      statusCode = 409;
      code = 'RESOURCE_ALREADY_EXISTS';
      message = `A conflicting record already exists with the provided unique field (${err.meta?.target || 'unique constraint'})`;
    } else if (err.code === 'P2025') {
      statusCode = 404;
      code = 'RESOURCE_NOT_FOUND';
      message = 'Requested record was not found in the database';
    } else if (err.code === 'P2003') {
      statusCode = 400;
      code = 'FOREIGN_KEY_VIOLATION';
      message = 'Referenced related entity does not exist';
    }

    logger.warn({ requestId, prismaCode: err.code, meta: err.meta }, 'Prisma error');
    return res.status(statusCode).json({
      success: false,
      error: {
        code,
        message,
        details: env.NODE_ENV !== 'production' ? err.meta : undefined,
      },
      requestId,
    });
  }

  // 4. Fallback: Unexpected 500 Error
  logger.error(
    {
      requestId,
      error: err.message,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method,
    },
    'Unhandled server error'
  );

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'An unexpected internal server error occurred. Please contact support.'
          : err.message,
    },
    requestId,
  });
};
