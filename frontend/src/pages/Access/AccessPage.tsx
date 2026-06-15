import React, { useState } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { CheckRounded, CloseRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { permissionMatrix, mockUsers, type UserRole } from '@/data/mockData';

const roles: UserRole[] = ['admin', 'manager', 'reviewer', 'viewer'];
const modules = ['projects', 'captures', 'tours', 'analytics', 'users', 'settings'];
const allActions = ['view', 'create', 'edit', 'delete', 'approve', 'publish'];

const roleColor: Record<string, { color: string; bg: string }> = {
  super_admin: { color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  admin:       { color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
  manager:     { color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
  reviewer:    { color: '#d97706', bg: 'rgba(217,119,6,0.1)' },
  viewer:      { color: '#64748b', bg: 'rgba(100,116,139,0.1)' },
};

function PermCell({ has }: { has: boolean }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '6px', backgroundColor: has ? 'rgba(22,163,74,0.10)' : 'rgba(220,38,38,0.06)' }}>
      {has ? <CheckRounded sx={{ fontSize: 14, color: '#16a34a' }} /> : <CloseRounded sx={{ fontSize: 14, color: '#94a3b8' }} />}
    </Box>
  );
}

export default function AccessPage() {
  const [activeRole, setActiveRole] = useState<UserRole>('admin');
  const matrix = permissionMatrix.find(m => m.role === activeRole);
  const roleUsers = mockUsers.filter(u => u.role === activeRole);

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
          Permissions
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Role-based access control across all modules</Typography>
      </Box>

      {/* Role selector */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 4, flexWrap: 'wrap' }}>
        {roles.map(r => {
          const rc = roleColor[r];
          const count = mockUsers.filter(u => u.role === r).length;
          return (
            <Box key={r} onClick={() => setActiveRole(r)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, borderRadius: '12px', border: `1.5px solid ${activeRole === r ? rc.color : colors.borderLight}`, backgroundColor: activeRole === r ? rc.bg : colors.card, cursor: 'pointer', transition: 'all 0.15s' }}>
              <Box sx={{ textAlign: 'left' }}>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: activeRole === r ? rc.color : colors.textStrong, textTransform: 'capitalize' }}>{r}</Typography>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{count} user{count !== 1 ? 's' : ''}</Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Permission matrix */}
      <Box sx={{ borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden', mb: 4 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '140px repeat(6, 1fr)', px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}`, backgroundColor: colors.bg }}>
          <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Module</Typography>
          {allActions.map(a => (
            <Typography key={a} sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, textTransform: 'capitalize', letterSpacing: '0.05em', textAlign: 'center' }}>{a}</Typography>
          ))}
        </Box>
        {modules.map((mod, i) => (
          <Box key={mod} sx={{ display: 'grid', gridTemplateColumns: '140px repeat(6, 1fr)', px: 2.5, py: 1.75, borderBottom: i < modules.length - 1 ? `1px solid ${colors.borderLight}` : 'none', alignItems: 'center', '&:hover': { backgroundColor: colors.bg } }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong, textTransform: 'capitalize' }}>{mod}</Typography>
            {allActions.map(a => (
              <Box key={a} sx={{ display: 'flex', justifyContent: 'center' }}>
                <PermCell has={matrix?.modules[mod]?.includes(a as import('@/data/mockData').PermissionAction) ?? false} />
              </Box>
            ))}
          </Box>
        ))}
      </Box>

      {/* Users with this role */}
      <Box>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2 }}>
          Users with {activeRole} role ({roleUsers.length})
        </Typography>
        {roleUsers.length === 0 ? (
          <Typography sx={{ fontSize: '0.875rem', color: colors.textMuted }}>No users with this role.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {roleUsers.map(u => {
              const rc = roleColor[u.role];
              return (
                <Box key={u.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderRadius: '12px', backgroundColor: colors.card, boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                  <Box sx={{ width: 36, height: 36, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#fff' }}>{u.name[0]}</Typography>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{u.name}</Typography>
                    <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>{u.email} · {u.designation}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>{u.lastActive}</Typography>
                  <Chip label={u.role} size="small" sx={{ height: 22, fontSize: '0.6875rem', fontWeight: 600, color: rc.color, backgroundColor: rc.bg, borderRadius: '6px', textTransform: 'capitalize' }} />
                </Box>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
}
