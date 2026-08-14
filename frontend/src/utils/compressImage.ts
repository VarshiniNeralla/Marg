/** Server `/uploads/image` rejects files over 5 MB. */
export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;

const DEFAULT_MAX_EDGE = 1600;
const DEFAULT_TARGET_BYTES = 1.5 * 1024 * 1024;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read this image. Try a JPG or PNG.'));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Image compression failed.'))),
      type,
      quality,
    );
  });
}

/**
 * Downscale + JPEG-compress a photo so it fits under the upload size limit.
 * Returns the original file when it is already small enough and is JPEG/PNG/WebP.
 */
export async function compressImageForUpload(
  file: File,
  opts?: {
    maxBytes?: number;
    maxEdge?: number;
    targetBytes?: number;
  },
): Promise<File> {
  const maxBytes = opts?.maxBytes ?? MAX_UPLOAD_IMAGE_BYTES;
  const maxEdge = opts?.maxEdge ?? DEFAULT_MAX_EDGE;
  const targetBytes = Math.min(opts?.targetBytes ?? DEFAULT_TARGET_BYTES, maxBytes);

  const type = (file.type || '').toLowerCase();
  const alreadyOk =
    file.size <= maxBytes
    && (type === 'image/jpeg' || type === 'image/png' || type === 'image/webp' || type === 'image/gif');
  if (alreadyOk && file.size <= targetBytes) {
    return file;
  }
  // Keep small GIFs as-is (canvas would flatten animation / transparency poorly).
  if (type === 'image/gif' && file.size <= maxBytes) {
    return file;
  }

  const img = await loadImage(file);
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;
  if (!width || !height) {
    throw new Error('Could not read image dimensions.');
  }

  const scale = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(1, Math.round(width * scale));
  height = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image compression is not supported in this browser.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, 'image/jpeg', quality);

  // Step quality down until under target (or floor quality).
  while (blob.size > targetBytes && quality > 0.45) {
    quality = Math.max(0.45, quality - 0.1);
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  }

  // Still too big — shrink dimensions further.
  let edge = maxEdge;
  while (blob.size > maxBytes && edge > 640) {
    edge = Math.round(edge * 0.75);
    const s = Math.min(1, edge / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    width = Math.max(1, Math.round((img.naturalWidth || img.width) * s));
    height = Math.max(1, Math.round((img.naturalHeight || img.height) * s));
    canvas.width = width;
    canvas.height = height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    quality = 0.75;
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob.size > targetBytes && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.1);
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
  }

  if (blob.size > maxBytes) {
    throw new Error(
      `Could not compress this image under ${Math.round(maxBytes / (1024 * 1024))} MB. Try a smaller photo.`,
    );
  }

  const base = (file.name || 'thumbnail').replace(/\.[^.]+$/, '') || 'thumbnail';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}
