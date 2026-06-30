import React from 'react';
import type { WfCapturePin } from '@store/workflowStore';
import { useDoubleTap } from '@/hooks/useDoubleTap';

interface CapturePinMarkerProps {
  pin: WfCapturePin;
  pageW: number;
  pageH: number;
  scale: number;
  selected: boolean;
  /** Double-tap/double-click — begins re-capture on the selected pin. */
  onActivate: (pin: WfCapturePin) => void;
  /** Single tap — select pin and reveal action panel. */
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
 *
 * Interaction model (replaces long press):
 *   • Single tap  → select pin (show action panel)
 *   • Double tap  → activate capture directly (camera on mobile, upload on desktop)
 */
export default function CapturePinMarker({ pin, pageW, pageH, scale, selected, onActivate, onSelect }: CapturePinMarkerProps) {
  const { handlers } = useDoubleTap(() => onActivate(pin), {
    onSingleTap: () => onSelect(pin),
  });

  const cx = (pin.x / 100) * pageW;
  const cy = (pin.y / 100) * pageH;
  const hasCapture = pin.captureIds.length > 0;

  // Pin radius in PAGE units. On-screen size = r * scale, clamped to [10, 22] px
  // so pins never explode at low zoom (scale≈0.1 on mobile) or vanish when zoomed in.
  const r       = Math.min(22, Math.max(10, 13 * scale)) / scale;
  const ringR   = Math.min(28, Math.max(13, 17 * scale)) / scale;
  const fontSize = Math.min(20, Math.max(9,  14 * scale)) / scale;

  const fill      = hasCapture ? '#16a34a' : '#ffffff';
  const stroke    = hasCapture ? '#15803d' : '#d97706';
  const textFill  = hasCapture ? '#ffffff' : '#d97706';

  return (
    <g
      {...handlers}
      style={{ cursor: 'pointer', touchAction: 'none' }}
    >
      {/* Selection halo */}
      {selected && (
        <circle
          cx={cx} cy={cy} r={ringR}
          fill={`${stroke}22`}
          stroke={stroke}
          strokeOpacity={0.5}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
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
