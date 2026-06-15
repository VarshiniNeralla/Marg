import React, { useState } from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  TrendingUpRounded, CameraAltRounded, ViewInArRounded, CheckCircleRounded,
  AccessTimeRounded, PeopleRounded, BugReportRounded, MapRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { mockProjects, mockCaptures, mockTours, mockDefects, mockUsers } from '@/data/mockData';

const captureWeeks = [
  { week: 'Apr W1', count: 8 }, { week: 'Apr W2', count: 14 }, { week: 'Apr W3', count: 11 },
  { week: 'Apr W4', count: 19 }, { week: 'May W1', count: 22 }, { week: 'May W2', count: 17 },
  { week: 'May W3', count: 28 }, { week: 'May W4', count: 31 },
];
const maxCount = Math.max(...captureWeeks.map(w => w.count));

const reviewTrend = [42, 38, 55, 47, 62, 58, 71, 78];
const maxRev = Math.max(...reviewTrend);

const teamStats = [
  { name: 'Ravi Kumar',  role: 'Site Manager',      uploads: 42, approved: 38, rejected: 2,  avgTime: '3.8h' },
  { name: 'Anil P',      role: 'QA Reviewer',       uploads: 29, approved: 25, rejected: 3,  avgTime: '4.2h' },
  { name: 'Kiran Desai', role: 'Field Coordinator', uploads: 18, approved: 17, rejected: 1,  avgTime: '2.9h' },
  { name: 'Meena R',     role: 'Documentation',     uploads: 12, approved: 11, rejected: 0,  avgTime: '5.1h' },
];

