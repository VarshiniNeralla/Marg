import React from 'react';

interface PendingPinMarkerProps {
  /** Position in percent of the page, exactly as it will be saved. */
  x: number;
  y: number;
  pageW: number;
  pageH: number;
  /** Viewer zoom: the marker keeps a constant size on screen whatever the zoom. */
  scale: number;
}

/**
 * The spot an admin just tapped, shown at once and BEFORE it is saved: a bright orange pin with a pulsing ring and a
 * crosshair on the exact point, so the position is unmistakable. It disappears when the point is saved (the normal blue
 * point takes its place) or cancelled. Purely visual: it takes no taps and saves nothing.
 */
export default function PendingPinMarker({ x, y, pageW, pageH, scale }: PendingPinMarkerProps) {
  const cx = (x / 100) * pageW;
  const cy = (y / 100) * pageH;
  const s = 1 / Math.max(scale, 0.05);      // one screen pixel in page units
  const ringR = 15 * s;
  const dotR = 3.5 * s;
  const pinH = 34 * s;                      // the pin's tip sits ON the tapped spot
  const pinW = 22 * s;

  return (
    <g data-pending-pin="true" style={{ pointerEvents: 'none' }}>
      <circle cx={cx} cy={cy} r={ringR} fill="rgba(249,115,22,0.18)" stroke="#f97316" strokeWidth={2 * s}>
        <animate attributeName="r" values={`${ringR * 0.7};${ringR * 1.25};${ringR * 0.7}`} dur="1.4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />
      </circle>
      {/* crosshair on the exact point */}
      <line x1={cx - ringR * 1.5} y1={cy} x2={cx + ringR * 1.5} y2={cy} stroke="#f97316" strokeWidth={1.25 * s} strokeOpacity={0.8} />
      <line x1={cx} y1={cy - ringR * 1.5} x2={cx} y2={cy + ringR * 1.5} stroke="#f97316" strokeWidth={1.25 * s} strokeOpacity={0.8} />
      {/* teardrop pin: tip at (cx, cy) */}
      <path
        d={`M ${cx} ${cy} C ${cx - pinW * 0.15} ${cy - pinH * 0.35}, ${cx - pinW / 2} ${cy - pinH * 0.55}, ${cx - pinW / 2} ${cy - pinH * 0.72}
            A ${pinW / 2} ${pinW / 2} 0 1 1 ${cx + pinW / 2} ${cy - pinH * 0.72}
            C ${cx + pinW / 2} ${cy - pinH * 0.55}, ${cx + pinW * 0.15} ${cy - pinH * 0.35}, ${cx} ${cy} Z`}
        fill="#f97316"
        stroke="#ffffff"
        strokeWidth={2 * s}
        style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.45))' }}
      />
      <circle cx={cx} cy={cy - pinH * 0.72} r={dotR} fill="#ffffff" />
      <circle cx={cx} cy={cy} r={1.75 * s} fill="#c2410c" stroke="#ffffff" strokeWidth={1 * s} />
    </g>
  );
}
