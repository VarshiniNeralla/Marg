import React, { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  ExpandMoreRounded,
  SummarizeRounded,
  TrendingUpRounded,
  ConstructionRounded,
  CheckCircleOutlineRounded,
  AddCircleOutlineRounded,
  PendingActionsRounded,
  VerifiedRounded,
  WarningAmberRounded,
  PlaylistAddCheckRounded,
  PsychologyRounded,
  MapRounded,
  CameraAltRounded,
  AccessTimeRounded,
  ArrowDownwardRounded,
} from '@mui/icons-material';
import { colors } from '@theme/tokens';
import type { ProgressReportVisualMeta } from '@/services/progressAnalysisService';
import {
  normalizeProgressReport,
  SECTION_EMPTY_MESSAGES,
  BRAND_NAME,
  BRAND_TAGLINE,
  BRAND_REPORT_TITLE,
  BRAND_FOOTER,
  type NormalizedProgressReport,
  type ImportanceLevel,
} from '@/utils/reportNormalization';
import { confidenceNarrative } from '@/utils/reportBranding';
import type { ProgressAnalysisReport } from '@/services/progressAnalysisService';
import { formatReportDate, formatReportDateRange, formatReportGeneratedAt } from '@/utils/reportFormat';

const SECTION_THEME = {
  completed: { accent: '#1a6b3c', bg: '#f4f8f5', border: '#d4e8db' },
  new: { accent: '#1a4d8f', bg: '#f4f7fb', border: '#d4e0ed' },
  pending: { accent: '#b45309', bg: '#fdf8f3', border: '#ede0d0' },
  quality: { accent: '#5b3d8f', bg: '#f7f4fb', border: '#e4d9f0' },
  risks: { accent: '#b91c1c', bg: '#fdf5f5', border: '#edd4d4' },
  next: { accent: '#1a2332', bg: '#f7f9fb', border: '#e4e8ee' },
  changes: { accent: '#1a4d8f', bg: '#f4f7fb', border: '#d4e0ed' },
} as const;

function importanceStyles(level: ImportanceLevel) {
  if (level === 'High') return { color: '#b91c1c', bg: '#fde8e8' };
  if (level === 'Medium') return { color: '#b45309', bg: '#fef3e2' };
  return { color: '#5c6778', bg: '#eef2f6' };
}

function BrandHeader() {
  return (
    <Box
      sx={{
        mb: 2,
        pb: 1.5,
        borderBottom: '1.5px solid #1a2332',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 2,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 800,
            color: '#1a2332',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          {BRAND_NAME}
        </Typography>
        <Box sx={{ width: '1px', height: 14, backgroundColor: '#c4cdd8' }} />
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: '#4a5568' }}>
          {BRAND_REPORT_TITLE}
        </Typography>
      </Box>
      <Typography
        sx={{
          fontSize: '0.5625rem',
          fontWeight: 600,
          color: '#8b95a5',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          textAlign: 'right',
        }}
      >
        {BRAND_TAGLINE}
      </Typography>
    </Box>
  );
}

