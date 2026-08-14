import { Box, Typography, Chip } from '@mui/material';
import { LightbulbRounded, FlagRounded, TrendingUpRounded, TrendingDownRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { DrishtiMessage } from '@/types/drishti';

interface Props {
  message: DrishtiMessage;
  onFollowUpClick?: (question: string) => void;
}

export default function DrishtiMessageBubble({ message, onFollowUpClick }: Props) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Box sx={{
          maxWidth: '78%', px: 2, py: 1.25, borderRadius: '14px 14px 4px 14px',
          backgroundColor: colors.primary, color: '#fff',
        }}>
          <Typography sx={{ fontSize: '0.875rem' }}>{message.content}</Typography>
        </Box>
      </Box>
    );
  }

  const payload = message.structuredPayload;

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mb: 2 }}>
      <Box sx={{
        maxWidth: '86%', width: '100%', px: 2.5, py: 2, borderRadius: '4px 14px 14px 14px',
        border: `1px solid ${colors.border}`, backgroundColor: colors.card,
      }}>
        <Typography sx={{ fontSize: '0.875rem', color: colors.textStrong, whiteSpace: 'pre-wrap' }}>
          {message.content}
        </Typography>

        {!!payload?.metrics?.length && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            {payload.metrics.map((m, i) => (
              <Box key={i} sx={{
                px: 1.25, py: 0.75, borderRadius: '10px', border: `1px solid ${colors.borderLight}`,
                minWidth: 90,
              }}>
                <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, fontWeight: 600 }}>{m.label}</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: colors.textStrong }}>{m.value}</Typography>
                  {m.trend === 'up' && <TrendingUpRounded sx={{ fontSize: 16, color: colors.success }} />}
                  {m.trend === 'down' && <TrendingDownRounded sx={{ fontSize: 16, color: colors.danger }} />}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {!!payload?.facts?.length && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textMuted, mb: 0.5 }}>Facts</Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {payload.facts.map((f, i) => (
                <Typography key={i} component="li" sx={{ fontSize: '0.8125rem', color: colors.textStrong }}>{f}</Typography>
              ))}
            </Box>
          </Box>
        )}

        {!!payload?.insights?.length && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.textMuted, mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LightbulbRounded sx={{ fontSize: 14 }} /> Insights
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {payload.insights.map((f, i) => (
                <Typography key={i} component="li" sx={{ fontSize: '0.8125rem', color: colors.textStrong }}>{f}</Typography>
              ))}
            </Box>
          </Box>
        )}

        {!!payload?.recommendations?.length && (
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: colors.primary, mb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <FlagRounded sx={{ fontSize: 14 }} /> Recommended next steps
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {payload.recommendations.map((f, i) => (
                <Typography key={i} component="li" sx={{ fontSize: '0.8125rem', color: colors.textStrong, fontWeight: 500 }}>{f}</Typography>
              ))}
            </Box>
          </Box>
        )}

        {!!payload?.evidence?.length && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
            {payload.evidence.map((e, i) => (
              <Chip
                key={i}
                size="small"
                label={e.note || [e.floorId, e.flatName, e.roomName].filter(Boolean).join(' · ') || 'Evidence'}
                sx={{ fontSize: '0.6875rem', backgroundColor: colors.bg, color: colors.textMuted }}
              />
            ))}
          </Box>
        )}

        {!!payload?.followUpQuestions?.length && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
            {payload.followUpQuestions.map((q, i) => (
              <Chip
                key={i}
                size="small"
                label={q}
                clickable
                onClick={() => onFollowUpClick?.(q)}
                sx={{
                  fontSize: '0.75rem', color: colors.primary,
                  backgroundColor: 'transparent', border: `1px solid ${colors.primary}55`,
                  '&:hover': { backgroundColor: colors.primary + '10' },
                }}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}
