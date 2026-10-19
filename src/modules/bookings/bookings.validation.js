import { z } from 'zod';

export const createBookingSchema = z.object({
  slotId: z.string().uuid({ message: 'slotId must be a valid UUID' }),
  reason: z.string().min(3, 'Reason for consultation must be at least 3 characters').max(500),
});

export const cancelBookingSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason must be provided').max(500),
});

export const listBookingsQuerySchema = z.object({
  status: z.enum(['BOOKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});