function TimelineBar({ meta }: { meta: ProgressReportVisualMeta }) {
  const items = [
    meta.projectName ? { label: 'Project', value: meta.projectName } : null,
    meta.tower ? { label: 'Tower', value: meta.tower } : null,
    meta.floor ? { label: 'Floor', value: meta.floor } : null,
    meta.pinName ? { label: 'Location', value: meta.pinName } : null,
    meta.beforeDate || meta.afterDate
      ? { label: 'Inspection', value: formatReportDateRange(meta.beforeDate, meta.afterDate) }
      : null,
    meta.generatedAt
      ? { label: 'Generated', value: formatReportGeneratedAt(meta.generatedAt) }
      : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <Box
      sx={{
        mb: 2,
        display: 'grid',
        gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
        gap: 0,
        borderTop: `1px solid ${colors.borderLight}`,
      }}
    >
      {items.map((item, i) => (
        <Box
          key={i}
          sx={{
            py: 1.25,
            pr: 1,
            borderBottom: `1px solid ${colors.borderLight}`,
          }}
        >
          <Typography
            sx={{
              fontSize: '0.5625rem',
              fontWeight: 700,
              color: '#8b95a5',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              mb: 0.25,
            }}
          >
            {item.label}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, color: colors.textStrong, lineHeight: 1.35 }}>
            {item.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function HeroProgressCard({
  pct,
  description,
  confidence,
}: {
  pct: number;
  description: string;
  confidence: number;
}) {
  return (
    <Box
      sx={{
        mb: 2,
        p: { xs: 2, sm: 2.5 },
        borderRadius: '4px',
        background: 'linear-gradient(135deg, #f7f9fb 0%, #eef2f6 100%)',
        border: '1px solid #dce3eb',
        display: 'flex',
        gap: { xs: 2, sm: 3 },
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { sm: 'flex-start' },
      }}
    >
      <Box sx={{ textAlign: 'center', flexShrink: 0, minWidth: 88 }}>
        <Typography
          sx={{
            fontSize: { xs: '2.75rem', sm: '3.25rem' },
            fontWeight: 200,
            color: '#1a6b3c',
            lineHeight: 1,
            letterSpacing: '-0.04em',
          }}
        >
          {pct}
          <Typography component="span" sx={{ fontSize: '1.25rem', fontWeight: 400, color: '#1a6b3c' }}>
            %
          </Typography>
        </Typography>
        <Typography
          sx={{
            fontSize: '0.5625rem',
            fontWeight: 700,
            color: '#5c6778',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            mt: 0.5,
          }}
        >
          Overall Progress
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: '0.875rem', color: colors.text, lineHeight: 1.75, mb: 1.5 }}>
          {description}
        </Typography>
        <Box sx={{ pt: 1.5, borderTop: '1px solid #dce3eb' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <PsychologyRounded sx={{ fontSize: 14, color: '#8b95a5' }} />
            <Typography
              sx={{
                fontSize: '0.5625rem',
                fontWeight: 700,
                color: '#8b95a5',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Analysis Confidence
            </Typography>
            <Typography sx={{ fontSize: '1rem', fontWeight: 700, color: '#1a2332', ml: 'auto' }}>
              {confidence}%
            </Typography>
          </Box>
          <Typography sx={{ fontSize: '0.75rem', color: '#5c6778', lineHeight: 1.6 }}>
            {confidenceNarrative(confidence)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function ComparisonStack({
  beforeDate,
  afterDate,
  beforeImageUrl,
  afterImageUrl,
}: {
  beforeDate?: string;
  afterDate?: string;
  beforeImageUrl?: string;
  afterImageUrl?: string;
}) {
  const frame = (label: string, date: string | undefined, url: string | undefined, accent: string) => (
    <Box sx={{ border: '1px solid #dce3eb', borderRadius: '4px', overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          px: 1.5,
          py: 1,
          backgroundColor: '#f7f9fb',
          borderBottom: '1px solid #e4e8ee',
        }}
      >
        <Chip
          label={label}
          size="small"
          sx={{
            height: 20,
            fontSize: '0.5625rem',
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: accent,
            backgroundColor: 'transparent',
            border: `1px solid ${accent}33`,
            borderRadius: '2px',
          }}
        />
        {date && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <AccessTimeRounded sx={{ fontSize: 12, color: '#8b95a5' }} />
            <Typography sx={{ fontSize: '0.6875rem', color: '#5c6778', fontWeight: 500 }}>
              {formatReportDate(date)}
            </Typography>
          </Box>
        )}
      </Box>
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '2 / 1',
          backgroundColor: '#0d1117',
        }}
      >
        {url ? (
          <Box
            component="img"
            key={url}
            src={url}
            alt={label}
            sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CameraAltRounded sx={{ fontSize: 36, color: '#4a5568', opacity: 0.4 }} />
          </Box>
        )}
      </Box>
      <Box sx={{ height: 12, backgroundColor: '#f7f9fb', borderTop: '1px dashed #dce3eb' }} />
    </Box>
  );

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
        <CameraAltRounded sx={{ fontSize: 16, color: '#1a4d8f' }} />
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 800,
            color: '#1a2332',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Before &amp; After Comparison
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {frame('Before', beforeDate, beforeImageUrl, '#1a4d8f')}
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 0.25 }}>
          <ArrowDownwardRounded sx={{ fontSize: 20, color: '#8b95a5' }} />
        </Box>
        {frame('After', afterDate, afterImageUrl, '#1a6b3c')}
      </Box>
    </Box>
  );
}

function FloorPlanSection({ meta }: { meta: ProgressReportVisualMeta }) {
  if (!meta.floorPlanImageUrl) return null;
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
        <MapRounded sx={{ fontSize: 16, color: '#1a4d8f' }} />
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 800,
            color: '#1a2332',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
          }}
        >
          Floor Plan — Inspected Location
        </Typography>
      </Box>
      {meta.pinName && (
        <Typography sx={{ fontSize: '0.75rem', color: '#5c6778', mb: 1 }}>
          Selected pin: <strong>{meta.pinName}</strong>
        </Typography>
      )}
      <Box
        sx={{
          position: 'relative',
          borderRadius: '4px',
          overflow: 'hidden',
          border: '1px solid #dce3eb',
          backgroundColor: '#f7f9fb',
        }}
      >
        <Box component="img" src={meta.floorPlanImageUrl} alt="Floor plan" sx={{ width: '100%', display: 'block' }} />
        {meta.pinX != null && meta.pinY != null && (
          <Box
            sx={{
              position: 'absolute',
              left: `${meta.pinX}%`,
              top: `${meta.pinY}%`,
              transform: 'translate(-50%, -50%)',
              width: 24,
              height: 24,
              pointerEvents: 'none',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 4,
                borderRadius: '50%',
                backgroundColor: '#1a4d8f',
                border: '2px solid #fff',
                boxShadow: '0 2px 8px rgba(26,77,143,0.45)',
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                borderRadius: '50%',
                border: '2px solid rgba(26,77,143,0.3)',
              }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

function FindingAccordion({
  title,
  icon,
  theme,
  items,
  emptyText,
  defaultExpanded = false,
}: {
  title: string;
  icon: React.ReactNode;
  theme: (typeof SECTION_THEME)[keyof typeof SECTION_THEME];
  items: string[];
  emptyText: string;
  defaultExpanded?: boolean;
}) {
  const hasItems = items.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded || hasItems);

  return (
    <Accordion
      expanded={expanded}
      onChange={(_, v) => setExpanded(v)}
      disableGutters
      elevation={0}
      sx={{
        mb: 1,
        borderRadius: '4px !important',
        border: `1px solid ${theme.border}`,
        backgroundColor: theme.bg,
        '&:before': { display: 'none' },
        '&.Mui-expanded': { margin: '0 0 8px 0' },
      }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreRounded sx={{ fontSize: 18, color: theme.accent }} />}
        sx={{
          minHeight: 44,
          px: 1.5,
          '& .MuiAccordionSummary-content': { my: 0.75, alignItems: 'center', gap: 1 },
        }}
      >
        <Box sx={{ color: theme.accent, display: 'flex' }}>{icon}</Box>
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 800,
            color: theme.accent,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            flex: 1,
          }}
        >
          {title}
        </Typography>
        {hasItems && (
          <Chip
            label={items.length}
            size="small"
            sx={{
              height: 18,
              minWidth: 22,
              fontSize: '0.5625rem',
              fontWeight: 700,
              backgroundColor: `${theme.accent}18`,
              color: theme.accent,
            }}
          />
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ px: 1.5, pt: 0, pb: 1.5 }}>
        {!hasItems ? (
          <Typography sx={{ fontSize: '0.8125rem', color: '#5c6778', lineHeight: 1.65 }}>
            {emptyText}
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2 }}>
            {items.map((item, i) => (
              <Typography
                component="li"
                key={i}
                sx={{ fontSize: '0.8125rem', color: colors.text, lineHeight: 1.65, mb: i < items.length - 1 ? 0.75 : 0 }}
              >
                {item}
              </Typography>
            ))}
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export interface ProgressReportViewProps {
  report: ProgressAnalysisReport;
  meta?: ProgressReportVisualMeta;
  normalized?: NormalizedProgressReport;
}

export default function ProgressReportView({ report, meta, normalized: normalizedProp }: ProgressReportViewProps) {
  const normalized = normalizedProp ?? normalizeProgressReport(report);
  const pct = normalized.overallProgress.percentage;
  const confidence = normalized.confidence;

  const showPanoramas = Boolean(meta?.beforeImageUrl || meta?.afterImageUrl);

  return (
    <Box sx={{ pb: 0.5 }}>
      <BrandHeader />
      {meta && <TimelineBar meta={meta} />}

      <HeroProgressCard pct={pct} description={normalized.overallProgress.description} confidence={confidence} />

      <Box sx={{ mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
          <SummarizeRounded sx={{ fontSize: 16, color: '#1a2332' }} />
          <Typography
            sx={{
              fontSize: '0.6875rem',
              fontWeight: 800,
              color: '#1a2332',
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            Executive Summary
          </Typography>
        </Box>
        <Typography
          sx={{
            fontSize: { xs: '0.9375rem', sm: '1rem' },
            color: colors.textStrong,
            lineHeight: 1.85,
            fontWeight: 400,
          }}
        >
          {normalized.summary}
        </Typography>
      </Box>

      {showPanoramas && (
        <ComparisonStack
          beforeDate={meta?.beforeDate}
          afterDate={meta?.afterDate}
          beforeImageUrl={meta?.beforeImageUrl}
          afterImageUrl={meta?.afterImageUrl}
        />
      )}

      {meta && <FloorPlanSection meta={meta} />}

      {normalized.changesDetected.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.25 }}>
            <ConstructionRounded sx={{ fontSize: 16, color: SECTION_THEME.changes.accent }} />
            <Typography
              sx={{
                fontSize: '0.6875rem',
                fontWeight: 800,
                color: '#1a2332',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
              }}
            >
              Key Construction Changes
            </Typography>
          </Box>
          {normalized.changesDetected.map((c, i) => {
            const imp = importanceStyles(c.importance);
            return (
              <Box
                key={i}
                sx={{
                  p: 1.25,
                  mb: 1,
                  borderRadius: '4px',
                  backgroundColor: '#fff',
                  border: `1px solid ${colors.borderLight}`,
                }}
              >
                <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5, flexWrap: 'wrap' }}>
                  <Chip
                    label={c.importance}
                    size="small"
                    sx={{
                      height: 18,
                      fontSize: '0.5625rem',
                      fontWeight: 800,
                      color: imp.color,
                      backgroundColor: imp.bg,
                      borderRadius: '2px',
                    }}
                  />
                  {c.category && c.category !== 'General' && (
                    <Chip
                      label={c.category}
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, fontSize: '0.5625rem', fontWeight: 600, borderRadius: '2px' }}
                    />
                  )}
                </Box>
                <Typography sx={{ fontSize: '0.8125rem', color: colors.text, lineHeight: 1.65 }}>
                  {c.text}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}

      <Box sx={{ mb: 1 }}>
        <Typography
          sx={{
            fontSize: '0.6875rem',
            fontWeight: 800,
            color: '#1a2332',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            mb: 1,
          }}
        >
          Inspection Findings
        </Typography>

        <FindingAccordion
          title="Completed Work"
          icon={<CheckCircleOutlineRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.completed}
          items={normalized.completedWork}
          emptyText={SECTION_EMPTY_MESSAGES.completedWork}
        />
        <FindingAccordion
          title="New Work"
          icon={<AddCircleOutlineRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.new}
          items={normalized.newlyAdded}
          emptyText={SECTION_EMPTY_MESSAGES.newlyAdded}
        />
        <FindingAccordion
          title="Pending Work"
          icon={<PendingActionsRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.pending}
          items={normalized.pendingWork}
          emptyText={SECTION_EMPTY_MESSAGES.pendingWork}
        />
        <FindingAccordion
          title="Quality Observations"
          icon={<VerifiedRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.quality}
          items={normalized.qualityObservations}
          emptyText={SECTION_EMPTY_MESSAGES.qualityObservations}
        />
        <FindingAccordion
          title="Safety Risks"
          icon={<WarningAmberRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.risks}
          items={normalized.risks}
          emptyText={SECTION_EMPTY_MESSAGES.risks}
        />
        <FindingAccordion
          title="Recommendations"
          icon={<PlaylistAddCheckRounded sx={{ fontSize: 18 }} />}
          theme={SECTION_THEME.next}
          items={normalized.recommendedNextSteps}
          emptyText={SECTION_EMPTY_MESSAGES.recommendedNextSteps}
        />
      </Box>

      <Box
        sx={{
          mt: 2,
          pt: 1.25,
          borderTop: '1px solid #e4e8ee',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 0.5,
        }}
      >
        <Typography sx={{ fontSize: '0.5625rem', fontWeight: 700, color: '#8b95a5', letterSpacing: '0.02em' }}>
          {BRAND_FOOTER}
        </Typography>
        <Typography sx={{ fontSize: '0.5625rem', color: '#8b95a5' }}>
          Confidential · Generated Automatically
        </Typography>
      </Box>
    </Box>
  );
}
