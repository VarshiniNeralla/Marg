import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, FormHelperText } from '@mui/material';
import { EngineeringRounded, ManageAccountsRounded, AdminPanelSettingsRounded, ErrorRounded } from '@mui/icons-material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginFormValues } from '../schemas/authSchemas';
import { authService } from '../services/authService';
import { authService as backendAuth } from '@services/authService';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import { useSettingsStore } from '@store/settingsStore';
import { normaliseError } from '@services/apiClient';
import AuthCard from '../components/AuthCard';
import Input from '@shared/components/Input/Input';
import Button from '@shared/components/Button/Button';
import { colors } from '@theme/tokens';
import { motion as m } from 'framer-motion';

const labelSx = {
  display: 'block',
  fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
  fontSize: '0.875rem',
  fontWeight: 500,
  color: '#3f3f46',
  mb: '8px',
};

const inputSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '12px',
    height: '52px',
    backgroundColor: 'rgba(0,0,0,0.02)',
    color: '#18181b',
    fontSize: '0.9375rem',
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
    transition: 'border-color 140ms, box-shadow 140ms, background-color 140ms',
    '& .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.1)' },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'rgba(0,0,0,0.08)' },
    '&:hover': { backgroundColor: 'rgba(0,0,0,0.05)' },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#18181b', borderWidth: '1.5px' },
    '&.Mui-focused': { boxShadow: '0 0 0 4px rgba(0,0,0,0.05)', backgroundColor: '#fff' },
  },
  '& .MuiInputLabel-root': { display: 'none' },
  '& .MuiInputBase-input': {
    fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
    py: 0,
    '&::placeholder': { color: '#71717a', opacity: 1 },
    '&:-webkit-autofill': {
      WebkitBoxShadow: '0 0 0 1000px #ffffff inset',
      WebkitTextFillColor: '#18181b',
      transition: 'background-color 5000s ease-in-out 0s',
    },
  },
};

const ROLE_OPTIONS = [
  {
    value: 'admin',
    label: 'Admin',
    desc: 'Platform administration',
    icon: <AdminPanelSettingsRounded sx={{ fontSize: 20 }} />,
    color: '#3b82f6',
    activeColor: '#60a5fa',
  },
  {
    value: 'manager',
    label: 'Manager',
    desc: 'Review captures',
    icon: <ManageAccountsRounded sx={{ fontSize: 20 }} />,
    color: '#8b5cf6',
    activeColor: '#a78bfa',
  },
  {
    value: 'field_engineer',
    label: 'Field Engineer',
    desc: 'Upload site photos',
    icon: <EngineeringRounded sx={{ fontSize: 20 }} />,
    color: '#10b981',
    activeColor: '#34d399',
  },
] as const;

