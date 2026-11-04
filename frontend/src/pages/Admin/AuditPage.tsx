import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Box, Typography, Pagination } from '@mui/material';
import {
  ArrowBackRounded, AutoAwesomeRounded, HistoryRounded,
  InputRounded, OutputRounded, TokenRounded,
  ChatBubbleOutlineRounded, InsightsRounded, MapRounded, PersonOutlineRounded, ErrorOutlineRounded,
} from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import {
  progressAnalysisService,
  type ProgressAnalysisAuditEntry,
  type ProgressAnalysisAuditSummary,
} from '@services/progressAnalysisService';

const PAGE_SIZE = 5;
type AuditTab = 'usage' | 'activity';
const TAB_PANEL_MIN_HEIGHT = 360;

function Metric({
  icon, label, value, color,
}: { icon: ReactNode; label: string; value: string; color: string }) {
  return (
    <Box sx={{
      position: 'relative',
      p: { xs: 1.5, sm: 2 },
      borderRadius: '14px',
      border: `1px solid ${colors.borderLight}`,
      backgroundColor: colors.card,
      minWidth: 0,
      boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
      overflow: 'hidden',
    }}>
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          backgroundColor: color,
        }}
      />
      <Box sx={{
        width: 34, height: 34, borderRadius: '9px', backgroundColor: `${color}15`, color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 1.25,
        '& svg': { fontSize: 17 },
      }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textMuted, mb: 0.25 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.25rem', fontWeight: 800, color: colors.textStrong, letterSpacing: '-0.03em' }}>
        {value}
      </Typography>
    </Box>
  );
}

function formatTokens(n: number): string {
  return n.toLocaleString();
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatLatency(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const COLS = 'minmax(120px,1fr) minmax(110px,1fr) minmax(120px,1.2fr) minmax(80px,0.8fr) minmax(90px,0.9fr) minmax(72px,0.7fr) minmax(72px,0.7fr) minmax(72px,0.7fr) minmax(64px,0.6fr)';
const ACTIVITY_COLS = 'minmax(120px,0.95fr) minmax(110px,0.9fr) minmax(110px,0.9fr) minmax(140px,1.2fr) minmax(220px,1.95fr)';

function activitySubject(log: ProgressAnalysisAuditEntry): string {
  const parts = [log.projectName, log.tower, log.floor, log.pinName].filter(Boolean);
  return parts.join(' · ') || log.sourceLabel || 'LLM call';
}

/** What happened, in plain words. */
function activityTitle(log: ProgressAnalysisAuditEntry): string {
  const failed = log.status === 'failed';
  switch (log.source) {
    case 'drishti_chat': return failed ? 'Drishti question (answer failed)' : 'Asked Drishti a question';
    case 'construction_progress': return failed ? 'Construction progress analysis failed' : 'Analysed construction progress';
    case 'room_map': return failed ? 'Floor plan room scan failed' : 'Scanned floor plan rooms';
    case 'progress_analysis': return failed ? 'Visit comparison failed' : 'Compared two visits';
    default: return log.sourceLabel || 'LLM call';
  }
}

function activityTokenSummary(log: ProgressAnalysisAuditEntry): string {
  const prompt = log.promptTokens ?? 0;
  const completion = log.completionTokens ?? 0;
  const total = log.totalTokens ?? (prompt + completion);
  return `${formatTokens(prompt)} in / ${formatTokens(completion)} out / ${formatTokens(total)} total`;
}

function activityCalls(log: ProgressAnalysisAuditEntry): string {
  const n = log.calls ?? 1;
  return `${n} LLM call${n === 1 ? '' : 's'}${log.latencyMs != null ? ` · ${formatLatency(log.latencyMs)}` : ''}`;
}


const SOURCE_META: Record<string, { color: string; icon: ReactNode }> = {
  drishti_chat: { color: '#7c3aed', icon: <ChatBubbleOutlineRounded /> },
  construction_progress: { color: '#0891b2', icon: <InsightsRounded /> },
  room_map: { color: '#d97706', icon: <MapRounded /> },
  progress_analysis: { color: '#2563eb', icon: <AutoAwesomeRounded /> },
};

function relativeTime(value?: string | null): string {
  if (!value) return '';
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}

function Chip({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.875, py: '2px', borderRadius: '999px',
      fontSize: '0.6875rem', fontWeight: 600, color, backgroundColor: bg, whiteSpace: 'nowrap', maxWidth: '100%',
      overflow: 'hidden', textOverflow: 'ellipsis',
      '& svg': { fontSize: 13 },
    }}>
      {children}
    </Box>
  );
}

