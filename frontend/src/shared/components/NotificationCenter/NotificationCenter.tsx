import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Typography, IconButton, Popover, Badge, Snackbar, Button } from '@mui/material';
import { NotificationsRounded, CameraAltRounded, CheckCircleRounded, ViewInArRounded, BugReportRounded, UploadFileRounded, CloseRounded, DoneAllRounded, DeleteOutlineRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import { useWorkflowStore } from '@store/workflowStore';
import type { MockNotification, NotifType } from '@/data/mockData';

const notifIcon: Record<NotifType, React.ReactNode> = {
  capture_uploaded:    <CameraAltRounded sx={{ fontSize: 15 }} />,
  review_requested:    <CheckCircleRounded sx={{ fontSize: 15 }} />,
  tour_published:      <ViewInArRounded sx={{ fontSize: 15 }} />,
  defect_assigned:     <BugReportRounded sx={{ fontSize: 15 }} />,
  floor_plan_uploaded: <UploadFileRounded sx={{ fontSize: 15 }} />,
  review_approved:     <CheckCircleRounded sx={{ fontSize: 15 }} />,
  review_rejected:     <CloseRounded sx={{ fontSize: 15 }} />,
};
const notifColor: Record<NotifType, string> = {
  capture_uploaded:    '#2563eb',
  review_requested:    '#d97706',
  tour_published:      '#16a34a',
  defect_assigned:     '#dc2626',
  floor_plan_uploaded: '#0891b2',
  review_approved:     '#16a34a',
  review_rejected:     '#dc2626',
};

export default function NotificationCenter() {
  const notifs = useWorkflowStore(s => s.notifications);
  const markRead = useWorkflowStore(s => s.markNotificationRead);
  const markAllRead = useWorkflowStore(s => s.markAllNotificationsRead);
  const deleteNotif = useWorkflowStore(s => s.deleteNotification);
  const restoreNotif = useWorkflowStore(s => s.restoreNotification);

  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [deletedNotif, setDeletedNotif] = useState<{ n: MockNotification; index: number } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const navigate = useNavigate();

  const unread = notifs.filter(n => !n.read).length;

  function handleNotifClick(n: MockNotification) {
    markRead(n.id);
    setAnchor(null);
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

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxHeight: 520, borderRadius: '16px', boxShadow: '0 20px 48px rgba(15,23,42,0.12)', overflow: 'hidden', mt: 1 } } }}
      >
        <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong }}>Notifications</Typography>
            {unread > 0 && (
              <Box sx={{ px: 1, py: 0.125, borderRadius: '20px', backgroundColor: colors.primary, color: '#fff', fontSize: '0.625rem', fontWeight: 700 }}>{unread}</Box>
            )}
          </Box>
          {unread > 0 && (
            <Box onClick={markAllRead} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: colors.primary, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}>
              <DoneAllRounded sx={{ fontSize: 14 }} /> Mark all read
            </Box>
          )}
        </Box>

        <Box sx={{ overflowY: 'auto', maxHeight: 420 }}>
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
                onClick={() => handleNotifClick(n)}
                sx={{
                  display: 'flex', gap: 1.5, px: 2.5, py: 1.75,
                  borderBottom: i < notifs.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                  backgroundColor: n.read ? 'transparent' : `${col}06`,
                  transition: `background ${motion.durationFast}`,
                  cursor: 'pointer',
                  '&:hover': { backgroundColor: colors.bg },
                  '&:hover .notif-delete': { opacity: 1 },
                  position: 'relative',
                }}
              >
                <Box sx={{ width: 32, height: 32, borderRadius: '8px', backgroundColor: `${col}15`, color: col, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.25 }}>{ic}</Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: n.read ? 400 : 600, color: colors.textStrong, lineHeight: 1.35 }}>{n.title}</Typography>
                    {!n.read && <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: colors.primary, flexShrink: 0, mt: 0.375 }} />}
                  </Box>
                  <Typography sx={{ fontSize: '0.75rem', color: colors.textMuted, mt: 0.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{n.body}</Typography>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, mt: 0.5 }}>{n.createdAt}</Typography>
                </Box>
                <Box
                  className="notif-delete"
                  onClick={e => handleDelete(e, n, i)}
                  sx={{ position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: `opacity ${motion.durationFast}`, '&:hover': { backgroundColor: colors.dangerBg, color: colors.danger }, color: colors.textSubdued }}
                >
                  <DeleteOutlineRounded sx={{ fontSize: 14 }} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Popover>

      <Snackbar
        open={undoOpen}
        autoHideDuration={5000}
        onClose={() => setUndoOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message="Notification deleted"
        action={
          <Button size="small" onClick={handleUndo} sx={{ color: '#60a5fa', fontWeight: 700, fontSize: '0.875rem' }}>
            UNDO
          </Button>
        }
        sx={{ '& .MuiSnackbarContent-root': { borderRadius: '12px', fontSize: '0.875rem' } }}
      />
    </>
  );
}
