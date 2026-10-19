import { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';
import { env } from '../config/env.js';
import { mockPrisma } from '../../tests/helpers/mock-prisma.js';

let prismaInstance = null;

export const getPrismaClient = () => {
  if (process.env.USE_MOCK_DB === 'true') {
    return mockPrisma;
  }

  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log:
        env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace'
          ? ['query', 'info', 'warn', 'error']
          : ['error', 'warn'],
    });

    prismaInstance.$connect()
      .then(() => {
        logger.info('Successfully connected to PostgreSQL via Prisma');
      })
      .catch((err) => {
        logger.warn({ error: err.message }, 'Prisma initial connection failed or database is not reachable yet');
      });
  }

  return prismaInstance;
};

export const prisma = getPrismaClient();
