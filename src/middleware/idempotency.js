import crypto from 'crypto';
import { prisma } from '../database/prisma.js';
import { AppError } from './error-handler.js';
import { idempotencyHitsTotal } from '../observability/metrics.js';
import { logger } from '../observability/logger.js';

export const idempotencyMiddleware = (options = { required: true }) => {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];

    if (!key) {
      if (options.required) {
        return next(
          new AppError(
            'Idempotency-Key header is required for this mutating operation.',
            400,
            'MISSING_IDEMPOTENCY_KEY'
          )
        );
      }
      return next();
    }

    // Hash endpoint + payload to detect conflicting payload reuse
    const bodyStr = JSON.stringify(req.body || {});
    const requestHash = crypto
      .createHash('sha256')
      .update(`${req.method}:${req.baseUrl || ''}${req.path}:${bodyStr}`)
      .digest('hex');

    const targetEndpoint = `${req.method} ${req.baseUrl || ''}${req.path}`;

    try {
      // Check existing key
      const existing = await prisma.idempotencyKey.findUnique({
        where: { key },
      });

      if (existing) {
        // Check for conflicting payload
        if (existing.requestHash !== requestHash) {
          return next(
            new AppError(
              'Idempotency key has already been used with a different request payload.',
              409,
              'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
            )
          );
        }

        // Check if request is still being processed
        if (!existing.responseStatus) {
          return next(
            new AppError(
              'A concurrent request with the same Idempotency-Key is currently in progress.',
              409,
              'IDEMPOTENCY_CONCURRENT_REQUEST'
            )
          );
        }

        // Return cached idempotent response
        idempotencyHitsTotal.inc({ endpoint: targetEndpoint });
        logger.info({ key, targetEndpoint }, 'Returning cached response for idempotent request');
        res.setHeader('X-Cache-Lookup', 'HIT-IDEMPOTENT');
        return res.status(existing.responseStatus).json(existing.responseBody);
      }

      // Reserve key for 24 hours
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.idempotencyKey.create({
        data: {
          key,
          targetEndpoint,
          requestHash,
          expiresAt,
        },
      });

      // Intercept response to store status & body upon completion
      const originalJson = res.json.bind(res);
      res.json = (body) => {
        const statusCode = res.statusCode;
        // Only cache successful or client-side responses (do not lock in temporary 500s)
        if (statusCode < 500) {
          prisma.idempotencyKey
            .update({
              where: { key },
              data: {
                responseStatus: statusCode,
                responseBody: body,
              },
            })
            .catch((err) => {
              logger.error({ key, error: err.message }, 'Failed to save idempotent response to database');
            });
        } else {
          // If 5xx internal server error occurred, delete key to allow clean retry
          prisma.idempotencyKey
            .delete({ where: { key } })
            .catch(() => {});
        }

        return originalJson(body);
      };

      next();
    } catch (error) {
      next(error);
    }
  };
};
