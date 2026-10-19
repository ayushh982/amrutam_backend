import { z } from 'zod';

export const updateConsultationStatusSchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED']),
  notes: z.string().max(1000).optional(),
});

export const prescriptionItemSchema = z.object({
  medication: z.string().min(2, 'Medication name is required'),
  dosage: z.string().min(1, 'Dosage is required (e.g., 500mg)'),
  instructions: z.string().min(2, 'Instructions are required (e.g., Take twice daily after meals)'),
  duration: z.string().min(1, 'Duration is required (e.g., 5 days)'),
});

export const createPrescriptionSchema = z.object({
  notes: z.string().max(1000).optional(),
  items: z.array(prescriptionItemSchema).min(1, 'At least one prescription medication item is required'),
});
