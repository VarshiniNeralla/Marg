import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Box, Typography, FormHelperText, Collapse, useMediaQuery, useTheme } from '@mui/material';
import { EngineeringRounded, ManageAccountsRounded, AdminPanelSettingsRounded, ErrorRounded, ExpandMoreRounded } from '@mui/icons-material';
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
import { motion as m } from 'framer-motion';

const labelSx = {
  display: 'block',
  fontFamily: '"Google Sans Flex", "Google Sans", Inter, sans-serif',
  fontSize: { xs: '0.8125rem', md: '0.875rem' },
  fontWeight: 500,
  color: '#3f3f46',
  mb: { xs: '6px', md: '8px' },
};

const inputSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: '12px',
    height: { xs: '48px', md: '52px' },
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
    shortLabel: 'Admin',
    desc: 'Platform administration',
    icon: AdminPanelSettingsRounded,
    color: '#3b82f6',
    activeColor: '#2563eb',
  },
  {
    value: 'manager',
    label: 'Manager',
    shortLabel: 'Manager',
    desc: 'Manage projects & tours',
    icon: ManageAccountsRounded,
    color: '#8b5cf6',
    activeColor: '#7c3aed',
  },
  {
    value: 'field_engineer',
    label: 'Field Engineer',
    shortLabel: 'Field',
    desc: 'Capture on site',
    icon: EngineeringRounded,
    color: '#10b981',
    activeColor: '#059669',
  },
] as const;

const DEMO_CREDENTIALS = [
  { role: 'admin',          roleLabel: 'Admin',          email: 'admin@myhomeconstructions.com',    password: 'Prangan@123', color: '#3b82f6' },
  { role: 'manager',        roleLabel: 'Manager',        email: 'manager@myhomeconstructions.com',  password: 'Prangan@123', color: '#8b5cf6' },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));
  const setAuth = useAuthStore((s) => s.setAuth);
  const patchProfile = useSettingsStore((s) => s.patchProfile);

  const [serverError, setServerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

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

  // Open demo panel by default on desktop only
  React.useEffect(() => {
    setDemoOpen(isDesktop);
  }, [isDesktop]);

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
      variant="split"
      title="Sign in"
      subtitle="Access your SiteVision workspace"
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
              <Typography sx={{ fontSize: '0.875rem', color: '#b91c1c', lineHeight: 1.5 }}>
                {serverError}
              </Typography>
            </Box>
          </m.div>
        )}

        {/* Role selector */}
        <Box sx={{ mb: { xs: '14px', md: '20px' } }}>
          <Typography component="label" sx={labelSx}>Sign in as</Typography>
          <Box sx={{ display: 'flex', gap: { xs: 0.75, md: 1.25 } }}>
            {ROLE_OPTIONS.map((opt) => {
              const isActive = selectedRole === opt.value;
              const Icon = opt.icon;
              return (
                <Controller
                  key={opt.value}
                  name="role"
                  control={control}
                  render={({ field }) => (
                    <Box
                      onClick={() => field.onChange(opt.value)}
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: { xs: 0.35, md: 0.75 },
                        py: { xs: 1.25, md: 1.75 },
                        px: { xs: 0.5, md: 1 },
                        borderRadius: { xs: '12px', md: '14px' },
                        cursor: 'pointer',
                        border: `1.5px solid ${isActive ? opt.activeColor : 'rgba(0,0,0,0.08)'}`,
                        backgroundColor: isActive ? `${opt.color}0c` : '#ffffff',
                        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        '&:hover': {
                          borderColor: isActive ? opt.activeColor : 'rgba(0,0,0,0.14)',
                          backgroundColor: isActive ? `${opt.color}10` : 'rgba(0,0,0,0.02)',
                        },
                      }}
                    >
                      <Box sx={{
                        width: { xs: 32, md: 36 },
                        height: { xs: 32, md: 36 },
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isActive ? opt.activeColor : '#71717a',
                        backgroundColor: isActive ? `${opt.color}14` : 'rgba(0,0,0,0.03)',
                        transition: 'all 0.2s',
                      }}>
                        <Icon sx={{ fontSize: { xs: 17, md: 19 } }} />
                      </Box>
                      <Typography sx={{
                        fontSize: { xs: '0.6875rem', md: '0.75rem' },
                        fontWeight: 600,
                        lineHeight: 1.2,
                        textAlign: 'center',
                        color: isActive ? opt.activeColor : '#52525b',
                        fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
                      }}>
                        <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{opt.shortLabel}</Box>
                        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{opt.label}</Box>
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
        <Box sx={{ mb: { xs: '14px', md: '20px' } }}>
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
        <Box sx={{ mb: { xs: '18px', md: '28px' } }}>
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
            height: { xs: '48px', md: '52px' }, borderRadius: '12px', fontSize: { xs: '0.9375rem', md: '1rem' },
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

        {/* Demo credentials — collapsible on mobile */}
        <Box sx={{ mt: { xs: 2, md: 3 }, pt: { xs: 1.5, md: 2.5 }, borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <Box
            onClick={() => setDemoOpen(v => !v)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              cursor: { xs: 'pointer', md: 'default' },
              py: { xs: 0.5, md: 0 },
              userSelect: 'none',
            }}
          >
            <Typography sx={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: '#71717a',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              Demo Credentials
            </Typography>
            <ExpandMoreRounded sx={{
              fontSize: 18,
              color: '#a1a1aa',
              display: { xs: 'block', md: 'none' },
              transform: demoOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s',
            }} />
          </Box>

          <Collapse in={demoOpen} timeout={250}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1.5 }}>
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
                    px: { xs: 1.5, md: 2 }, py: { xs: 1.25, md: 1.5 },
                    borderRadius: '12px', cursor: 'pointer',
                    border: '1px solid rgba(0,0,0,0.06)', backgroundColor: 'rgba(0,0,0,0.02)',
                    transition: 'all 0.2s',
                    '&:hover': { borderColor: `${cred.color}44`, backgroundColor: `${cred.color}08` },
                    '&:active': { transform: 'scale(0.99)' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0, flex: 1 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: cred.color, flexShrink: 0 }} />
                    <Typography noWrap sx={{ fontSize: { xs: '0.75rem', md: '0.8125rem' }, fontWeight: 500, color: '#3f3f46' }}>
                      {cred.email}
                    </Typography>
                  </Box>
                  <Typography sx={{
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    color: cred.color,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    flexShrink: 0,
                    pl: 1,
                  }}>
                    {cred.roleLabel}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </AuthCard>
  );
}
