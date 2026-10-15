/**
 * In-memory store for locally captured submissions.
 * Uses a simple pub/sub so React components can subscribe via useSyncExternalStore.
 */
import type { Submission } from '@/types';

export interface LocalSubmission extends Submission {
  photoDataUrl?: string;
  note?: string;
  address?: string;
}

type Listener = () => void;

let localSubmissions: LocalSubmission[] = [];
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l());
}

export const submissionStore = {
  getSnapshot(): LocalSubmission[] {
    return localSubmissions;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  add(submission: LocalSubmission): void {
    localSubmissions = [submission, ...localSubmissions];
    notify();
  },
};
