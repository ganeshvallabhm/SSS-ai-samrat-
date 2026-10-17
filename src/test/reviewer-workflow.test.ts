import { describe, expect, it, beforeEach } from 'vitest';
import {
  MONTHLY_CAP,
  CATEGORY_DEFAULT_POINTS,
  getSnapshot,
  approveSubmission,
  rejectSubmission,
  resetWalletState,
} from '@/api';
import { submissionStore, type LocalSubmission } from '@/lib/submissionStore';

describe('Reviewer Portal and Complete Approval Workflow', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWalletState();
    submissionStore.clear();
  });

  it('completes the full approval lifecycle: submit with photo & GPS -> review -> approve -> wallet points awarded once', async () => {
    const initial = await getSnapshot();
    const initialBalance = initial.user.balance;
    const initialMonthly = initial.user.monthlyPoints;

    // 1. Citizen submits a task with photo and GPS coordinates
    const submissionId = `sub-civic-${Date.now()}`;
    const submission: LocalSubmission = {
      id: submissionId,
      taskId: 't2',
      taskTitle: 'Report a road that needs care',
      category: 'civic',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,road_pothole_proof_bytes',
      latitude: 17.4485,
      longitude: 78.3742,
      accuracy: 6.5,
      note: 'Deep pothole dangerous for two-wheelers',
      address: 'Madhapur Main Road, Hyderabad',
    };

    submissionStore.add(submission);

    // 2. Reviewer queue finds the pending submission
    const pendingList = submissionStore.getSnapshot().filter(s => s.status === 'under_review');
    const targetSub = pendingList.find(s => s.id === submissionId);
    expect(targetSub).toBeDefined();
    expect(targetSub?.photoDataUrl).toBe('data:image/jpeg;base64,road_pothole_proof_bytes');
    expect(targetSub?.latitude).toBe(17.4485);
    expect(targetSub?.longitude).toBe(78.3742);
    expect(targetSub?.accuracy).toBe(6.5);
    expect(targetSub?.status).toBe('under_review');

    // Wallet balance must NOT increase while pending
    const pendingSnapshot = await getSnapshot();
    expect(pendingSnapshot.user.balance).toBe(initialBalance);

    // 3. Reviewer approves the submission
    const approvalResult = await approveSubmission(submissionId, {
      category: 'civic',
      taskTitle: 'Report a road that needs care',
      points: CATEGORY_DEFAULT_POINTS.civic, // 20 points
    });

    expect(approvalResult.alreadyApproved).toBe(false);
    expect(approvalResult.pointsAwarded).toBe(20);

    // 4. Confirm submission status in store changed to approved
    const afterSub = submissionStore.getSnapshot().find(s => s.id === submissionId);
    expect(afterSub?.status).toBe('approved');
    expect(afterSub?.reviewedAt).toBeDefined();

    // 5. Confirm citizen wallet receives correct points exactly once
    const afterSnapshot = await getSnapshot();
    expect(afterSnapshot.user.balance).toBe(initialBalance + 20);
    expect(afterSnapshot.user.monthlyPoints).toBe(initialMonthly + 20);
    expect(afterSnapshot.transactions[0].id).toBe(`p-sub-${submissionId}`);
    expect(afterSnapshot.transactions[0].points).toBe(20);

    // 6. Confirm repeated approval click awards zero duplicate points (Idempotency)
    const duplicateResult = await approveSubmission(submissionId, {
      category: 'civic',
      taskTitle: 'Report a road that needs care',
      points: 20,
    });
    expect(duplicateResult.alreadyApproved).toBe(true);
    expect(duplicateResult.pointsAwarded).toBe(0);

    const afterDuplicateSnapshot = await getSnapshot();
    expect(afterDuplicateSnapshot.user.balance).toBe(initialBalance + 20);
  });

  it('rejects a submission with required reason and awards no points', async () => {
    const initial = await getSnapshot();
    const initialBalance = initial.user.balance;

    // 1. Citizen submits a task
    const rejectSubId = `sub-reject-${Date.now()}`;
    const submission: LocalSubmission = {
      id: rejectSubId,
      taskId: 't1',
      taskTitle: 'Plant 5 trees in park',
      category: 'green',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,blurry_photo',
      latitude: 17.4485,
      longitude: 78.3742,
      accuracy: 25.0,
      note: 'Tree planted',
    };
    submissionStore.add(submission);

    // 2. Rejecting without a reason must throw an error
    await expect(rejectSubmission(rejectSubId, '')).rejects.toThrow('A rejection reason is required.');
    await expect(rejectSubmission(rejectSubId, '   ')).rejects.toThrow('A rejection reason is required.');

    // 3. Reviewer provides a valid rejection reason
    const rejectionReason = 'Photograph is too blurry to identify saplings. Please resubmit with clear daytime photo.';
    const rejectResult = await rejectSubmission(rejectSubId, rejectionReason);

    expect(rejectResult.alreadyRejected).toBe(false);
    expect(rejectResult.submission.status).toBe('rejected');
    expect(rejectResult.submission.reason).toBe(rejectionReason);

    // 4. Verify submission in store is rejected with reason
    const localUpdated = submissionStore.getSnapshot().find(s => s.id === rejectSubId);
    expect(localUpdated?.status).toBe('rejected');
    expect(localUpdated?.reason).toBe(rejectionReason);
    expect(localUpdated?.reviewedAt).toBeDefined();

    // 5. Verify citizen wallet balance has NOT changed
    const afterSnapshot = await getSnapshot();
    expect(afterSnapshot.user.balance).toBe(initialBalance);

    // 6. Verify notification was sent to citizen
    const notification = afterSnapshot.notifications.find(n => n.submissionId === rejectSubId);
    expect(notification).toBeDefined();
    expect(notification?.type).toBe('rejected');
    expect(notification?.message).toContain(rejectionReason);
  });

  it('persists approved and rejected submissions and wallet balances in localStorage', async () => {
    // Submit, approve one, reject another
    const approvedId = 'sub-persist-app-1';
    const rejectedId = 'sub-persist-rej-1';

    submissionStore.add({
      id: approvedId,
      taskId: 't-health',
      taskTitle: 'Community Blood Drive',
      category: 'health',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,health_proof',
    });

    submissionStore.add({
      id: rejectedId,
      taskId: 't-gov',
      taskTitle: 'Civic Survey',
      category: 'governance',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,gov_proof',
    });

    await approveSubmission(approvedId, {
      category: 'health',
      points: 50,
      taskTitle: 'Community Blood Drive',
    });

    await rejectSubmission(rejectedId, 'Incomplete survey answers.');

    // Check localStorage persistence
    const storedSubs = JSON.parse(localStorage.getItem('civic_spark_local_submissions') || '[]');
    const storedApproved = storedSubs.find((s: LocalSubmission) => s.id === approvedId);
    const storedRejected = storedSubs.find((s: LocalSubmission) => s.id === rejectedId);

    expect(storedApproved?.status).toBe('approved');
    expect(storedRejected?.status).toBe('rejected');
    expect(storedRejected?.reason).toBe('Incomplete survey answers.');

    const storedWallet = JSON.parse(localStorage.getItem('civic_spark_wallet_state') || '{}');
    expect(storedWallet.user.balance).toBe(320 + 50); // initial 320 + 50
    expect(storedWallet.transactions.some((t: { id: string }) => t.id === `p-sub-${approvedId}`)).toBe(true);
  });

  it('enforces status transition guardrails: cannot approve a rejected submission or reject an approved submission', async () => {
    const subId = 'sub-guardrail-1';
    submissionStore.add({
      id: subId,
      taskId: 't2',
      taskTitle: 'Road audit',
      category: 'civic',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,guardrail_proof',
    });

    // 1. Reject first
    await rejectSubmission(subId, 'Photo unclear.');
    const rejectedSub = submissionStore.getSnapshot().find(s => s.id === subId);
    expect(rejectedSub?.status).toBe('rejected');

    // 2. Attempt to approve rejected submission -> MUST throw error
    await expect(approveSubmission(subId, { points: 20 })).rejects.toThrow(
      'Cannot approve a submission that has already been rejected.'
    );

    // 3. For an approved submission, attempting to reject -> MUST throw error
    const approvedSubId = 'sub-guardrail-2';
    submissionStore.add({
      id: approvedSubId,
      taskId: 't1',
      taskTitle: 'Tree drive',
      category: 'green',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,tree_proof',
    });

    await approveSubmission(approvedSubId, { category: 'green', points: 40 });
    await expect(rejectSubmission(approvedSubId, 'Changed mind')).rejects.toThrow(
      'Cannot reject a submission that has already been approved and rewarded.'
    );
  });

  it('prevents accidental duplicate submissions with the same task and photo within 60 seconds', () => {
    const first = submissionStore.add({
      id: 'sub-dup-first',
      taskId: 't2',
      taskTitle: 'Road pothole',
      category: 'civic',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,identical_photo_data',
    });

    // Duplicate submission within 60s
    const second = submissionStore.add({
      id: 'sub-dup-second',
      taskId: 't2',
      taskTitle: 'Road pothole',
      category: 'civic',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,identical_photo_data',
    });

    expect(second.id).toBe(first.id);
    expect(submissionStore.getSnapshot().filter(s => s.taskId === 't2')).toHaveLength(1);
  });
});
