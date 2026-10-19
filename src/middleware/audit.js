import { prisma } from '../database/prisma.js';
import { logger } from '../observability/logger.js';

export const logAuditEvent = async ({
  actorId = null,
  action,
  resourceType,
  resourceId = null,
  outcome = 'SUCCESS',
  ipAddress = null,
  userAgent = null,
  details = null,
}) => {
  try {
    await prisma.auditLog.create({
      data: {
        actorId,
        action,
        resourceType,
        resourceId,
        outcome,
        ipAddress,
        userAgent,
        details: details ? (typeof details === 'object' ? details : { raw: details }) : undefined,
      },
    });
  } catch (error) {
    logger.error(
      {
        action,
        resourceType,
        resourceId,
        error: error.message,
      },
      'Failed to persist audit log to database'
    );
  }
};
