import React from 'react';
import type { WfCapturePin } from '@store/workflowStore';
import { useLongPress } from '@/hooks/useLongPress';

interface CapturePinMarkerProps {
  pin: WfCapturePin;
  pageW: number;
  pageH: number;
  scale: number;
  selected: boolean;
  /** Long-press (mobile/tablet camera, or desktop) — begins capture. */
  onActivate: (pin: WfCapturePin) => void;
  /** Short tap — select to reveal the action panel. */
  onSelect: (pin: WfCapturePin) => void;
}

/**
 * A single numbered capture pin rendered in floor-plan page space inside the
 * shared SVG. Coordinates are stored as % of the page, so the pin stays exactly
 * aligned through pan/zoom. Radius is divided by `scale` (and stroke uses
 * non-scaling-stroke) so the pin keeps a constant on-screen size at any zoom.
 *
 * Two visual states:
 *   • Waiting for capture  → hollow ring, dashed, amber
 *   • Capture attached     → solid filled, green, with a count badge
 */
export default function CapturePinMarker({ pin, pageW, pageH, scale, selected, onActivate, onSelect }: CapturePinMarkerProps) {
  const { handlers, isPressing, progress } = useLongPress(() => onActivate(pin), {
    threshold: 500,
    onClick: () => onSelect(pin),
  });

  const cx = (pin.x / 100) * pageW;
  const cy = (pin.y / 100) * pageH;
  const hasCapture = pin.captureIds.length > 0;

  // Constant on-screen size regardless of zoom.
  const r = 13 / scale;
  const ringR = 17 / scale;
  const fontSize = 14 / scale;

  const fill = hasCapture ? '#16a34a' : '#ffffff';
  const stroke = hasCapture ? '#15803d' : '#d97706';
  const textFill = hasCapture ? '#ffffff' : '#d97706';

  // Hold-progress arc (radial fill) while long-pressing.
  const arcCirc = 2 * Math.PI * ringR;

  return (
    <g
      {...handlers}
      style={{ cursor: 'pointer', touchAction: 'none' }}
    >
      {/* Selection / hold halo */}
      {(selected || isPressing) && (
        <circle
          cx={cx} cy={cy} r={ringR}
          fill={selected ? `${stroke}22` : 'transparent'}
          stroke={stroke}
          strokeOpacity={0.5}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* Hold-to-capture progress ring */}
      {isPressing && progress > 0 && (
        <circle
          cx={cx} cy={cy} r={ringR}
          fill="none"
          stroke={stroke}
          strokeWidth={3}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeDasharray={arcCirc}
          strokeDashoffset={arcCirc * (1 - progress)}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Pin body */}
      <circle
        cx={cx} cy={cy} r={r}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
        strokeDasharray={hasCapture ? undefined : `${4 / scale} ${3 / scale}`}
        vectorEffect="non-scaling-stroke"
        style={{ filter: 'drop-shadow(0 1px 3px rgba(15,23,42,0.35))' }}
      />

      {/* Sequence number */}
      <text
        x={cx} y={cy}
        textAnchor="middle" dominantBaseline="central"
        fontSize={fontSize}
        fontWeight={700}
        fill={textFill}
        fontFamily="Inter, system-ui, sans-serif"
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >{pin.sequenceNumber}</text>

      {/* Capture-count badge (>1 visit) */}
      {pin.captureIds.length > 1 && (
        <>
          <circle cx={cx + r * 0.85} cy={cy - r * 0.85} r={7 / scale} fill="#2563eb" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <text
            x={cx + r * 0.85} y={cy - r * 0.85}
            textAnchor="middle" dominantBaseline="central"
            fontSize={8 / scale} fontWeight={700} fill="#fff"
            fontFamily="Inter, system-ui, sans-serif"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >{pin.captureIds.length}</text>
        </>
      )}
    </g>
  );
}
