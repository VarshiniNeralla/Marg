import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Typography, IconButton, CircularProgress } from '@mui/material';
import {
  CloseRounded, CameraAltRounded, CameraswitchRounded,
  ReplayRounded, CheckRounded, ErrorOutlineRounded,
} from '@mui/icons-material';

type Phase = 'starting' | 'live' | 'captured' | 'uploading' | 'error';

interface CameraCaptureDialogProps {
  open: boolean;
  pinLabel: string;
  /** Receives the captured frame as a File and performs the upload. Resolve to close. */
  onCapture: (file: File) => Promise<void>;
  onClose: () => void;
}

/**
 * Full-screen camera capture for mobile/tablet. Opens the rear ("environment")
 * camera via getUserMedia, lets the engineer snap a frame, review it, then hands
 * the resulting File to the existing upload pipeline via onCapture.
 *
 * For now this captures a single still from the device's back camera. The
 * Insta360 integration will replace the stream source later without changing
 * this component's contract (open → capture File → onCapture).
 */
export default function CameraCaptureDialog({ open, pinLabel, onCapture, onClose }: CameraCaptureDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(async (mode: 'environment' | 'user') => {
    setPhase('starting');
    setError('');
    stopStream();
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not supported on this device.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase('live');
    } catch (e) {
      const err = e as DOMException;
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Enable camera access and try again.'
          : err?.name === 'NotFoundError'
            ? 'No camera found on this device.'
            : err?.message || 'Could not open the camera.',
      );
      setPhase('error');
    }
  }, [stopStream]);

  // Open/close lifecycle
  useEffect(() => {
    if (open) {
      void startStream(facingMode);
    } else {
      stopStream();
      setShot(null);
      setPhase('starting');
      setError('');
    }
    return () => stopStream();
    // facingMode handled by its own effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Re-acquire when the user flips the camera
  useEffect(() => {
    if (open && phase !== 'captured' && phase !== 'uploading') {
      void startStream(facingMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1920;
    const h = video.videoHeight || 1080;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(blob => {
      if (!blob) return;
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setShot({ url: URL.createObjectURL(blob), file });
      setPhase('captured');
      stopStream();
    }, 'image/jpeg', 0.92);
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    void startStream(facingMode);
  }

  async function confirm() {
    if (!shot) return;
    setPhase('uploading');
    try {
      await onCapture(shot.file);
      URL.revokeObjectURL(shot.url);
      onClose();
    } catch {
      setError('Upload failed. Please try again.');
      setPhase('error');
    }
  }

  if (!open) return null;

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 1500, backgroundColor: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, background: 'linear-gradient(to bottom, rgba(0,0,0,0.6), transparent)' }}>
        <IconButton onClick={onClose} sx={{ color: '#fff', backgroundColor: 'rgba(255,255,255,0.12)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' } }}>
          <CloseRounded />
        </IconButton>
        <Typography sx={{ color: '#fff', fontSize: '0.9375rem', fontWeight: 700 }}>{pinLabel}</Typography>
        {(phase === 'live' || phase === 'starting') ? (
          <IconButton onClick={() => setFacingMode(m => (m === 'environment' ? 'user' : 'environment'))} sx={{ color: '#fff', backgroundColor: 'rgba(255,255,255,0.12)', '&:hover': { backgroundColor: 'rgba(255,255,255,0.2)' } }}>
            <CameraswitchRounded />
          </IconButton>
        ) : <Box sx={{ width: 40 }} />}
      </Box>

      {/* Video / preview surface */}
      <Box sx={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {shot ? (
          <Box component="img" src={shot.url} alt="Captured" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}

        {(phase === 'starting' || phase === 'uploading') && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, backgroundColor: 'rgba(0,0,0,0.55)' }}>
            <CircularProgress sx={{ color: '#fff' }} />
            <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.875rem' }}>
              {phase === 'uploading' ? 'Uploading capture…' : 'Opening camera…'}
            </Typography>
          </Box>
        )}

        {phase === 'error' && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, px: 4, textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.8)' }}>
            <ErrorOutlineRounded sx={{ fontSize: 44, color: '#f87171' }} />
            <Typography sx={{ color: '#fff', fontSize: '0.9375rem', fontWeight: 600 }}>{error}</Typography>
            <Box onClick={() => startStream(facingMode)} sx={{ mt: 1, px: 2.5, py: 1, borderRadius: '10px', backgroundColor: 'rgba(255,255,255,0.14)', color: '#fff', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer', '&:hover': { backgroundColor: 'rgba(255,255,255,0.22)' } }}>
              Try again
            </Box>
          </Box>
        )}
      </Box>

      {/* Controls */}
      <Box sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, px: 3, py: 4, background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)' }}>
        {phase === 'live' && (
          <Box
            onClick={takePhoto}
            sx={{ width: 72, height: 72, borderRadius: '50%', border: '4px solid rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', backgroundColor: 'rgba(255,255,255,0.12)', transition: 'transform 120ms', '&:active': { transform: 'scale(0.92)' } }}
          >
            <CameraAltRounded sx={{ fontSize: 30, color: '#fff' }} />
          </Box>
        )}
        {phase === 'captured' && (
          <>
            <Box onClick={retake} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: '#fff' }}>
              <Box sx={{ width: 56, height: 56, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', '&:hover': { backgroundColor: 'rgba(255,255,255,0.22)' } }}>
                <ReplayRounded sx={{ fontSize: 26 }} />
              </Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Retake</Typography>
            </Box>
            <Box onClick={confirm} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: '#fff' }}>
              <Box sx={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 16px rgba(22,163,74,0.5)', '&:hover': { backgroundColor: '#15803d' } }}>
                <CheckRounded sx={{ fontSize: 30 }} />
              </Box>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 600 }}>Use Photo</Typography>
            </Box>
          </>
        )}
      </Box>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </Box>
  );
}
