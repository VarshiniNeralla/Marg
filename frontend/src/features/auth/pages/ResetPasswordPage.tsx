import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Box, Alert, Typography } from '@mui/material';
import { LockOutlined, CheckCircleOutlined } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  resetPasswordSchema,
  type ResetPasswordFormValues,
} from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { normaliseError } from '@services/apiClient';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') ?? '';

  const [done, setDone] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: tokenFromUrl },
  });

  async function onSubmit(values: ResetPasswordFormValues) {
    setServerError('');
    setIsLoading(true);
    try {
      await authService.resetPassword(values.token, values.new_password);
      setDone(true);
      // Auto-redirect to login after 2s
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setServerError(normaliseError(err).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Set new password"
      subtitle="Choose a strong password for your account"
      footer={
        <Link to="/login" style={{ color: colors.primary, fontWeight: 500 }}>
          ← Back to sign in
        </Link>
      }
    >
      {done ? (
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
          <CheckCircleOutlined sx={{ fontSize: 48, color: colors.success }} />
          <Typography
            sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textStrong }}
          >
            Password updated
          </Typography>
          <Typography
            sx={{ fontSize: '0.875rem', color: colors.textMuted }}
          >
            Redirecting you to sign in…
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

          {/* Hidden token field — auto-filled from URL param */}
          <input type="hidden" {...register('token')} />

          <Input
            label="New password"
            isPassword
            autoComplete="new-password"
            autoFocus
            startIcon={<LockOutlined fontSize="small" />}
            error={!!errors.new_password}
            helperText={
              errors.new_password?.message ??
              'Min 8 chars, 1 uppercase, 1 number, 1 special'
            }
            {...register('new_password')}
          />

          <Input
            label="Confirm new password"
            isPassword
            autoComplete="new-password"
            startIcon={<LockOutlined fontSize="small" />}
            error={!!errors.confirm_password}
            helperText={errors.confirm_password?.message}
            {...register('confirm_password')}
          />

          <Button
            variant="primary"
            type="submit"
            loading={isLoading}
            fullWidth
            size="large"
          >
            Update password
          </Button>
        </Box>
      )}
    </AuthCard>
  );
}
