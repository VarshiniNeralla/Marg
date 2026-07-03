import React, { useState, useEffect } from 'react';
import { Box, Typography, InputBase, Menu, MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Divider, Button as MuiButton, Pagination } from '@mui/material';
import {
  CheckCircleRounded, RateReviewRounded, ViewInArRounded,
  ArrowForwardRounded, KeyboardArrowDownRounded, CheckRounded, SearchRounded, ArrowBackRounded,
} from '@mui/icons-material';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import { useAuthStore, getRoleLandingPath } from '@store/authStore';
import Button from '@shared/components/Button/Button';
import { locationFilterMenuPaperSx } from '@/utils/locationFilters';

type ReviewTab = 'pending' | 'reviewing' | 'reviewed';

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
  { value: 'reviewed',  label: 'Reviewed' },
];

const TOUR_FROM_REVIEWS = { from: '/reviews', fromLabel: 'Reviews' } as const;

type ReviewsLocationState = { tab?: ReviewTab };

const REVIEWS_PAGE_SIZE = 5;

function isReviewTab(value: unknown): value is ReviewTab {
  return value === 'pending' || value === 'reviewing' || value === 'reviewed';
}

export default function ReviewsPage() {
  const user  = useAuthStore(s => s.user);
  const tours = useWorkflowStore(s => s.tours);
  const updateTour = useWorkflowStore(s => s.updateTour);
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab]               = useState<ReviewTab>(() => {
    const requested = (location.state as ReviewsLocationState | null)?.tab;
    return isReviewTab(requested) ? requested : 'pending';
  });
  const [tabAnchor, setTabAnchor]   = useState<null | HTMLElement>(null);
  const [query, setQuery]           = useState('');
  const [page, setPage]             = useState(1);
  const [selectedTour, setSelectedTour] = useState<typeof tours[0] | null>(null);
  const [notes, setNotes]           = useState('');

  // Use global state instead of local underReviewIds so it persists across navigation
  const pendingTours   = tours.filter(t => t.status === 'published' && !t.managerReviewed);
  const reviewingTours = tours.filter(t => t.status === 'in_review');
  const reviewedTours  = tours.filter(t => t.status === 'published' && t.managerReviewed);

  useEffect(() => {
    const requested = (location.state as ReviewsLocationState | null)?.tab;
    if (isReviewTab(requested)) {
      setTab(requested);
      setPage(1);
      setQuery('');
    }
  }, [location.key]);

  const base = tab === 'pending' ? pendingTours : tab === 'reviewing' ? reviewingTours : reviewedTours;
  const displayed = base.filter(t => {
    const q = query.trim().toLowerCase();
    return !q || t.roomName.toLowerCase().includes(q) || t.projectName.toLowerCase().includes(q) || t.towerName.toLowerCase().includes(q);
  });

  const totalPages = Math.max(1, Math.ceil(displayed.length / REVIEWS_PAGE_SIZE));
  const paginatedDisplayed = displayed.slice(
    (page - 1) * REVIEWS_PAGE_SIZE,
    page * REVIEWS_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [tab, query]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function startReview(tour: typeof tours[0]) {
    setSelectedTour(tour);
    setNotes('');
  }

  function confirmReview() {
    if (selectedTour) {
      updateTour(selectedTour.id, { status: 'in_review' });
      navigate(`/tours/${selectedTour.id}`, { state: TOUR_FROM_REVIEWS });
    }
    setSelectedTour(null);
    setNotes('');
  }

  const currentTab = TAB_OPTIONS.find(o => o.value === tab)!;

  return (
    <Box sx={{ maxWidth: 800, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
      {/* Back to overview */}
      <Box component={Link} to={getRoleLandingPath(user?.role)} sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>

      {/* Heading */}
      <Box sx={{ mb: { xs: 2, sm: 4 } }}>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: P.strong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Reviews
        </Typography>
        <Typography sx={{ fontSize: { xs: '0.8125rem', sm: '0.9375rem' }, color: P.muted, display: { xs: 'none', sm: 'block' } }}>
          {reviewedTours.length} reviewed · {pendingTours.length} pending · {reviewingTours.length} under review
        </Typography>
      </Box>

      {/* KPI row — compact 3-across on mobile */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: 0.75, sm: 1.5 }, mb: { xs: 2, sm: 4 } }}>
        {[
          { label: 'Reviewed', shortLabel: 'Reviewed', value: reviewedTours.length,  color: '#16a34a', bg: 'rgba(22,163,74,0.08)' },
          { label: 'Pending Review', shortLabel: 'Pending', value: pendingTours.length,   color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
          { label: 'Under Review', shortLabel: 'In review', value: reviewingTours.length, color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
        ].map(s => (
          <Box key={s.label} sx={{
            px: { xs: 0.75, sm: 2 }, py: { xs: 1, sm: 2 },
            borderRadius: { xs: '10px', sm: '14px' },
            border: `1.5px solid ${P.border}`,
            backgroundColor: P.white,
            textAlign: 'center',
            minWidth: 0,
          }}>
            <Typography sx={{ fontSize: { xs: '1.125rem', sm: '1.75rem' }, fontWeight: 800, color: s.color, letterSpacing: '-0.04em', lineHeight: 1 }}>
              {s.value}
            </Typography>
            <Typography sx={{
              fontSize: { xs: '0.5625rem', sm: '0.75rem' },
              color: P.muted, mt: { xs: 0.25, sm: 0.5 }, fontWeight: 500,
              lineHeight: 1.2,
            }}>
              <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{s.shortLabel}</Box>
              <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{s.label}</Box>
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, gap: { xs: 0.75, sm: 1.5 }, mb: 3 }}>
        {/* Tab pill */}
        <Box
          onClick={e => setTabAnchor(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.75,
            px: 1.5, py: 0.875, borderRadius: '10px', cursor: 'pointer',
            border: `1.5px solid ${tabAnchor ? P.blue : P.border}`,
            backgroundColor: tabAnchor ? P.blueSoft : P.white,
            transition: T, '&:hover': { borderColor: P.blue },
            justifyContent: 'space-between',
            width: { xs: '100%', sm: 'auto' },
            minWidth: { sm: 200 },
            flexShrink: 0,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, overflow: 'hidden' }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: tab === 'pending' ? '#d97706' : tab === 'reviewing' ? '#7c3aed' : '#16a34a', flexShrink: 0 }} />
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

        {/* Search */}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          width: { xs: '100%', sm: 220 },
          flexShrink: 0,
          ml: { sm: 'auto' },
          px: { xs: 1, sm: 1.25 },
          py: { xs: 0.5, sm: 0.75 },
          borderRadius: '10px', backgroundColor: P.white,
          border: `1.5px solid ${P.border}`, transition: T,
          '&:focus-within': { borderColor: P.blue },
        }}>
          <SearchRounded sx={{ fontSize: { xs: 15, sm: 16 }, color: P.subtle, flexShrink: 0 }} />
          <InputBase
            placeholder="Search reviews…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            sx={{
              flex: 1,
              fontSize: { xs: '0.75rem', sm: '0.8125rem' },
              '& input': { py: { xs: 0.25, sm: 0.5 } },
              '& input::placeholder': { color: P.subtle, opacity: 1 },
            }}
          />
        </Box>
      </Box>

      {/* Tab menu */}
      <Menu anchorEl={tabAnchor} open={!!tabAnchor} onClose={() => setTabAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: locationFilterMenuPaperSx(220, colors.borderLight) } }}
      >
        {TAB_OPTIONS.map(opt => {
          const isActive = tab === opt.value;
          const count    = opt.value === 'pending' ? pendingTours.length : opt.value === 'reviewing' ? reviewingTours.length : reviewedTours.length;
          const dot      = opt.value === 'pending' ? '#d97706' : opt.value === 'reviewing' ? '#7c3aed' : '#16a34a';
          return (
            <MenuItem key={opt.value} onClick={() => { setTab(opt.value); setTabAnchor(null); setPage(1); }}
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
            {tab === 'pending' ? 'No pending reviews' : tab === 'reviewing' ? 'No tours under review' : 'No reviewed walkthroughs yet'}
          </Typography>
          <Typography sx={{ fontSize: '0.875rem', color: P.muted }}>
            {tab === 'pending' ? 'All caught up — new uploads will appear here.' : tab === 'reviewing' ? 'Start reviewing tours from the Pending tab.' : 'Walkthroughs you mark as done will appear here.'}
          </Typography>
        </Box>
      ) : (
        <>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {paginatedDisplayed.map(t => {
            const isReviewing = t.status === 'in_review';
            const sm = tab === 'reviewed'
              ? { label: 'Reviewed', color: '#16a34a', bg: 'rgba(22,163,74,0.08)' }
              : isReviewing
              ? { label: 'Under Review', color: '#d97706', bg: 'rgba(217,119,6,0.08)' }
              : { label: 'Published',    color: '#2563eb', bg: 'rgba(37,99,235,0.08)' };
            return (
              <Box
                key={t.id}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1.5,
                  p: { xs: 1.25, sm: 1.5 }, borderRadius: '12px',
                  border: `1px solid ${colors.borderLight}`,
                  width: '100%',
                  '&:hover': { backgroundColor: colors.bg, borderColor: colors.border },
                  transition: `background ${motion.durationFast}, border-color ${motion.durationFast}`,
                }}
              >
                <Box sx={{ width: 42, height: 42, borderRadius: '10px', background: t.gradient, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <ViewInArRounded sx={{ fontSize: 18, color: 'rgba(255,255,255,0.85)' }} />
                </Box>

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: '0.875rem', fontWeight: 600, color: colors.textStrong }}>{t.roomName}</Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted }}>
                    <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>{t.projectName.replace(/^My Home\s+/i, '')} · {t.floorLabel}</Box>
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t.towerName} · {t.floorLabel}</Box>
                  </Typography>
                </Box>

                <Box sx={{ px: 1.25, py: 0.375, borderRadius: '6px', backgroundColor: sm.bg, color: sm.color, fontSize: '0.6875rem', fontWeight: 700, flexShrink: 0, display: { xs: 'none', sm: 'block' } }}>
                  {sm.label}
                </Box>

                <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
                  <Box
                    component={Link}
                    to={`/tours/${t.id}`}
                    state={TOUR_FROM_REVIEWS}
                    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '8px', border: `1px solid ${colors.borderLight}`, color: colors.textMuted, textDecoration: 'none', transition: T, '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft } }}
                  >
                    <ArrowForwardRounded sx={{ fontSize: 16 }} />
                  </Box>
                  {tab === 'pending' && (
                    <Box
                      onClick={() => startReview(t)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, height: 34, borderRadius: '8px', border: `1px solid rgba(124,58,237,0.3)`, color: '#7c3aed', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer', transition: T, '&:hover': { backgroundColor: 'rgba(124,58,237,0.06)' } }}
                    >
                      <RateReviewRounded sx={{ fontSize: 15 }} />
                      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Review</Box>
                    </Box>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
        {totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(_, p) => setPage(p)}
              color="primary"
              size="small"
              siblingCount={0}
              boundaryCount={1}
              sx={{ maxWidth: '100%', '& .MuiPaginationItem-root': { fontWeight: 600 } }}
            />
          </Box>
        )}
        </>
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
