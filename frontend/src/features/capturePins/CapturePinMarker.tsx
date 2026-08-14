import React from 'react';
import type { WfCapturePin } from '@store/workflowStore';

interface CapturePinMarkerProps {
  pin: WfCapturePin;
  pageW: number;
  pageH: number;
  scale: number;
  selected: boolean;
  /** When many pins are on screen, shrink further and hide labels unless selected. */
  dense?: boolean;
  /**
   * Annotation mode: always render as an unlabeled capture point (blue).
   * Hides whether the field engineer has already uploaded to this pin.
   */
  annotationOnly?: boolean;
  /** Capture Pins review: show sequence # on the marker (green uploads). */
  showSequence?: boolean;
  /** Override displayed sequence (e.g. 1..N among captured pins). */
  sequenceNumber?: number;
  /** Single tap — select pin (Edit / Delete). */
  onSelect: (pin: WfCapturePin) => void;
}

/**
 * Compact capture point on the floor plan.
 * Size stays roughly constant on screen, but shrinks when zoomed out / dense
 * so a full-floor view stays readable.
 */
export default function CapturePinMarker({
  pin, pageW, pageH, scale, selected, dense = false, annotationOnly = false,
  showSequence = false, sequenceNumber, onSelect,
}: CapturePinMarkerProps) {
  const cx = (pin.x / 100) * pageW;
  const cy = (pin.y / 100) * pageH;
  const hasCapture = !annotationOnly && pin.captureIds.length > 0;

  // Zoomed-out views: slightly smaller so dense plans stay readable.
  const zoomT = Math.min(1, Math.max(0, (scale - 0.25) / 1.1));
  const baseR = dense
    ? 3.6 + 1.4 * zoomT   // ~3.6–5.0px
    : 4.2 + 1.6 * zoomT;  // ~4.2–5.8px
  // Sequence badge needs a slightly larger disc so the number stays readable.
  const seqBoost = showSequence ? (dense ? 2.2 : 2.8) : 0;
  const screenR = (selected ? baseR + 1.25 : baseR) + seqBoost;
  const screenRing = screenR + (dense ? 3 : 3.5);
  const r = screenR / scale;
  const ringR = screenRing / scale;

  const showLabel = !showSequence && (selected || (!dense && scale >= 0.85));
  const labelFs = (dense ? 7 : 8) / scale;
  const seqFs = Math.max(8, Math.min(13, screenR * 1.15)) / scale;
  const seqNum = sequenceNumber ?? pin.sequenceNumber;

  const fill   = hasCapture ? '#16a34a' : '#2563eb';
  const stroke = hasCapture ? '#15803d' : '#1d4ed8';
  const roomLabel = (pin.label || pin.roomName || '').trim();

  const startRef = React.useRef({ x: 0, y: 0 });

  return (
    <g
      data-capture-pin={pin.id}
      style={{ cursor: 'pointer', touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        startRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        e.stopPropagation();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) > 10) return;
        onSelect(pin);
      }}
    >
      {/* Invisible hit target — easier taps without making the visible dot huge */}
      <circle
        cx={cx} cy={cy} r={Math.max(r * 2.6, (dense ? 10 : 12) / scale)}
        fill="transparent"
      />

      {selected && (
        <circle
          cx={cx} cy={cy} r={ringR}
          fill={`${stroke}18`}
          stroke={stroke}
          strokeOpacity={0.45}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      )}

      <circle
        cx={cx} cy={cy} r={r}
        fill={fill}
        stroke="#ffffff"
        strokeWidth={1.35}
        vectorEffect="non-scaling-stroke"
        style={{
          filter: hasCapture
            ? 'drop-shadow(0 1px 2px rgba(22,163,74,0.4))'
            : 'drop-shadow(0 1px 2px rgba(37,99,235,0.4))',
        }}
      />

      {showSequence ? (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={seqFs}
          fontWeight={800}
          fill="#ffffff"
          fontFamily="Inter, system-ui, sans-serif"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {seqNum}
        </text>
      ) : null}

      {showLabel && roomLabel ? (
        <text
          x={cx}
          y={cy + r + labelFs * 1.15}
          textAnchor="middle"
          dominantBaseline="hanging"
          fontSize={labelFs}
          fontWeight={700}
          fill="#111827"
          fillOpacity={0.88}
          fontFamily="Inter, system-ui, sans-serif"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {roomLabel.length > 18 ? `${roomLabel.slice(0, 16)}…` : roomLabel}
        </text>
      ) : null}
    </g>
  );
}
