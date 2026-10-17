import { Link } from '@tanstack/react-router';
import { useSuspenseQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ArrowRight, ArrowUpRight, Bell, Gift, HeartHandshake, MapPin, ShieldCheck, Sprout } from 'lucide-react';
import { snapshotOptions, monthlyProgress, MONTHLY_CAP } from '@/api';
import { Button } from '@/components/ui/button';
import { Brand, SectionTitle, SubmissionRow, TaskCard, VerifiedNote } from '@/components/civic/shared';
import { submissionStore } from '@/lib/submissionStore';
export function HomePage() {
 const { data } = useSuspenseQuery(snapshotOptions);
 const localSubs = useSyncExternalStore(
   submissionStore.subscribe,
   submissionStore.getSnapshot,
   submissionStore.getServerSnapshot,
 );
 const approved = data.submissions.filter(s => s.status === 'approved').length;
 // Merge local submissions with server ones; local entries first, deduped by id
 const localIds = new Set(localSubs.map(s => s.id));
 const mergedSubmissions = [...localSubs, ...data.submissions.filter(s => !localIds.has(s.id))];
 // For SubmissionRow we need matching tasks; local subs use the task id from TASK_IDS
 const allTasks = data.tasks;
 return <div className="home-page"><header className="home-header"><Brand/><Button asChild variant="ghost" size="icon" className="notification-button" aria-label="Notifications"><Link to="/notifications"><Bell size={22}/>{data.notifications.some(n => !n.read) && <span className="notification-dot"/>}</Link></Button></header><div className="page-content"><div className="location-line"><MapPin size={13}/>{data.user.ward}<span className="location-dot"/>{data.user.city}</div><div className="greeting"><span>MONDAY, 12 OCTOBER</span><h1>Good morning Mr.Ganesh <span className="sun-greeting">☀</span></h1><p>A little good goes a long way.</p></div><section className="balance-card"><div className="balance-topline"><span><span className="balance-icon"><Sprout size={16}/></span>Your civic points</span><span className="balance-badge"><ShieldCheck size={12}/> VERIFIED</span></div><div className="balance-main"><div><strong>{data.user.balance.toLocaleString('en-IN')}</strong><span>points</span></div><Button asChild className="reward-button" variant="secondary"><Link to="/redeem"><Gift size={15}/>Redeem<ArrowUpRight size={13}/></Link></Button></div><div className="monthly-line"><span>Earned this month</span><span><b>{data.user.monthlyPoints}</b> / {MONTHLY_CAP} pts</span></div><div className="monthly-track" role="progressbar" aria-label="Monthly points" aria-valuenow={data.user.monthlyPoints} aria-valuemin={0} aria-valuemax={500}><div style={{ width: `${monthlyProgress(data.user.monthlyPoints)}%` }}/></div><div className="balance-footer"><Sprout size={12}/>Small steps. A stronger community.</div></section><SectionTitle title="Near you today" to="/tasks" label="See all"/><div className="near-label"><span className="live-dot"/>Make a difference, right around the corner</div><div className="task-stack">{data.tasks.slice(0, 2).map((task, i) => <TaskCard key={task.id} task={task} featured={i === 0 || task.id === 't2'}/>)}</div><SectionTitle title="Your little acts add up"/><section className="impact-strip"><div><span className="impact-icon"><ShieldCheck size={18}/></span><strong>{approved}</strong><span>Verified tasks</span></div><div><span className="impact-icon"><Sprout size={18}/></span><strong>2</strong><span>Greener spaces</span></div><div><span className="impact-icon"><HeartHandshake size={18}/></span><strong>1</strong><span>Life touched</span></div></section><SectionTitle title="Recent activity" to="/submissions"/><div className="activity-list">{mergedSubmissions.slice(0, 3).map(s => <SubmissionRow key={s.id} submission={s} tasks={allTasks}/>)}</div><VerifiedNote/></div></div>;
}

