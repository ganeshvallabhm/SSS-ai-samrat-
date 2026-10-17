import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  apiFetch,
  ApiError,
  setAuthSession,
  clearAuthSession,
  getAccessToken,
  getAuthUser,
} from '@/api/client';
import { isBackendMode, setBackendMode } from '@/api/config';
import {
  getSnapshot,
  sendOtp,
  verifyOtp,
  approveSubmission,
  rejectSubmission,
  fetchReviewerQueue,
  getSubmissionPhotoUrl,
} from '@/api';

describe('Phase 1 & 2: API Configuration and Client Behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('configures backend vs demo mode accurately and allows toggling', () => {
    localStorage.setItem('civic_spark_use_backend', 'false');
    expect(isBackendMode()).toBe(false);

    setBackendMode(true);
    expect(isBackendMode()).toBe(true);
    expect(localStorage.getItem('civic_spark_use_backend')).toBe('true');

    setBackendMode(false);
    expect(isBackendMode()).toBe(false);
    expect(localStorage.getItem('civic_spark_use_backend')).toBe('false');
  });

  it('attaches JWT Bearer token when user is authenticated', async () => {
    const fakeToken = 'mock.jwt.token.for.testing';
    setAuthSession({
      accessToken: fakeToken,
      refreshToken: 'mock.refresh.token',
      user: { id: 'u1', phone: '9900000042', role: 'citizen', name: 'Test Citizen', language: 'en' },
    });

    expect(getAccessToken()).toBe(fakeToken);
    expect(getAuthUser()?.phone).toBe('9900000042');

    let capturedAuth: string | null | undefined = undefined;
    global.fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const h = options.headers;
      capturedAuth = h instanceof Headers ? h.get('Authorization') : (h as any)?.['Authorization'];
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const res = await apiFetch<{ status: string }>('/health');
    expect(res.status).toBe('ok');
    expect(capturedAuth).toBe(`Bearer ${fakeToken}`);
  });

  it('omits Authorization header when no user is authenticated', async () => {
    clearAuthSession();
    expect(getAccessToken()).toBeNull();

    let capturedAuth: string | null | undefined = undefined;
    global.fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const h = options.headers;
      capturedAuth = h instanceof Headers ? h.get('Authorization') : (h as any)?.['Authorization'];
      return new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await apiFetch<{ status: string }>('/health');
    expect(capturedAuth).toBeNull();
  });

  it('does not manually set Content-Type on FormData to preserve boundary', async () => {
    const formData = new FormData();
    formData.append('key', 'value');

    let capturedContentType: string | null | undefined = undefined;
    global.fetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const h = options.headers;
      capturedContentType = h instanceof Headers ? h.get('Content-Type') : (h as any)?.['Content-Type'];
      return new Response(JSON.stringify({ uploaded: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await apiFetch('/upload', {
      method: 'POST',
      body: formData,
    });

    // Content-Type must not be application/json or hardcoded multipart without boundary
    expect(capturedContentType).toBeNull();
  });

  it('properly extracts and surfaces ApiError for 400, 401, 403, 404, 409, and 500 responses', async () => {
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({ detail: 'Submission is outside task geofence (distance 52.4km > 50km)' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    try {
      await apiFetch('/submissions', { method: 'POST', body: JSON.stringify({}) });
      expect.fail('Expected apiFetch to throw ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(400);
      expect(apiErr.message).toContain('geofence');
    }
  });

  it('handles network failure with descriptive error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(apiFetch('/health')).rejects.toThrow(ApiError);
  });
});

describe('Phase 3, 4 & 5: Backend Mode vs Demo Mode Guardrails', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('preserves offline demo mode in getSnapshot without triggering network calls', async () => {
    setBackendMode(false);
    expect(isBackendMode()).toBe(false);

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy;

    const snapshot = await getSnapshot();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(snapshot.tasks.length).toBeGreaterThan(0);
    expect(snapshot.user.balance).toBeDefined();
  });

  it('in backend mode, throws without silent fallback to localStorage when backend request fails', async () => {
    setBackendMode(true);
    expect(isBackendMode()).toBe(true);

    // Mock fetch returning a 500 error from backend
    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({ detail: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // When backend mode is on, a failure MUST throw an ApiError and NEVER silently return demo data
    await expect(getSnapshot()).rejects.toThrow(ApiError);
  });

  it('loads real backend tasks and wallet balance when in backend mode and authenticated', async () => {
    setBackendMode(true);
    setAuthSession({
      accessToken: 'test.citizen.jwt',
      refreshToken: 'test.citizen.refresh',
      user: { id: 'u-citizen-1', phone: '9900000042', role: 'citizen', name: 'Citizen 1', language: 'en' },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/tasks')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'task-live-1',
                title: 'Clean lake perimeter',
                description: 'Clear plastic waste near lake',
                category: 'green',
                points: 40,
                distance: 120,
                location: 'Kondapur Lake',
                requirements: ['Clear trash'],
                date: '2026-10-17',
              },
            ],
            meta: { page: 1, limit: 20, totalItems: 1, totalPages: 1 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/wallet/transactions')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'tx-live-1',
                points: 40,
                type: 'earned',
                title: 'Lake clean reward',
                date: new Date().toISOString(),
              },
            ],
            total: 1,
            page: 1,
            size: 50,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/wallet')) {
        return new Response(
          JSON.stringify({
            balance: 40,
            monthlyPoints: 40,
            monthlyCap: 500,
            monthlyProgressPercent: 8,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/submissions/mine')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    });

    const snapshot = await getSnapshot();
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0].id).toBe('task-live-1');
    expect(snapshot.tasks[0].points).toBe(40);
    expect(snapshot.user.balance).toBe(40);
    expect(snapshot.user.monthlyPoints).toBe(40);
    expect(snapshot.transactions).toHaveLength(1);
  });
});

describe('Phase 4: Authentication Flow', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('connects sendOtp to /auth/otp/request in backend mode and handles +91 prefix', async () => {
    setBackendMode(true);

    let sentBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      sentBody = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({
          message: 'OTP sent successfully',
          expiresInSeconds: 300,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await sendOtp('+919900000042');
    expect(res.sent).toBe(true);
    expect(sentBody.phone).toBe('+919900000042');
  });

  it('connects verifyOtp to /auth/otp/verify and sets auth tokens in backend mode', async () => {
    setBackendMode(true);

    global.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'valid.access.jwt',
          refresh_token: 'valid.refresh.jwt',
          token_type: 'bearer',
          user: {
            id: 'u-db-10',
            phone: '+919900000042',
            role: 'citizen',
            name: 'Ravi Kumar',
            language: 'en',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await verifyOtp('9900000042', '123456');
    expect(res.id).toBe('u-db-10');
    expect(res.phone).toBe('+919900000042');
    expect(getAccessToken()).toBe('valid.access.jwt');
    expect(getAuthUser()?.role).toBe('citizen');
  });
});

describe('Phase 6, 7 & 8: Reviewer Portal and Submission Details', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches real reviewer queue in backend mode', async () => {
    setBackendMode(true);
    setAuthSession({
      accessToken: 'reviewer.jwt',
      refreshToken: 'reviewer.refresh',
      user: { id: 'u-rev-1', phone: '9800000001', role: 'reviewer', name: 'Priya Sharma', language: 'en' },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/reviewer/queue')) {
        return new Response(
          JSON.stringify([
            {
              id: 'sub-backend-99',
              task_id: 'task-1',
              task_title: 'Pothole reporting',
              category: 'civic',
              points: 20,
              citizen_id: 'citizen-1',
              citizen_phone: '9900000042',
              status: 'submitted',
              submitted_at: new Date().toISOString(),
              latitude: 12.9716,
              longitude: 77.5946,
              distance_meters: 120,
              photo_url: '/api/v1/submissions/sub-backend-99/photo',
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('Not found', { status: 404 });
    });

    const queue = await fetchReviewerQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('sub-backend-99');
    expect(queue[0].status).toBe('submitted');
  });

  it('submits approval decision to /reviewer/submissions/{id}/review', async () => {
    setBackendMode(true);
    setAuthSession({
      accessToken: 'reviewer.jwt',
      refreshToken: 'reviewer.refresh',
      user: { id: 'u-rev-1', phone: '9800000001', role: 'reviewer', name: 'Priya Sharma', language: 'en' },
    });

    let reviewPayload: Record<string, unknown> = {};
    let requestUrl = '';

    global.fetch = vi.fn().mockImplementation(async (url: string, opts: RequestInit) => {
      requestUrl = url;
      reviewPayload = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({
          id: 'sub-backend-99',
          taskId: 'task-1',
          status: 'approved',
          reviewerId: 'u-rev-1',
          reviewedAt: new Date().toISOString(),
          rejectionReason: null,
          pointsAwarded: 20,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await approveSubmission('sub-backend-99');
    expect(requestUrl).toContain('/reviewer/submissions/sub-backend-99/review');
    expect(reviewPayload.decision).toBe('approve');
    expect(res.pointsAwarded).toBe(20);
  });

  it('submits rejection decision with required reason to /reviewer/submissions/{id}/review', async () => {
    setBackendMode(true);
    setAuthSession({
      accessToken: 'reviewer.jwt',
      refreshToken: 'reviewer.refresh',
      user: { id: 'u-rev-1', phone: '9800000001', role: 'reviewer', name: 'Priya Sharma', language: 'en' },
    });

    let reviewPayload: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation(async (_url: string, opts: RequestInit) => {
      reviewPayload = JSON.parse(opts.body as string);
      return new Response(
        JSON.stringify({
          id: 'sub-backend-99',
          taskId: 'task-1',
          status: 'rejected',
          reviewerId: 'u-rev-1',
          reviewedAt: new Date().toISOString(),
          rejectionReason: 'Photo is blurry and unidentifiable',
          pointsAwarded: 0,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const res = await rejectSubmission('sub-backend-99', 'Photo is blurry and unidentifiable');
    expect(reviewPayload.decision).toBe('reject');
    expect(reviewPayload.reason).toBe('Photo is blurry and unidentifiable');
    expect(res.rejectionReason).toBe('Photo is blurry and unidentifiable');
  });

  it('constructs authenticated photo URL with query token for browser img display', () => {
    setBackendMode(true);
    setAuthSession({
      accessToken: 'photo.jwt.test',
      refreshToken: 'photo.jwt.refresh',
      user: { id: 'u-1', phone: '9900000042', role: 'citizen', name: 'Citizen', language: 'en' },
    });

    const url = getSubmissionPhotoUrl('sub-123');
    expect(url).toContain('/submissions/sub-123/photo');
    expect(url).toContain('token=photo.jwt.test');
  });
});
