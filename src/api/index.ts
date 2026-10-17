import { queryOptions } from '@tanstack/react-query';
import { mockData } from '@/data/mock';
import type { AppSnapshot, PointsTransaction, Redemption, Submission, Task, TaskCategory, User } from '@/types';
import { submissionStore, type LocalSubmission } from '@/lib/submissionStore';
import { isBackendMode, getApiConfig, setBackendMode } from './config';
import {
  apiFetch,
  ApiError,
  getAccessToken,
  getAuthUser,
  setAuthSession,
  clearAuthSession,
} from './client';

export { isBackendMode, getApiConfig, setBackendMode, getAccessToken, getAuthUser, clearAuthSession, ApiError };

export const MONTHLY_CAP = 500;
export const OTP_RESEND_SECONDS = 30;

export const CATEGORY_DEFAULT_POINTS: Record<TaskCategory, number> = {
  civic: 20,
  green: 40,
  health: 50,
  governance: 10,
};

const WALLET_STORAGE_KEY = 'civic_spark_wallet_state';

function loadPersistedState(): AppSnapshot {
  const base = structuredClone(mockData);
  if (typeof window === 'undefined') return base;
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      ...base,
      user: { ...base.user, ...(parsed.user || {}) },
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : base.transactions,
      redemptions: Array.isArray(parsed.redemptions) ? parsed.redemptions : base.redemptions,
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : base.notifications,
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : base.submissions,
    };
  } catch {
    return base;
  }
}

function persistState(s: AppSnapshot) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({
      user: s.user,
      transactions: s.transactions,
      redemptions: s.redemptions,
      notifications: s.notifications,
      submissions: s.submissions,
    }));
  } catch {
    // Ignore storage quota limits
  }
}

let state: AppSnapshot = loadPersistedState();

export function resetWalletState(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
  state = structuredClone(mockData);
}

export const delay = () => new Promise<void>(resolve => setTimeout(resolve, 500));
export function monthlyProgress(points: number) { return Math.min(100, Math.max(0, points / MONTHLY_CAP * 100)); }
export function canRedeem(balance: number, cost: number) { return cost > 0 && balance >= cost; }
export function validOtp(code: string) { return /^\d{6}$/.test(code); }

export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const b64 = parts[1] || '';
  const byteString = atob(b64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mime });
}

export function getSubmissionPhotoUrl(photoUrlOrPath: string): string {
  if (!photoUrlOrPath) return '';
  if (photoUrlOrPath.startsWith('data:')) {
    return photoUrlOrPath;
  }
  const { baseUrl } = getApiConfig();
  const rootUrl = baseUrl.replace(/\/api\/v1\/?$/, '');
  let path = photoUrlOrPath;
  if (!path.includes('/')) {
    // Passed a submission ID directly
    path = `/api/v1/submissions/${photoUrlOrPath}/photo`;
  } else if (!path.startsWith('http')) {
    path = path.startsWith('/') ? path : `/${path}`;
    if (!path.startsWith('/api/v1')) {
      path = `/api/v1${path}`;
    }
  }
  const token = getAccessToken();
  if (path.startsWith('http')) {
    return token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : path;
  }
  const full = `${rootUrl}${path}`;
  return token ? `${full}?token=${encodeURIComponent(token)}` : full;
}

