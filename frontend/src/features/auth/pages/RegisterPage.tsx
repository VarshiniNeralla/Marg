import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Alert } from '@mui/material';
import {
  PersonOutlined,
  EmailOutlined,
  LockOutlined,
  BusinessOutlined,
} from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, type RegisterFormValues } from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { normaliseError } from '@services/apiClient';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';

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
      // Registration successful — redirect to login with a success state
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
      subtitle="Join your organization's workspace"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" style={{ color: colors.primary, fontWeight: 500 }}>
            Sign in
          </Link>
        </>
      }
    >
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
          label="Full name"
          autoComplete="name"
          autoFocus
          startIcon={<PersonOutlined fontSize="small" />}
          error={!!errors.name}
          helperText={errors.name?.message}
          {...register('name')}
        />

        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          startIcon={<EmailOutlined fontSize="small" />}
          error={!!errors.email}
          helperText={errors.email?.message}
          {...register('email')}
        />

        <Input
          label="Password"
          isPassword
          autoComplete="new-password"
          startIcon={<LockOutlined fontSize="small" />}
          error={!!errors.password}
          helperText={errors.password?.message ?? 'Min 8 chars, 1 uppercase, 1 number, 1 special'}
          {...register('password')}
        />

        <Input
          label="Organization slug"
          autoComplete="off"
          startIcon={<BusinessOutlined fontSize="small" />}
          error={!!errors.org_slug}
          helperText={errors.org_slug?.message ?? 'Use "demo" for the default organization'}
          {...register('org_slug')}
        />

        <Button
          variant="primary"
          type="submit"
          loading={isLoading}
          fullWidth
          size="large"
          sx={{ mt: 0.5 }}
        >
          Create account
        </Button>
      </Box>
    </AuthCard>
  );
}
