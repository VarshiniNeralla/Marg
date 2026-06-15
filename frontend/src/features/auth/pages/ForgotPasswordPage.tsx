import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, Alert, Typography } from '@mui/material';
import { EmailOutlined, CheckCircleOutlined } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  forgotPasswordSchema,
  type ForgotPasswordFormValues,
} from '../schemas/authSchemas';
import { authService } from '../services/authService';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  async function onSubmit(values: ForgotPasswordFormValues) {
    setServerError('');
    setIsLoading(true);
    try {
      await authService.forgotPassword(values.email);
      setSent(true);
    } catch {
      // API always returns 200 — if this throws it's a network error.
      setServerError('Could not send reset email. Check your connection.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a reset link"
      footer={
        <Link to="/login" style={{ color: colors.primary, fontWeight: 500 }}>
          ← Back to sign in
        </Link>
      }
    >
      {sent ? (
        // Success state
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.5,
            py: 2,
            textAlign: 'center',
          }}
        >
          <CheckCircleOutlined
            sx={{ fontSize: 48, color: colors.success }}
          />
          <Typography
            sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textStrong }}
          >
            Check your inbox
          </Typography>
          <Typography
            sx={{ fontSize: '0.875rem', color: colors.textMuted, lineHeight: 1.5 }}
          >
            If an account exists for that email, a password reset link will arrive
            within a few minutes.
          </Typography>
        </Box>
      ) : (
        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {serverError && (
            <Alert severity="error" sx={{ borderRadius: '8px', fontSize: '0.875rem' }}>
              {serverError}
            </Alert>
          )}

          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            autoFocus
            startIcon={<EmailOutlined fontSize="small" />}
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
          />

          <Button
            variant="primary"
            type="submit"
            loading={isLoading}
            fullWidth
            size="large"
          >
            Send reset link
          </Button>
        </Box>
      )}
    </AuthCard>
  );
}
