import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Box, Alert, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormValues } from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { useAuthStore } from '@store/authStore';
import { normaliseError } from '@services/apiClient';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';

// Shared field label style matching the reference
const labelSx = {
  display: 'block',
  fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#374151',
  mb: '6px',
};

// Calm, enterprise-grade field — taller, soft border, subtle focus
const inputSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '12px',
    height: '52px',
    backgroundColor: '#fff',
    fontSize: '0.9375rem',
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
    transition: 'border-color 140ms, box-shadow 140ms',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#9ca3af', borderWidth: '1px' },
    '&.Mui-focused': { boxShadow: '0 0 0 4px rgba(15,23,42,0.05)' },
  },
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiInputBase-input': {
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
    py: 0,
    '&::placeholder': { color: '#9ca3af', opacity: 1 },
  },
};

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/dashboard';

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  async function onSubmit(values: LoginFormValues) {
    setServerError('');
    setIsLoading(true);
    try {
      const data = await authService.login(values);
      setAuth(data.access_token, data.user);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(normaliseError(err).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your Horizon workspace"
      footer={
        <Typography
          sx={{
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontSize: '0.875rem',
            color: '#6b7280',
          }}
        >
          Don't have an account?{' '}
          <Link to="/register" style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
            Register
          </Link>
        </Typography>
      }
    >
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}
      >
        {serverError && (
          <Alert severity="error" sx={{ borderRadius: '8px', fontSize: '0.875rem', mb: '16px' }}>
            {serverError}
          </Alert>
        )}

        {/* Email field */}
        <Box sx={{ mb: '20px' }}>
          <Typography component="label" htmlFor="login-email" sx={labelSx}>
            Email
          </Typography>
          <Input
            id="login-email"
            type="email"
            placeholder="Enter your mail"
            autoComplete="email"
            autoFocus
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
            sx={inputSx}
          />
        </Box>

        {/* Password field */}
        <Box sx={{ mb: '24px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
            <Typography component="label" htmlFor="login-password" sx={{ ...labelSx, mb: 0 }}>
              Password
            </Typography>
            <Link to="/forgot-password" style={{ fontSize: '0.8125rem', color: colors.primary, fontWeight: 500, textDecoration: 'none' }}>
              Forgot password?
            </Link>
          </Box>
          <Input
            id="login-password"
            isPassword
            placeholder="Password"
            autoComplete="current-password"
            error={!!errors.password}
            helperText={errors.password?.message}
            {...register('password')}
            sx={inputSx}
          />
        </Box>

        {/* Sign in CTA */}
        <Button
          variant="primary"
          type="submit"
          loading={isLoading}
          fullWidth
          sx={{
            height: '52px',
            borderRadius: '12px',
            fontSize: '1rem',
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            background: '#111827',
            boxShadow: '0 1px 2px rgba(15,23,42,0.12)',
            transition: 'transform 140ms, box-shadow 140ms, background-color 140ms',
            '&:hover': {
              background: '#000',
              boxShadow: '0 6px 18px rgba(15,23,42,0.18)',
              transform: 'translateY(-1px)',
            },
            '&:active': { transform: 'translateY(0)' },
          }}
        >
          Sign in
        </Button>
      </Box>
    </AuthCard>
  );
}
