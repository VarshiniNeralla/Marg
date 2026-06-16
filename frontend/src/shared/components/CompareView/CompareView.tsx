import React, { useState, useRef, useCallback } from 'react';
import { Box, Typography } from '@mui/material';
import { CameraAltRounded, CompareArrowsRounded, ViewColumnRounded, DragHandleRounded } from '@mui/icons-material';
import { colors, motion } from '@theme/tokens';
import type { CaptureSnapshot } from '@/data/mockData';

interface CompareViewProps {
  a: CaptureSnapshot;
  b: CaptureSnapshot;
}

type Mode = 'slider' | 'side';

// A panel that renders two capture snapshots of the same room either as a
// draggable before/after slider or side-by-side. Uses mock gradient "images".
export default function CompareView({ a, b }: CompareViewProps) {
  const [mode, setMode] = useState<Mode>('slider');
  const [pos, setPos] = useState(50); // slider divider position %
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // a = older (before), b = newer (after) — order by date if needed
  const [before, after] = a.date <= b.date ? [a, b] : [b, a];

  const updatePos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, p)));
  }, []);

  const onMouseDown = () => { dragging.current = true; };
  const onMouseMove = (e: React.MouseEvent) => { if (dragging.current) updatePos(e.clientX); };
  const onMouseUp = () => { dragging.current = false; };
  const onTouchMove = (e: React.TouchEvent) => { if (e.touches[0]) updatePos(e.touches[0].clientX); };

  function PanoFill({ snap, label }: { snap: CaptureSnapshot; label: string }) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, background: snap.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Box sx={{ textAlign: 'center', opacity: 0.5 }}>
          <CameraAltRounded sx={{ fontSize: 40, color: 'rgba(255,255,255,0.4)' }} />
        </Box>
        {/* Date + progress chip */}
        <Box sx={{ position: 'absolute', bottom: 12, left: 12, px: 1.25, py: 0.625, borderRadius: '8px', backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}>
          <Typography sx={{ fontSize: '0.625rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.08em', lineHeight: 1.2 }}>{label}</Typography>
          <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{snap.dateLabel} · {snap.progress}%</Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      {/* Header + mode toggle */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CompareArrowsRounded sx={{ fontSize: 18, color: colors.primary }} />
          <Typography sx={{ fontSize: '0.9375rem', fontWeight: 700, color: colors.textStrong, letterSpacing: '-0.02em' }}>Before / After</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5, p: 0.375, borderRadius: '10px', backgroundColor: colors.bgDeep }}>
          {([['slider', 'Slider', <DragHandleRounded sx={{ fontSize: 15 }} />], ['side', 'Side by side', <ViewColumnRounded sx={{ fontSize: 15 }} />]] as const).map(([m, label, icon]) => (
            <Box
              key={m}
              onClick={() => setMode(m)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.625, px: 1.25, py: 0.625, borderRadius: '8px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: mode === m ? colors.textStrong : colors.textMuted, backgroundColor: mode === m ? '#fff' : 'transparent', boxShadow: mode === m ? '0 1px 3px rgba(15,23,42,0.10)' : 'none', transition: `all ${motion.durationFast}` }}
            >
              {icon} {label}
            </Box>
          ))}
        </Box>
      </Box>

      {mode === 'slider' ? (
        <Box
          ref={containerRef}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onTouchMove={onTouchMove}
          sx={{ position: 'relative', height: 340, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.06)', userSelect: 'none', cursor: 'ew-resize' }}
        >
          {/* After (full) */}
          <PanoFill snap={after} label="After" />
          {/* Before (clipped to slider) */}
          <Box sx={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <PanoFill snap={before} label="Before" />
          </Box>
          {/* Divider handle */}
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 2, backgroundColor: '#fff', boxShadow: '0 0 8px rgba(0,0,0,0.4)', transform: 'translateX(-1px)', zIndex: 3 }}>
            <Box
              onMouseDown={onMouseDown}
              onTouchStart={onMouseDown}
              sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 36, height: 36, borderRadius: '50%', backgroundColor: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'ew-resize' }}
            >
              <CompareArrowsRounded sx={{ fontSize: 18, color: colors.textStrong }} />
            </Box>
          </Box>
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          {[before, after].map((snap, i) => (
            <Box key={snap.id} sx={{ flex: 1, position: 'relative', height: 300, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(15,23,42,0.06)' }}>
              <PanoFill snap={snap} label={i === 0 ? 'Before' : 'After'} />
            </Box>
          ))}
        </Box>
      )}

      {/* Delta summary */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, mt: 2, py: 1, borderRadius: '10px', backgroundColor: colors.successBg }}>
        <Typography sx={{ fontSize: '0.8125rem', color: colors.textSecondary }}>
          Progress over {before.dateLabel} → {after.dateLabel}:
        </Typography>
        <Typography sx={{ fontSize: '0.8125rem', fontWeight: 700, color: colors.success }}>
          +{Math.max(0, after.progress - before.progress)}%
        </Typography>
      </Box>
    </Box>
  );
}
