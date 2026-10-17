/**
 * Persistent & in-memory store for locally captured submissions.
 * Uses localStorage when available and pub/sub so React components subscribe via useSyncExternalStore.
 */
import type { Submission, TaskCategory } from '@/types';

export interface LocalSubmission extends Submission {
  photoDataUrl?: string;
  note?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  taskTitle?: string;
  category?: TaskCategory;
  reason?: string;
}

type Listener = () => void;

const STORAGE_KEY = 'civic_spark_local_submissions';

function loadStoredSubmissions(): LocalSubmission[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSubmissions(subs: LocalSubmission[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch {
    // Ignore storage quota errors
  }
}

const EMPTY_SNAPSHOT: LocalSubmission[] = [];
let localSubmissions: LocalSubmission[] = loadStoredSubmissions();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l());
}

export const submissionStore = {
  getSnapshot(): LocalSubmission[] {
    return localSubmissions;
  },
  getServerSnapshot(): LocalSubmission[] {
    return EMPTY_SNAPSHOT;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  add(submission: LocalSubmission): LocalSubmission {
    // Prevent accidental duplicate submission
    const existing = localSubmissions.find(s => s.id === submission.id);
    if (existing) return existing;
    const recentDup = localSubmissions.find(
      s => s.taskId === submission.taskId &&
           s.photoDataUrl && submission.photoDataUrl &&
           s.photoDataUrl === submission.photoDataUrl &&
           Date.now() - new Date(s.submittedAt).getTime() < 60_000
    );
    if (recentDup) return recentDup;

    localSubmissions = [submission, ...localSubmissions];
    persistSubmissions(localSubmissions);
    notify();
    return submission;
  },
  updateStatus(id: string, status: Submission['status'], reviewedAt?: string, reason?: string): void {
    localSubmissions = localSubmissions.map(s => s.id === id ? {
      ...s,
      status,
      ...(reviewedAt ? { reviewedAt } : {}),
      ...(reason !== undefined ? { reason } : {}),
    } : s);
    persistSubmissions(localSubmissions);
    notify();
  },
  clear(): void {
    localSubmissions = [];
    persistSubmissions([]);
    notify();
  },
};

