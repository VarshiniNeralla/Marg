import React from 'react';
import { Box, Typography } from '@mui/material';
import { MapRounded, CameraAltRounded } from '@mui/icons-material';
import { colors } from '@theme/tokens';
import { formatReportDate } from '@/utils/reportFormat';

export interface ReportVisualSectionProps {
  beforeImageUrl?: string;
  afterImageUrl?: string;
  beforeDate?: string;
  afterDate?: string;
  floorPlanImageUrl?: string;
  pinX?: number | null;
  pinY?: number | null;
  pinName?: string;
}

function PanoramaCard({
  label,
  date,
  imageUrl,
}: {
  label: string;
  date?: string;
  imageUrl?: string;
}) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: colors.textMuted, mb: 0.5, textTransform: 'uppercase' }}>
        {label}
      </Typography>
      {date && (
        <Typography sx={{ fontSize: '0.75rem', color: colors.textSubdued, mb: 0.75 }}>
          {formatReportDate(date)}
        </Typography>
      )}
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          aspectRatio: '2 / 1',
          borderRadius: '10px',
          overflow: 'hidden',
          backgroundColor: '#0f1929',
          border: `1px solid ${colors.borderLight}`,
        }}
      >
        {imageUrl ? (
          <Box
            component="img"
            key={imageUrl}
            src={imageUrl}
            alt={label}
            sx={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: colors.textSubdued }}>
            <CameraAltRounded sx={{ fontSize: 28, opacity: 0.4 }} />
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default function ReportVisualSection({
  beforeImageUrl,
  afterImageUrl,
  beforeDate,
  afterDate,
  floorPlanImageUrl,
  pinX,
  pinY,
  pinName,
}: ReportVisualSectionProps) {
  const showFloorPlan = Boolean(floorPlanImageUrl);
  const showPanoramas = Boolean(beforeImageUrl || afterImageUrl);
  if (!showFloorPlan && !showPanoramas) return null;

  return (
    <Box sx={{ mb: 2.5 }}>
      {showFloorPlan && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <MapRounded sx={{ fontSize: 17, color: '#2563eb' }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Floor Plan Location
            </Typography>
          </Box>
          <Box
            sx={{
              position: 'relative',
              borderRadius: '10px',
              overflow: 'hidden',
              border: `1px solid ${colors.borderLight}`,
              backgroundColor: colors.bg,
            }}
          >
            <Box
              component="img"
              src={floorPlanImageUrl}
              alt="Floor plan"
              sx={{ width: '100%', display: 'block' }}
            />
            {pinX != null && pinY != null && (
              <Box
                sx={{
                  position: 'absolute',
                  left: `${pinX}%`,
                  top: `${pinY}%`,
                  transform: 'translate(-50%, -100%)',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                <Box
                  sx={{
                    width: 28,
                    height: 28,
                    borderRadius: '50% 50% 50% 0',
                    backgroundColor: '#2563eb',
                    border: '2.5px solid #fff',
                    transform: 'rotate(-45deg)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(37,99,235,0.45)',
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      transform: 'rotate(45deg)',
                      color: '#fff',
                      fontSize: '0.6875rem',
                      fontWeight: 800,
                      lineHeight: 1,
                    }}
                  >
                    {pinName?.replace(/\D/g, '') || '•'}
                  </Box>
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {showPanoramas && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <CameraAltRounded sx={{ fontSize: 17, color: '#7c3aed' }} />
            <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.textStrong, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Capture Comparison
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
            <PanoramaCard label="Before" date={beforeDate} imageUrl={beforeImageUrl} />
            <PanoramaCard label="After" date={afterDate} imageUrl={afterImageUrl} />
          </Box>
        </Box>
      )}
    </Box>
  );
}
