import { describe, expect, it, beforeEach } from 'vitest';
import {
  MONTHLY_CAP,
  CATEGORY_DEFAULT_POINTS,
  getSnapshot,
  approveSubmission,
  resetWalletState,
  monthlyProgress,
} from '@/api';
import { submissionStore, type LocalSubmission } from '@/lib/submissionStore';

describe('Citizen Points Wallet Functional Specification', () => {
  beforeEach(() => {
    localStorage.clear();
    resetWalletState();
  });

  it('maintains a 500 points monthly earning limit and calculates progress', () => {
    expect(MONTHLY_CAP).toBe(500);
    expect(monthlyProgress(0)).toBe(0);
    expect(monthlyProgress(250)).toBe(50);
    expect(monthlyProgress(500)).toBe(100);
    expect(monthlyProgress(600)).toBe(100); // capped at 100%
  });

  it('keeps new task submissions under review with zero immediate points awarded', async () => {
    const initial = await getSnapshot();
    const initialBalance = initial.user.balance;
    const initialMonthly = initial.user.monthlyPoints;

    // Simulate citizen task submission
    const submissionId = `sub-test-${Date.now()}`;
    const newSubmission: LocalSubmission = {
      id: submissionId,
      taskId: 't-civic-1',
      taskTitle: 'Report damaged street light',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,samplephoto',
    };
    submissionStore.add(newSubmission);

    // Verify submission is under review
    const stored = submissionStore.getSnapshot().find(s => s.id === submissionId);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('under_review');

    // Balance must NOT increase upon submission
    const current = await getSnapshot();
    expect(current.user.balance).toBe(initialBalance);
    expect(current.user.monthlyPoints).toBe(initialMonthly);
  });

  it('awards configured category points upon approval (Civic: 20, Green: 40, Health: 50, Governance: 10)', async () => {
    expect(CATEGORY_DEFAULT_POINTS.civic).toBe(20);
    expect(CATEGORY_DEFAULT_POINTS.green).toBe(40);
    expect(CATEGORY_DEFAULT_POINTS.health).toBe(50);
    expect(CATEGORY_DEFAULT_POINTS.governance).toBe(10);

    const initial = await getSnapshot();
    const initialBalance = initial.user.balance;
    const initialMonthly = initial.user.monthlyPoints;

    // Create a local submission for Green Drive
    const subGreen: LocalSubmission = {
      id: 'sub-green-test-1',
      taskId: 't-green-1',
      taskTitle: 'Plant 5 trees in park',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,greendrive',
    };
    submissionStore.add(subGreen);

    // Approve the submission
    const result = await approveSubmission('sub-green-test-1', {
      category: 'green',
      taskTitle: 'Plant 5 trees in park',
    });

    expect(result.pointsAwarded).toBe(40);
    expect(result.alreadyApproved).toBe(false);

    // Verify user balance & monthly earned updated
    const after = await getSnapshot();
    expect(after.user.balance).toBe(initialBalance + 40);
    expect(after.user.monthlyPoints).toBe(initialMonthly + 40);

    // Verify submission store marked as approved
    const localUpdated = submissionStore.getSnapshot().find(s => s.id === 'sub-green-test-1');
    expect(localUpdated?.status).toBe('approved');
  });

  it('prevents duplicate point awards for the same approved submission', async () => {
    const subHealth: LocalSubmission = {
      id: 'sub-health-test-1',
      taskId: 't-health-1',
      taskTitle: 'Community Blood Donation Drive',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,healthcamp',
    };
    submissionStore.add(subHealth);

    // First approval
    const firstResult = await approveSubmission('sub-health-test-1', {
      category: 'health',
      taskTitle: 'Community Blood Donation Drive',
    });
    expect(firstResult.pointsAwarded).toBe(50);

    const afterFirst = await getSnapshot();
    const balanceAfterFirst = afterFirst.user.balance;

    // Second approval attempt for the exact same submission
    const secondResult = await approveSubmission('sub-health-test-1', {
      category: 'health',
      taskTitle: 'Community Blood Donation Drive',
    });
    expect(secondResult.pointsAwarded).toBe(0);
    expect(secondResult.alreadyApproved).toBe(true);

    // Balance must NOT have increased again
    const afterSecond = await getSnapshot();
    expect(afterSecond.user.balance).toBe(balanceAfterFirst);
  });

  it('enforces the monthly earning cap of 500 points', async () => {
    // Current monthly points in seed is 180, cap is 500 => room for 320 points
    const current = await getSnapshot();
    const remaining = MONTHLY_CAP - current.user.monthlyPoints;
    expect(remaining).toBe(320);

    // Try awarding 400 points
    const result = await approveSubmission('sub-large-audit', {
      points: 400,
      taskTitle: 'Major Civic Infrastructure Audit',
    });

    // Should only award up to remaining limit (320)
    expect(result.pointsAwarded).toBe(320);

    const afterCap = await getSnapshot();
    expect(afterCap.user.monthlyPoints).toBe(500);

    // Further approvals this month award 0 points due to cap
    const nextResult = await approveSubmission('sub-another-task', {
      points: 20,
      taskTitle: 'Pothole report',
    });
    expect(nextResult.pointsAwarded).toBe(0);
  });

  it('persists wallet state in localStorage across page reloads', async () => {
    await approveSubmission('sub-civic-audit-persist', {
      category: 'civic',
      taskTitle: 'Pothole repair verification',
    });

    const storedRaw = localStorage.getItem('civic_spark_wallet_state');
    expect(storedRaw).toBeTruthy();

    const parsed = JSON.parse(storedRaw!);
    expect(parsed.user.balance).toBe(340); // 320 initial + 20
    expect(parsed.user.monthlyPoints).toBe(200); // 180 initial + 20
    expect(parsed.transactions.some((t: { id: string }) => t.id === 'p-sub-sub-civic-audit-persist')).toBe(true);
  });
});