function ActivityRow({ log, last }: { log: ProgressAnalysisAuditEntry; last: boolean }) {
  const meta = SOURCE_META[log.source ?? ''] ?? { color: colors.textMuted, icon: <AutoAwesomeRounded /> };
  const failed = log.status === 'failed';
  const accent = failed ? '#dc2626' : meta.color;
  const prompt = log.promptTokens ?? 0;
  const completion = log.completionTokens ?? 0;
  const total = log.totalTokens ?? (prompt + completion);
  const when = relativeTime(log.createdAt);
  return (
    <Box sx={{
      display: 'flex', gap: 1.75, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' },
      px: { xs: 2, sm: 2.5 }, py: 2,
      borderBottom: last ? 'none' : `1px solid ${colors.borderLight}`,
      '&:hover': { backgroundColor: colors.bg },
    }}>
      <Box sx={{
        width: 40, height: 40, borderRadius: '12px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: `${accent}14`, color: accent, '& svg': { fontSize: 20 },
      }}>
        {failed ? <ErrorOutlineRounded /> : meta.icon}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: failed ? '#dc2626' : colors.textStrong, lineHeight: 1.3 }}>
            {activityTitle(log)}
          </Typography>
          {failed && <Chip color="#dc2626" bg="rgba(220,38,38,0.08)">Failed</Chip>}
        </Box>
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textSecondary, mt: 0.25, overflowWrap: 'anywhere' }}>
          {activitySubject(log)}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
          <Chip color={colors.textSecondary} bg={colors.bgDeep}>
            <PersonOutlineRounded />{log.requestedByName || log.requestedBy || 'Unknown user'}
          </Chip>
          {log.model && (
            <Chip color={colors.textMuted} bg={colors.bgDeep}>
              <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.6875rem' }}>{log.model}</Box>
            </Chip>
          )}
        </Box>
      </Box>

      <Box sx={{
        flexShrink: 0, textAlign: { xs: 'left', sm: 'right' }, minWidth: { sm: 190 },
        width: { xs: '100%', sm: 'auto' }, pl: { xs: '56px', sm: 0 },
      }}>
        <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: colors.textStrong, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
          {formatTokens(total)} <Box component="span" sx={{ fontSize: '0.6875rem', fontWeight: 600, color: colors.textMuted }}>tokens</Box>
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, justifyContent: { xs: 'flex-start', sm: 'flex-end' }, mt: 0.75, flexWrap: 'wrap' }}>
          <Chip color="#2563eb" bg="rgba(37,99,235,0.08)">{formatTokens(prompt)} in</Chip>
          <Chip color="#0891b2" bg="rgba(8,145,178,0.08)">{formatTokens(completion)} out</Chip>
        </Box>
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.75 }}>
          {activityCalls(log)}
        </Typography>
        <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted, mt: 0.25 }} title={formatDate(log.createdAt)}>
          {formatDate(log.createdAt)}{when ? ` · ${when}` : ''}
        </Typography>
      </Box>
    </Box>
  );
}

