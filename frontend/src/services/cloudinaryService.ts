import type { CloudinaryUploadResult } from '@/types/dto';
import { captureService } from './captureService';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;

export interface UploadProgressEvent {
  loaded: number;
  total: number;
  percent: number;
}

export interface CloudinaryUploadOptions {
  folder?: string;
  onProgress?: (e: UploadProgressEvent) => void;
  useSignedUpload?: boolean;
}

export async function uploadToCloudinary(
  file: File,
  options: CloudinaryUploadOptions = {}
): Promise<CloudinaryUploadResult> {
  const { folder = 'virtual-tour/captures', onProgress, useSignedUpload = false } = options;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  if (useSignedUpload) {
    // Signed upload via backend-generated signature (for production)
    const sig = await captureService.getUploadSignature(folder);
    formData.append('signature', sig.signature);
    formData.append('timestamp', String(sig.timestamp));
    formData.append('api_key', sig.api_key);
    if (sig.upload_preset) formData.append('upload_preset', sig.upload_preset);
  } else {
    // Unsigned upload via preset (for development)
    formData.append('upload_preset', UPLOAD_PRESET);
  }

  return new Promise<CloudinaryUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const cloudName = useSignedUpload
      ? import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
      : CLOUD_NAME;

    xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`);

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({ loaded: e.loaded, total: e.total, percent: Math.round((e.loaded / e.total) * 100) });
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText) as CloudinaryUploadResult);
      } else {
        reject(new Error(`Cloudinary upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during Cloudinary upload'));
    xhr.send(formData);
  });
}

export async function uploadMultipleToCloudinary(
  files: File[],
  options: CloudinaryUploadOptions & { onFileProgress?: (index: number, e: UploadProgressEvent) => void } = {}
): Promise<CloudinaryUploadResult[]> {
  const { onFileProgress, ...baseOptions } = options;
  return Promise.all(
    files.map((file, index) =>
      uploadToCloudinary(file, {
        ...baseOptions,
        onProgress: onFileProgress ? (e) => onFileProgress(index, e) : undefined,
      })
    )
  );
}
