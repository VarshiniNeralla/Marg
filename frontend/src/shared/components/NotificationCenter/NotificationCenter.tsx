import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, IconButton, Popover, Badge, Snackbar, Button,
  Drawer, useMediaQuery, useTheme,
} from '@mui/material';
import {
  NotificationsRounded, CameraAltRounded, CheckCircleRounded, ViewInArRounded,
  BugReportRounded, UploadFileRounded, CloseRounded, DoneAllRounded, DeleteOutlineRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import type { MockNotification, NotifType } from '@/data/mockData';

const NAV_OFFSET = 56;

const notifIcon: Record<NotifType, React.ReactNode> = {
  capture_uploaded:    <CameraAltRounded sx={{ fontSize: 15 }} />,
  review_requested:    <CheckCircleRounded sx={{ fontSize: 15 }} />,
  tour_published:      <ViewInArRounded sx={{ fontSize: 15 }} />,
  defect_assigned:     <BugReportRounded sx={{ fontSize: 15 }} />,
  floor_plan_uploaded: <UploadFileRounded sx={{ fontSize: 15 }} />,
  floor_plan_deleted:  <DeleteOutlineRounded sx={{ fontSize: 15 }} />,
  review_approved:     <CheckCircleRounded sx={{ fontSize: 15 }} />,
  review_rejected:     <CloseRounded sx={{ fontSize: 15 }} />,
};
const notifColor: Record<NotifType, string> = {
  capture_uploaded:    '#2563eb',
  review_requested:    '#d97706',
  tour_published:      '#16a34a',
  defect_assigned:     '#dc2626',
  floor_plan_uploaded: '#0891b2',
  floor_plan_deleted:  '#dc2626',
  review_approved:     '#16a34a',
  review_rejected:     '#dc2626',
};

function NotificationPanel({
  notifs,
  unread,
  onClose,
  onNotifClick,
  onDelete,
  onMarkAllRead,
  isMobile,
}: {
  notifs: MockNotification[];
  unread: number;
  onClose: () => void;
  onNotifClick: (n: MockNotification) => void;
  onDelete: (e: React.MouseEvent, n: MockNotification, index: number) => void;
  onMarkAllRead: () => void;
  isMobile: boolean;
}) {
  return (
    <>
      <Box
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: { xs: 1.5, sm: 2 },
          borderBottom: `1px solid ${colors.borderLight}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          backgroundColor: colors.card,
          minWidth: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: { xs: '0.875rem', sm: '0.9375rem' }, fontWeight: 700, color: colors.textStrong }}>
            Notifications
          </Typography>
          {unread > 0 && (
            <Box sx={{ px: 0.875, py: 0.125, borderRadius: '20px', backgroundColor: colors.primary, color: '#fff', fontSize: '0.625rem', fontWeight: 700, flexShrink: 0 }}>
              {unread}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {unread > 0 && (
            <Box
              onClick={onMarkAllRead}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                color: colors.primary, fontSize: { xs: '0.6875rem', sm: '0.75rem' }, fontWeight: 600,
                cursor: 'pointer', whiteSpace: 'nowrap',
                '&:hover': { textDecoration: 'underline' },
              }}
            >
              <DoneAllRounded sx={{ fontSize: 14 }} />
              {isMobile ? 'Mark read' : 'Mark all read'}
            </Box>
          )}
          {isMobile && (
            <IconButton size="small" onClick={onClose} aria-label="Close notifications" sx={{ color: colors.textMuted, ml: 0.25 }}>
              <CloseRounded sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      <Box sx={{ overflowY: 'auto', maxHeight: { xs: 'min(70vh, 480px)', sm: 420 } }}>
        {notifs.length === 0 ? (
          <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted }}>
            <NotificationsRounded sx={{ fontSize: 36, color: colors.border, mb: 1 }} />
            <Typography sx={{ fontSize: '0.875rem' }}>No notifications</Typography>
          </Box>
        ) : notifs.map((n, i) => {
          const ic = notifIcon[n.type];
          const col = notifColor[n.type];
          return (
            <Box
              key={n.id}
              onClick={() => onNotifClick(n)}
              sx={{
                display: 'flex', gap: { xs: 1.25, sm: 1.5 },
                px: { xs: 1.5, sm: 2.5 },
                py: { xs: 1.5, sm: 1.75 },
                pr: { xs: 4.5, sm: 2.5 },
                borderBottom: i < notifs.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                backgroundColor: n.read ? 'transparent' : `${col}06`,
                transition: `background ${motion.durationFast}`,
                cursor: 'pointer',
                '&:hover': { backgroundColor: colors.bg },
                '&:hover .notif-delete': { opacity: 1 },
                position: 'relative',
                minWidth: 0,
              }}
            >
              <Box sx={{ width: { xs: 30, sm: 32 }, height: { xs: 30, sm: 32 }, borderRadius: '8px', backgroundColor: `${col}15`, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>
                {ic}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: { xs: '0.8125rem', sm: '0.8125rem' }, fontWeight: n.read ? 400 : 600, color: colors.textStrong, lineHeight: 1.35, minWidth: 0 }}>
                    {n.title}
                  </Typography>
                  {!n.read && <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: colors.primary, flexShrink: 0, mt: 0.375 }} />}
                </Box>
                <Typography sx={{ fontSize: { xs: '0.75rem', sm: '0.75rem' }, color: colors.textMuted, mt: 0.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>
                  {n.body}
                </Typography>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.5 }}>{n.createdAt}</Typography>
              </Box>
              <Box
                className="notif-delete"
                onClick={e => onDelete(e, n, i)}
                sx={{
                  position: 'absolute', top: { xs: 8, sm: 10 }, right: { xs: 8, sm: 10 },
                  width: 28, height: 28, borderRadius: '6px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  opacity: { xs: 1, sm: 0 },
                  transition: `opacity ${motion.durationFast}`,
                  '&:hover': { backgroundColor: colors.dangerBg, color: colors.danger },
                  color: colors.textSubdued,
                }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 15 }} />
              </Box>
            </Box>
          );
        })}
      </Box>
    </>
  );
}

export default function NotificationCenter() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const notifs = useWorkflowStore(s => s.notifications);
  const markRead = useWorkflowStore(s => s.markNotificationRead);
  const markAllRead = useWorkflowStore(s => s.markAllNotificationsRead);
  const deleteNotif = useWorkflowStore(s => s.deleteNotification);
  const restoreNotif = useWorkflowStore(s => s.restoreNotification);

  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [deletedNotif, setDeletedNotif] = useState<{ n: MockNotification; index: number } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const navigate = useNavigate();

  const open = Boolean(anchor);
  const unread = notifs.filter(n => !n.read).length;

  function close() {
    setAnchor(null);
  }

  function handleNotifClick(n: MockNotification) {
    markRead(n.id);
    close();
    navigate(n.link);
  }

  function handleDelete(e: React.MouseEvent, n: MockNotification, index: number) {
    e.stopPropagation();
    e.preventDefault();
    setDeletedNotif({ n, index });
    deleteNotif(n.id);
    setUndoOpen(true);
  }

  function handleUndo() {
    if (deletedNotif) {
      restoreNotif(deletedNotif.n, deletedNotif.index);
      setDeletedNotif(null);
    }
    setUndoOpen(false);
  }

  const panel = (
    <NotificationPanel
      notifs={notifs}
      unread={unread}
      onClose={close}
      onNotifClick={handleNotifClick}
      onDelete={handleDelete}
      onMarkAllRead={markAllRead}
      isMobile={isMobile}
    />
  );

  return (
    <>
      <IconButton
        size="small"
        onClick={e => { setAnchor(e.currentTarget); e.currentTarget.blur(); }}
        sx={{ position: 'relative', color: colors.textMuted, '&:hover': { color: colors.textStrong, backgroundColor: colors.bgDeep } }}
      >
        <Badge badgeContent={unread} color="error" max={9} sx={{ '& .MuiBadge-badge': { fontSize: '0.5625rem', minWidth: 16, height: 16 } }}>
          <NotificationsRounded sx={{ fontSize: 20 }} />
        </Badge>
      </IconButton>

      {isMobile ? (
        <Drawer
          anchor="top"
          open={open}
          onClose={close}
          ModalProps={{ keepMounted: true }}
          slotProps={{
            paper: {
              sx: {
                top: NAV_OFFSET,
                width: '100%',
                maxHeight: `calc(100vh - ${NAV_OFFSET}px)`,
                borderRadius: '0 0 16px 16px',
                boxShadow: '0 20px 48px rgba(15,23,42,0.16)',
                overflow: 'hidden',
              },
            },
            backdrop: {
              sx: { top: NAV_OFFSET },
            },
          }}
        >
          {panel}
        </Drawer>
      ) : (
        <Popover
          open={open}
          anchorEl={anchor}
          onClose={close}
          marginThreshold={16}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{
            paper: {
              sx: {
                width: 380,
                maxWidth: 'calc(100vw - 32px)',
                maxHeight: 520,
                borderRadius: '16px',
                boxShadow: '0 20px 48px rgba(15,23,42,0.12)',
                overflow: 'hidden',
                mt: 1,
              },
            },
          }}
        >
          {panel}
        </Popover>
      )}

      <Snackbar
        open={undoOpen}
        autoHideDuration={5000}
        onClose={() => setUndoOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message="Notification deleted"
        action={
          <Button size="small" onClick={handleUndo} sx={{ color: '#60a5fa', fontWeight: 700, fontSize: '0.875rem' }}>
            UNDO
          </Button>
        }
        sx={{
          '& .MuiSnackbar-root': { left: { xs: 16, sm: 'auto' }, right: { xs: 16, sm: 'auto' } },
          '& .MuiSnackbarContent-root': { borderRadius: '12px', fontSize: '0.875rem', flexWrap: 'nowrap' },
        }}
      />
    </>
  );
}
