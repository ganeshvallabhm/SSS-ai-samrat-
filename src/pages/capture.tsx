import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  ChevronRight,
  Construction,
  Flashlight,
  FlipHorizontal,
  Grid3x3,
  Heart,
  Landmark,
  Loader2,
  MapPin,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sprout,
  WifiOff,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Brand } from '@/components/civic/shared';
import { useCamera } from '@/hooks/useCamera';
import { useGeolocation } from '@/hooks/useGeolocation';
import { snapshotOptions, isBackendMode, createBackendSubmission } from '@/api';
import { useSuspenseQuery } from '@tanstack/react-query';
import type { Task, TaskCategory } from '@/types';
import civicAuditImg from '@/assets/civic-audit.png';
import greenDriveImg from '@/assets/green-drive.png';
import healthCampImg from '@/assets/health-camp.png';
import localGovernanceImg from '@/assets/local-governance.png';

/* ─────────────────────────── Types ─────────────────────────── */

type Step = 'category' | 'explainer' | 'viewfinder' | 'preview' | 'details' | 'success';

interface CaptureCategory {
  id: TaskCategory;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
  image: string;
}

const CATEGORIES: CaptureCategory[] = [
  { id: 'civic', label: 'Civic Audit', description: 'Potholes, broken lights, road damage', Icon: Construction, image: civicAuditImg },
  { id: 'green', label: 'Green Drive', description: 'Tree planting, clean-up, waste', Icon: Sprout, image: greenDriveImg },
  { id: 'health', label: 'Health Camp', description: 'Blood donation, health volunteering', Icon: Heart, image: healthCampImg },
  { id: 'governance', label: 'Local Governance', description: 'Public amenities, ward surveys', Icon: Landmark, image: localGovernanceImg },
];

const TASK_IDS: Record<TaskCategory, string> = {
  civic: 't2',
  green: 't1',
  health: 't7',
  governance: 't10',
};

/* ─────────────────────────── Main page ─────────────────────────── */

