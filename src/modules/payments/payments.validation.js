import { z } from 'zod';

export const initiatePaymentSchema = z.object({
  consultationId: z.string().uuid({ message: 'consultationId must be a valid UUID' }),
  amount: z.number().int().positive({ message: 'amount must be a positive integer in minor units' }),
  currency: z.string().length(3).default('INR'),
});

export const webhookPayloadSchema = z.object({
  eventId: z.string().min(1, 'eventId is required'),
  eventType: z.enum(['payment.succeeded', 'payment.failed']),
  provider: z.string().default('mock_provider'),
  data: z.object({
    paymentId: z.string().uuid(),
    providerReference: z.string(),
    amount: z.number().int().positive(),
    currency: z.string(),
  }),
});
