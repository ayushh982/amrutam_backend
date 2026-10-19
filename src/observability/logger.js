import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'headers.authorization',
      'password',
      'passwordHash',
      'creditCard',
      'paymentSecret',
      '*.password',
      '*.passwordHash',
    ],
    remove: true,
  },
  base: {
    service: 'amrutam-backend',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