export function CapturePage() {
  const { data } = useSuspenseQuery(snapshotOptions);

  // Read optional taskId from URL parameters if citizen entered from a specific task page
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const urlTaskId = searchParams?.get('taskId') ?? undefined;

  const initialTask = urlTaskId ? (data.tasks.find(t => t.id === urlTaskId) ?? null) : null;
  const initialCategory = initialTask
    ? (CATEGORIES.find(c => c.id === initialTask.category) ?? null)
    : null;

  const [step, setStep] = useState<Step>(initialTask ? 'explainer' : 'category');
  const [selectedTask, setSelectedTask] = useState<Task | null>(initialTask);
  const [category, setCategory] = useState<CaptureCategory | null>(initialCategory);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedGeo, setCapturedGeo] = useState<{
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    error: ReturnType<typeof useGeolocation>['error'];
    locating: boolean;
  }>({
    latitude: null,
    longitude: null,
    accuracy: null,
    error: null,
    locating: false,
  });
  const [note, setNote] = useState('');
  const [address, setAddress] = useState('');
  const [newSubmissionId, setNewSubmissionId] = useState<string | null>(null);

  const geo = useGeolocation();
  const cam = useCamera();

  // Stop camera when leaving viewfinder
  useEffect(() => {
    if (step !== 'viewfinder') {
      cam.stopCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Reverse geocode when we get a GPS fix
  useEffect(() => {
    if (geo.latitude !== null && geo.longitude !== null && !address) {
      void reverseGeocode(geo.latitude, geo.longitude).then(a => {
        if (a) setAddress(a);
      });
    }
  }, [geo.latitude, geo.longitude, address]);

  const handleCategorySelect = (cat: CaptureCategory) => {
    setCategory(cat);
    const matchingTask = data.tasks.find(t => t.id === TASK_IDS[cat.id]) || data.tasks.find(t => t.category === cat.id);
    if (matchingTask) {
      setSelectedTask(matchingTask);
    }
    setStep('explainer');
  };

  const handleStartCamera = () => {
    setStep('viewfinder');
    void cam.startCamera('environment');
  };

  const handleCapture = async () => {
    if (!cam.ready) return;

    const curLat = geo.latitude;
    const curLng = geo.longitude;
    const curAcc = geo.accuracy;
    const curErr = geo.error;
    const curLoc = geo.locating;

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const watermark = curLat !== null && curLng !== null
      ? `${dateStr}  ${timeStr}\n${curLat.toFixed(5)}, ${curLng.toFixed(5)}`
      : `${dateStr}  ${timeStr}`;

    const dataUrl = await cam.captureFrame(watermark);
    if (dataUrl) {
      setCapturedDataUrl(dataUrl);
      setCapturedGeo({
        latitude: curLat,
        longitude: curLng,
        accuracy: curAcc,
        error: curErr,
        locating: curLoc,
      });
      setStep('preview');

      // If location wasn't available yet or was still locating, trigger getCurrentPosition
      if (curLat === null && !curErr) {
        setCapturedGeo(prev => ({ ...prev, locating: true }));
        geo.getCurrentPosition().then(fresh => {
          setCapturedGeo({
            latitude: fresh.latitude,
            longitude: fresh.longitude,
            accuracy: fresh.accuracy,
            error: fresh.error,
            locating: false,
          });
          if (fresh.latitude !== null && fresh.longitude !== null && !address) {
            void reverseGeocode(fresh.latitude, fresh.longitude).then(a => {
              if (a) setAddress(a);
            });
          }
        });
      }
    }
  };

  const handleUsePhoto = () => {
    setStep('details');
  };

  const handleRetake = () => {
    setCapturedDataUrl(null);
    setCapturedGeo({
      latitude: null,
      longitude: null,
      accuracy: null,
      error: null,
      locating: false,
    });
    setStep('viewfinder');
    void cam.startCamera(cam.facingMode);
  };

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async () => {
    // Prevent submission if already submitting or if no photo or valid location is available
    if (submitting || !capturedDataUrl || capturedGeo.latitude === null || capturedGeo.longitude === null) {
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const finalTaskId = selectedTask?.id ?? TASK_IDS[category?.id ?? 'civic'];
    const finalCategory = (selectedTask?.category || category?.id || 'civic') as TaskCategory;

    try {
      if (isBackendMode()) {
        const backendSub = await createBackendSubmission({
          photoDataUrl: capturedDataUrl,
          lat: capturedGeo.latitude,
          lng: capturedGeo.longitude,
          accuracy: capturedGeo.accuracy ?? 10.0,
          categoryId: finalCategory,
          taskId: finalTaskId,
          note: note.trim() || undefined,
          address: address || undefined,
        });

        setNewSubmissionId(backendSub.id);
        setStep('success');
      } else {
        const id = `cap-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const finalTaskTitle = selectedTask?.title ?? (data.tasks.find(t => t.id === finalTaskId)?.title || category?.label || 'Civic Task');

        const submission: LocalSubmission = {
          id,
          taskId: finalTaskId,
          taskTitle: finalTaskTitle,
          category: finalCategory,
          status: 'under_review',
          submittedAt: now,
          photoDataUrl: capturedDataUrl,
          latitude: capturedGeo.latitude,
          longitude: capturedGeo.longitude,
          accuracy: capturedGeo.accuracy ?? undefined,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(address ? { address } : {}),
        };

        const saved = submissionStore.add(submission);
        setNewSubmissionId(saved.id);
        setStep('success');
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to submit report. Please check location and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDoAnother = () => {
    setStep('category');
    setSelectedTask(null);
    setCategory(null);
    setCapturedDataUrl(null);
    setCapturedGeo({
      latitude: null,
      longitude: null,
      accuracy: null,
      error: null,
      locating: false,
    });
    setNote('');
    setAddress('');
    setNewSubmissionId(null);
  };

  return (
    <>
      {step === 'category' && (
        <CategoryStep onSelect={handleCategorySelect} />
      )}
      {step === 'explainer' && category && (
        <ExplainerStep
          category={category}
          selectedTask={selectedTask}
          onBack={() => initialTask ? window.history.back() : setStep('category')}
          onContinue={handleStartCamera}
        />
      )}
      {step === 'viewfinder' && category && (
        <ViewfinderStep
          category={category}
          cam={cam}
          geo={geo}
          onBack={() => setStep('explainer')}
          onCapture={handleCapture}
        />
      )}
      {step === 'preview' && capturedDataUrl && (
        <PreviewStep
          dataUrl={capturedDataUrl}
          geo={capturedGeo}
          address={address}
          onRetake={handleRetake}
          onUse={handleUsePhoto}
        />
      )}
      {step === 'details' && capturedDataUrl && (
        <DetailsStep
          dataUrl={capturedDataUrl}
          category={category}
          selectedTask={selectedTask}
          geo={capturedGeo}
          address={address}
          note={note}
          submitting={submitting}
          submitError={submitError}
          onNoteChange={setNote}
          onBack={() => setStep('preview')}
          onSubmit={handleSubmit}
        />
      )}
      {step === 'success' && newSubmissionId && (
        <SuccessStep
          submissionId={newSubmissionId}
          selectedTask={selectedTask}
          onDoAnother={handleDoAnother}
        />
      )}
    </>
  );
}

/* ─────────────────────────── Step: Category ─────────────────────────── */

function CategoryStep({ onSelect }: { onSelect: (cat: CaptureCategory) => void }) {
  return (
    <div className="capture-page">
      <header className="capture-header">
        <Button asChild variant="ghost" size="icon" aria-label="Go back to tasks">
          <Link to="/tasks"><ArrowLeft /></Link>
        </Button>
        <Brand compact />
        <div style={{ width: 44 }} />
      </header>
      <div className="page-content" style={{ paddingTop: 12, paddingBottom: 100 }}>
        <span className="eyebrow">ONE PHOTO. REAL IMPACT.</span>
        <h1 className="capture-step-title">What are you reporting?</h1>
        <p className="capture-step-sub">Choose a category to continue.</p>
        <div className="category-pick-grid">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              className={`category-pick-card category-${cat.id}`}
              onClick={() => onSelect(cat)}
              aria-label={cat.label}
            >
              <div className="category-thumb-wrap">
                <img
                  src={cat.image}
                  alt={cat.label}
                  className="category-thumb"
                  width={144}
                  height={144}
                  loading="eager"
                />
                <span className={`category-thumb-badge category-${cat.id}`}>
                  <cat.Icon size={13} />
                </span>
              </div>
              <div className="category-pick-info">
                <strong>{cat.label}</strong>
                <span className="category-desc">{cat.description}</span>
              </div>
              <ChevronRight size={16} className="pick-chevron" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Step: Explainer ─────────────────────────── */

function ExplainerStep({
  category,
  selectedTask,
  onBack,
  onContinue,
}: {
  category: CaptureCategory;
  selectedTask: Task | null;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="capture-page">
      <header className="capture-header">
        <Button variant="ghost" size="icon" aria-label="Go back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <Brand compact />
        <div style={{ width: 44 }} />
      </header>
      <div className="page-content explainer-content">
        <span className={`category-icon category-${category.id}`} style={{ width: 72, height: 72, borderRadius: 20, marginBottom: 20 }}>
          <category.Icon size={34} />
        </span>
        <span className="eyebrow">{selectedTask ? 'TASK VERIFICATION' : 'BEFORE WE START'}</span>
        <h1 style={{ fontSize: 24, fontWeight: 650, lineHeight: 1.35, margin: '8px 0 14px' }}>
          {selectedTask ? `Submit proof for ${selectedTask.title}` : "We'll use your camera and location"}
        </h1>
        <div className="explainer-items">
          {[
            {
              Icon: Camera,
              title: 'Live camera only',
              text: 'We access your camera to take a live photo. No gallery access. The camera turns off automatically when you leave.',
            },
            {
              Icon: MapPin,
              title: 'Your GPS confirms where you are',
              text: 'Your precise location is stamped onto the photo to verify the report. We use it only for this submission.',
            },
            {
              Icon: ShieldCheck,
              title: 'Your data stays with you',
              text: 'Avoid photographing people without permission. Your location and photo are used for verification only.',
            },
          ].map(item => (
            <div className="explainer-item" key={item.title}>
              <span className="explainer-icon"><item.Icon size={20} /></span>
              <div>
                <h2>{item.title}</h2>
                <p>{item.text}</p>
              </div>
            </div>
          ))}
        </div>
        <Button className="w-full" style={{ marginTop: 28, height: 52 }} onClick={onContinue}>
          Allow camera & location <ArrowRight size={17} />
        </Button>
        <p className="explainer-footer">
          Your browser will ask for camera permission. If prompted, tap Allow.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Step: Viewfinder ─────────────────────────── */

function ViewfinderStep({
  category,
  cam,
  geo,
  onBack,
  onCapture,
}: {
  category: CaptureCategory;
  cam: ReturnType<typeof useCamera>;
  geo: ReturnType<typeof useGeolocation>;
  onBack: () => void;
  onCapture: () => void;
}) {
  // Mirror front camera in video element
  const videoStyle: React.CSSProperties =
    cam.facingMode === 'user' ? { transform: 'scaleX(-1)' } : {};

  return (
    <div className="viewfinder-shell">
      {/* Error screens */}
      {cam.error && <CameraErrorScreen error={cam.error} onBack={onBack} onRetry={() => void cam.startCamera(cam.facingMode)} />}

      {/* Loading state */}
      {!cam.error && !cam.ready && (
        <div className="vf-loading">
          <Loader2 className="spin" size={38} />
          <p>Starting camera…</p>
        </div>
      )}

      {/* Video */}
      <video
        ref={cam.videoRef}
        className="viewfinder-video"
        playsInline
        muted
        autoPlay
        style={videoStyle}
        aria-label="Live camera viewfinder"
        onLoadedMetadata={e => {
          e.currentTarget.play().catch(() => {});
        }}
      />

      {/* Grid overlay */}
      {cam.gridOn && cam.ready && (
        <div className="vf-grid" aria-hidden="true">
          <div /><div /><div /><div /><div /><div />
        </div>
      )}

      {/* Top bar */}
      <div className="vf-topbar">
        <button className="vf-icon-btn" aria-label="Go back" onClick={onBack}>
          <X size={22} />
        </button>
        <span className={`category-icon category-${category.id}`} style={{ width: 36, height: 36, borderRadius: 10 }}>
          <category.Icon size={18} />
        </span>
        <div className="vf-top-right">
          {cam.torchSupported && (
            <button
              className={`vf-icon-btn ${cam.torchOn ? 'vf-icon-btn--active' : ''}`}
              aria-label={cam.torchOn ? 'Turn off torch' : 'Turn on torch'}
              aria-pressed={cam.torchOn}
              onClick={() => void cam.toggleTorch()}
            >
              <Flashlight size={20} />
            </button>
          )}
          <button
            className={`vf-icon-btn ${cam.gridOn ? 'vf-icon-btn--active' : ''}`}
            aria-label={cam.gridOn ? 'Hide grid' : 'Show grid'}
            aria-pressed={cam.gridOn}
            onClick={cam.toggleGrid}
          >
            <Grid3x3 size={20} />
          </button>
        </div>
      </div>

      {/* GPS chip */}
      <div className="vf-gps-row">
        <GpsChip geo={geo} />
      </div>

      {/* Bottom controls */}
      <div className="vf-bottom">
        <button
          className="vf-flip-btn"
          aria-label="Flip camera"
          onClick={cam.flipCamera}
          disabled={!cam.ready}
        >
          <FlipHorizontal size={22} />
        </button>

        <div className="vf-shutter-wrap">
          <button
            id="shutter-btn"
            className="vf-shutter"
            aria-label="Take photo"
            disabled={!cam.ready}
            onClick={onCapture}
          >
            <span className="vf-shutter-inner" />
          </button>
          {cam.ready && geo.locating && (
            <p className="vf-shutter-hint">
              Acquiring GPS location…
            </p>
          )}
          {cam.ready && geo.error && (
            <p className="vf-shutter-hint">
              GPS unavailable
            </p>
          )}
        </div>

        <div style={{ width: 56 }} /> {/* spacer */}
      </div>
    </div>
  );
}

/* GPS chip component */
function GpsChip({ geo }: { geo: ReturnType<typeof useGeolocation> }) {
  if (geo.error) {
    return (
      <div className="gps-chip gps-chip--error">
        <WifiOff size={12} />
        {geo.error === 'denied' ? 'Location denied' : 'Location unavailable'}
      </div>
    );
  }
  const cls =
    geo.quality === 'good' ? 'gps-chip--good'
    : geo.quality === 'weak' ? 'gps-chip--weak'
    : 'gps-chip--locating';

  return (
    <div className={`gps-chip ${cls}`}>
      <MapPin size={12} />
      {geo.chipLabel}
    </div>
  );
}

/* Camera error screen */
function CameraErrorScreen({
  error,
  onBack,
  onRetry,
}: {
  error: ReturnType<typeof useCamera>['error'];
  onBack: () => void;
  onRetry: () => void;
}) {
  const info: Record<
    NonNullable<ReturnType<typeof useCamera>['error']>,
    { title: string; message: string; showRetry: boolean }
  > = {
    permission_denied: {
      title: 'Camera access denied',
      message:
        'To use the live camera, open your browser settings, find this site under Permissions, and allow camera access. Then tap Retry.',
      showRetry: true,
    },
    no_camera: {
      title: 'No camera found',
      message: "Your device doesn't appear to have an accessible camera. Try a different device.",
      showRetry: false,
    },
    camera_busy: {
      title: 'Camera in use',
      message: 'Another app is using your camera. Close it and tap Retry.',
      showRetry: true,
    },
    insecure_context: {
      title: 'Secure connection required',
      message: 'Camera access requires a secure (HTTPS) connection or localhost. Please open the app over HTTPS.',
      showRetry: false,
    },
    unknown: {
      title: 'Camera unavailable',
      message: 'Something went wrong starting the camera. Tap Retry or go back.',
      showRetry: true,
    },
  };

  if (!error) return null;
  const { title, message, showRetry } = info[error];

  return (
    <div className="cam-error-screen">
      <span className="cam-error-icon"><Camera size={40} /></span>
      <h1>{title}</h1>
      <p>{message}</p>
      <div className="cam-error-actions">
        {showRetry && (
          <Button onClick={onRetry}><RefreshCw size={16} /> Retry</Button>
        )}
        <Button variant="outline" onClick={onBack}><ArrowLeft size={16} /> Go back</Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Step: Preview ─────────────────────────── */

function PreviewStep({
  dataUrl,
  geo,
  address,
  onRetake,
  onUse,
}: {
  dataUrl: string;
  geo: {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    error: ReturnType<typeof useGeolocation>['error'];
    locating: boolean;
  };
  address: string;
  onRetake: () => void;
  onUse: () => void;
}) {
  const hasCoords = geo.latitude !== null && geo.longitude !== null;

  return (
    <div className="capture-page preview-page">
      <header className="capture-header">
        <Button variant="ghost" size="icon" aria-label="Retake photo" onClick={onRetake}>
          <ArrowLeft />
        </Button>
        <span className="eyebrow" style={{ fontSize: 10, letterSpacing: '1px' }}>PREVIEW</span>
        <div style={{ width: 44 }} />
      </header>
      <div className="preview-img-wrap">
        <img src={dataUrl} alt="Captured photo preview" className="preview-img" />
      </div>

      {/* GPS coordinates & accuracy directly below the captured photo */}
      <div className="preview-gps-bar" id="preview-gps-bar">
        {geo.locating ? (
          <div className="preview-gps-status preview-gps-status--loading">
            <Loader2 size={16} className="spin" />
            <span>Acquiring GPS location…</span>
          </div>
        ) : geo.error === 'denied' ? (
          <div className="preview-gps-status preview-gps-status--error">
            <AlertTriangle size={16} />
            <div>
              <strong>GPS access denied</strong>
              <span>Location permission was denied in your browser</span>
            </div>
          </div>
        ) : geo.error || !hasCoords ? (
          <div className="preview-gps-status preview-gps-status--error">
            <WifiOff size={16} />
            <div>
              <strong>GPS coordinates unavailable</strong>
              <span>Unable to obtain location fix for this photo</span>
            </div>
          </div>
        ) : (
          <div className="preview-gps-status preview-gps-status--success">
            <MapPin size={18} className="preview-gps-pin" />
            <div className="preview-gps-details">
              <div className="preview-gps-coords">
                <span className="preview-gps-latlng">
                  {geo.latitude! >= 0 ? `${geo.latitude!.toFixed(5)}° N` : `${Math.abs(geo.latitude!).toFixed(5)}° S`},{' '}
                  {geo.longitude! >= 0 ? `${geo.longitude!.toFixed(5)}° E` : `${Math.abs(geo.longitude!).toFixed(5)}° W`}
                </span>
                {geo.accuracy !== null && (
                  <span className="preview-gps-accuracy">
                    ±{Math.round(geo.accuracy)} m accuracy
                  </span>
                )}
              </div>
              {address && <span className="preview-gps-address">{address}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="preview-actions">
        <Button variant="outline" onClick={onRetake} className="preview-btn">
          <RotateCcw size={16} /> Retake
        </Button>
        <Button onClick={onUse} className="preview-btn preview-btn--use">
          Use photo <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────── Step: Details ─────────────────────────── */

function DetailsStep({
  dataUrl,
  category,
  selectedTask,
  geo,
  address,
  note,
  submitting = false,
  submitError = null,
  onNoteChange,
  onBack,
  onSubmit,
}: {
  dataUrl: string;
  category: CaptureCategory | null;
  selectedTask: Task | null;
  geo: {
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    error: ReturnType<typeof useGeolocation>['error'];
    locating: boolean;
  };
  address: string;
  note: string;
  submitting?: boolean;
  submitError?: string | null;
  onNoteChange: (v: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const [dismissSimilar, setDismissSimilar] = useState(false);

  const hasCoords = geo.latitude !== null && geo.longitude !== null;
  const canSubmit = Boolean(dataUrl && hasCoords && !submitting);

  // Simulate "similar report nearby" warning (random so it appears sometimes)
  const hasSimilarWarning = !dismissSimilar && hasCoords && (
    (Math.abs(geo.latitude! * 1000 % 1) < 0.4)
  );

  const lat = geo.latitude?.toFixed(5) ?? null;
  const lng = geo.longitude?.toFixed(5) ?? null;
  const displayAddress = address || (lat && lng ? `${lat}, ${lng}` : null);

  return (
    <div className="capture-page">
      <header className="capture-header">
        <Button variant="ghost" size="icon" aria-label="Go back" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <span style={{ fontWeight: 650, fontSize: 15 }}>Add details</span>
        <div style={{ width: 44 }} />
      </header>
      <div className="page-content" style={{ paddingTop: 16, paddingBottom: 120 }}>
        {selectedTask && (
          <div style={{ padding: '10px 14px', background: 'var(--secondary)', borderRadius: 12, marginBottom: 14 }}>
            <span className="eyebrow" style={{ fontSize: 9 }}>TASK TO VERIFY</span>
            <div style={{ fontWeight: 650, fontSize: 14, marginTop: 2 }}>{selectedTask.title}</div>
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>{selectedTask.location} · +{selectedTask.points} points</div>
          </div>
        )}

        {/* Thumbnail */}
        <div className="details-thumb-wrap">
          <img src={dataUrl} alt="Your capture" className="details-thumb" />
          {category && (
            <span className={`details-cat-badge category-${category.id}`}>
              <category.Icon size={13} /> {category.label}
            </span>
          )}
        </div>

        {/* Mini-map / address card */}
        <div className="details-map-card">
          <div className="details-map-visual">
            {hasCoords ? (
              <MapPin size={26} style={{ color: 'var(--primary)' }} />
            ) : (
              <WifiOff size={26} style={{ color: 'var(--muted-foreground)' }} />
            )}
          </div>
          <div className="details-map-text">
            <strong>Location</strong>
            {hasCoords ? (
              <>
                <span>{displayAddress}</span>
                {geo.accuracy !== null && (
                  <span className="details-acc">±{Math.round(geo.accuracy)} m accuracy (GPS verified)</span>
                )}
              </>
            ) : (
              <>
                <span style={{ color: 'var(--muted-foreground)' }}>
                  {geo.error === 'denied' ? 'Location permission denied' : 'No GPS coordinates obtained'}
                </span>
                <span className="details-acc" style={{ color: 'var(--destructive, #ef4444)' }}>GPS location required to submit</span>
              </>
            )}
          </div>
        </div>

        {/* Similar warning */}
        {hasSimilarWarning && (
          <div className="similar-warning">
            <AlertTriangle size={17} />
            <div>
              <strong>Similar report nearby</strong>
              <p>Someone may have reported this issue recently.</p>
            </div>
            <button className="similar-dismiss" onClick={() => setDismissSimilar(true)}>
              This is a different issue
            </button>
          </div>
        )}

        {/* Note */}
        <div className="details-note-wrap">
          <label className="field-label" htmlFor="capture-note">
            Add a note <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>(optional)</span>
          </label>
          <textarea
            id="capture-note"
            className="details-note"
            placeholder="Describe what you see (e.g. pothole near gate, depth ~15 cm)…"
            maxLength={200}
            rows={3}
            value={note}
            onChange={e => onNoteChange(e.target.value)}
          />
          <span className="note-counter">{note.length}/200</span>
        </div>
        {submitError && (
          <div style={{ padding: '10px 14px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--destructive, #ef4444)', borderRadius: 10, color: 'var(--destructive, #ef4444)', fontSize: 12, marginTop: 12 }}>
            <strong>Submission failed:</strong> {submitError}
          </div>
        )}
      </div>

      {/* Sticky submit */}
      <div className="sticky-action" style={{ bottom: 0 }}>
        <Button
          className="w-full"
          style={{ height: 52 }}
          onClick={onSubmit}
          disabled={!canSubmit}
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" /> Submitting report…
            </>
          ) : (
            <>
              <Check size={18} /> Submit report
            </>
          )}
        </Button>
        {!canSubmit && !submitting && (
          <p style={{ fontSize: 11, textAlign: 'center', marginTop: 8, color: 'var(--destructive, #ef4444)' }}>
            {!dataUrl ? 'Photo is required' : 'Acquiring GPS location… coordinates required'}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── Step: Success ─────────────────────────── */

function SuccessStep({
  submissionId,
  selectedTask,
  onDoAnother,
}: {
  submissionId: string;
  selectedTask: Task | null;
  onDoAnother: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="capture-page success-page">
      <div className="success-content">
        <div className="success-anim">
          <span className="success-ring" />
          <Check size={40} strokeWidth={3} color="var(--primary-foreground)" />
        </div>
        <span className="eyebrow" style={{ marginTop: 28, display: 'block' }}>SUBMITTED!</span>
        <h1 style={{ fontSize: 26, fontWeight: 650, margin: '10px 0 6px', lineHeight: 1.35 }}>
          Under review
        </h1>
        {selectedTask && (
          <p style={{ fontWeight: 600, fontSize: 13, color: 'var(--primary)', marginBottom: 8 }}>
            {selectedTask.title}
          </p>
        )}
        <p style={{ color: 'var(--muted-foreground)', fontSize: 12, lineHeight: 1.8, maxWidth: 280, margin: '0 auto 28px' }}>
          Your photo and GPS location have been recorded and are now under review. Usually verified within 24 hours.
        </p>
        <div className="success-actions">
          <Button
            className="w-full"
            onClick={() => void navigate({ to: '/submissions/$submissionId', params: { submissionId } })}
          >
            View submission <ChevronRight size={16} />
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void navigate({ to: '/submissions' })}
          >
            All submissions
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={onDoAnother}
          >
            <Camera size={16} /> Submit another report
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Reverse geocode ─────────────────────────── */

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    if (!res.ok) return null;
    const json = await res.json() as {
      display_name?: string;
      address?: {
        road?: string;
        suburb?: string;
        city?: string;
        state?: string;
      };
    };
    const a = json.address;
    if (!a) return json.display_name ?? null;
    const parts = [a.road, a.suburb, a.city].filter(Boolean);
    return parts.length ? parts.join(', ') : (json.display_name ?? null);
  } catch {
    return null;
  }
}

/* ─────────────────────────── Local submissions hook ─────────────────────────── */

export function useLocalSubmissions() {
  return useSyncExternalStore(
    submissionStore.subscribe,
    submissionStore.getSnapshot,
    submissionStore.getServerSnapshot,
  );
}
