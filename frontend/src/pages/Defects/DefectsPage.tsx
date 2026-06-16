import React, { useState } from 'react';
import { Box, Typography, Grid, TextField, Select, MenuItem, Menu } from '@mui/material';
import { Link } from 'react-router-dom';
import { AddRounded, BugReportRounded, WarningRounded, DeleteOutlineRounded, KeyboardArrowDownRounded, CheckRounded, ArrowForwardRounded } from '@mui/icons-material';
import EmptyState from '@shared/components/EmptyState/EmptyState';
import ConfirmDialog from '@shared/components/ConfirmDialog/ConfirmDialog';
import { colors, motion } from '@theme/tokens';
import { statusConfig } from '@store/workflowSelectors';
import { useWorkflowStore } from '@store/workflowStore';
import type { MockDefect } from '@/data/mockData';

const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const STATUS_OPTIONS = [
  { value: 'all', label: 'All status' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
] as const;
type StatusValue = typeof STATUS_OPTIONS[number]['value'];

const SEVERITY_OPTIONS = [
  { value: 'all', label: 'All severity' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const STATUS_DOT: Record<string, string> = {
  all: colors.textSubdued, open: colors.danger, in_progress: colors.warning, resolved: colors.success, closed: colors.textSubdued,
};
const SEVERITY_DOT: Record<string, string> = {
  all: colors.textSubdued, critical: '#7c3aed', high: colors.danger, medium: colors.warning, low: colors.info,
};

const fieldSx = {
  '& .MuiOutlinedInput-root': { borderRadius: '10px', fontSize: '0.875rem', '& .MuiOutlinedInput-notchedOutline': { borderColor: '#e5e7eb' }, '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#cbd5e1' } },
};

function CreateDefectModal({ onClose, onSave }: { onClose: () => void; onSave: (d: Omit<MockDefect, 'id' | 'createdAt' | 'updatedAt'>) => void }) {
  const projects = useWorkflowStore(s => s.projects);
  const users = useWorkflowStore(s => s.users);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '1');
  const [assignee, setAssignee] = useState(users[1]?.id ?? 'u2');

  function handleSave() {
    if (!title.trim()) return;
    const project = projects.find(p => p.id === projectId);
    const user = users.find(u => u.id === assignee);
    onSave({
      title, description: desc, severity, status: 'open',
      projectId, projectName: project?.name ?? '', assignedTo: user?.name ?? '', createdBy: 'You',
    });
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
                {users.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </Select>
            </Grid>
          </Grid>
          <Box>
            <Typography component="label" sx={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>Project</Typography>
            <Select fullWidth size="small" value={projectId} onChange={e => setProjectId(e.target.value)} sx={{ borderRadius: '10px', fontSize: '0.875rem' }}>
              {projects.filter(p => !p.archived).map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
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
  const defects = useWorkflowStore(s => s.defects);
  const createDefect = useWorkflowStore(s => s.createDefect);
  const updateDefect = useWorkflowStore(s => s.updateDefect);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState<StatusValue>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [statusAnchor, setStatusAnchor] = useState<null | HTMLElement>(null);
  const [sevAnchor, setSevAnchor] = useState<null | HTMLElement>(null);

  const statusLabel = STATUS_OPTIONS.find(o => o.value === filter)?.label ?? 'All status';
  const sevLabel = SEVERITY_OPTIONS.find(o => o.value === severityFilter)?.label ?? 'All severity';

  function handleDelete() {
    if (!deleteTarget) return;
    updateDefect(deleteTarget, { status: 'closed' });
    setDeleteTarget(null);
  }

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

      {/* Stats — single calm surface, dots not colour-blocks */}
      <Box sx={{ display: 'flex', mb: 4, borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, overflow: 'hidden' }}>
        {[
          { label: 'Open', value: counts.open, dot: colors.danger },
          { label: 'In Progress', value: counts.in_progress, dot: colors.warning },
          { label: 'Resolved', value: counts.resolved, dot: colors.success },
          { label: 'Total', value: defects.length, dot: colors.textSubdued },
        ].map((s, i) => (
          <Box key={s.label} sx={{ flex: 1, px: 2.5, py: 2, borderLeft: i > 0 ? `1px solid ${colors.borderLight}` : 'none' }}>
            <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.04em', lineHeight: 1, mb: 0.75 }}>{s.value}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: s.dot }} />
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, fontWeight: 500 }}>{s.label}</Typography>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Filters — matching pill dropdowns */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Status dropdown */}
        <Box onClick={e => setStatusAnchor(e.currentTarget)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 1.25, py: 1.125, borderRadius: '999px', cursor: 'pointer', border: `1px solid ${statusAnchor ? colors.textStrong : colors.border}`, backgroundColor: colors.card, boxShadow: statusAnchor ? `0 0 0 3px ${colors.primaryRing}` : '0 1px 2px rgba(15,23,42,0.04)', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.textSubdued } }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: STATUS_DOT[filter] }} />
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }}>{statusLabel}</Typography>
          <KeyboardArrowDownRounded sx={{ fontSize: 18, color: colors.textMuted, transform: statusAnchor ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast}` }} />
        </Box>

        {/* Severity dropdown */}
        <Box onClick={e => setSevAnchor(e.currentTarget)} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, pl: 1.5, pr: 1.25, py: 1.125, borderRadius: '999px', cursor: 'pointer', border: `1px solid ${sevAnchor ? colors.textStrong : colors.border}`, backgroundColor: colors.card, boxShadow: sevAnchor ? `0 0 0 3px ${colors.primaryRing}` : '0 1px 2px rgba(15,23,42,0.04)', transition: `all ${motion.durationFast}`, '&:hover': { borderColor: colors.textSubdued } }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: SEVERITY_DOT[severityFilter] }} />
          <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em' }}>{sevLabel}</Typography>
          <KeyboardArrowDownRounded sx={{ fontSize: 18, color: colors.textMuted, transform: sevAnchor ? 'rotate(180deg)' : 'none', transition: `transform ${motion.durationFast}` }} />
        </Box>

        <Typography sx={{ ml: 'auto', fontSize: '0.8125rem', color: colors.textSubdued }}>{filtered.length} {filtered.length === 1 ? 'defect' : 'defects'}</Typography>
      </Box>

      {/* Status menu */}
      <Menu anchorEl={statusAnchor} open={!!statusAnchor} onClose={() => setStatusAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: 1, minWidth: 200, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}>
        {STATUS_OPTIONS.map(o => {
          const isActive = filter === o.value;
          return (
            <MenuItem key={o.value} onClick={() => { setFilter(o.value); setStatusAnchor(null); }} sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, backgroundColor: isActive ? colors.primarySoft : 'transparent', '&:hover': { backgroundColor: colors.bg } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: STATUS_DOT[o.value] }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>{o.label}</Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Severity menu */}
      <Menu anchorEl={sevAnchor} open={!!sevAnchor} onClose={() => setSevAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }} transformOrigin={{ vertical: 'top', horizontal: 'left' }} slotProps={{ paper: { sx: { mt: 1, minWidth: 200, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}>
        {SEVERITY_OPTIONS.map(o => {
          const isActive = severityFilter === o.value;
          return (
            <MenuItem key={o.value} onClick={() => { setSeverityFilter(o.value); setSevAnchor(null); }} sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, backgroundColor: isActive ? colors.primarySoft : 'transparent', '&:hover': { backgroundColor: colors.bg } }}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: SEVERITY_DOT[o.value] }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>{o.label}</Typography>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Defect list — calm rows, hairline dividers, one neutral surface */}
      <Box sx={filtered.length > 0 ? { borderRadius: '16px', backgroundColor: colors.card, border: `1px solid ${colors.borderLight}`, overflow: 'hidden' } : undefined}>
        {filtered.map((d, idx) => {
          const sevCfg = statusConfig.severity[d.severity];
          const stCfg = statusConfig.defect[d.status];
          const location = [d.projectName, d.towerName, d.floorLabel, d.roomName].filter(Boolean).join(' · ');
          return (
            <Box key={d.id} sx={{ p: 2.5, display: 'flex', gap: 2, alignItems: 'flex-start', borderTop: idx > 0 ? `1px solid ${colors.borderLight}` : 'none', transition: `background ${motion.durationFast}`, '&:hover': { backgroundColor: colors.bg }, '&:hover .dfx-delete': { opacity: 1 } }}>
              {/* Neutral icon, severity carried by a small dot */}
              <Box sx={{ width: 36, height: 36, borderRadius: '10px', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' }}>
                {d.severity === 'critical' ? <WarningRounded sx={{ fontSize: 18, color: colors.textMuted }} /> : <BugReportRounded sx={{ fontSize: 18, color: colors.textMuted }} />}
                <Box sx={{ position: 'absolute', top: -2, right: -2, width: 10, height: 10, borderRadius: '50%', backgroundColor: sevCfg.color, border: `2px solid ${colors.card}` }} />
              </Box>

              {/* Main */}
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong, letterSpacing: '-0.01em', mb: 0.375 }}>{d.title}</Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.5 }}>{d.description}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                  {/* status: dot + word */}
                  <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.625 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: stCfg.color }} />
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textSecondary }}>{stCfg.label}</Typography>
                  </Box>
                  {/* severity: quiet label */}
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: sevCfg.color }}>{sevCfg.label}</Typography>
                  <Box sx={{ width: 3, height: 3, borderRadius: '50%', backgroundColor: colors.borderLight }} />
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textSubdued, minWidth: 0 }}>{location}</Typography>
                </Box>
              </Box>

              {/* Right meta */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.875, flexShrink: 0 }}>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued }}>{d.createdAt}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box sx={{ width: 22, height: 22, borderRadius: '50%', backgroundColor: colors.bgDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: colors.textSecondary }}>{d.assignedTo[0]}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textSecondary }}>{d.assignedTo.split(' ')[0]}</Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {d.captureId && (
                    <Box component={Link} to={`/captures/${d.captureId}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.375, fontSize: '0.75rem', color: colors.primary, textDecoration: 'none', fontWeight: 600, '&:hover': { textDecoration: 'underline' } }}>
                      View capture <ArrowForwardRounded sx={{ fontSize: 13 }} />
                    </Box>
                  )}
                  <Box className="dfx-delete" onClick={() => setDeleteTarget(d.id)} sx={{ display: 'flex', alignItems: 'center', color: colors.textSubdued, cursor: 'pointer', opacity: { xs: 1, md: 0 }, transition: `opacity ${motion.durationFast}, color ${motion.durationFast}`, '&:hover': { color: colors.danger } }}>
                    <DeleteOutlineRounded sx={{ fontSize: 16 }} />
                  </Box>
                </Box>
              </Box>
            </Box>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState
            icon={<BugReportRounded />}
            title="No defects found"
            description="No defects match your current filters. Adjust the filters or create a new defect."
            action={{ label: '+ Create Defect', onClick: () => setShowCreate(true) }}
          />
        )}
      </Box>

      {showCreate && <CreateDefectModal onClose={() => setShowCreate(false)} onSave={d => createDefect(d)} />}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete defect?"
        description="This defect will be permanently removed. This action cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
