/**
 * Centralized API client for SSS Civic Tech.
 * Handles base URL resolution, JWT bearer token attachment, multipart uploads,
 * timeout handling, and typed error responses.
 */
import { getApiConfig } from './config';

export class ApiError extends Error {
  status: number;
  errorType?: string;
  data?: unknown;

  constructor(message: string, status: number, errorType?: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errorType = errorType;
    this.data = data;
  }
}

const ACCESS_TOKEN_KEY = 'civic_spark_access_token';
const REFRESH_TOKEN_KEY = 'civic_spark_refresh_token';
const AUTH_USER_KEY = 'civic_spark_auth_user';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function getAuthUser(): { id: string; phone: string; name: string; role: string; language: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setAuthSession(data: {
  accessToken: string;
  refreshToken: string;
  user: { id: string | number; phone: string; name?: string; role?: string; language?: string };
}): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACCESS_TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {
    // Ignore
  }
}

export interface ApiFetchOptions extends RequestInit {
  requiresAuth?: boolean;
  timeoutMs?: number;
}

export async function apiFetch<T>(endpoint: string, options: ApiFetchOptions = {}): Promise<T> {
  const { baseUrl } = getApiConfig();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const headers = new Headers(options.headers || {});

  // Attach Authorization header if authenticated and not explicitly disabled
  if (options.requiresAuth !== false) {
    const token = getAccessToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  // Handle request body
  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof URLSearchParams)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    body = JSON.stringify(body);
  }

  // Attach timeout controller
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      headers,
      body,
      signal: options.signal || controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errData: any = null;
      try {
        errData = await res.json();
      } catch {
        errData = null;
      }

      let errorMsg = `Request to ${cleanEndpoint} failed with status ${res.status}`;
      let errorType: string | undefined = undefined;

      if (errData && typeof errData === 'object') {
        if (errData.detail) {
          if (typeof errData.detail === 'object') {
            errorMsg = errData.detail.message || errorMsg;
            errorType = errData.detail.error;
          } else if (typeof errData.detail === 'string') {
            errorMsg = errData.detail;
          }
        } else if (errData.message) {
          errorMsg = errData.message;
          errorType = errData.error;
        }
      }

      throw new ApiError(errorMsg, res.status, errorType, errData);
    }

    // Parse JSON or return empty object
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }
    return {} as T;
  } catch (err: any) {
    clearTimeout(timer);
    if (err instanceof ApiError) {
      throw err;
    }

    if (err.name === 'AbortError') {
      throw new ApiError(`Request to ${cleanEndpoint} timed out after ${timeoutMs}ms.`, 408, 'timeout');
    }

    // Network error (e.g. connection refused, offline)
    throw new ApiError(
      `Backend service unavailable at ${baseUrl}. Please ensure the backend is running.`,
      0,
      'network_error',
      err
    );
  }
}
