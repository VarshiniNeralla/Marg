import React, { useState } from 'react';
import { Box, Typography, InputBase, Menu, MenuItem, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Divider, Button as MuiButton } from '@mui/material';
import {
  CheckCircleRounded, RateReviewRounded, ViewInArRounded,
  ArrowForwardRounded, KeyboardArrowDownRounded, CheckRounded, SearchRounded,
} from '@mui/icons-material';
import { Link, useNavigate } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import Button from '@shared/components/Button/Button';

type ReviewTab = 'pending' | 'reviewing';

const T = `all 160ms cubic-bezier(0.4,0,0.2,1)`;
const P = {
  border:   '#e4e7ec',
  muted:    '#6b7280',
  subtle:   '#9ca3af',
  strong:   '#111827',
  blue:     '#2563eb',
  blueSoft: 'rgba(37,99,235,0.08)',
  white:    '#ffffff',
  bg:       '#f7f8fa',
};

const TAB_OPTIONS: { value: ReviewTab; label: string }[] = [
  { value: 'pending',   label: 'Pending' },
  { value: 'reviewing', label: 'Under Review' },
];

export default function ReviewsPage() {
  const tours = useWorkflowStore(s => s.tours);
  const updateTour = useWorkflowStore(s => s.updateTour);
  const navigate = useNavigate();

  const [tab, setTab]               = useState<ReviewTab>('pending');
  const [tabAnchor, setTabAnchor]   = useState<null | HTMLElement>(null);
  const [query, setQuery]           = useState('');
  const [selectedTour, setSelectedTour] = useState<typeof tours[0] | null>(null);
  const [notes, setNotes]           = useState('');

  // Use global state instead of local underReviewIds so it persists across navigation
  const pendingTours   = tours.filter(t => t.status === 'published' && !(t as any).managerReviewed);
  const reviewingTours = tours.filter(t => t.status === 'in_review');
  const publishedTours = tours.filter(t => t.status === 'published' && (t as any).managerReviewed);

  const base = tab === 'pending' ? pendingTours : reviewingTours;
  const displayed = base.filter(t => {
    const q = query.trim().toLowerCase();
    return !q || t.roomName.toLowerCase().includes(q) || t.projectName.toLowerCase().includes(q) || t.towerName.toLowerCase().includes(q);
  });

  function startReview(tour: typeof tours[0]) {
    setSelectedTour(tour);
    setNotes('');
  }

  function confirmReview() {
    if (selectedTour) {
      updateTour(selectedTour.id, { status: 'in_review' });
      navigate(`/tours/${selectedTour.id}`);
    }
    setSelectedTour(null);
    setNotes('');
  }

  const currentTab = TAB_OPTIONS.find(o => o.value === tab)!;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6 }}>
      {/* Heading */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Reviews
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: P.muted }}>
          {publishedTours.length} published tour{publishedTours.length !== 1 ? 's' : ''} · {pendingTours.length} pending · {reviewingTours.length} under review
        </Typography>
      </Box>

      {/* KPI row */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3,1fr)' }, gap: 1.5, mb: 4 }}>
        {[
          { label: 'Published Tours', value: publishedTours.length, color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
          { label: 'Pending Review',  value: pendingTours.length,   color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
          { label: 'Under Review',    value: reviewingTours.length,  color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
        ].map(s => (
          <Box key={s.label} sx={{ p: 2, borderRadius: '14px', border: `1.5px solid ${P.border}`, backgroundColor: P.white, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '1.75rem', fontWeight: 800, color: s.color, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</Typography>
            <Typography sx={{ fontSize: '0.75rem', color: P.muted, mt: 0.5, fontWeight: 500 }}>{s.label}</Typography>
          </Box>
        ))}
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 1.5 }, mb: 3, flexWrap: 'wrap' }}>
        {/* Tab pill */}
        <Box
          onClick={e => setTabAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${tabAnchor ? P.blue : P.border}`,
            backgroundColor: tabAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            flex: { xs: '1 1 0%', sm: 'initial' }, justifyContent: 'space-between', order: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: tab === 'pending' ? '#d97706' : '#7c3aed', flexShrink: 0 }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: P.strong, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
              {currentTab.label}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0 }}>
            <Box sx={{ px: 0.75, py: 0.25, borderRadius: '6px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: P.bg, color: P.muted }}>
              {base.length}
            </Box>
            <KeyboardArrowDownRounded sx={{ fontSize: 16, color: P.muted, transform: tabAnchor ? 'rotate(180deg)' : 'none', transition: T }} />
          </Box>
        </Box>

        <Box sx={{ flex: 1, order: 2, display: { xs: 'none', sm: 'block' } }} />

        {/* Search */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          width: { xs: '100%', sm: 220 }, px: 1.25, py: 0.75,
          borderRadius: '10px', backgroundColor: P.white,
          border: `1.5px solid ${P.border}`, transition: T,
          '&:focus-within': { borderColor: P.blue }, order: 3,
        }}>
          <SearchRounded sx={{ fontSize: 16, color: P.subtle, flexShrink: 0 }} />
          <InputBase placeholder="Search reviews…" value={query} onChange={e => setQuery(e.target.value)} sx={{ flex: 1, fontSize: '0.8125rem', '& input::placeholder': { color: P.subtle, opacity: 1 } }} />
        </Box>
      </Box>

      {/* Tab menu */}
      <Menu anchorEl={tabAnchor} open={!!tabAnchor} onClose={() => setTabAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 200, borderRadius: '14px', boxShadow: '0 12px 40px rgba(15,23,42,0.14)', border: `1px solid ${colors.borderLight}`, p: 0.75 } } }}
      >
        {TAB_OPTIONS.map(opt => {
          const isActive = tab === opt.value;
          const count    = opt.value === 'pending' ? pendingTours.length : reviewingTours.length;
          const dot      = opt.value === 'pending' ? '#d97706' : '#7c3aed';
          return (
            <MenuItem key={opt.value} onClick={() => { setTab(opt.value); setTabAnchor(null); }}
              sx={{ borderRadius: '10px', py: 0.875, px: 1, gap: 1.25, '&:hover': { backgroundColor: colors.bg }, backgroundColor: isActive ? colors.primarySoft : 'transparent' }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dot, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: '0.875rem', fontWeight: isActive ? 700 : 500, color: isActive ? colors.primary : colors.textStrong }}>
                {opt.label}
              </Typography>
              <Box sx={{ px: 0.875, py: 0.125, borderRadius: '999px', fontSize: '0.6875rem', fontWeight: 700, backgroundColor: colors.bgDeep, color: colors.textMuted }}>
                {count}
              </Box>
              {isActive && <CheckRounded sx={{ fontSize: 17, color: colors.primary }} />}
            </MenuItem>
          );
        })}
      </Menu>

      {/* Empty state */}
      {displayed.length === 0 ? (
        <Box sx={{ py: 8, textAlign: 'center', border: `1.5px dashed ${P.border}`, borderRadius: '18px', backgroundColor: P.white }}>
          <CheckCircleRounded sx={{ fontSize: 44, color: colors.success, mb: 1.5 }} />
          <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: P.strong, mb: 0.5 }}>
            {tab === 'pending' ? 'No pending reviews' : 'No tours under review'}
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            {tab === 'pending' ? 'All caught up — new uploads will appear here.' : 'Start reviewing tours from the Pending tab.'}
          </Typography>
        </Box>
      ) : (
        /* Tour list */
        <Box sx={{ display: 'flex', flexDirection: 'column', border: `1.5px solid ${P.border}`, borderRadius: '18px', backgroundColor: P.white, overflow: 'hidden' }}>
          {displayed.map((t, i) => {
            const isReviewing = t.status === 'in_review';
            const sm = isReviewing
              ? { label: 'Under Review', color: '#d97706', bg: 'rgba(217,119,6,0.08)' }
              : { label: 'Published',    color: '#2563eb', bg: 'rgba(37,99,235,0.08)' };
            return (
              <Box
                key={t.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 2.5,
                  px: 2.5, py: 2,
                  borderBottom: i < displayed.length - 1 ? `1px solid ${P.border}` : 'none',
                  transition: `background ${motion.durationFast}`,
                  '&:hover': { backgroundColor: P.bg },
                }}
              >
                {/* Thumbnail */}
                <Box sx={{ width: 52, height: 52, borderRadius: '12px', background: t.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }} />
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.25 }}>
                    <Typography noWrap sx={{ fontSize: '0.9375rem', fontWeight: 600, color: P.strong }}>{t.roomName}</Typography>
                    <Chip
                      label={sm.label}
                      size="small"
                      sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 600, color: sm.color, backgroundColor: sm.bg, borderRadius: '5px', flexShrink: 0 }}
                    />
                  </Box>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', color: P.muted }}>
                    {t.projectName} · {t.towerName} · {t.floorLabel} · {t.captures} captures
                  </Typography>
                </Box>

                {/* Actions */}
                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <Box
                    component={Link}
                    to={`/tours/${t.id}`}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid ${P.border}`, color: P.muted, textDecoration: 'none', transition: T, '&:hover': { borderColor: P.blue, color: P.blue, backgroundColor: P.blueSoft } }}
                  >
                    <ArrowForwardRounded sx={{ fontSize: 16 }} />
                  </Box>
                  {tab === 'pending' && (
                    <Box
                      onClick={() => startReview(t)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, height: 34, borderRadius: '8px', border: `1px solid rgba(124,58,237,0.3)`, color: '#7c3aed', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', transition: T, '&:hover': { backgroundColor: 'rgba(124,58,237,0.06)' } }}
                    >
                      <RateReviewRounded sx={{ fontSize: 15 }} /> Review
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Review Dialog */}
      <Dialog
        open={Boolean(selectedTour)}
        onClose={() => setSelectedTour(null)}
        maxWidth="sm"
        fullWidth
        slotProps={{ paper: { sx: { borderRadius: '20px' } } }}
      >
        {selectedTour && (
          <>
            <DialogTitle sx={{ fontSize: '1.0625rem', fontWeight: 700, pb: 1 }}>Review Tour</DialogTitle>
            <Divider />
            <DialogContent sx={{ pt: 2.5 }}>
              <Box sx={{ display: 'flex', gap: 2, mb: 2.5, p: 2, borderRadius: '12px', backgroundColor: P.bg }}>
                <Box sx={{ width: 52, height: 52, borderRadius: '10px', background: selectedTour.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ViewInArRounded sx={{ color: 'rgba(255,255,255,0.7)', fontSize: 22 }} />
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: P.strong }}>{selectedTour.roomName}</Typography>
                  <Typography sx={{ fontSize: '0.8125rem', color: P.muted }}>{selectedTour.projectName} · {selectedTour.floorLabel}</Typography>
                </Box>
              </Box>
              <Typography sx={{ fontSize: '0.875rem', color: colors.textSecondary, mb: 1.5 }}>
                This tour will be moved to "Under Review". Add any review notes below.
              </Typography>
              <Box
                component="textarea"
                value={notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                rows={3}
                placeholder="Review notes (optional)…"
                sx={{ width: '100%', px: 1.75, py: 1.25, borderRadius: '10px', border: `1px solid ${P.border}`, fontSize: '0.875rem', fontFamily: 'inherit', color: P.strong, outline: 'none', resize: 'vertical', boxSizing: 'border-box', '&:focus': { borderColor: P.blue, boxShadow: '0 0 0 3px rgba(37,99,235,0.08)' } }}
              />
            </DialogContent>
            <Divider />
            <DialogActions sx={{ p: 2, gap: 1 }}>
              <MuiButton onClick={() => setSelectedTour(null)} sx={{ borderRadius: '10px', textTransform: 'none', color: P.muted }}>
                Cancel
              </MuiButton>
              <Button variant="primary" onClick={confirmReview} sx={{ borderRadius: '10px', px: 3 }}>
                Start Review
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
