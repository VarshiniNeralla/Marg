import React, { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { pinMarkerRadius, pinPercentToImageCoords } from '@/utils/floorPlanPinPosition';

export interface FloorPlanWithPinProps {
  imageUrl: string;
  pinX?: number | null;
  pinY?: number | null;
  maxHeight?: number;
}

/**
 * Renders a floor plan with a pin in page space (SVG viewBox = image dimensions).
 * Pin percentages match the capture workflow / tour floor-plan viewer.
 */
export default function FloorPlanWithPin({
  imageUrl,
  pinX,
  pinY,
  maxHeight = 360,
}: FloorPlanWithPinProps) {
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setPageSize({
        w: img.naturalWidth || 1000,
        h: img.naturalHeight || 700,
      });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  const showPin = pinX != null && pinY != null && pageSize.w > 0;
  const pinCoords = showPin
    ? pinPercentToImageCoords(pinX!, pinY!, pageSize.w, pageSize.h)
    : null;
  const pinR = showPin ? pinMarkerRadius(pageSize.w, pageSize.h) : 0;

  return (
    <Box
      sx={{
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid #dce3eb',
        backgroundColor: '#f7f9fb',
      }}
    >
      {pageSize.w > 0 ? (
        <Box
          component="svg"
          viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
          preserveAspectRatio="xMidYMid meet"
          sx={{ width: '100%', maxHeight, display: 'block' }}
        >
          <rect x={0} y={0} width={pageSize.w} height={pageSize.h} fill="#ffffff" />
          <image href={imageUrl} x={0} y={0} width={pageSize.w} height={pageSize.h} />
          {showPin && pinCoords && (
            <g>
              <circle
                cx={pinCoords.cx}
                cy={pinCoords.cy}
                r={pinR * 1.35}
                fill="rgba(26,77,143,0.15)"
                stroke="rgba(26,77,143,0.35)"
                strokeWidth={2}
              />
              <circle
                cx={pinCoords.cx}
                cy={pinCoords.cy}
                r={pinR}
                fill="#1a4d8f"
                stroke="#ffffff"
                strokeWidth={Math.max(2, pinR * 0.2)}
              />
            </g>
          )}
        </Box>
      ) : (
        <Box
          component="img"
          src={imageUrl}
          alt="Floor plan"
          sx={{ width: '100%', maxHeight, objectFit: 'contain', display: 'block' }}
        />
      )}
    </Box>
  );
}
