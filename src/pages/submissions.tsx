import { Link } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { Check, Clock3, MapPin, RotateCcw, ShieldCheck, Sprout, XCircle } from 'lucide-react';
import { snapshotOptions, getSubmissionPhotoUrl } from '@/api';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, StatusChip, SubmissionRow, formatDate, CategoryIcon, VerifiedNote } from '@/components/civic/shared';
import { submissionStore } from '@/lib/submissionStore';
export function SubmissionsPage() { const { data } = useSuspenseQuery(snapshotOptions); const [filter, setFilter] = useState('all');
 const localSubs = useSyncExternalStore(
   submissionStore.subscribe,
   submissionStore.getSnapshot,
   submissionStore.getServerSnapshot,
 );
 const localIds = new Set(localSubs.map(s => s.id));
 const allSubmissions = [...localSubs, ...data.submissions.filter(s => !localIds.has(s.id))];
  const rows = allSubmissions.filter(s => filter === 'all' || s.status === filter); return <><PageHeader title="My submissions"/><div className="page-content"><div className="intro-copy"><h2>Your good deeds, tracked.</h2><p>Every verified action brings us forward.</p></div><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--secondary)', borderRadius: 12, margin: '14px 0' }}><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><ShieldCheck size={16} style={{ color: 'var(--primary)' }} /><span style={{ fontSize: 11, fontWeight: 600 }}>Reviewer Demonstration</span></div><Button asChild size="sm" variant="outline" style={{ height: 28, fontSize: 10 }}><Link to="/reviewer">Open Portal →</Link></Button></div><div className="category-filters"><Button variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>All ({allSubmissions.length})</Button>{(['under_review', 'approved', 'rejected'] as const).map(s => <Button key={s} variant={filter === s ? 'secondary' : 'outline'} onClick={() => setFilter(s)}><StatusChip status={s}/></Button>)}</div><div className="activity-list">{rows.map(s => <SubmissionRow key={s.id} submission={s} tasks={data.tasks}/>)}</div>{!rows.length && <EmptyState title="No submissions yet" message="Complete a nearby task to start making an impact."><Button asChild><Link to="/tasks">Find a task</Link></Button></EmptyState>}</div></>;
}
export function SubmissionDetailPage({ submissionId }: { submissionId: string }) {
 const { data } = useSuspenseQuery(snapshotOptions);
 const localSubs = useSyncExternalStore(
   submissionStore.subscribe,
   submissionStore.getSnapshot,
   submissionStore.getServerSnapshot,
 );
 const s = localSubs.find(sub => sub.id === submissionId) || data.submissions.find(sub => sub.id === submissionId);
 const sAny = s as any;
 const task = data.tasks.find(t => t.id === s?.taskId) || sAny?.task || (s ? {
   id: s.taskId || 't-unknown',
   title: 'Civic Task',
   category: (sAny?.category || 'civic') as any,
   points: 20,
   distance: 0,
   location: sAny?.address || 'Hyderabad',
   description: '',
   requirements: [],
   date: '',
 } : null);
 if (!s || !task) return <><PageHeader title="Submission" back="/submissions"/><EmptyState title="Submission not found"/></>;
 const complete = s.status === 'approved';
 const steps = [{ title: 'Submitted', detail: formatDate(s.submittedAt), active: true, Icon: Check }, { title: 'Under review', detail: 'Your photo and location are checked', active: true, Icon: Clock3 }, { title: s.status === 'rejected' ? 'Rejected' : 'Approved', detail: s.reviewedAt ? formatDate(s.reviewedAt) : 'Waiting for verification', active: s.status !== 'under_review', Icon: s.status === 'rejected' ? XCircle : ShieldCheck }, { title: 'Points added', detail: complete ? `+${task.points} points added to your wallet` : s.status === 'rejected' ? 'No points added for this submission' : `+${task.points} points after approval`, active: complete, Icon: Sprout }];
 const photoUrl = sAny?.photoUrl ? getSubmissionPhotoUrl(sAny.photoUrl) : sAny?.photoDataUrl;
 const subLat = sAny?.latitude ?? sAny?.lat;
 const subLng = sAny?.longitude ?? sAny?.lng;
 const subAcc = sAny?.accuracy;
 const subNote = sAny?.note;
 const subAddress = sAny?.address || task.location;

 return <><PageHeader title="Submission details" back="/submissions"/><div className="page-content">{photoUrl && <div className="submission-detail-photo-wrap" style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 16, border: '1px solid var(--border)' }}><img src={photoUrl} alt={task.title} style={{ width: '100%', maxHeight: 250, objectFit: 'cover', display: 'block' }}/></div>}<div className="submission-heading"><CategoryIcon category={task.category}/><StatusChip status={s.status}/></div><h1 className="detail-title">{task.title}</h1><p className="detail-location"><MapPin size={15}/>{subAddress}</p>{subLat !== undefined && subLng !== undefined && <div className="submission-gps-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '5px 10px', background: 'var(--secondary)', color: 'var(--primary)', borderRadius: 8, marginTop: 4, marginBottom: 12 }}><MapPin size={13}/><span>GPS: {subLat >= 0 ? `${subLat.toFixed(5)}° N` : `${Math.abs(subLat).toFixed(5)}° S`}, {subLng >= 0 ? `${subLng.toFixed(5)}° E` : `${Math.abs(subLng).toFixed(5)}° W`}{subAcc !== undefined ? ` (±${Math.round(subAcc)} m)` : ''}</span></div>}{subNote && <div style={{ padding: '12px 14px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, fontSize: 12, marginBottom: 16 }}><strong style={{ display: 'block', fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 3, letterSpacing: '0.5px' }}>REPORT NOTE</strong><p style={{ margin: 0, lineHeight: 1.6 }}>{subNote}</p></div>}<div className="submission-reference">Submission #{s.id.toUpperCase()} · {formatDate(s.submittedAt)}</div><h2 className="section-title">Your task journey</h2><div className="timeline">{steps.map((step, i) => <div className={`timeline-step ${step.active ? 'complete' : ''} ${s.status === 'rejected' && i === 2 ? 'rejected' : ''}`} key={step.title}><span className="timeline-icon"><step.Icon size={18}/></span><div><h3>{step.title}</h3><p>{step.detail}</p></div></div>)}</div>{s.status === 'rejected' && <div className="rejection-note"><h3><XCircle size={17}/>Let’s give it another try</h3><p>{s.reason}</p><Button asChild><Link to="/capture" search={{ taskId: task.id }}><RotateCcw/>Resubmit</Link></Button></div>}{s.status === 'under_review' && <div className="info-note" style={{ flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}><div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><Clock3 size={20}/><p>Your task is being checked. We’ll notify you when there’s an update.</p></div><Button asChild size="sm" variant="secondary" style={{ fontSize: 11, height: 28 }}><Link to="/reviewer">Review in Portal →</Link></Button></div>}{complete && <Button asChild variant="outline" className="w-full"><Link to="/wallet">View your points<ChevronRightIcon/></Link></Button>}<Button asChild variant="link" className="w-full mt-3"><Link to="/tasks/$taskId" params={{ taskId: task.id }}>View original task</Link></Button></div></>;
}
function ChevronRightIcon() { return <span aria-hidden="true">→</span>; }
