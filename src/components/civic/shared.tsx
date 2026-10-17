import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, Bell, Camera, Check, CheckCircle2, ChevronRight, CircleHelp, Clock3, Gift, Heart, Home, Leaf, ListChecks, MapPin, Search, ShieldCheck, Sprout, Wallet, UserRound, XCircle, Wifi, Signal, BatteryFull, Landmark, Construction } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { categories } from '@/data/mock';
import type { Submission, Task, TaskCategory } from '@/types';
import planting from '@/assets/planting.jpg';
import civicRoad from '@/assets/civic-audit-road.png';
import companyLogo from '@/assets/company-logo.png';
export { planting, civicRoad, companyLogo };
export const categoryIcons = { civic: Construction, green: Sprout, health: Heart, governance: Landmark };
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">
        <img
          src={companyLogo}
          alt="AI SAMRAT"
          className="brand-logo-img"
          width={1024}
          height={344}
        />
      </span>
      <span>
        SSS <span className="font-normal">Civic Tech</span>
        {!compact && <small>SMALL ACTIONS. SHARED IMPACT.</small>}
      </span>
    </div>
  );
}
export function AppShell({ children }: { children: ReactNode }) {
 const path = useRouterState({ select: s => s.location.pathname });
 const hidden = ['/onboarding', '/login', '/consent', '/capture'].includes(path);
 return <div className="phone-frame"><div className="system-bar" aria-hidden="true"><span>9:41</span><div><Signal size={14}/><Wifi size={15}/><BatteryFull size={21}/></div></div><main className={hidden ? 'app-main no-tabs' : 'app-main'}>{children}</main>{!hidden && <nav className="bottom-nav" aria-label="Main navigation"><Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}><Home/><span>Home</span></Link><Link to="/tasks" activeProps={{ className: 'active' }}><ListChecks/><span>Tasks</span></Link><Link to="/capture" className="capture-tab" aria-label="Capture a task"><span><Camera size={25}/></span></Link><Link to="/wallet" activeProps={{ className: 'active' }}><Wallet/><span>Wallet</span></Link><Link to="/profile" activeProps={{ className: 'active' }}><UserRound/><span>Profile</span></Link></nav>}</div>;
}
export function PageHeader({ title, back = '/', action }: { title: string; back?: '/' | '/tasks' | '/submissions' | '/wallet' | '/redeem' | '/profile'; action?: ReactNode }) { return <header className="page-header"><Button asChild variant="ghost" size="icon" aria-label="Go back"><Link to={back}><ArrowLeft/></Link></Button><h1>{title}</h1><div className="header-action">{action}</div></header>; }
export function SectionTitle({ title, to, label = 'View all' }: { title: string; to?: '/tasks' | '/submissions' | '/wallet'; label?: string }) { return <div className="section-heading"><h2>{title}</h2>{to && <Link to={to}>{label}<ChevronRight size={14}/></Link>}</div>; }
export function CategoryIcon({ category }: { category: TaskCategory }) { const Icon = categoryIcons[category]; return <span className={`category-icon category-${category}`}><Icon size={21}/></span>; }
export function StatusChip({ status }: { status: Submission['status'] }) { const info = { under_review: { Icon: Clock3, label: 'Under review' }, approved: { Icon: CheckCircle2, label: 'Approved' }, rejected: { Icon: XCircle, label: 'Rejected' } }[status]; return <span className={`status-chip status-${status}`}><info.Icon size={12}/>{info.label}</span>; }
export function Points({ amount }: { amount: number }) { return <span className="points-chip"><Sprout size={13}/><b>+{amount}</b> pts</span>; }
export function TaskCard({ task, featured = false }: { task: Task; featured?: boolean }) {
  const isRoad = task.id === 't2' || task.title === 'Report a road that needs care';
  const photo = isRoad ? civicRoad : planting;
  const alt = isRoad ? 'Citizen reporting a road that needs care' : 'Neighbours planting a sapling together';
  return (
    <Link className={`task-card ${featured ? 'featured-task' : ''}`} to="/tasks/$taskId" params={{ taskId: task.id }}>
      {featured ? (
        <div className="task-photo">
          <img src={photo} width={1024} height={768} alt={alt}/>
          {!isRoad && (
            <span className="photo-label">
              <Sprout size={12}/> GREEN DRIVE
            </span>
          )}
        </div>
      ) : (
        <CategoryIcon category={task.category}/>
      )}
      <div className="task-card-content">
        <div className="task-meta">
          {categories.find(c => c.id === task.category)?.short}
          <Points amount={task.points}/>
        </div>
        <h3>{task.title}</h3>
        <div className="task-location">
          <MapPin size={12}/>
          <span>{task.location}</span>
          <span className="distance">{task.distance} km</span>
        </div>
      </div>
      {!featured && <ChevronRight className="task-chevron" size={16}/>}
    </Link>
  );
}
export function SubmissionRow({ submission, tasks }: { submission: Submission; tasks: Task[] }) {
  const task = tasks.find(t => t.id === submission.taskId);
  if (!task) return null;
  const local = submission as Submission & { photoDataUrl?: string; latitude?: number; longitude?: number };
  return (
    <Link className="activity-row" to="/submissions/$submissionId" params={{ submissionId: submission.id }}>
      {local.photoDataUrl ? (
        <div style={{ width: 38, height: 38, borderRadius: 10, overflow: 'hidden', flexShrink: 0, border: '1px solid var(--border)' }}>
          <img src={local.photoDataUrl} alt={task.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      ) : (
        <CategoryIcon category={task.category} />
      )}
      <div className="min-w-0 flex-1">
        <h3>{task.title}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <span className="row-date">{formatDate(submission.submittedAt)}</span>
          {local.latitude !== undefined && local.longitude !== undefined && (
            <span style={{ fontSize: 9, color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <MapPin size={9} />
              {local.latitude >= 0 ? `${local.latitude.toFixed(4)}°N` : `${Math.abs(local.latitude).toFixed(4)}°S`}, {local.longitude >= 0 ? `${local.longitude.toFixed(4)}°E` : `${Math.abs(local.longitude).toFixed(4)}°W`}
            </span>
          )}
        </div>
      </div>
      <StatusChip status={submission.status} />
    </Link>
  );
}
export function formatDate(value: string) { return new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
export function EmptyState({ title = 'Nothing here just yet', message = 'Your next small action could make a big difference.', children }: { title?: string; message?: string; children?: ReactNode }) { return <div className="empty-state"><span><Sprout size={30}/></span><h2>{title}</h2><p>{message}</p>{children}</div>; }
export function LoadingPage() { return <div className="page-content space-y-5 pt-6"><Skeleton className="h-12 w-3/4"/><Skeleton className="h-44 rounded-2xl"/><Skeleton className="h-7 w-1/2"/><Skeleton className="h-44 rounded-2xl"/><Skeleton className="h-24 rounded-2xl"/></div>; }
export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) { return <label className="search-box"><Search size={19}/><input aria-label="Search tasks" value={value} onChange={e => onChange(e.target.value)} placeholder="Search tasks in your neighbourhood"/></label>; }
export function VerifiedNote({ children }: { children?: ReactNode }) { return <div className="verified-note"><ShieldCheck size={14}/>{children ?? 'Verified actions. Real community impact.'}</div>; }
export const infoContent = {
 points: { title: 'How points work', text: 'Complete a civic task and submit a live, geo-tagged photo. Once your task is approved, its points are added to your wallet. You can earn up to 500 points each month. Redeem points for Amazon or Flipkart gift vouchers. Points can’t be transferred or exchanged for cash. There is no cash or crypto reward.' },
 privacy: { title: 'Your privacy matters', text: 'Your camera is used only when you choose to capture task proof. Location helps verify where a task was completed. Your photo, location and task details are used for verification. Never photograph private information or other people without permission. This preview uses mock data and does not upload photos or collect your location.' },
 help: { title: 'A little help, whenever you need it', text: 'If a task is under review, no action is needed. If it is rejected, open the submission to see why and tap Resubmit to try again. Voucher codes in this preview are demonstration codes, not redeemable gift cards. For help with your ward’s tasks, contact your local community office.' },
};
