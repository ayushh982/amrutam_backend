import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().optional(),
  role: z.enum(['PATIENT', 'DOCTOR']).default('PATIENT'),
  // Doctor-specific fields when registering as doctor
  specialization: z.string().optional(),
  licenseNumber: z.string().optional(),
  consultationFee: z.number().int().positive().optional(),
  bio: z.string().optional(),
  experienceYears: z.number().int().nonnegative().optional(),
}).refine(
  (data) => {
    if (data.role === 'DOCTOR') {
      return !!data.specialization && !!data.licenseNumber;
    }
    return true;
  },
  {
    message: 'Doctors must provide specialization and licenseNumber',
    path: ['specialization'],
  }
);

export const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
});
