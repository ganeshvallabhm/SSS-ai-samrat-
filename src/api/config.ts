/**
 * API configuration module for SSS Civic Tech.
 * Supports configurable Backend Mode (communicating with FastAPI on port 8888)
 * and Demo Mode (client-side in-memory / localStorage fallback).
 */

export interface ApiConfig {
  useBackend: boolean;
  baseUrl: string;
}

const STORAGE_MODE_KEY = 'civic_spark_use_backend';

export function getApiConfig(): ApiConfig {
  // Check explicit Vite environment variable first
  const envVal = import.meta.env.VITE_USE_BACKEND_API;
  let useBackend = false;

  if (typeof envVal === 'string') {
    useBackend = envVal.trim().toLowerCase() === 'true';
  } else if (typeof window !== 'undefined') {
    // Check localStorage toggle if env is not explicitly set to true
    useBackend = window.localStorage.getItem(STORAGE_MODE_KEY) === 'true';
  }

  const baseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || 'http://localhost:8888/api/v1';

  return {
    useBackend,
    baseUrl: baseUrl.replace(/\/+$/, ''),
  };
}

export function isBackendMode(): boolean {
  return getApiConfig().useBackend;
}

export function setBackendMode(enabled: boolean): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_MODE_KEY, enabled ? 'true' : 'false');
  }
}
