import React, { useState } from 'react';
import { Box, Typography, Grid, Chip, TextField, Select, MenuItem } from '@mui/material';
import { Link } from 'react-router-dom';
import { AddRounded, BugReportRounded, WarningRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { mockDefects, statusConfig, mockProjects, mockUsers, type MockDefect } from '@/data/mockData';

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const fieldSx = {
  '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: '0.875rem', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' } },
};

function CreateDefectModal({ onClose, onSave }: { onClose: () => void; onSave: (d: MockDefect) => void }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [projectId, setProjectId] = useState('1');
  const [assignee, setAssignee] = useState('u2');

  function handleSave() {
    if (!title.trim()) return;
    const project = mockProjects.find(p => p.id === projectId);
    const user = mockUsers.find(u => u.id === assignee);
    const newDefect: MockDefect = {
      id: `d${Date.now()}`, title, description: desc, severity, status: 'open',
      projectId, projectName: project?.name ?? '', assignedTo: user?.name ?? '', createdBy: 'Ravi Kumar', createdAt: 'Just now', updatedAt: 'Just now',
    };
    mockDefects.push(newDefect);
    onSave(newDefect);
    onClose();
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <Box sx={{ width: '100%', maxWidth: 520, borderRadius: '20px', backgroundColor: colors.card, boxShadow: '0 24px 64px rgba(15,23,42,0.18)', overflow: 'hidden' }}>
        <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: colors.textStrong }}>Create Defect</Typography>
          <Box onClick={onClose} sx={{ cursor: 'pointer', color: colors.textSubdued, '&:hover': { color: colors.textStrong } }}>✕</Box>
        </Box>
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Title *</Typography>
            <TextField fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} placeholder="Describe the issue" sx={fieldSx} />
          </Box>
          <Box>
            <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Description</Typography>
            <TextField fullWidth multiline rows={3} size="small" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Detailed description…" sx={fieldSx} />
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Severity</Typography>
              <Select fullWidth size="small" value={severity} onChange={e => setSeverity(e.target.value as typeof severity)} sx={{ borderRadius: '10px', fontSize: '0.875rem' }}>
                {['low', 'medium', 'high', 'critical'].map(s => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
              </Select>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Assignee</Typography>
              <Select fullWidth size="small" value={assignee} onChange={e => setAssignee(e.target.value)} sx={{ borderRadius: '10px', fontSize: '0.875rem' }}>
                {mockUsers.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </Select>
            </Grid>
          </Grid>
          <Box>
            <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Project</Typography>
            <Select fullWidth size="small" value={projectId} onChange={e => setProjectId(e.target.value)} sx={{ borderRadius: '10px', fontSize: '0.875rem' }}>
              {mockProjects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </Box>
        </Box>
        <Box sx={{ px: 3, py: 2.5, borderTop: `1px solid ${colors.borderLight}`, display: 'flex', gap: 1.5, justifyContent: 'flex-end' }}>
          <Box onClick={onClose} sx={{ px: 2.5, py: 1, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textSecondary, fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>Cancel</Box>
          <Box onClick={handleSave} sx={{ px: 2.5, py: 1, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>Create Defect</Box>
        </Box>
      </Box>
    </Box>
  );
}

export default function DefectsPage() {
  const [defects, setDefects] = useState([...mockDefects]);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'resolved' | 'closed'>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  const filtered = defects
    .filter(d => filter === 'all' ? true : d.status === filter)
    .filter(d => severityFilter === 'all' ? true : d.severity === severityFilter)
    .sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));

  const counts = { open: defects.filter(d => d.status === 'open').length, in_progress: defects.filter(d => d.status === 'in_progress').length, resolved: defects.filter(d => d.status === 'resolved').length };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 4, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography sx={{ fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif', fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1.1, mb: 0.75 }}>
            Defects
          </Typography>
          <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>Track and resolve issues across all projects</Typography>
        </Box>
        <Box onClick={() => setShowCreate(true)} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 2, py: 0.875, borderRadius: '8px', background: colors.primaryGradient, color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 14px rgba(37,99,235,0.28)' }}>
          <AddRounded sx={{ fontSize: 16 }} /> Create Defect
        </Box>
      </Box>

      {/* Stats */}
      <Box sx={{ display: 'flex', gap: 2, mb: 4, flexWrap: 'wrap' }}>
        {[
          { label: 'Open', value: counts.open, color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
          { label: 'In Progress', value: counts.in_progress, color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
          { label: 'Resolved', value: counts.resolved, color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
          { label: 'Total', value: defects.length, color: colors.textSecondary, bg: colors.bgDeep },
        ].map(s => (
          <Box key={s.label} sx={{ px: 2.5, py: 1.5, borderRadius: '12px', backgroundColor: s.bg }}>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: s.color, letterSpacing: '-0.03em', lineHeight: 1 }}>{s.value}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: s.color, fontWeight: 500, opacity: 0.8 }}>{s.label}</Typography>
          </Box>
        ))}
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'open', 'in_progress', 'resolved', 'closed'] as const).map(f => (
          <Box key={f} onClick={() => setFilter(f)} sx={{ px: 2, py: 0.625, borderRadius: '20px', fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer', transition: `all ${motion.durationFast}`, backgroundColor: filter === f ? colors.ink : colors.card, color: filter === f ? '#fff' : colors.textMuted, boxShadow: '0 1px 4px rgba(15,23,42,0.05)', textTransform: 'capitalize' }}>
            {f === 'all' ? 'All' : f.replace('_', ' ')}
          </Box>
        ))}
        <Box sx={{ ml: 'auto' }}>
          <Select size="small" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)} sx={{ borderRadius: '8px', fontSize: '0.8125rem', minWidth: 120 }}>
            <MenuItem value="all">All Severity</MenuItem>
            {['critical', 'high', 'medium', 'low'].map(s => <MenuItem key={s} value={s} sx={{ textTransform: 'capitalize' }}>{s}</MenuItem>)}
          </Select>
        </Box>
      </Box>

      {/* Defect list */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {filtered.map(d => {
          const sevCfg = statusConfig.severity[d.severity];
          const stCfg = statusConfig.defect[d.status];
          return (
            <Box key={d.id} sx={{ p: 2.5, borderRadius: '16px', backgroundColor: colors.card, boxShadow: '0 2px 8px rgba(15,23,42,0.05)', display: 'flex', gap: 2, alignItems: 'flex-start', transition: `all ${motion.durationFast}`, '&:hover': { boxShadow: '0 6px 24px rgba(15,23,42,0.08)', transform: 'translateY(-1px)' } }}>
              <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: sevCfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {d.severity === 'critical' ? <WarningRounded sx={{ fontSize: 18, color: sevCfg.color }} /> : <BugReportRounded sx={{ fontSize: 18, color: sevCfg.color }} />}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>{d.title}</Typography>
                  <Chip label={sevCfg.label} size="small" sx={{ height: 18, fontSize: '0.5625rem', fontWeight: 700, color: sevCfg.color, backgroundColor: sevCfg.bg, borderRadius: '4px' }} />
                  <Chip label={stCfg.label} size="small" sx={{ height: 18, fontSize: '0.5625rem', fontWeight: 700, color: stCfg.color, backgroundColor: stCfg.bg, borderRadius: '4px' }} />
                </Box>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{d.description}</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>{d.projectName}</Typography>
                  {d.towerName && <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>· {d.towerName}</Typography>}
                  {d.floorLabel && <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>· {d.floorLabel}</Typography>}
                  {d.roomName && <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued }}>· {d.roomName}</Typography>}
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{d.createdAt}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', background: colors.primaryGradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#fff' }}>{d.assignedTo[0]}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSecondary }}>{d.assignedTo.split(' ')[0]}</Typography>
                </Box>
                {d.captureId && (
                  <Box component={Link} to={`/captures/${d.captureId}`} sx={{ fontSize: '0.75rem', color: colors.primary, textDecoration: 'none', fontWeight: 500, '&:hover': { textDecoration: 'underline' } }}>View capture →</Box>
                )}
              </Box>
            </Box>
          );
        })}
        {filtered.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center', color: colors.textMuted }}>
            <BugReportRounded sx={{ fontSize: 40, color: colors.border, mb: 1 }} />
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 500 }}>No defects found</Typography>
          </Box>
        )}
      </Box>

      {showCreate && <CreateDefectModal onClose={() => setShowCreate(false)} onSave={d => setDefects(prev => [d, ...prev])} />}
    </Box>
  );
}
