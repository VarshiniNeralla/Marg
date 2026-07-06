/** Pin x/y are stored as % of the floor-plan image (page space), not the container. */

export interface Size {
  width: number;
  height: number;
}

export function computeContainedImageRect(
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): { x: number; y: number; width: number; height: number } {
  if (!containerW || !containerH || !imageW || !imageH) {
    return { x: 0, y: 0, width: containerW, height: containerH };
  }
  const scale = Math.min(containerW / imageW, containerH / imageH);
  const width = imageW * scale;
  const height = imageH * scale;
  return {
    x: (containerW - width) / 2,
    y: (containerH - height) / 2,
    width,
    height,
  };
}

export function pinPercentToContainerPercent(
  pinX: number,
  pinY: number,
  containerW: number,
  containerH: number,
  imageW: number,
  imageH: number,
): { left: number; top: number } {
  const rect = computeContainedImageRect(containerW, containerH, imageW, imageH);
  const leftPx = rect.x + (pinX / 100) * rect.width;
  const topPx = rect.y + (pinY / 100) * rect.height;
  return {
    left: (leftPx / containerW) * 100,
    top: (topPx / containerH) * 100,
  };
}

export function pinPercentToImageCoords(
  pinX: number,
  pinY: number,
  imageW: number,
  imageH: number,
): { cx: number; cy: number } {
  return {
    cx: (pinX / 100) * imageW,
    cy: (pinY / 100) * imageH,
  };
}

export function pinMarkerRadius(imageW: number, imageH: number): number {
  return Math.max(12, Math.min(imageW, imageH) * 0.018);
}
