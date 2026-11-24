/**
 * Spot a camera frame that came out black.
 *
 * A 360 camera can hand back a perfectly valid, complete photo that is simply black (lens covered, or the camera just
 * woke up and took frames before its sensor was ready). The server rejects such a photo much later, during upload, as
 * "mostly flat colour". Checking the small preview the moment the shot is taken lets the engineer retake it on the
 * spot, while they are still standing at that point.
 *
 * Measured on real frames from the tablet: black frames average about 2.8 out of 255 with a spread of about 1.5, while
 * normal frames average 100+ with a spread of 60+. The limits below sit far from both.
 */
export const BLACK_MEAN_LIMIT = 10;
export const BLACK_SPREAD_LIMIT = 8;

/** Brightness (0 to 255) of every pixel in an RGBA buffer, e.g. from `getImageData(...).data`. */
export function lumaFromRgba(rgba: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    out.push(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

export function meanAndSpread(luma: ArrayLike<number>): { mean: number; spread: number } {
  const n = luma.length;
  if (!n) return { mean: 0, spread: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += luma[i];
  const mean = sum / n;
  let sq = 0;
  for (let i = 0; i < n; i++) sq += (luma[i] - mean) ** 2;
  return { mean, spread: Math.sqrt(sq / n) };
}

/** True when the picture is almost entirely black. An empty sample is never called black (nothing was measured). */
export function isNearlyBlack(luma: ArrayLike<number>): boolean {
  if (!luma.length) return false;
  const { mean, spread } = meanAndSpread(luma);
  return mean < BLACK_MEAN_LIMIT && spread < BLACK_SPREAD_LIMIT;
}

export const BLACK_PHOTO_MESSAGE =
  'This photo is black. Check the lens is uncovered and the camera is awake, then retake it.';
