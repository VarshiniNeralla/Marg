import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, MenuItem, Select, FormControl, FormHelperText } from '@mui/material';
import { EngineeringRounded, ManageAccountsRounded, AdminPanelSettingsRounded, ErrorRounded } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormValues, APP_ROLES } from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { authService as backendAuth } from '@services/authService';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
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

const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'Admin',
    desc: 'Platform administration & configuration',
    icon: <AdminPanelSettingsRounded sx={{ fontSize: 18 }} />,
    color: '#2563eb',
    bg: 'rgba(37,99,235,0.06)',
  },
  {
    value: 'manager',
    label: 'Manager',
    desc: 'Review captures & monitor progress',
    icon: <ManageAccountsRounded sx={{ fontSize: 18 }} />,
    color: '#7c3aed',
    bg: 'rgba(124,58,237,0.06)',
  },
  {
    value: 'field_engineer',
    label: 'Field Engineer',
    desc: 'Capture & upload site photos',
    icon: <EngineeringRounded sx={{ fontSize: 18 }} />,
    color: '#059669',
    bg: 'rgba(5,150,105,0.06)',
  },
] as const;

const DEMO_CREDENTIALS = [
  { role: 'admin',          roleLabel: 'Admin',          email: 'admin@myhomeconstructions.com',    password: 'Prangan@123', color: '#2563eb' },
  { role: 'manager',        roleLabel: 'Manager',        email: 'manager@myhomeconstructions.com',  password: 'Prangan@123', color: '#7c3aed' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname;

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { role: 'admin' },
  });

  const selectedRole = watch('role');
  const roleOption = ROLE_OPTIONS.find(r => r.value === selectedRole);

  async function onSubmit(values: LoginFormValues) {
    setServerError('');
    setIsLoading(true);
    try {
      const data = await authService.login({ email: values.email, password: values.password });
      // Use the role returned by the auth response — never the UI role picker.
      const authedRole = data.user.role;
      setAuth(data.access_token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: authedRole,
        org_id: data.user.org_id,
        org_name: data.user.org_name,
        org_slug: 'myhome',
        avatar_url: data.user.avatar_url,
      });
      // Enrich with /auth/me to get org_slug and other full profile fields.
      try {
        const me = await backendAuth.me();
        setAuth(data.access_token, {
          id: me.id,
          name: me.name,
          email: me.email,
          role: (me.role ?? authedRole) as typeof authedRole,
          org_id: me.org_id,
          org_name: me.org_name,
          org_slug: me.org_slug,
          avatar_url: me.avatar_url,
        });
      } catch {
        // /me failed — continue with partial data, org_slug defaults to 'myhome'
      }
      navigate(from ?? getRoleLandingPath(authedRole), { replace: true });
    } catch (err) {
      const e = normaliseError(err);
      setServerError(
        e.status === 401
          ? 'Invalid email or password. Please check your credentials.'
          : e.message
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthCard
      title="Sign in"
      subtitle="Access your Prāṅgaṇ workspace"
    >
      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {serverError && (
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.25,
            px: 2, py: 1.5, mb: 2, borderRadius: '10px',
            backgroundColor: '#fef2f2', border: '1px solid #fecaca',
          }}>
            <ErrorRounded sx={{ fontSize: 18, color: '#dc2626', flexShrink: 0, mt: '1px' }} />
            <Typography sx={{ fontSize: '0.875rem', color: '#b91c1c', lineHeight: 1.5 }}>
              {serverError}
            </Typography>
          </Box>
        )}

        {/* Role selector */}
        <Box sx={{ mb: '20px' }}>
          <Typography component="label" sx={labelSx}>Sign in as</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {ROLE_OPTIONS.map((opt) => {
              const isActive = selectedRole === opt.value;
              return (
                <Controller
                  key={opt.value}
                  name="role"
                  control={control}
                  render={({ field }) => (
                    <Box
                      onClick={() => field.onChange(opt.value)}
                      sx={{
                        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5,
                        py: 1.5, px: 1, borderRadius: '12px', cursor: 'pointer',
                        border: `1.5px solid ${isActive ? opt.color : '#e5e7eb'}`,
                        backgroundColor: isActive ? opt.bg : '#fff',
                        transition: 'all 150ms',
                        '&:hover': { borderColor: opt.color, backgroundColor: opt.bg },
                      }}
                    >
                      <Box sx={{ color: isActive ? opt.color : '#9ca3af', transition: 'color 150ms' }}>
                        {opt.icon}
                      </Box>
                      <Typography sx={{
                        fontSize: '0.6875rem', fontWeight: 600, lineHeight: 1.2, textAlign: 'center',
                        color: isActive ? opt.color : '#6b7280',
                        fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                        transition: 'color 150ms',
                      }}>
                        {opt.label}
                      </Typography>
                    </Box>
                  )}
                />
              );
            })}
          </Box>
          {roleOption && (
            <Typography sx={{ mt: 1, fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
              {roleOption.desc}
            </Typography>
          )}
          {errors.role && <FormHelperText error>{errors.role.message}</FormHelperText>}
        </Box>

        {/* Email */}
        <Box sx={{ mb: '20px' }}>
          <Typography component="label" htmlFor="login-email" sx={labelSx}>Email</Typography>
          <Input
            id="login-email"
            type="email"
            placeholder="Enter your email"
            autoComplete="email"
            autoFocus
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
            sx={inputSx}
          />
        </Box>

        {/* Password */}
        <Box sx={{ mb: '24px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '6px' }}>
            <Typography component="label" htmlFor="login-password" sx={{ ...labelSx, mb: 0 }}>Password</Typography>
            <Box
              component="a"
              href="/forgot-password"
              sx={{ fontSize: '0.8125rem', color: colors.primary, fontWeight: 500, textDecoration: 'none', cursor: 'pointer' }}
            >
              Forgot password?
            </Box>
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

        <Button
          variant="primary"
          type="submit"
          loading={isLoading}
          fullWidth
          sx={{
            height: '52px', borderRadius: '12px', fontSize: '1rem',
            fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
            fontWeight: 600, letterSpacing: '-0.01em',
            background: roleOption?.color ?? '#111827',
            boxShadow: '0 1px 2px rgba(15,23,42,0.12)',
            transition: 'transform 140ms, box-shadow 140ms, background-color 140ms',
            '&:hover': { filter: 'brightness(0.92)', boxShadow: '0 6px 18px rgba(15,23,42,0.18)', transform: 'translateY(-1px)' },
            '&:active': { transform: 'translateY(0)' },
          }}
        >
          Sign in as {roleOption?.label ?? 'User'}
        </Button>

        {/* Demo credentials panel */}
        <Box sx={{ mt: 2.5, pt: 2.5, borderTop: '1px solid rgba(15,23,42,0.06)' }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', mb: 1.25 }}>
            Demo Credentials
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {DEMO_CREDENTIALS.map((cred) => (
              <Box
                key={cred.role}
                onClick={() => {
                  setValue('role', cred.role as LoginFormValues['role']);
                  setValue('email', cred.email);
                  setValue('password', cred.password);
                }}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  px: 1.5, py: 1, borderRadius: '10px', cursor: 'pointer',
                  border: '1px solid rgba(15,23,42,0.06)', backgroundColor: 'rgba(15,23,42,0.02)',
                  transition: 'all 140ms',
                  '&:hover': { borderColor: cred.color + '55', backgroundColor: cred.color + '08' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: cred.color, flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#374151', lineHeight: 1.2 }}>
                      {cred.email}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: cred.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {cred.roleLabel}
                  </Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                    {cred.password}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
          <Typography sx={{ fontSize: '0.6875rem', color: '#c4c9d4', textAlign: 'center', mt: 1 }}>
            Click any row to auto-fill
          </Typography>
        </Box>
      </Box>
    </AuthCard>
  );
}
