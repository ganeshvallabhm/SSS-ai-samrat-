import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraError =
  | 'permission_denied'
  | 'no_camera'
  | 'camera_busy'
  | 'insecure_context'
  | 'unknown';

export type FacingMode = 'environment' | 'user';

export interface CameraState {
  ready: boolean;
  error: CameraError | null;
  facingMode: FacingMode;
  torchSupported: boolean;
  torchOn: boolean;
  gridOn: boolean;
  stream: MediaStream | null;
}

export interface UseCameraReturn extends CameraState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  startCamera: (facing?: FacingMode) => Promise<void>;
  stopCamera: () => void;
  flipCamera: () => void;
  toggleTorch: () => Promise<void>;
  toggleGrid: () => void;
  captureFrame: (watermarkText?: string) => Promise<string | null>;
}

function mapError(err: unknown): CameraError {
  if (err instanceof Error) {
    const n = err.name;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'permission_denied';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError') return 'no_camera';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'camera_busy';
    if (n === 'SecurityError') return 'insecure_context';
  }
  return 'unknown';
}

export function useCamera(): UseCameraReturn {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [state, setState] = useState<CameraState>({
    ready: false,
    error: null,
    facingMode: 'environment',
    torchSupported: false,
    torchOn: false,
    gridOn: false,
    stream: null,
  });

  // Check for insecure context up-front
  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState(s => ({
        ...s,
        error: location.protocol !== 'https:' && location.hostname !== 'localhost'
          ? 'insecure_context'
          : 'no_camera',
      }));
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setState(s => ({ ...s, ready: false, stream: null, torchSupported: false, torchOn: false }));
  }, []);

  const startCamera = useCallback(async (facing: FacingMode = 'environment') => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState(s => ({
        ...s,
        error: location.protocol !== 'https:' && location.hostname !== 'localhost'
          ? 'insecure_context'
          : 'no_camera',
      }));
      return;
    }

    // Stop existing stream first
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setState(s => ({ ...s, ready: false, error: null, stream: null }));

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check torch support
      const videoTrack = stream.getVideoTracks()[0];
      const capabilities = videoTrack?.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean } | undefined;
      const torchSupported = Boolean(capabilities?.torch);

      setState(s => ({
        ...s,
        ready: true,
        error: null,
        facingMode: facing,
        torchSupported,
        torchOn: false,
        stream,
      }));
    } catch (err) {
      setState(s => ({ ...s, ready: false, error: mapError(err), stream: null }));
    }
  }, []);

  const flipCamera = useCallback(() => {
    const next: FacingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    void startCamera(next);
  }, [state.facingMode, startCamera]);

  const toggleTorch = useCallback(async () => {
    if (!state.torchSupported || !streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (!videoTrack) return;
    const newVal = !state.torchOn;
    try {
      await videoTrack.applyConstraints({ advanced: [{ torch: newVal } as MediaTrackConstraintSet] });
      setState(s => ({ ...s, torchOn: newVal }));
    } catch {
      // torch apply failed silently
    }
  }, [state.torchSupported, state.torchOn]);

  const toggleGrid = useCallback(() => {
    setState(s => ({ ...s, gridOn: !s.gridOn }));
  }, []);

  const captureFrame = useCallback(async (watermarkText?: string): Promise<string | null> => {
    const video = videoRef.current;
    if (!video || !state.ready) return null;

    const TARGET_WIDTH = 1280;
    const ratio = video.videoHeight / video.videoWidth;
    const w = TARGET_WIDTH;
    const h = Math.round(TARGET_WIDTH * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Mirror front camera
    if (state.facingMode === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }

    ctx.drawImage(video, 0, 0, w, h);

    // Reset transform for watermark
    if (state.facingMode === 'user') {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Watermark
    if (watermarkText) {
      const lines = watermarkText.split('\n');
      const PAD = 14;
      const LINE_H = 22;
      const fontSize = 15;
      ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;

      const maxW = lines.reduce((mx, l) => Math.max(mx, ctx.measureText(l).width), 0);
      const bw = maxW + PAD * 2;
      const bh = lines.length * LINE_H + PAD * 1.5;
      const bx = w - bw - 12;
      const by = h - bh - 12;

      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 8);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      lines.forEach((line, i) => {
        ctx.fillText(line, bx + PAD, by + PAD + i * LINE_H + fontSize);
      });
    }

    return canvas.toDataURL('image/jpeg', 0.8);
  }, [state.ready, state.facingMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return {
    ...state,
    videoRef,
    startCamera,
    stopCamera,
    flipCamera,
    toggleTorch,
    toggleGrid,
    captureFrame,
  };
}