export async function getSnapshot(): Promise<AppSnapshot> {
  if (!isBackendMode()) {
    await delay();
    return structuredClone(state);
  }

  const token = getAccessToken();
  const authUser = getAuthUser();

  // In backend mode, tasks must come from backend. If backend fails, propagate ApiError (never silent fallback)
  const tasksRes = await apiFetch<any>('/tasks', {
    requiresAuth: !!token,
  });
  const taskList = Array.isArray(tasksRes) ? tasksRes : tasksRes?.items || [];
  const tasks: Task[] = taskList.map((t: any) => ({
    id: String(t.id),
    title: t.title,
    category: t.category,
    points: t.points,
    distance: t.distance ?? 0,
    location: t.location || '',
    description: t.description || '',
    requirements: t.requirements || [],
    date: t.date || new Date().toISOString().slice(0, 10),
  }));

  let balance = 0;
  let monthlyPoints = 0;
  let liveTransactions: PointsTransaction[] = [];
  let liveSubmissions: Submission[] = [];

  if (token) {
    // 1. Fetch live wallet balance from backend
    const walletRes = await apiFetch<{
      balance: number;
      monthlyPoints: number;
      monthlyCap: number;
      monthlyProgressPercent: number;
    }>('/wallet');
    balance = walletRes.balance;
    monthlyPoints = walletRes.monthlyPoints;

    // 2. Fetch live immutable transactions from backend
    const txRes = await apiFetch<{ items: any[]; meta: any }>('/wallet/transactions');
    liveTransactions = (txRes?.items || []).map(tx => ({
      id: tx.id,
      title: tx.title,
      points: tx.points,
      date: tx.date,
      type: tx.type,
    }));

    // 3. Fetch submissions for citizen
    if (!authUser?.role || authUser.role === 'citizen') {
      try {
        const subRes = await apiFetch<{ items: any[]; meta: any }>('/submissions/mine');
        liveSubmissions = (subRes?.items || []).map(s => ({
          id: String(s.id),
          taskId: String(s.taskId),
          status: s.status,
          submittedAt: s.submittedAt,
          reviewedAt: s.reviewedAt,
          reason: s.reason,
        }));
      } catch (err) {
        console.error('Failed to load my submissions:', err);
      }
    }
  }

  const user: User = {
    id: authUser?.id ? String(authUser.id) : 'u-live',
    name: authUser?.name || (token ? 'Civic Citizen' : 'Guest Citizen'),
    phone: authUser?.phone || '',
    ward: 'Ward 104',
    city: 'Hyderabad',
    balance,
    monthlyPoints,
  };

  return {
    user,
    tasks,
    submissions: liveSubmissions,
    transactions: liveTransactions,
    vouchers: mockData.vouchers,
    redemptions: state.redemptions,
    notifications: state.notifications,
  };
}

export const snapshotOptions = queryOptions({
  queryKey: ['civic-app'],
  queryFn: getSnapshot,
  staleTime: 10_000,
});

export async function sendOtp(phone: string): Promise<{ sent: boolean; message?: string }> {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  if (digits.length !== 10) {
    throw new Error('Enter a valid 10-digit mobile number.');
  }

  if (!isBackendMode()) {
    await delay();
    return { sent: true };
  }

  const res = await apiFetch<{ message: string; expiresInSeconds: number }>('/auth/otp/request', {
    method: 'POST',
    requiresAuth: false,
    body: { phone: `+91${digits}` },
  });

  return { sent: true, message: res.message };
}

export async function verifyOtp(phone: string, code: string): Promise<User> {
  if (!validOtp(code)) {
    throw new Error('Enter all six digits.');
  }

  let digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  if (!isBackendMode()) {
    await delay();
    state.user.phone = digits;
    persistState(state);
    return structuredClone(state.user);
  }

  const res = await apiFetch<{
    access_token?: string;
    accessToken?: string;
    refresh_token?: string;
    refreshToken?: string;
    user: { id: string | number; phone: string; name?: string; role?: string; language?: string };
  }>('/auth/otp/verify', {
    method: 'POST',
    requiresAuth: false,
    body: {
      phone: `+91${digits}`,
      code,
    },
  });

  const accessToken = res.accessToken || res.access_token || '';
  const refreshToken = res.refreshToken || res.refresh_token || '';

  setAuthSession({
    accessToken,
    refreshToken,
    user: res.user,
  });

  const updatedUser: User = {
    id: String(res.user.id),
    name: res.user.name || 'Citizen User',
    phone: res.user.phone,
    ward: 'Ward 104',
    city: 'Hyderabad',
    balance: 0,
    monthlyPoints: 0,
  };

  return updatedUser;
}

export async function acceptConsent(): Promise<{ accepted: boolean }> {
  await delay();
  return { accepted: true };
}

export async function logOut(): Promise<{ signedOut: boolean }> {
  if (isBackendMode()) {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    clearAuthSession();
  }
  return { signedOut: true };
}

export async function markNotificationsRead(): Promise<void> {
  await delay();
  state.notifications.forEach(n => (n.read = true));
  persistState(state);
}

