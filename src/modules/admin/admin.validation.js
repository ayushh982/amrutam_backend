import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  actorId: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const verifyDoctorSchema = z.object({
  status: z.enum(['VERIFIED', 'REJECTED']),
  reason: z.string().optional(),
});
