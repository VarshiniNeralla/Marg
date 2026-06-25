import { z } from 'zod';
import type { AppRole } from '@store/authStore';

export const APP_ROLES = ['admin', 'manager', 'field_engineer'] as const;
export type LoginRole = typeof APP_ROLES[number];

export const loginSchema = z.object({
  role:     z.enum(APP_ROLES),
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[@$!%*?&]/, 'Must contain at least one special character (@$!%*?&)');

export const resetPasswordSchema = z
  .object({
    token:            z.string().min(1, 'Reset token is required'),
    new_password:     passwordSchema,
    confirm_password: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.new_password === d.confirm_password, {
    message: 'Passwords do not match',
    path: ['confirm_password'],
  });

export type LoginFormValues         = z.infer<typeof loginSchema>;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormValues  = z.infer<typeof resetPasswordSchema>;
