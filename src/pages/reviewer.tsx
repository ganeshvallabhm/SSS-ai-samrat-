import { useQuery, useSuspenseQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, useSyncExternalStore } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  X,
  XCircle,
} from 'lucide-react';
import {
  approveSubmission,
  rejectSubmission,
  snapshotOptions,
  CATEGORY_DEFAULT_POINTS,
  MONTHLY_CAP,
  isBackendMode,
  fetchReviewerQueue,
  getSubmissionPhotoUrl,
} from '@/api';
import { Button } from '@/components/ui/button';
import {
  CategoryIcon,
  EmptyState,
  PageHeader,
  Points,
  StatusChip,
  VerifiedNote,
  categoryIcons,
  civicRoad,
  formatDate,
  planting,
} from '@/components/civic/shared';
import { submissionStore, type LocalSubmission } from '@/lib/submissionStore';
import type { Submission, Task, TaskCategory } from '@/types';

type FilterTab = 'under_review' | 'approved' | 'rejected' | 'all';
type CategoryFilter = 'all' | TaskCategory;

const QUICK_REJECTION_REASONS = [
  'Photo is blurry or not clear enough to verify task completion.',
  'Location metadata does not match the designated task site.',
  'Incomplete proof of civic work or activity.',
  'Photo appears to be duplicate or photographed from another screen.',
];

