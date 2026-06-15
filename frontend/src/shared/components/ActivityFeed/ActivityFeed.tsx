import React from 'react';
import { Box, Typography } from '@mui/material';
import {
  CameraAltRounded, CheckCircleRounded, ViewInArRounded,
  BugReportRounded, UploadFileRounded, CloseRounded,
  PersonAddRounded, ManageAccountsRounded, AssignmentRounded,
  FolderRounded, EditRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { MockAuditLog, AuditEventType } from '@/data/mockData';

const EVENT_ICON: Record<AuditEventType, React.ReactNode> = {
  capture_uploaded:    <CameraAltRounded    sx={{ fontSize: 14 }} />,
  capture_approved:    <CheckCircleRounded  sx={{ fontSize: 14 }} />,
  capture_rejected:    <CloseRounded        sx={{ fontSize: 14 }} />,
  tour_published:      <ViewInArRounded     sx={{ fontSize: 14 }} />,
  tour_draft:          <ViewInArRounded     sx={{ fontSize: 14 }} />,
  defect_created:      <BugReportRounded    sx={{ fontSize: 14 }} />,
  defect_resolved:     <CheckCircleRounded  sx={{ fontSize: 14 }} />,
  floor_plan_uploaded: <UploadFileRounded   sx={{ fontSize: 14 }} />,
  user_invited:        <PersonAddRounded    sx={{ fontSize: 14 }} />,
  user_role_changed:   <ManageAccountsRounded sx={{ fontSize: 14 }} />,
  review_assigned:     <AssignmentRounded   sx={{ fontSize: 14 }} />,
  project_created:     <FolderRounded       sx={{ fontSize: 14 }} />,
  project_updated:     <EditRounded         sx={{ fontSize: 14 }} />,
};

const EVENT_COLOR: Record<AuditEventType, string> = {
  capture_uploaded:    '#2563eb',
  capture_approved:    '#16a34a',
  capture_rejected:    '#dc2626',
  tour_published:      '#059669',
  tour_draft:          '#64748b',
  defect_created:      '#dc2626',
  defect_resolved:     '#16a34a',
  floor_plan_uploaded: '#0891b2',
  user_invited:        '#7c3aed',
  user_role_changed:   '#d97706',
  review_assigned:     '#2563eb',
  project_created:     '#059669',
  project_updated:     '#d97706',
};

interface ActivityFeedProps {
  logs: MockAuditLog[];
  maxItems?: number;
  compact?: boolean;
}

export default function ActivityFeed({ logs, maxItems, compact = false }: ActivityFeedProps) {
  const visible = maxItems ? logs.slice(0, maxItems) : logs;

  if (visible.length === 0) {
    return (
      <Box sx={{ py: 4, textAlign: 'center', color: colors.textMuted }}>
        <AssignmentRounded sx={{ fontSize: 32, color: colors.border, mb: 1 }} />
        <Typography sx={{ fontSize: '0.875rem' }}>No activity yet</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: 'relative' }}>
      {/* Vertical timeline line */}
      <Box sx={{ position: 'absolute', left: compact ? 12 : 15, top: 8, bottom: 8, width: 1, backgroundColor: colors.borderLight }} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: compact ? 1.5 : 2 }}>
        {visible.map((log, i) => {
          const ic = EVENT_ICON[log.eventType];
          const col = EVENT_COLOR[log.eventType];
          return (
            <Box key={log.id} sx={{ display: 'flex', gap: compact ? 1.5 : 2, position: 'relative' }}>
              {/* Icon bubble */}
              <Box sx={{
                width: compact ? 26 : 32,
                height: compact ? 26 : 32,
                borderRadius: '50%',
                backgroundColor: `${col}15`,
                color: col,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                zIndex: 1,
                border: `2px solid ${colors.bg}`,
              }}>
                {ic}
              </Box>

              {/* Content */}
              <Box sx={{ flex: 1, minWidth: 0, pb: i < visible.length - 1 ? (compact ? 0 : 0.5) : 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: compact ? '0.8125rem' : '0.875rem', fontWeight: 500, color: colors.textStrong, lineHeight: 1.4 }}>
                      <Box component="span" sx={{ fontWeight: 700 }}>{log.actorName}</Box>
                      {' — '}
                      {log.description}
                    </Typography>
                    {!compact && log.entityName && (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mt: 0.5, px: 1, py: 0.25, borderRadius: '5px', backgroundColor: `${col}10`, color: col }}>
                        <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600 }}>{log.entityName}</Typography>
                      </Box>
                    )}
                  </Box>
                  <Typography sx={{ fontSize: '0.6875rem', color: colors.textSubdued, flexShrink: 0, mt: 0.125 }}>{log.createdAt}</Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