const DEMO_CREDENTIALS = [
  { role: 'admin',          roleLabel: 'Admin',          email: 'admin@myhomeconstructions.com',    password: 'Prangan@123', color: '#3b82f6' },
  { role: 'manager',        roleLabel: 'Manager',        email: 'manager@myhomeconstructions.com',  password: 'Prangan@123', color: '#8b5cf6' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);
  const patchProfile = useSettingsStore((s) => s.patchProfile);

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
      const authedRole = data.user.role;

      // Normalise: backend may return 'super_admin' which maps to 'admin' on the UI
      const normalisedRole = (authedRole === 'super_admin' ? 'admin' : authedRole) as LoginFormValues['role'];

      // Role mismatch — credentials belong to a different role than selected
      if (normalisedRole !== values.role) {
        const roleLabels: Record<string, string> = {
          admin: 'Admin', manager: 'Manager', field_engineer: 'Field Engineer',
        };
        setServerError(
          `These credentials belong to a ${roleLabels[normalisedRole] ?? normalisedRole} account. Please select the correct role and try again.`
        );
        return;
      }

      setAuth(data.access_token, {
        id: data.user.id,
        name: data.user.name,
        email: data.user.email,
        role: authedRole,
        org_id: data.user.org_id,
        org_name: data.user.org_name,
        org_slug: 'myhome',
        avatar_url: data.user.avatar_url,
        assignedProjectIds: data.user.assignedProjectIds,
      }, data.sessionKind ?? 'live');
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
          assignedProjectIds: me.assigned_project_ids,
        }, 'live');
      } catch {
        // partial data
      }
      // Clear any stale profile data from a previously logged-in user
      patchProfile({ name: '', designation: '', phone: '', bio: '', avatarUrl: '' });
      navigate(from ?? getRoleLandingPath(authedRole), { replace: true });
    } catch (err) {
      const e = normaliseError(err);
      if (e.status === 401) {
        setServerError('Invalid email or password. Please check your credentials.');
      } else if (e.status === 429) {
        setServerError('Too many login attempts. Wait a few minutes and try again.');
      } else if (e.status === 0) {
        setServerError('Cannot reach the server. Make sure the backend is running on port 8002.');
      } else {
        setServerError(e.message);
      }
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
          <m.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 1.25,
              px: 2, py: 1.5, mb: 3, borderRadius: '12px',
              backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            }}>
              <ErrorRounded sx={{ fontSize: 18, color: '#ef4444', flexShrink: 0, mt: '2px' }} />
              <Typography sx={{ fontSize: '0.875rem', color: '#fca5a5', lineHeight: 1.5 }}>
                {serverError}
              </Typography>
            </Box>
          </m.div>
        )}

        {/* Role selector */}
        <Box sx={{ mb: { xs: '16px', sm: '24px' } }}>
          <Typography component="label" sx={labelSx}>Sign in as</Typography>
          <Box sx={{ display: 'flex', gap: { xs: 1, sm: 1.5 } }}>
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
                        flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: { xs: 0.5, sm: 1 },
                        py: { xs: 1, sm: 2 }, px: { xs: 0.5, sm: 1 }, borderRadius: '16px', cursor: 'pointer',
                        border: `1px solid ${isActive ? opt.activeColor : 'rgba(0,0,0,0.1)'}`,
                        backgroundColor: isActive ? 'rgba(0,0,0,0.04)' : '#ffffff',
                        boxShadow: isActive ? `0 0 20px ${opt.color}22 inset` : 'none',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        '&:hover': { 
                          borderColor: isActive ? opt.activeColor : 'rgba(0,0,0,0.15)', 
                          backgroundColor: 'rgba(0,0,0,0.02)',
                          transform: 'translateY(-2px)'
                        },
                      }}
                    >
                      <Box sx={{ color: isActive ? opt.activeColor : '#71717a', transition: 'color 0.2s' }}>
                        {opt.icon}
                      </Box>
                      <Typography sx={{
                        fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2, textAlign: 'center',
                        color: isActive ? opt.activeColor : '#52525b',
                        fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                        transition: 'color 0.2s',
                      }}>
                        {opt.label}
                      </Typography>
                    </Box>
                  )}
                />
              );
            })}
          </Box>
          {errors.role && <FormHelperText error sx={{ color: '#ef4444' }}>{errors.role.message}</FormHelperText>}
        </Box>

        {/* Email */}
        <Box sx={{ mb: { xs: '16px', sm: '24px' } }}>
          <Typography component="label" htmlFor="login-email" sx={labelSx}>Email</Typography>
          <Input
            id="login-email"
            type="email"
            placeholder="name@company.com"
            autoComplete="email"
            autoFocus
            error={!!errors.email}
            helperText={errors.email?.message}
            {...register('email')}
            sx={inputSx}
          />
        </Box>

        {/* Password */}
        <Box sx={{ mb: { xs: '16px', sm: '32px' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '8px' }}>
            <Typography component="label" htmlFor="login-password" sx={{ ...labelSx, mb: 0 }}>Password</Typography>
            <Box
              component="a"
              href="/forgot-password"
              sx={{ fontSize: '0.8125rem', color: '#52525b', fontWeight: 500, textDecoration: 'none', cursor: 'pointer', transition: 'color 0.2s', '&:hover': { color: '#18181b' } }}
            >
              Forgot password?
            </Box>
          </Box>
          <Input
            id="login-password"
            isPassword
            placeholder="••••••••"
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
            background: '#18181b',
            color: '#ffffff',
            boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            transition: 'transform 0.2s, box-shadow 0.2s, background-color 0.2s',
            '&:hover': { background: '#27272a', boxShadow: '0 6px 20px rgba(0,0,0,0.2)', transform: 'translateY(-1px)' },
            '&:active': { transform: 'translateY(0)' },
          }}
        >
          Sign in
        </Button>

        {/* Demo credentials panel */}
        <Box sx={{ mt: { xs: 2.5, sm: 4 }, pt: { xs: 2, sm: 3 }, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'center', mb: 2 }}>
            Demo Credentials
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
                  px: 2, py: 1.5, borderRadius: '12px', cursor: 'pointer',
                  border: '1px solid rgba(0,0,0,0.05)', backgroundColor: 'rgba(255,255,255,0.02)',
                  transition: 'all 0.2s',
                  '&:hover': { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(0,0,0,0.05)', transform: 'translateX(2px)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, flex: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: cred.color, flexShrink: 0, boxShadow: `0 0 10px ${cred.color}` }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: { xs: '0.75rem', sm: '0.8125rem' }, fontWeight: 600, color: '#3f3f46', lineHeight: 1.2 }}>
                      {cred.email}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0, pl: 1 }}>
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: cred.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {cred.roleLabel}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </AuthCard>
  );
}
