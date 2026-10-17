import { describe, expect, it } from 'vitest';
import { submissionStore, type LocalSubmission } from '@/lib/submissionStore';

describe('Camera capture and GPS location submission flow', () => {
  it('stores captured image and real GPS metadata together in submissionStore', () => {
    const submissionId = `cap-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const testSubmission: LocalSubmission = {
      id: submissionId,
      taskId: 't2',
      status: 'under_review',
      submittedAt: now,
      photoDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      note: 'Pothole observed near northern gate',
      address: 'MG Road, Bengaluru, Karnataka',
      latitude: 12.971598,
      longitude: 77.594562,
      accuracy: 14.5,
    };

    submissionStore.add(testSubmission);

    const snapshot = submissionStore.getSnapshot();
    const stored = snapshot.find(s => s.id === submissionId);

    expect(stored).toBeDefined();
    expect(stored?.photoDataUrl).toBe('data:image/jpeg;base64,/9j/4AAQSkZJRg==');
    expect(stored?.latitude).toBe(12.971598);
    expect(stored?.longitude).toBe(77.594562);
    expect(stored?.accuracy).toBe(14.5);
    expect(stored?.address).toBe('MG Road, Bengaluru, Karnataka');
    expect(stored?.status).toBe('under_review');
  });

  it('handles location failure by omitting fake coordinates', () => {
    const failedGeoSubmission: LocalSubmission = {
      id: 'cap-no-gps-1',
      taskId: 't1',
      status: 'under_review',
      submittedAt: new Date().toISOString(),
      photoDataUrl: 'data:image/jpeg;base64,/9j/photo-no-gps',
      note: 'Tree planting activity',
      // No coordinates when location access fails
    };

    submissionStore.add(failedGeoSubmission);

    const snapshot = submissionStore.getSnapshot();
    const stored = snapshot.find(s => s.id === 'cap-no-gps-1');

    expect(stored).toBeDefined();
    expect(stored?.photoDataUrl).toBe('data:image/jpeg;base64,/9j/photo-no-gps');
    expect(stored?.latitude).toBeUndefined();
    expect(stored?.longitude).toBeUndefined();
    expect(stored?.accuracy).toBeUndefined();
  });

  it('preserves task name and persists submissions across page navigation via localStorage', () => {
    const submissionId = `cap-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const submissionWithTask: LocalSubmission = {
      id: submissionId,
      taskId: 't1',
      taskTitle: 'Plant 5 saplings in community park',
      status: 'under_review',
      submittedAt: now,
      photoDataUrl: 'data:image/jpeg;base64,planted_saplings_proof',
      latitude: 17.4485,
      longitude: 78.3742,
      accuracy: 8.2,
      note: 'All saplings planted with tree guards',
      address: 'Botanical Garden Rd, Kondapur',
    };

    submissionStore.add(submissionWithTask);

    // Verify retrieval from store snapshot
    const stored = submissionStore.getSnapshot().find(s => s.id === submissionId);
    expect(stored).toBeDefined();
    expect(stored?.taskTitle).toBe('Plant 5 saplings in community park');
    expect(stored?.latitude).toBe(17.4485);
    expect(stored?.longitude).toBe(78.3742);
    expect(stored?.accuracy).toBe(8.2);

    // Verify persistence in localStorage
    const raw = localStorage.getItem('civic_spark_local_submissions');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    const persistentEntry = parsed.find((s: LocalSubmission) => s.id === submissionId);
    expect(persistentEntry).toBeDefined();
    expect(persistentEntry.taskTitle).toBe('Plant 5 saplings in community park');
    expect(persistentEntry.photoDataUrl).toBe('data:image/jpeg;base64,planted_saplings_proof');
  });
});