export function ReviewerPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(snapshotOptions);
  const [filter, setFilter] = useState<FilterTab>('under_review');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  // Reject modal state
  const [rejectingSub, setRejectingSub] = useState<LocalSubmission | Submission | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Photo modal preview state
  const [previewPhoto, setPreviewPhoto] = useState<{ url: string; title: string } | null>(null);

  const backendActive = isBackendMode();
  const { data: backendQueueData, error: queueError, refetch: refetchQueue } = useQuery({
    queryKey: ['reviewer-queue', filter, categoryFilter],
    queryFn: () => fetchReviewerQueue({ status: filter, category: categoryFilter }),
    enabled: backendActive,
  });

  // Subscribe to live local submission changes
  const localSubs = useSyncExternalStore(
    submissionStore.subscribe,
    submissionStore.getSnapshot,
    submissionStore.getServerSnapshot,
  );

  // Merge local submissions with server submissions; local first, deduped by ID
  const localIds = new Set(localSubs.map(s => s.id));
  const allSubmissions: (LocalSubmission | Submission)[] = backendActive && backendQueueData?.items
    ? backendQueueData.items
    : [
        ...localSubs,
        ...data.submissions.filter(s => !localIds.has(s.id)),
      ];

  const pendingCount = allSubmissions.filter(s => s.status === 'under_review').length;
  const approvedCount = allSubmissions.filter(s => s.status === 'approved').length;
  const rejectedCount = allSubmissions.filter(s => s.status === 'rejected').length;

  const getTaskInfo = (sub: any): {
    title: string;
    category: TaskCategory;
    points: number;
    location: string;
  } => {
    const matched = data.tasks.find(t => t.id === sub.taskId);
    const local = sub as LocalSubmission;
    const category = (sub.task?.category || local.category || matched?.category || 'civic') as TaskCategory;
    const title = sub.task?.title || local.taskTitle || matched?.title || 'Community Civic Action';
    const points = sub.task?.points ?? matched?.points ?? CATEGORY_DEFAULT_POINTS[category] ?? 20;
    const location = sub.task?.location || local.address || sub.address || matched?.location || 'Ward 102, Hyderabad';
    return { title, category, points, location };
  };

  const filteredSubmissions = allSubmissions.filter(s => {
    if (filter !== 'all' && s.status !== filter) return false;
    if (categoryFilter !== 'all') {
      const taskInfo = getTaskInfo(s);
      if (taskInfo.category !== categoryFilter) return false;
    }
    return true;
  });

  const handleApprove = async (sub: LocalSubmission | Submission) => {
    if (busyId) return; // Prevent concurrent requests
    setBusyId(sub.id);
    setFeedback(null);

    const taskInfo = getTaskInfo(sub);
    try {
      const result = await approveSubmission(sub.id, {
        points: taskInfo.points,
        category: taskInfo.category,
        taskTitle: taskInfo.title,
        taskId: sub.taskId,
      });

      // Synchronize QueryClient data across wallet, queue and snapshot
      await queryClient.invalidateQueries({ queryKey: ['civic-app'] });
      await queryClient.invalidateQueries({ queryKey: ['reviewer-queue'] });

      if (result.alreadyApproved) {
        setFeedback({
          type: 'info',
          message: `Submission was already approved. Citizen balance is ${result.balance ?? 'unchanged'}.`,
        });
      } else {
        const pts = result.pointsAwarded ?? taskInfo.points;
        setFeedback({
          type: 'success',
          message: `Approved successfully! Awarded +${pts} pts to citizen's wallet.`,
        });
      }
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to approve submission.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const openRejectDialog = (sub: LocalSubmission | Submission) => {
    setRejectingSub(sub);
    setRejectionReason('');
    setRejectError('');
  };

  const handleConfirmReject = async () => {
    if (!rejectingSub) return;
    if (!rejectionReason.trim()) {
      setRejectError('Please enter a rejection reason for the citizen.');
      return;
    }

    setBusyId(rejectingSub.id);
    setRejectError('');
    setFeedback(null);

    try {
      await rejectSubmission(rejectingSub.id, rejectionReason.trim());
      await queryClient.invalidateQueries({ queryKey: ['civic-app'] });
      await queryClient.invalidateQueries({ queryKey: ['reviewer-queue'] });

      setFeedback({
        type: 'success',
        message: `Submission rejected. Rejection reason has been recorded and notified to the citizen.`,
      });
      setRejectingSub(null);
      setRejectionReason('');
    } catch (err: unknown) {
      setRejectError(err instanceof Error ? err.message : 'Failed to reject submission.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="reviewer-page">
      <PageHeader title="Reviewer Portal" back="/profile" />

      <div className="page-content">
        {/* Demo Reviewer Disclaimer */}
        <div className="reviewer-demo-banner">
          <div className="demo-banner-header">
            <span className="demo-tag">DEMO REVIEWER</span>
            <span className="demo-live-badge">Interactive Evaluation Mode</span>
          </div>
          <p>
            Verify live citizen submissions with captured photographs and GPS metadata. Approvals
            award category points to the citizen&apos;s wallet and enforce the 500-point monthly cap.
          </p>
          <div className="reviewer-summary-chips">
            <span><b>Civic Audit:</b> 20 pts</span>
            <span><b>Green Drive:</b> 40 pts</span>
            <span><b>Health Camp:</b> 50 pts</span>
            <span><b>Governance:</b> 10 pts</span>
          </div>
        </div>

        {queueError && (
          <div style={{ padding: '12px 16px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--destructive, #ef4444)', borderRadius: 12, color: 'var(--destructive, #ef4444)', fontSize: 13, marginBottom: 16 }}>
            <strong>Reviewer Authorization Required:</strong> {queueError instanceof Error ? queueError.message : 'Failed to load reviewer queue.'}
            <p style={{ margin: '6px 0 0 0', fontSize: 11, color: 'var(--muted-foreground)' }}>
              A reviewer or admin account is required (e.g. Priya Sharma 9800000001). Citizens are not permitted to audit queue records.
            </p>
          </div>
        )}

        {/* Global Feedback Banner */}
        {feedback && (
          <div className={`reviewer-feedback feedback-${feedback.type}`} role="status">
            {feedback.type === 'success' && <CheckCircle2 size={18} />}
            {feedback.type === 'error' && <AlertCircle size={18} />}
            {feedback.type === 'info' && <ShieldCheck size={18} />}
            <div className="feedback-content">
              <span>{feedback.message}</span>
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="feedback-dismiss"
              aria-label="Dismiss message"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Status Filter Tabs */}
        <div className="reviewer-tabs" role="tablist" aria-label="Submission filter">
          <button
            role="tab"
            aria-selected={filter === 'under_review'}
            className={`reviewer-tab ${filter === 'under_review' ? 'active' : ''}`}
            onClick={() => setFilter('under_review')}
          >
            Pending <span className="tab-badge">{pendingCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={filter === 'approved'}
            className={`reviewer-tab ${filter === 'approved' ? 'active' : ''}`}
            onClick={() => setFilter('approved')}
          >
            Approved <span className="tab-badge">{approvedCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={filter === 'rejected'}
            className={`reviewer-tab ${filter === 'rejected' ? 'active' : ''}`}
            onClick={() => setFilter('rejected')}
          >
            Rejected <span className="tab-badge">{rejectedCount}</span>
          </button>
          <button
            role="tab"
            aria-selected={filter === 'all'}
            className={`reviewer-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All <span className="tab-badge">{allSubmissions.length}</span>
          </button>
        </div>

        {/* Category Filter Chips */}
        <div className="reviewer-category-filters" role="group" aria-label="Filter by task category">
          <Button
            size="sm"
            variant={categoryFilter === 'all' ? 'default' : 'outline'}
            className="reviewer-cat-chip"
            onClick={() => setCategoryFilter('all')}
          >
            All Categories
          </Button>
          {(['civic', 'green', 'health', 'governance'] as const).map(cat => (
            <Button
              key={cat}
              size="sm"
              variant={categoryFilter === cat ? 'default' : 'outline'}
              className="reviewer-cat-chip"
              onClick={() => setCategoryFilter(cat)}
            >
              <CategoryIcon category={cat} />
              {cat === 'civic'
                ? 'Civic Audit'
                : cat === 'green'
                  ? 'Green Drive'
                  : cat === 'health'
                    ? 'Health Camp'
                    : 'Local Governance'}
            </Button>
          ))}
        </div>

        {/* Submissions Queue */}
        <div className="reviewer-queue">
          {filteredSubmissions.length === 0 ? (
            <div className="reviewer-empty">
              <EmptyState
                title={
                  filter === 'under_review'
                    ? 'All caught up! No pending submissions'
                    : `No ${filter} submissions found`
                }
                message={
                  filter === 'under_review'
                    ? 'Submit a new task with camera capture and GPS coordinates from the citizen interface to see it here.'
                    : 'Items will appear here once processed by a reviewer.'
                }
              >
                <div className="empty-actions">
                  <Button asChild size="sm">
                    <Link to="/capture">
                      <Camera size={14} /> Capture New Task
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link to="/wallet">
                      <Sprout size={14} /> View Citizen Wallet
                    </Link>
                  </Button>
                </div>
              </EmptyState>
            </div>
          ) : (
            filteredSubmissions.map(sub => {
              const local = sub as LocalSubmission;
              const taskInfo = getTaskInfo(sub);
              const isPending = sub.status === 'under_review';
              const isApproved = sub.status === 'approved';
              const isRejected = sub.status === 'rejected';

              const subAny = sub as any;
              const photoSrc =
                subAny.photoUrl
                  ? getSubmissionPhotoUrl(subAny.photoUrl)
                  : local.photoDataUrl ||
                    (sub.taskId === 't2' ? civicRoad : planting);

              return (
                <article key={sub.id} className={`reviewer-card card-status-${sub.status}`}>
                  {/* Card Header: Category & Status */}
                  <div className="reviewer-card-top">
                    <div className="reviewer-category-group">
                      <CategoryIcon category={taskInfo.category} />
                      <div>
                        <span className="reviewer-category-name">
                          {taskInfo.category.toUpperCase()}
                        </span>
                        <h3 className="reviewer-task-title">{taskInfo.title}</h3>
                      </div>
                    </div>
                    <div className="reviewer-status-group">
                      <StatusChip status={sub.status} />
                      <Points amount={taskInfo.points} />
                    </div>
                  </div>

                  {/* Photograph Section */}
                  <div className="reviewer-photo-section">
                    <div
                      className="reviewer-photo-frame"
                      onClick={() => setPreviewPhoto({ url: photoSrc, title: taskInfo.title })}
                      role="button"
                      tabIndex={0}
                      title="Click to zoom photograph"
                    >
                      <img
                        src={photoSrc}
                        alt={`Proof for ${taskInfo.title}`}
                        className="reviewer-photo-img"
                      />
                      <span className="reviewer-photo-badge">
                        {local.photoDataUrl ? (
                          <>
                            <Camera size={12} /> Live Captured Proof
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={12} /> Seed Demonstration Photo
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Metadata Grid: GPS, Accuracy, Date, Note */}
                  <div className="reviewer-metadata-grid">
                    {/* Location & GPS */}
                    <div className="metadata-item location-item">
                      <div className="metadata-label">
                        <MapPin size={12} /> Location &amp; GPS Coordinates
                      </div>
                      <div className="metadata-value">
                        {(local.latitude !== undefined && local.longitude !== undefined) || (subAny.lat !== undefined && subAny.lng !== undefined) ? (
                          <>
                            <strong>
                              {Number(local.latitude ?? subAny.lat) >= 0
                                ? `${Number(local.latitude ?? subAny.lat).toFixed(5)}° N`
                                : `${Math.abs(Number(local.latitude ?? subAny.lat)).toFixed(5)}° S`}
                              ,{' '}
                              {Number(local.longitude ?? subAny.lng) >= 0
                                ? `${Number(local.longitude ?? subAny.lng).toFixed(5)}° E`
                                : `${Math.abs(Number(local.longitude ?? subAny.lng)).toFixed(5)}° W`}
                            </strong>
                            <div className="metadata-sub">
                              {local.accuracy !== undefined || subAny.accuracy !== undefined ? (
                                <span className="gps-accuracy-chip">
                                  Reported Accuracy: ±{Math.round(Number(local.accuracy ?? subAny.accuracy))} m
                                </span>
                              ) : null}
                              {(local.address || subAny.address) && <span className="gps-address">{local.address || subAny.address}</span>}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted">
                            {local.address || subAny.address || taskInfo.location} (No live GPS tags)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Submitted At */}
                    <div className="metadata-item">
                      <div className="metadata-label">
                        <Clock3 size={12} /> Submission Date &amp; Time
                      </div>
                      <div className="metadata-value">
                        {new Date(sub.submittedAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        <span className="metadata-sub">ID: #{sub.id}</span>
                      </div>
                    </div>

                    {/* Citizen Note */}
                    {local.note && (
                      <div className="metadata-item note-item">
                        <div className="metadata-label">Citizen Note</div>
                        <p className="metadata-note-text">&ldquo;{local.note}&rdquo;</p>
                      </div>
                    )}

                    {/* Rejection Note if Rejected */}
                    {isRejected && sub.reason && (
                      <div className="metadata-item rejection-box">
                        <div className="metadata-label rejection-label">
                          <XCircle size={12} /> Rejection Reason
                        </div>
                        <p className="rejection-text">{sub.reason}</p>
                        {sub.reviewedAt && (
                          <span className="metadata-sub">
                            Reviewed on {formatDate(sub.reviewedAt)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Approved Note if Approved */}
                    {isApproved && (
                      <div className="metadata-item approval-box">
                        <div className="metadata-label approval-label">
                          <CheckCircle2 size={12} /> Verified &amp; Rewarded
                        </div>
                        <p className="approval-text">
                          +{taskInfo.points} points awarded to citizen wallet.
                        </p>
                        {sub.reviewedAt && (
                          <span className="metadata-sub">
                            Approved on {formatDate(sub.reviewedAt)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons for Pending Review */}
                  {isPending && (
                    <div className="reviewer-actions">
                      <Button
                        className="reviewer-btn-approve"
                        onClick={() => handleApprove(sub)}
                        disabled={busyId === sub.id}
                      >
                        {busyId === sub.id ? (
                          <>
                            <RefreshCw size={14} className="animate-spin" /> Approving…
                          </>
                        ) : (
                          <>
                            <CheckCircle2 size={15} /> Approve (+{taskInfo.points} pts)
                          </>
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        className="reviewer-btn-reject"
                        onClick={() => openRejectDialog(sub)}
                        disabled={busyId === sub.id}
                      >
                        <XCircle size={15} /> Reject…
                      </Button>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>

        <VerifiedNote>Reviewer Portal · SSS Civic Tech Evaluation Sandbox</VerifiedNote>
      </div>

      {/* Reject Modal / Bottom Sheet */}
      {rejectingSub && (
        <div className="reviewer-modal-overlay" onClick={() => setRejectingSub(null)}>
          <div
            className="reviewer-modal-content"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-dialog-title"
          >
            <div className="reviewer-modal-header">
              <div className="modal-title-wrap">
                <ShieldAlert size={20} className="text-danger" />
                <h2 id="reject-dialog-title">Reject Submission</h2>
              </div>
              <button
                onClick={() => setRejectingSub(null)}
                className="modal-close-btn"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>

            <p className="modal-subtitle">
              Provide feedback for submission #{rejectingSub.id}. No points will be awarded. The citizen
              will be informed and given the opportunity to resubmit.
            </p>

            {/* Quick Reason Chips */}
            <div className="quick-reasons-block">
              <span className="quick-reasons-title">Quick reason templates:</span>
              <div className="quick-chips">
                {QUICK_REJECTION_REASONS.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    className="quick-chip"
                    onClick={() => setRejectionReason(r)}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason Textarea */}
            <div className="modal-field">
              <label htmlFor="rejection-reason-input" className="field-label">
                Rejection reason <b>(required)</b>:
              </label>
              <textarea
                id="rejection-reason-input"
                className="reason-textarea"
                rows={3}
                placeholder="Explain why this submission does not meet verification requirements…"
                value={rejectionReason}
                onChange={e => setRejectionReason(e.target.value)}
              />
            </div>

            {rejectError && (
              <div className="modal-error">
                <AlertCircle size={14} />
                <span>{rejectError}</span>
              </div>
            )}

            <div className="modal-actions">
              <Button
                variant="ghost"
                onClick={() => setRejectingSub(null)}
                disabled={busyId === rejectingSub.id}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmReject}
                disabled={!rejectionReason.trim() || busyId === rejectingSub.id}
              >
                {busyId === rejectingSub.id ? 'Rejecting…' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Preview Modal */}
      {previewPhoto && (
        <div className="reviewer-photo-modal" onClick={() => setPreviewPhoto(null)}>
          <div className="photo-modal-card" onClick={e => e.stopPropagation()}>
            <div className="photo-modal-header">
              <span>{previewPhoto.title}</span>
              <button onClick={() => setPreviewPhoto(null)} aria-label="Close photo">
                <X size={18} />
              </button>
            </div>
            <img src={previewPhoto.url} alt={previewPhoto.title} />
          </div>
        </div>
      )}
    </div>
  );
}
