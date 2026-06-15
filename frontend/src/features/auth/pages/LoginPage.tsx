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
      title="Marg"
      subtitle="Construction Visibility, Reimagined."
      footer={
        <Typography
          sx={{
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontSize: '0.875rem',
            color: '#6b7280',
          }}
        >
          New to this platform?{' '}
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
        <Box sx={{ mb: '16px' }}>
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
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '10px',
                height: '48px',
                backgroundColor: '#fff',
                fontSize: '0.9375rem',
                fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: '1.5px' },
                '&.Mui-focused': { boxShadow: `0 0 0 3px ${colors.primaryRing}` },
              },
              '& .MuiInputLabel-root': { display: 'none' },
              '& .MuiInputBase-input': {
                fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                py: 0,
                '&::placeholder': { color: '#9ca3af', opacity: 1 },
              },
            }}
          />
        </Box>

        {/* Password field */}
        <Box sx={{ mb: '24px' }}>
          <Typography component="label" htmlFor="login-password" sx={labelSx}>
            Password
          </Typography>
          <Input
            id="login-password"
            isPassword
            placeholder="Password"
            autoComplete="current-password"
            error={!!errors.password}
            helperText={errors.password?.message}
            {...register('password')}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '10px',
                height: '48px',
                backgroundColor: '#fff',
                fontSize: '0.9375rem',
                fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#d1d5db' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.primary, borderWidth: '1.5px' },
                '&.Mui-focused': { boxShadow: `0 0 0 3px ${colors.primaryRing}` },
              },
              '& .MuiInputLabel-root': { display: 'none' },
              '& .MuiInputBase-input': {
                fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
                py: 0,
                '&::placeholder': { color: '#9ca3af', opacity: 1 },
              },
            }}
          />
        </Box>

        {/* Sign in CTA */}
        <Button
          variant="primary"
          type="submit"
          loading={isLoading}
          fullWidth
          sx={{
            height: '48px',
            borderRadius: '10px',
            fontSize: '1rem',
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            background: '#2563eb',
            boxShadow: 'none',
            '&:hover': {
              background: '#1d4ed8',
              boxShadow: '0 4px 14px rgba(37,99,235,0.28)',
            },
          }}
        >
          Sign in
        </Button>
      </Box>
    </AuthCard>
  );
}
