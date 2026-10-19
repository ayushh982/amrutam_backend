import { z } from 'zod';

export const listDoctorsQuerySchema = z.object({
  specialization: z.string().optional(),
  minFee: z.coerce.number().int().positive().optional(),
  maxFee: z.coerce.number().int().positive().optional(),
  search: z.string().optional(),
  verificationStatus: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional().default('VERIFIED'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const updateDoctorProfileSchema = z.object({
  specialization: z.string().min(2).optional(),
  consultationFee: z.number().int().positive().optional(),
  bio: z.string().max(1000).optional(),
  experienceYears: z.number().int().nonnegative().optional(),
});

export const createSlotSchema = z.object({
  startAt: z.string().datetime({ message: 'startAt must be a valid ISO 8601 UTC datetime string' }),
  endAt: z.string().datetime({ message: 'endAt must be a valid ISO 8601 UTC datetime string' }),
}).refine(
  (data) => new Date(data.startAt) < new Date(data.endAt),
  { message: 'endAt must be chronologically after startAt', path: ['endAt'] }
).refine(
  (data) => new Date(data.startAt) > new Date(),
  { message: 'startAt must be in the future', path: ['startAt'] }
);

export const listSlotsQuerySchema = z.object({
  status: z.enum(['AVAILABLE', 'RESERVED', 'BOOKED', 'CANCELLED']).optional().default('AVAILABLE'),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