export async function redeemVoucher(voucherId: string, brand: Redemption['brand']): Promise<Redemption> {
  await delay();
  const voucher = state.vouchers.find(v => v.id === voucherId);
  if (!voucher || !voucher.brands.includes(brand)) throw new Error('This voucher is not available.');
  if (!canRedeem(state.user.balance, voucher.cost)) throw new Error('You need a few more points for this voucher.');
  const now = new Date();
  const expiry = new Date(now);
  expiry.setFullYear(expiry.getFullYear() + 1);
  const id = `r-${crypto.randomUUID()}`;
  const redemption: Redemption = {
    id,
    brand,
    value: voucher.value,
    cost: voucher.cost,
    code: `SSS-DEMO-${brand === 'Amazon' ? 'AMZ' : 'FLK'}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    redeemedAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
  };
  state.user.balance -= voucher.cost;
  state.redemptions.unshift(redemption);
  state.transactions.unshift({
    id: `p-${id}`,
    title: `${brand} ₹${voucher.value} voucher`,
    points: -voucher.cost,
    type: 'redeemed',
    date: now.toISOString(),
  });
  state.notifications.unshift({
    id: `n-${id}`,
    title: `Your ${brand} voucher is ready`,
    message: `Your ₹${voucher.value} gift voucher is ready to reveal.`,
    type: 'voucher_ready',
    date: now.toISOString(),
    read: false,
    redemptionId: id,
  });
  persistState(state);
  return structuredClone(redemption);
}

export async function createBackendSubmission(params: {
  photoDataUrl: string;
  lat: number;
  lng: number;
  accuracy: number;
  categoryId: string;
  taskId: string;
  note?: string;
  address?: string;
}): Promise<any> {
  const formData = new FormData();
  const blob = dataUrlToBlob(params.photoDataUrl);
  formData.append('photo', blob, 'capture.jpg');
  formData.append('lat', String(params.lat));
  formData.append('lng', String(params.lng));
  formData.append('accuracy', String(params.accuracy));
  formData.append('timestamp', new Date().toISOString());
  formData.append('categoryId', params.categoryId);
  formData.append('taskId', params.taskId);
  if (params.note) formData.append('note', params.note);
  if (params.address) formData.append('address', params.address);

  return await apiFetch('/submissions', {
    method: 'POST',
    body: formData,
  });
}

export async function fetchReviewerQueue(options?: {
  status?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<any> {
  if (!isBackendMode()) {
    const local = submissionStore.getSnapshot();
    let filtered = local;
    if (options?.status && options.status !== 'all') {
      filtered = filtered.filter(s => s.status === options.status);
    }
    if (options?.category && options.category !== 'all') {
      filtered = filtered.filter(s => s.category === options.category);
    }
    return { items: filtered, meta: { totalItems: filtered.length, totalPages: 1 } };
  }

  const query = new URLSearchParams();
  if (options?.status && options.status !== 'all') query.set('status', options.status);
  if (options?.category && options.category !== 'all') query.set('category', options.category);
  if (options?.page) query.set('page', String(options.page));
  if (options?.limit) query.set('limit', String(options.limit));

  const qs = query.toString();
  return await apiFetch(`/reviewer/queue${qs ? `?${qs}` : ''}`);
}

export async function fetchSubmissionDetail(submissionId: string): Promise<any> {
  if (!isBackendMode()) {
    const local = submissionStore.getSnapshot().find(s => s.id === submissionId);
    if (local) return local;
    return state.submissions.find(s => s.id === submissionId);
  }

  const authUser = getAuthUser();
  const endpoint =
    authUser?.role === 'reviewer' || authUser?.role === 'admin'
      ? `/reviewer/submissions/${submissionId}`
      : `/submissions/${submissionId}`;

  return await apiFetch(endpoint);
}

export async function approveSubmission(
  submissionId: string,
  options?: { points?: number; category?: TaskCategory; taskTitle?: string; taskId?: string }
): Promise<any> {
  if (isBackendMode()) {
    const res = await apiFetch<any>(`/reviewer/submissions/${submissionId}/review`, {
      method: 'POST',
      body: {
        decision: 'approve',
        points: options?.points,
        internalNotes: 'Approved via Reviewer Portal',
      },
    });
    return {
      alreadyApproved: false,
      pointsAwarded: res.pointsAwarded ?? res.points_awarded ?? res.awarded_points ?? res.awardedPoints ?? 0,
      submission: res,
    };
  }

  await delay();
  const subInState = state.submissions.find(s => s.id === submissionId);
  const localSubs = typeof window !== 'undefined' ? submissionStore.getSnapshot() : [];
  const subInLocal = localSubs.find(s => s.id === submissionId);

  let sub = subInState || subInLocal;
  if (!sub && options) {
    sub = {
      id: submissionId,
      taskId: options.taskId || 't-demo',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
    };
    state.submissions.unshift(sub);
  } else if (!sub) {
    throw new Error(`Submission ${submissionId} not found.`);
  }

  // Enforce valid status transitions
  if (sub.status === 'rejected') {
    throw new Error('Cannot approve a submission that has already been rejected.');
  }

  // Idempotency: avoid duplicate point awards for the same approved submission
  if (sub.status === 'approved') {
    return { alreadyApproved: true, pointsAwarded: 0, balance: state.user.balance, monthlyPoints: state.user.monthlyPoints };
  }

  const existingTx = state.transactions.find(t => t.id === `p-sub-${submissionId}`);
  if (existingTx) {
    sub.status = 'approved';
    return { alreadyApproved: true, pointsAwarded: 0, balance: state.user.balance, monthlyPoints: state.user.monthlyPoints };
  }

  const task = state.tasks.find(t => t.id === sub.taskId);
  const category = (options?.category || task?.category || (sub as any).category || 'civic') as TaskCategory;
  const basePoints = options?.points ?? (task?.points ?? CATEGORY_DEFAULT_POINTS[category] ?? 20);

  // Enforce monthly limit (500 pts max)
  const remainingMonthly = Math.max(0, MONTHLY_CAP - state.user.monthlyPoints);
  const pointsAwarded = Math.min(basePoints, remainingMonthly);

  const now = new Date();
  sub.status = 'approved';
  sub.reviewedAt = now.toISOString();

  if (subInLocal) {
    submissionStore.updateStatus(submissionId, 'approved', now.toISOString());
  }
  if (!subInState) {
    state.submissions.unshift({
      id: sub.id,
      taskId: sub.taskId,
      status: 'approved',
      submittedAt: sub.submittedAt,
      reviewedAt: now.toISOString(),
    });
  }

  if (pointsAwarded > 0) {
    state.user.balance += pointsAwarded;
    state.user.monthlyPoints += pointsAwarded;

    state.transactions.unshift({
      id: `p-sub-${submissionId}`,
      title: options?.taskTitle || (sub as any).taskTitle || (task ? `${task.title} approved` : 'Task approved'),
      points: pointsAwarded,
      type: 'earned',
      date: now.toISOString(),
    });

    state.notifications.unshift({
      id: `n-sub-${submissionId}`,
      title: 'Your task is approved',
      message: `${pointsAwarded} points have been added to your wallet.`,
      type: 'approved',
      date: now.toISOString(),
      submissionId: sub.id,
      read: false,
    });
  }

  persistState(state);
  return {
    alreadyApproved: false,
    pointsAwarded,
    balance: state.user.balance,
    monthlyPoints: state.user.monthlyPoints,
  };
}

export async function rejectSubmission(submissionId: string, reason: string): Promise<any> {
  const trimmedReason = reason?.trim();
  if (!trimmedReason) {
    throw new Error('A rejection reason is required.');
  }

  if (isBackendMode()) {
    const res = await apiFetch<any>(`/reviewer/submissions/${submissionId}/review`, {
      method: 'POST',
      body: {
        decision: 'reject',
        reason: trimmedReason,
        internalNotes: 'Rejected via Reviewer Portal',
      },
    });
    return {
      alreadyRejected: false,
      rejectionReason: trimmedReason,
      submission: res,
    };
  }

  await delay();
  const subInState = state.submissions.find(s => s.id === submissionId);
  const localSubs = typeof window !== 'undefined' ? submissionStore.getSnapshot() : [];
  const subInLocal = localSubs.find(s => s.id === submissionId);

  let sub = subInState || subInLocal;
  if (!sub) {
    throw new Error(`Submission ${submissionId} not found.`);
  }

  if (sub.status === 'rejected') {
    return { alreadyRejected: true, submission: sub };
  }
  if (sub.status === 'approved') {
    throw new Error('Cannot reject a submission that has already been approved and rewarded.');
  }

  const now = new Date();
  sub.status = 'rejected';
  sub.reviewedAt = now.toISOString();
  sub.reason = trimmedReason;

  if (subInLocal) {
    submissionStore.updateStatus(submissionId, 'rejected', now.toISOString(), trimmedReason);
  }
  if (!subInState) {
    state.submissions.unshift({
      id: sub.id,
      taskId: sub.taskId,
      status: 'rejected',
      submittedAt: sub.submittedAt,
      reviewedAt: now.toISOString(),
      reason: trimmedReason,
    });
  }

  const task = state.tasks.find(t => t.id === sub.taskId);
  const taskTitle = (sub as any).taskTitle || task?.title || 'Civic task';

  state.notifications.unshift({
    id: `n-sub-${submissionId}`,
    title: 'Submission not approved',
    message: `${taskTitle}: ${trimmedReason}`,
    type: 'rejected',
    date: now.toISOString(),
    read: false,
    submissionId: sub.id,
  });

  persistState(state);
  return {
    alreadyRejected: false,
    submission: sub,
  };
}
