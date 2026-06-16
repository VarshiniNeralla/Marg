import React, { useState } from 'react';
import { Box, Typography, Grid } from '@mui/material';
import {
  TrendingUpRounded, CameraAltRounded, ViewInArRounded, CheckCircleRounded,
  AccessTimeRounded, PeopleRounded, BugReportRounded, MapRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { computeDashboardStats } from '@store/workflowSelectors';

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

const TABS = ['Overview', 'Captures', 'Reviews', 'Projects', 'Team'] as const;
type Tab = typeof TABS[number];

// ── Reusable surface ───────────────────────────────────────────────────────────
function Card({ title, subtitle, right, children }: { title?: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ p: 3, borderRadius: '18px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}` }}>
      {(title || right) && (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3 }}>
          <Box>
            {title && <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.01em' }}>{title}</Typography>}
            {subtitle && <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25 }}>{subtitle}</Typography>}
          </Box>
          {right}
        </Box>
      )}
      {children}
    </Box>
  );
}

function StatTile({ icon, label, value, sub, color, bg }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub: string; color: string; bg: string }) {
  return (
    <Box sx={{ p: 2.5, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}` }}>
      <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color, mb: 2, '& svg': { fontSize: 18 } }}>{icon}</Box>
      <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1, mb: 0.5 }}>{value}</Typography>
      <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textSecondary }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.25 }}>{sub}</Typography>
    </Box>
  );
}

function CaptureVolumeChart() {
  return (
    <Card title="Capture Volume" subtitle="8-week trend across all projects" right={<Typography sx={{ fontSize: '1.125rem', fontWeight: 800, color: '#16a34a', letterSpacing: '-0.03em' }}>↑ 24%</Typography>}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 150 }}>
        {captureWeeks.map((w, i) => (
          <Box key={i} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.625 }}>
            <Typography sx={{ fontSize: '0.625rem', fontWeight: 600, color: colors.textSubdued }}>{w.count}</Typography>
            <Box sx={{ width: '100%', borderRadius: '6px 6px 0 0', height: `${(w.count / maxCount) * 110}px`, background: i === captureWeeks.length - 1 ? colors.primaryGradient : 'rgba(37,99,235,0.16)', minHeight: 8, transition: `height ${motion.durationSlow} ${motion.easeOut}` }} />
            <Typography sx={{ fontSize: '0.5625rem', color: colors.textSubdued, textAlign: 'center' }}>{w.week}</Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function ApprovalTrendChart() {
  return (
    <Card title="Review Approval Rate" subtitle="First-pass weekly trend" right={<Typography sx={{ fontSize: '1.125rem', fontWeight: 800, color: colors.primary, letterSpacing: '-0.03em' }}>78%</Typography>}>
      <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.75, height: 130 }}>
        {reviewTrend.map((v, i) => (
          <Box key={i} sx={{ flex: 1, height: `${(v / maxRev) * 118}px`, borderRadius: '4px 4px 0 0', backgroundColor: i === reviewTrend.length - 1 ? colors.primary : 'rgba(37,99,235,0.18)', minHeight: 6, transition: `height ${motion.durationSlow} ${motion.easeOut}` }} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued }}>Apr W1</Typography>
        <Typography sx={{ fontSize: '0.625rem', color: colors.textSubdued }}>May W4</Typography>
      </Box>
    </Card>
  );
}

function ReviewMetrics() {
  const metrics = [
    { label: 'Avg Review Time',     value: '4.2h',  delta: '-18%',  positive: true },
    { label: 'First-pass Approval', value: '78%',   delta: '+5pp',  positive: true },
    { label: 'Rejection Rate',      value: '8%',    delta: '+1pp',  positive: false },
    { label: 'Capture Velocity',    value: '31/wk', delta: '+24%',  positive: true },
    { label: 'Pending Queue',       value: '7',     delta: '3 overdue', positive: false },
  ];
  return (
    <Card title="Review Metrics">
      {metrics.map((m, i) => (
        <Box key={m.label} sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: i < metrics.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 500, color: colors.textStrong }}>{m.label}</Typography>
            <Typography sx={{ fontSize: '0.6875rem', color: m.positive ? '#16a34a' : '#d97706' }}>{m.delta}</Typography>
          </Box>
          <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em' }}>{m.value}</Typography>
        </Box>
      ))}
    </Card>
  );
}

function ProjectCompletion() {
  const mockProjects = useWorkflowStore(s => s.projects).filter(p => !p.archived);
  return (
    <Card title="Project Completion" subtitle="Mapping progress per project">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {mockProjects.map(p => (
          <Box key={p.id}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              <Box sx={{ width: 34, height: 34, borderRadius: '9px', background: p.gradient, flexShrink: 0 }} />
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{p.name}</Typography>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 800, color: p.accent, letterSpacing: '-0.02em' }}>{p.progress}%</Typography>
                </Box>
                <Box sx={{ height: 6, borderRadius: '99px', backgroundColor: `${p.accent}1f` }}>
                  <Box sx={{ height: '100%', width: `${p.progress}%`, borderRadius: '99px', backgroundColor: p.accent, transition: `width ${motion.durationSlow} ${motion.easeOut}` }} />
                </Box>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, pl: '46px' }}>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{p.captures}/{p.totalRooms} captures</Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>· {p.towers} towers</Typography>
              <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>· {p.teamSize} members</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

function TeamTable() {
  return (
    <Card title="Team Productivity" subtitle="Uploads and review outcomes per member">
      <Box sx={{ borderRadius: '12px', border: `1px solid ${colors.borderLight}`, overflow: 'hidden' }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 80px', px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.borderLight}`, backgroundColor: colors.bg }}>
          {['Member', 'Uploads', 'Approved', 'Rejected', 'Avg Time'].map(h => (
            <Typography key={h} sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textSubdued, letterSpacing: '0.07em', textTransform: 'uppercase', textAlign: h === 'Member' ? 'left' : 'center' }}>{h}</Typography>
          ))}
        </Box>
        {teamStats.map((m, i) => (
          <Box key={i} sx={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px 80px', px: 2.5, py: 1.75, borderBottom: i < teamStats.length - 1 ? `1px solid ${colors.borderLight}` : 'none', alignItems: 'center', '&:hover': { backgroundColor: colors.bg } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box sx={{ width: 32, height: 32, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff' }}>{m.name[0]}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{m.name}</Typography>
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
    </Card>
  );
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [range, setRange] = useState('30d');

  // Reactive: live data from the workflow store.
  const mockCaptures = useWorkflowStore(s => s.captures);
  const mockTours = useWorkflowStore(s => s.tours);
  const mockProjects = useWorkflowStore(s => s.projects).filter(p => !p.archived);
  const defects = useWorkflowStore(s => s.defects);
  const users = useWorkflowStore(s => s.users);
  const floorPlans = useWorkflowStore(s => s.floorPlans);

  const totalCaptures = mockCaptures.length;
  const approved = mockCaptures.filter(c => c.status === 'processed').length;
  const pending  = mockCaptures.filter(c => c.status === 'review').length;
  const tours    = mockTours.filter(t => t.status === 'published').length;
  const avgProgress = Math.round(mockProjects.reduce((a, p) => a + p.progress, 0) / mockProjects.length);
  const openDefects = defects.filter(d => d.status === 'open' || d.status === 'in_progress').length;
  const criticalDefects = defects.filter(d => d.severity === 'critical').length;
  const reviewerCount = users.filter(u => u.role === 'reviewer' || u.role === 'admin').length;
  const uniquePlanProjects = new Set(floorPlans.map(fp => fp.projectId)).size;

  const ALL_KPIS = [
    { key: 'captures', icon: <CameraAltRounded />,  label: 'Total Captures',  value: totalCaptures, sub: '31 this week', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
    { key: 'approved', icon: <CheckCircleRounded />, label: 'Approved',        value: approved,       sub: `${Math.round(approved/totalCaptures*100)}% rate`, color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
    { key: 'pending',  icon: <AccessTimeRounded />,  label: 'Pending Review',  value: pending,        sub: 'Avg 4.2h', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    { key: 'tours',    icon: <ViewInArRounded />,    label: 'Published Tours', value: tours,          sub: `${mockTours.reduce((a,t) => a+t.viewCount,0)} views`, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
    { key: 'progress', icon: <TrendingUpRounded />,  label: 'Avg Completion',  value: `${avgProgress}%`, sub: 'Across 4 projects', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
    { key: 'defects',  icon: <BugReportRounded />,   label: 'Open Defects',    value: openDefects,    sub: `${criticalDefects} critical`, color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    { key: 'team',     icon: <PeopleRounded />,      label: 'Team Members',    value: users.length, sub: `${reviewerCount} reviewers`, color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
    { key: 'plans',    icon: <MapRounded />,         label: 'Floor Plans',     value: floorPlans.length, sub: `${uniquePlanProjects} projects`, color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  ];

  // Each tab shows only its relevant KPIs — focused, not the whole wall.
  // KPI strip is shown on the Overview tab only.
  const OVERVIEW_KPIS = ['captures', 'approved', 'pending', 'progress'];
  const visibleKpis = ALL_KPIS.filter(k => OVERVIEW_KPIS.includes(k.key));

  return (
    <Box sx={{ maxWidth: 1160, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>Analytics</Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Construction intelligence across all active projects</Typography>
        </Box>
        {/* <Box sx={{ display: 'flex', gap: 0.5, backgroundColor: colors.bgDeep, borderRadius: '10px', p: 0.5 }}>
          {['7d', '30d', '90d', 'All'].map(r => (
            <Box key={r} onClick={() => setRange(r)} sx={{ px: 1.5, py: 0.625, borderRadius: '8px', fontSize: '0.8125rem', fontWeight: r === range ? 600 : 500, color: r === range ? '#fff' : colors.textMuted, backgroundColor: r === range ? colors.textStrong : 'transparent', cursor: 'pointer', transition: `all ${motion.durationFast}`, '&:hover': { color: r === range ? '#fff' : colors.textStrong } }}>{r}</Box>
          ))}
        </Box> */}
      </Box>

      {/* Tabs — underline, working */}
      <Box sx={{ display: 'flex', gap: 3, mb: 4, borderBottom: `1px solid ${colors.borderLight}` }}>
        {TABS.map(t => {
          const isActive = activeTab === t;
          return (
            <Box key={t} onClick={() => setActiveTab(t)} sx={{ position: 'relative', pb: 1.5, cursor: 'pointer', fontSize: '0.9375rem', fontWeight: isActive ? 600 : 500, color: isActive ? colors.textStrong : colors.textSubdued, letterSpacing: '-0.01em', transition: `color ${motion.durationFast}`, '&:hover': { color: colors.textStrong }, '&::after': { content: '""', position: 'absolute', left: 0, right: 0, bottom: -1, height: 2, borderRadius: '2px', backgroundColor: colors.textStrong, transform: isActive ? 'scaleX(1)' : 'scaleX(0)', transformOrigin: 'center', transition: `transform ${motion.durationNormal} ${motion.easeOut}` } }}>
              {t}
            </Box>
          );
        })}
      </Box>

      {/* Tab content — animates on switch */}
      <Box key={activeTab} sx={{ animation: `tabFade ${motion.durationNormal} ${motion.easeOut}`, '@keyframes tabFade': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } } }}>
        {/* Per-tab body */}
        {activeTab === 'Overview' && (
          <>
            {/* KPI strip — Overview only */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              {visibleKpis.map(k => (
                <Grid key={k.key} size={{ xs: 6, md: 3 }}>
                  <StatTile {...k} />
                </Grid>
              ))}
            </Grid>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 7 }}><CaptureVolumeChart /></Grid>
              <Grid size={{ xs: 12, md: 5 }}><ApprovalTrendChart /></Grid>
            </Grid>
          </>
        )}

        {activeTab === 'Captures' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}><CaptureVolumeChart /></Grid>
            <Grid size={{ xs: 12, md: 4 }}><ReviewMetrics /></Grid>
          </Grid>
        )}

        {activeTab === 'Reviews' && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 7 }}><ApprovalTrendChart /></Grid>
            <Grid size={{ xs: 12, md: 5 }}><ReviewMetrics /></Grid>
          </Grid>
        )}

        {activeTab === 'Projects' && <ProjectCompletion />}

        {activeTab === 'Team' && <TeamTable />}
      </Box>
    </Box>
  );
}