const tabs = ['Overview', 'Captures', 'Reviews', 'Projects', 'Team'];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('Overview');
  const totalCaptures = mockCaptures.length;
  const approved = mockCaptures.filter(c => c.status === 'processed').length;
  const pending  = mockCaptures.filter(c => c.status === 'review').length;
  const tours    = mockTours.filter(t => t.status === 'published').length;
  const avgProgress = Math.round(mockProjects.reduce((a, p) => a + p.progress, 0) / mockProjects.length);
  const openDefects = mockDefects.filter(d => d.status === 'open' || d.status === 'in_progress').length;

  const kpis = [
    { icon: <CameraAltRounded />,  label: 'Total Captures',  value: totalCaptures, sub: '31 this week', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
    { icon: <CheckCircleRounded />, label: 'Approved',        value: approved,       sub: `${Math.round(approved/totalCaptures*100)}% rate`, color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    { icon: <AccessTimeRounded />,  label: 'Pending Review',  value: pending,        sub: 'Avg 4.2h', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    { icon: <ViewInArRounded />,    label: 'Published Tours', value: tours,          sub: `${mockTours.reduce((a,t) => a+t.viewCount,0)} views`, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    { icon: <TrendingUpRounded />,  label: 'Avg Completion',  value: `${avgProgress}%`, sub: 'Across 4 projects', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
    { icon: <BugReportRounded />,   label: 'Open Defects',    value: openDefects,    sub: `${mockDefects.filter(d=>d.severity==='critical').length} critical`, color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    { icon: <PeopleRounded />,      label: 'Team Members',    value: mockUsers.length, sub: '3 reviewers', color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
    { icon: <MapRounded />,         label: 'Floor Plans',     value: 3,              sub: '2 projects', color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  ];

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>Analytics</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Construction intelligence across all active projects</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75, backgroundColor: colors.card, borderRadius: '10px', p: 0.5, boxShadow: '0 1px 4px rgba(15,23,42,0.05)' }}>
          {['7d', '30d', '90d', 'All'].map(r => (
            <Box key={r} sx={{ px: 1.5, py: 0.5, borderRadius: '8px', fontSize: '0.8125rem', fontWeight: r === '30d' ? 600 : 400, color: r === '30d' ? '#fff' : colors.textMuted, backgroundColor: r === '30d' ? colors.primary : 'transparent', cursor: 'pointer', transition: 'all 0.15s' }}>{r}</Box>
          ))}
        </Box>
      </Box>

      {/* Tabs */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 4, borderBottom: `1px solid ${colors.borderLight}`, pb: 0 }}>
        {tabs.map(t => (
          <Box key={t} onClick={() => setActiveTab(t)} sx={{ px: 2, py: 0.875, fontSize: '0.875rem', fontWeight: activeTab === t ? 600 : 400, color: activeTab === t ? colors.primary : colors.textMuted, borderBottom: `2px solid ${activeTab === t ? colors.primary : 'transparent'}`, cursor: 'pointer', transition: 'all 0.15s', mb: '-1px' }}>
            {t}
          </Box>
        ))}
      </Box>

      {/* KPI grid */}
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {kpis.map(({ icon, label, value, sub, color, bg }) => (
          <Grid key={label} size={{ xs: 6, sm: 4, md: 3 }}>
            <Box sx={{ p: 2.5, borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
              <Box sx={{ width: 34, height: 34, borderRadius: '9px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, mb: 1.5, '& svg': { fontSize: 17 } }}>{icon}</Box>
              <Typography sx={{ fontSize: '1.625rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1, mb: 0.25 }}>{value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 500, color: colors.textSecondary }}>{label}</Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.25 }}>{sub}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Capture volume chart */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
              <Box>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Capture Volume</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>8-week trend across all projects</Typography>
              </Box>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#16a34a', letterSpacing: '-0.03em' }}>↑ 24%</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 120 }}>
              {captureWeeks.map((w, i) => (
                <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.375 }}>
                  <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued }}>{w.count}</Typography>
                  <Box sx={{ width: '100%', borderRadius: '4px 4px 0 0', height: `${(w.count / maxCount) * 96}px`, background: i === captureWeeks.length - 1 ? colors.primaryGradient : `${colors.primary}28`, minHeight: 6, transition: 'all 0.3s' }} />
                  <Typography sx={{ fontSize: '0.4375rem', color: colors.textSubdued, textAlign: 'center' }}>{w.week}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Grid>

        {/* Review approval trend */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ p: 3, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', height: '100%' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
              <Box>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Review Approval Rate</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted }}>First-pass weekly trend</Typography>
              </Box>
              <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: '#2563eb', letterSpacing: '-0.03em' }}>78%</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 96 }}>
              {reviewTrend.map((v, i) => (
                <Box key={i} sx={{ flex: 1, height: `${(v / maxRev) * 88}px`, borderRadius: '3px 3px 0 0', backgroundColor: i === reviewTrend.length - 1 ? '#2563eb' : 'rgba(37,99,235,0.22)', minHeight: 4 }} />
              ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued }}>Apr W1</Typography>
              <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued }}>May W4</Typography>
            </Box>
          </Box>
        </Grid>
      </Grid>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {/* Review metrics */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Box sx={{ p: 3, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, mb: 2.5 }}>Review Metrics</Typography>
            {[
              { label: 'Avg Review Time',     value: '4.2h',  delta: '-18%',  positive: true },
              { label: 'First-pass Approval', value: '78%',   delta: '+5pp',  positive: true },
              { label: 'Rejection Rate',       value: '8%',    delta: '+1pp',  positive: false },
              { label: 'Capture Velocity',     value: '31/wk', delta: '+24%',  positive: true },
              { label: 'Pending Queue',        value: '7',     delta: '3 overdue', positive: false },
            ].map(m => (
              <Box key={m.label} sx={{ display: 'flex', alignItems: 'center', py: 1.25, borderBottom: `1px solid ${colors.borderLight}`, '&:last-child': { borderBottom: 'none' } }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{m.label}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: m.positive ? '#16a34a' : '#d97706' }}>{m.delta}</Typography>
                </Box>
                <Typography sx={{ fontSize: '1.25rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.03em' }}>{m.value}</Typography>
              </Box>
            ))}
          </Box>
        </Grid>

        {/* Project progress */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Box sx={{ p: 3, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)' }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, mb: 2.5 }}>Project Completion</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {mockProjects.map(p => (
                <Box key={p.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                    <Box sx={{ width: 32, height: 32, borderRadius: '8px', background: p.gradient, flexShrink: 0 }} />
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.25 }}>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{p.name}</Typography>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: p.accent }}>{p.progress}%</Typography>
                      </Box>
                      <Box sx={{ height: 6, borderRadius: '99px', backgroundColor: `${p.accent}20` }}>
                        <Box sx={{ height: '100%', width: `${p.progress}%`, borderRadius: '99px', backgroundColor: p.accent, transition: 'width 0.6s' }} />
                      </Box>
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 2, pl: '44px' }}>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{p.captures}/{p.totalRooms} captures</Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>· {p.towers} towers</Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>· {p.teamSize} members</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Grid>
      </Grid>

      {/* Team productivity */}
      <Box>
        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.08em', textTransform: 'uppercase', mb: 2.5 }}>Team Productivity</Typography>
        <Box sx={{ borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', overflow: 'hidden' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 80px', px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.borderLight}`, backgroundColor: colors.bg }}>
            {['Member', 'Uploads', 'Approved', 'Rejected', 'Avg Time'].map(h => (
              <Typography key={h} sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', textAlign: h === 'Member' ? 'left' : 'center' }}>{h}</Typography>
            ))}
          </Box>
          {teamStats.map((m, i) => (
            <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 80px', px: 2.5, py: 1.5, borderBottom: i < teamStats.length - 1 ? `1px solid ${colors.borderLight}` : 'none', alignItems: 'center', '&:hover': { backgroundColor: colors.bg } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 30, height: 30, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>{m.name[0]}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{m.name}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>{m.role}</Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, textAlign: 'center' }}>{m.uploads}</Typography>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: '#16a34a', textAlign: 'center' }}>{m.approved}</Typography>
              <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: m.rejected > 0 ? '#dc2626' : colors.textSubdued, textAlign: 'center' }}>{m.rejected}</Typography>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textSecondary, textAlign: 'center' }}>{m.avgTime}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}