export default function AuditPage() {
  const [usagePage, setUsagePage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [activeTab, setActiveTab] = useState<AuditTab>('usage');
  const [items, setItems] = useState<ProgressAnalysisAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<ProgressAnalysisAuditSummary>({
    analysisCount: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await progressAnalysisService.listTokenAudit(p, PAGE_SIZE);
      setItems(res.items);
      setTotal(res.total);
      setSummary(res.summary);
    } catch {
      setError('Could not load LLM usage audit data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(activeTab === 'usage' ? usagePage : activityPage);
  }, [activeTab, usagePage, activityPage, load]);

  const usagePageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activityPageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (activityPage > activityPageCount) {
      setActivityPage(activityPageCount);
    }
  }, [activityPage, activityPageCount]);

  return (
    <Box sx={{ maxWidth: 960, mx: 'auto', pb: 6, width: '100%', minWidth: 0, overflow: 'hidden' }}>
      <Box sx={{ mb: 4 }}>
        <Box component={Link} to="/dashboard/admin" sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, mb: 3,
          px: 1.25, py: 0.625, borderRadius: '8px',
          border: `1.5px solid ${colors.borderLight}`, color: colors.textMuted,
          fontSize: '0.8125rem', fontWeight: 600, textDecoration: 'none',
          transition: `all ${motion.durationFast} ${motion.easeOut}`,
          '&:hover': { borderColor: colors.primary, color: colors.primary, backgroundColor: colors.primarySoft },
        }}>
          <ArrowBackRounded sx={{ fontSize: 15 }} /> Overview
        </Box>
        <Typography sx={{
          fontFamily: '"Google Sans Flex","Google Sans",Inter,sans-serif',
          fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 800,
          color: colors.textStrong, letterSpacing: '-0.05em', lineHeight: 1.05, mb: 0.5,
        }}>
          Audit
        </Typography>
        <Typography sx={{ fontSize: '0.9375rem', color: colors.textMuted }}>
          LLM token usage across construction progress analyses, Drishti chat, and platform activity
        </Typography>
      </Box>

      <Box sx={{
        display: 'grid',
        width: '100%',
        gridTemplateColumns: { xs: 'repeat(3, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
        gap: { xs: '6px', sm: '12px', md: '16px' },
        mb: 3,
      }}>
        <Metric
          icon={<AutoAwesomeRounded />}
          label="LLM calls"
          value={formatTokens(summary.analysisCount)}
          color="#7c3aed"
        />
        <Metric
          icon={<InputRounded />}
          label="Input tokens"
          value={formatTokens(summary.promptTokens)}
          color="#2563eb"
        />
        <Metric
          icon={<OutputRounded />}
          label="Output tokens"
          value={formatTokens(summary.completionTokens)}
          color="#d97706"
        />
        <Metric
          icon={<TokenRounded />}
          label="Total tokens"
          value={formatTokens(summary.totalTokens)}
          color="#059669"
        />
      </Box>

      <Box sx={{
        borderRadius: '18px',
        backgroundColor: colors.card,
        border: `1px solid ${colors.borderLight}`,
        overflow: 'hidden',
        mb: 3,
      }}>
        <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.borderLight}`, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { id: 'usage' as const, label: 'LLM token usage' },
            { id: 'activity' as const, label: 'Recent activity' },
          ].map(tab => {
            const selected = activeTab === tab.id;
            return (
              <Box
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  px: 1.25,
                  py: 0.625,
                  borderRadius: '999px',
                  border: `1px solid ${colors.borderLight}`,
                  borderBottom: selected ? '2px solid #7c3aed' : `1px solid ${colors.borderLight}`,
                  backgroundColor: colors.card,
                  color: selected ? colors.textStrong : colors.textMuted,
                  fontSize: '0.8125rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: `all ${motion.durationFast} ${motion.easeOut}`,
                  '&:hover': {
                    borderColor: '#7c3aed',
                    color: colors.textStrong,
                  },
                }}
              >
                {tab.label}
              </Box>
            );
          })}
        </Box>

        {activeTab === 'usage' ? (
          <Box sx={{ minHeight: TAB_PANEL_MIN_HEIGHT, display: 'flex', flexDirection: 'column' }}>
            <Box sx={{
              display: 'grid', gridTemplateColumns: COLS, gap: 1,
              px: 2.5, py: 1.25, borderBottom: `1px solid ${colors.borderLight}`,
              backgroundColor: colors.bgDeep,
            }}>
              {['Date', 'Source', 'Project', 'Location', 'Pin', 'Model', 'Input', 'Output', 'Total'].map(h => (
                <Typography key={h} sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {h}
                </Typography>
              ))}
            </Box>

            {loading ? (
              <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted, fontSize: '0.875rem', flex: 1 }}>
                Loading…
              </Box>
            ) : error ? (
              <Box sx={{ py: 6, textAlign: 'center', color: '#dc2626', fontSize: '0.875rem', flex: 1 }}>
                {error}
              </Box>
            ) : items.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center', flex: 1 }}>
                <AutoAwesomeRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>
                  No analyses yet
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.5 }}>
                  Token usage appears here after Drishti is asked a question, a floor is analysed, or a floor plan is scanned.
                </Typography>
              </Box>
            ) : (
              items.map((row, i) => (
                <Box
                  key={row.reportId}
                  sx={{
                    display: 'grid', gridTemplateColumns: COLS, gap: 1, alignItems: 'center',
                    px: 2.5, py: 1.5, minHeight: 52,
                    borderBottom: i < items.length - 1 ? `1px solid ${colors.borderLight}` : 'none',
                    '&:hover': { backgroundColor: colors.bg },
                  }}
                >
                  <Typography sx={{ fontSize: '0.8125rem', color: colors.textSecondary }}>
                    {formatDate(row.createdAt)}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', fontWeight: 600, color: row.status === 'failed' ? '#dc2626' : colors.textMuted }}>
                    {row.sourceLabel || '—'}{row.status === 'failed' ? ' (failed)' : ''}
                  </Typography>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontSize: '0.8125rem', fontWeight: 600, color: colors.textStrong }}>
                      {row.projectName || '—'}
                    </Typography>
                    {row.requestedByName && (
                      <Typography noWrap sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
                        {row.requestedByName}
                      </Typography>
                    )}
                  </Box>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textSecondary }}>
                    {[row.tower, row.floor].filter(Boolean).join(' · ') || '—'}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.8125rem', color: colors.textSecondary }}>
                    {row.pinName || '—'}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: '0.75rem', color: colors.textMuted, fontFamily: 'monospace' }}>
                    {row.model || '—'}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#2563eb', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTokens(row.promptTokens)}
                  </Typography>
                  <Typography sx={{ fontSize: '0.8125rem', fontWeight: 600, color: '#0891b2', fontVariantNumeric: 'tabular-nums' }}>
                    {formatTokens(row.completionTokens)}
                  </Typography>
                  <Box>
                    <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, fontVariantNumeric: 'tabular-nums' }}>
                      {formatTokens(row.totalTokens)}
                    </Typography>
                    <Typography sx={{ fontSize: '0.6875rem', color: colors.textMuted }}>
                      {formatLatency(row.latencyMs)}
                    </Typography>
                  </Box>
                </Box>
              ))
            )}

            {total > PAGE_SIZE && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2, borderTop: `1px solid ${colors.borderLight}` }}>
                <Pagination
                  count={usagePageCount}
                  page={usagePage}
                  onChange={(_, p) => setUsagePage(p)}
                  size="small"
                  shape="rounded"
                />
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ minHeight: TAB_PANEL_MIN_HEIGHT, display: 'flex', flexDirection: 'column' }}>
            {loading ? (
              <Box sx={{ py: 6, textAlign: 'center', color: colors.textMuted, fontSize: '0.875rem', flex: 1 }}>
                Loading…
              </Box>
            ) : error ? (
              <Box sx={{ py: 6, textAlign: 'center', color: '#dc2626', fontSize: '0.875rem', flex: 1 }}>
                {error}
              </Box>
            ) : items.length === 0 ? (
              <Box sx={{ py: 6, textAlign: 'center', flex: 1 }}>
                <HistoryRounded sx={{ fontSize: 36, color: colors.textSubdued, mb: 1 }} />
                <Typography sx={{ fontSize: '0.9375rem', fontWeight: 600, color: colors.textSecondary }}>
                  No recent activity
                </Typography>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.textMuted, mt: 0.5 }}>
                  Drishti questions, construction progress analyses and floor plan scans appear here as they happen.
                </Typography>
              </Box>
            ) : (
              items.map((log, i) => (
                <ActivityRow key={`${log.reportId}-${log.createdAt ?? i}`} log={log} last={i === items.length - 1} />
              ))
            )}

            {total > PAGE_SIZE && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2, borderTop: `1px solid ${colors.borderLight}`, mt: 'auto' }}>
                <Pagination
                  count={activityPageCount}
                  page={activityPage}
                  onChange={(_, p) => setActivityPage(p)}
                  size="small"
                  shape="rounded"
                />
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
