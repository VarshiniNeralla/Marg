import React, { useState } from 'react';
import { Box, Typography, Grid, Chip, Tabs, Tab, Dialog, DialogTitle, DialogContent, DialogActions, Divider, Button as MuiButton, TextField } from '@mui/material';
import {
  CheckCircleRounded, CancelRounded, ReplayRounded, RateReviewRounded,
  ArrowForwardRounded, FilterListRounded, ViewInArRounded,
} from '@mui/icons-material';
import { Link } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import PageHeader from '@shared/components/PageHeader/PageHeader';
import Button from '@shared/components/Button/Button';

type ReviewTab = 'all' | 'pending' | 'approved' | 'rejected';

const statusMeta: Record<string, { label: string; color: string; bg: string }> = {
  uploaded:          { label: 'Uploaded',      color: '#64748b', bg: 'rgba(100,116,139,0.08)' },
  assigned:          { label: 'Assigned',      color: '#0891b2', bg: 'rgba(8,145,178,0.08)' },
  reviewing:         { label: 'Reviewing',     color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  changes_requested: { label: 'Changes Req.',  color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
  review:            { label: 'In Review',     color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
  approved:          { label: 'Approved',      color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  processed:         { label: 'Processed',     color: '#059669', bg: 'rgba(5,150,105,0.08)' },
  published:         { label: 'Published',     color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
  rejected:          { label: 'Rejected',      color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
};

// CaptureStatus is 'processed' | 'review' | 'rejected' | 'uploading'
const PENDING_STATUSES = new Set<string>(['review', 'uploading']);

export default function ReviewsPage() {
  const captures = useWorkflowStore(s => s.captures);
  const [tab, setTab]           = useState<ReviewTab>('pending');
  const [reviewCapture, setReview] = useState<typeof captures[0] | null>(null);
  const [action, setAction]     = useState<'approve' | 'reject' | 'recapture' | null>(null);
  const [notes, setNotes]       = useState('');
  const [localStatus, setLocalStatus] = useState<Record<string, string>>({});

  function getStatus(c: typeof captures[0]) {
    return localStatus[c.id] ?? c.status;
  }

  const filtered = captures.filter(c => {
    const s = getStatus(c);
    if (tab === 'pending')  return PENDING_STATUSES.has(s);
    if (tab === 'approved') return s === 'processed';
    if (tab === 'rejected') return s === 'rejected';
    return true;
  });

  const pendingCount  = captures.filter(c => PENDING_STATUSES.has(getStatus(c))).length;
  const approvedCount = captures.filter(c => getStatus(c) === 'processed').length;
  const rejectedCount = captures.filter(c => getStatus(c) === 'rejected').length;

  function openReview(capture: typeof captures[0], act: 'approve' | 'reject' | 'recapture') {
    setReview(capture);
    setAction(act);
    setNotes('');
  }

  function confirmAction() {
    if (!reviewCapture || !action) return;
    if (action === 'approve') {
      setLocalStatus(s => ({ ...s, [reviewCapture.id]: 'approved' }));
    } else if (action === 'reject') {
      setLocalStatus(s => ({ ...s, [reviewCapture.id]: 'rejected' }));
    } else {
      setLocalStatus(s => ({ ...s, [reviewCapture.id]: 'changes_requested' }));
    }
    setReview(null);
    setAction(null);
  }

  const actionMeta = {
    approve:   { label: 'Approve Capture', color: colors.success, desc: 'This capture meets quality standards.' },
    reject:    { label: 'Reject Capture',  color: colors.danger,  desc: 'This capture cannot be used and will be discarded.' },
    recapture: { label: 'Request Recapture', color: '#d97706',   desc: 'The engineer will need to re-take this capture.' },
  };

  return (
    <Box>
      <PageHeader
        title="Review Queue"
        subtitle={`${pendingCount} pending · ${approvedCount} approved · ${rejectedCount} rejected`}
        breadcrumbs={[{ label: 'Reviews' }]}
      />

      {/* KPI row */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { label: 'Pending',  value: pendingCount,  color: '#d97706' },
          { label: 'Approved', value: approvedCount, color: '#059669' },
          { label: 'Rejected', value: rejectedCount, color: '#dc2626' },
          { label: 'Total',    value: captures.length, color: '#2563eb' },
        ].map(s => (
          <Grid key={s.label} size={{ xs: 6, sm: 3 }}>
            <Box sx={{ p: 2, borderRadius: '12px', border: `1px solid ${colors.border}`, backgroundColor: colors.card, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '1.625rem', fontWeight: 800, color: s.color, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.375, fontWeight: 500 }}>{s.label}</Typography>
            </Box>
          </Grid>
        ))}
      </Grid>

      {/* Tabs */}
      <Box sx={{ borderBottom: `1px solid ${colors.border}`, mb: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ '& .MuiTab-root': { textTransform: 'none', fontSize: '0.875rem', fontWeight: 500, minWidth: 'auto', px: 2 }, '& .Mui-selected': { fontWeight: 700 } }}>
          <Tab value="pending"  label={`Pending (${pendingCount})`} />
          <Tab value="approved" label={`Approved (${approvedCount})`} />
          <Tab value="rejected" label={`Rejected (${rejectedCount})`} />
          <Tab value="all"      label="All" />
        </Tabs>
      </Box>

      {/* Capture cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {filtered.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <CheckCircleRounded sx={{ fontSize: 48, color: colors.success, mb: 1 }} />
            <Typography sx={{ fontSize: '1rem', fontWeight: 600, color: colors.textSecondary }}>All done — nothing to review here.</Typography>
          </Box>
        )}
        {filtered.map((c, i) => {
          const st = getStatus(c);
          const sm = statusMeta[st] ?? statusMeta.review;
          const isPending = PENDING_STATUSES.has(st);
          return (
            <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 2.5, py: 2, borderBottom: i < filtered.length - 1 ? `1px solid ${colors.borderLight}` : 'none' }}>
              <Box sx={{ width: 52, height: 52, borderRadius: '12px', background: c.gradient, flexShrink: 0 }} />

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
                  <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>{c.roomName}</Typography>
                  <Chip label={sm.label} size="small" sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, color: sm.color, backgroundColor: sm.bg, borderRadius: '5px', flexShrink: 0 }} />
                </Box>
                <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>
                  {c.projectName} · {c.floorLabel} · {c.uploadedAt}
                </Typography>
              </Box>

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                <Box component={Link} to={`/captures/${c.id}`} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid ${colors.border}`, color: colors.textMuted, textDecoration: 'none', '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft } }}>
                  <ArrowForwardRounded sx={{ fontSize: 16 }} />
                </Box>
                {isPending && (
                  <>
                    <Box onClick={() => openReview(c, 'approve')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid rgba(5,150,105,0.3)`, color: colors.success, cursor: 'pointer', '&:hover': { backgroundColor: colors.successBg } }}>
                      <CheckCircleRounded sx={{ fontSize: 18 }} />
                    </Box>
                    <Box onClick={() => openReview(c, 'recapture')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid rgba(217,119,6,0.3)`, color: '#d97706', cursor: 'pointer', '&:hover': { backgroundColor: colors.warningBg } }}>
                      <ReplayRounded sx={{ fontSize: 17 }} />
                    </Box>
                    <Box onClick={() => openReview(c, 'reject')} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid rgba(220,38,38,0.3)`, color: colors.danger, cursor: 'pointer', '&:hover': { backgroundColor: colors.dangerBg } }}>
                      <CancelRounded sx={{ fontSize: 18 }} />
                    </Box>
                  </>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Review Action Dialog */}
      <Dialog open={Boolean(reviewCapture && action)} onClose={() => setReview(null)} maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: "20px" } } }}>
        {reviewCapture && action && (() => {
          const am = actionMeta[action];
          return (
            <>
              <DialogTitle sx={{ fontSize: '1.0625rem', fontWeight: 700, pb: 1 }}>{am.label}</DialogTitle>
              <Divider />
              <DialogContent sx={{ pt: 2.5 }}>
                <Box sx={{ display: 'flex', gap: 2, mb: 2.5, p: 2, borderRadius: '12px', backgroundColor: colors.bg }}>
                  <Box sx={{ width: 52, height: 52, borderRadius: '10px', background: reviewCapture.gradient, flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textStrong }}>{reviewCapture.roomName}</Typography>
                    <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted }}>{reviewCapture.projectName} · {reviewCapture.floorLabel}</Typography>
                  </Box>
                </Box>
                <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary, mb: 2 }}>{am.desc}</Typography>
                <Box>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 500, color: colors.textSecondary, mb: 0.75 }}>
                    {action === 'approve' ? 'Approval notes (optional)' : 'Reason / Instructions'}
                  </Typography>
                  <Box component="textarea" value={notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)} rows={3} placeholder={action === 'approve' ? 'Add any notes for the record…' : 'Explain what needs to be fixed or why this is rejected…'} sx={{ width: '100%', px: 1.75, py: 1.25, borderRadius: '10px', border: `1px solid ${colors.border}`, fontSize: '0.875rem', fontFamily: 'inherit', color: colors.textStrong, outline: 'none', resize: 'vertical', boxSizing: 'border-box', '&:focus': { borderColor: colors.primary, boxShadow: '0 0 0 3px rgba(37,99,235,0.08)' } }} />
                </Box>
              </DialogContent>
              <Divider />
              <DialogActions sx={{ p: 2, gap: 1 }}>
                <MuiButton onClick={() => setReview(null)} sx={{ borderRadius: '10px', textTransform: 'none', color: colors.textMuted }}>Cancel</MuiButton>
                <Button
                  variant="primary"
                  onClick={confirmAction}
                  sx={{ borderRadius: '10px', px: 3, backgroundColor: am.color, '&:hover': { backgroundColor: am.color, filter: 'brightness(0.9)' } }}
                >
                  {am.label}
                </Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>
    </Box>
  );
}
