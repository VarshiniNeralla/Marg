import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Alert, Typography } from '@mui/material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterFormValues } from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { normaliseError } from '@services/apiClient';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';

const labelSx = {
  display: 'block',
  fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#374151',
  mb: '6px',
};

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

export default function RegisterPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { org_slug: 'demo' },
  });

  async function onSubmit(values: RegisterFormValues) {
    setServerError('');
    setIsLoading(true);
    try {
      await authService.register(values);
      navigate('/login', {
        state: { registered: true, email: values.email },
        replace: true,
      });
    } catch (err) {
      setServerError(normaliseError(err).message);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Create your account"
      // subtitle="Start your free trial — no credit card required"
      footer={
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: '0.875rem', color: '#6b7280' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: colors.primary, fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        </Typography>
      }
    >
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {serverError && (
          <Alert severity="error" sx={{ borderRadius: '8px', fontSize: '0.875rem', mb: '16px' }}>
            {serverError}
          </Alert>
        )}

        {/* Full name */}
        <Box sx={{ mb: '16px' }}>
          <Typography component="label" htmlFor="reg-name" sx={labelSx}>Full name</Typography>
          <Input
            id="reg-name"
            placeholder="Jane Smith"
            autoComplete="name"
            autoFocus
            error={!!errors.name}
            helperText={errors.name?.message}
            {...register('name')}
            sx={inputSx}
          />
        </Box>

        {/* Email */}
        <Box sx={{ mb: '16px' }}>
          <Typography component="label" htmlFor="reg-email" sx={labelSx}>Work email</Typography>
          <Input
            id="reg-email"
            type="email"
            placeholder="jane@company.com"
            autoComplete="email"
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
            sx={inputSx}
          />
        </Box>

        {/* Password */}
        <Box sx={{ mb: '16px' }}>
          <Typography component="label" htmlFor="reg-password" sx={labelSx}>Password</Typography>
          <Input
            id="reg-password"
            isPassword
            placeholder="Min 8 chars, 1 uppercase, 1 number"
            autoComplete="new-password"
            error={!!errors.password}
            helperText={errors.password?.message}
            {...register('password')}
            sx={inputSx}
          />
        </Box>

        {/* Org slug */}
        <Box sx={{ mb: '22px' }}>
          <Typography component="label" htmlFor="reg-org" sx={labelSx}>Organization slug</Typography>
          <Input
            id="reg-org"
            placeholder="your-company"
            autoComplete="off"
            error={!!errors.org_slug}
            helperText={errors.org_slug?.message ?? 'Lowercase, hyphens only — use "demo" for default'}
            {...register('org_slug')}
            sx={inputSx}
          />
        </Box>

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
          Create account
        </Button>

        <Typography sx={{ fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center', mt: 1.5 }}>
          By creating an account you agree to our{' '}
          <Box component="span" sx={{ '& a': { color: '#6b7280', textDecoration: 'none', '&:hover': { color: colors.textStrong } } }}>
            <a href="/">Terms of Service</a>
          </Box>{' '}
          and{' '}
          <Box component="span" sx={{ '& a': { color: '#6b7280', textDecoration: 'none', '&:hover': { color: colors.textStrong } } }}>
            <a href="/">Privacy Policy</a>
          </Box>
        </Typography>
      </Box>
    </AuthCard>
  );
}
