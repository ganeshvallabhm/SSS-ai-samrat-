import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Copy, Eye, EyeOff, Gift, LockKeyhole, ShieldCheck, Sprout, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { canRedeem, redeemVoucher, snapshotOptions, MONTHLY_CAP, monthlyProgress, isBackendMode } from '@/api';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader, formatDate, VerifiedNote } from '@/components/civic/shared';
import type { Redemption, Voucher } from '@/types';
export function WalletPage() {
  const { data } = useSuspenseQuery(snapshotOptions);
  const [tab, setTab] = useState('history');
  const backendActive = isBackendMode();
  return (
    <>
      <PageHeader title="My wallet" />
      <div className="page-content">
        <section className="wallet-hero">
          <span className="wallet-hero-icon"><Sprout size={28} /></span>
          <p>Your civic points</p>
          <h1>{data.user.balance.toLocaleString('en-IN')}<span>points</span></h1>
          
          <div className="wallet-monthly-box">
            <div className="monthly-line">
              <span>Earned this month</span>
              <span><b>{data.user.monthlyPoints}</b> / {MONTHLY_CAP} pts</span>
            </div>
            <div
              className="monthly-track"
              role="progressbar"
              aria-label="Monthly points"
              aria-valuenow={data.user.monthlyPoints}
              aria-valuemin={0}
              aria-valuemax={MONTHLY_CAP}
            >
              <div style={{ width: `${monthlyProgress(data.user.monthlyPoints)}%` }} />
            </div>
            <div className="wallet-monthly-sub">
              <span>Monthly limit: {MONTHLY_CAP} points</span>
              <span>{Math.max(0, MONTHLY_CAP - data.user.monthlyPoints)} pts remaining</span>
            </div>
          </div>

          <Button asChild variant="secondary">
            <Link to="/redeem"><Gift />Redeem rewards<ArrowUpRight /></Link>
          </Button>
          <VerifiedNote>Earned with purpose. Rewarded with care.</VerifiedNote>
        </section>

        <div className="info-note">
          <LockKeyhole size={18} />
          <p>Points can't be transferred or exchanged for cash</p>
        </div>

        <div className="segmented-control">
          <Button variant={tab === 'history' ? 'default' : 'ghost'} onClick={() => setTab('history')}>
            Points History
          </Button>
          <Button variant={tab === 'redemptions' ? 'default' : 'ghost'} onClick={() => setTab('redemptions')}>
            Redemptions
          </Button>
        </div>

        {tab === 'history' ? (
          <div className="ledger-list">
            <div className="demo-badge-row">
              <span className={`demo-tag ${backendActive ? 'bg-emerald-600 text-white' : ''}`}>
                {backendActive ? 'LIVE DATABASE' : 'DEMO DATA'}
              </span>
              <span>
                {backendActive
                  ? 'Authoritative PostgreSQL points ledger'
                  : 'Verified historical community actions'}
              </span>
            </div>
            {data.transactions.map(p => (
              <div className="ledger-row" key={p.id}>
                <span className={`ledger-icon ${p.type}`}>
                  {p.type === 'earned' ? <ArrowDownLeft size={19} /> : <Gift size={19} />}
                </span>
                <div>
                  <h3>{p.title}</h3>
                  <span>{formatDate(p.date)}</span>
                </div>
                <strong className={p.type === 'earned' ? 'earned-text' : ''}>
                  {p.points > 0 ? '+' : '−'}{Math.abs(p.points)}<small>points</small>
                </strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="redemption-list">
            <div className="demo-badge-row">
              <span className="demo-tag">DEMO VOUCHERS</span>
              <span>Non-transferable partner vouchers</span>
            </div>
            {data.redemptions.map(r => (
              <Link key={r.id} to="/redemptions/$redemptionId" params={{ redemptionId: r.id }} className="redemption-row">
                <Merchant brand={r.brand} />
                <div>
                  <h3>{r.brand} ₹{r.value}</h3>
                  <span>{formatDate(r.redeemedAt)}</span>
                </div>
                <ArrowUpRight size={18} />
              </Link>
            ))}
            {!data.redemptions.length && (
              <EmptyState title="Your first reward is waiting" message="Turn your verified points into a gift voucher.">
                <Button asChild><Link to="/redeem">Explore rewards</Link></Button>
              </EmptyState>
            )}
          </div>
        )}
      </div>
    </>
  );
}
export function Merchant({ brand }: { brand: Redemption['brand'] }) { return <span className={`merchant merchant-${brand.toLowerCase()}`} aria-label={brand}>{brand === 'Amazon' ? <span className="amazon-letter">a<span>⌣</span></span> : <span className="flipkart-letter">f</span>}</span>; }
export function RedeemPage() {
 const { data } = useSuspenseQuery(snapshotOptions); const [selection, setSelection] = useState<{ voucher: Voucher; brand: Redemption['brand'] } | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const queryClient = useQueryClient(); const navigate = useNavigate();
 async function confirm() { if (!selection || busy) return; setBusy(true); setError(''); try { const r = await redeemVoucher(selection.voucher.id, selection.brand); await queryClient.invalidateQueries({ queryKey: snapshotOptions.queryKey }); setSelection(null); await navigate({ to: '/redemptions/$redemptionId', params: { redemptionId: r.id } }); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { setBusy(false); } }
 return <><PageHeader title="A little reward for your good" back="/wallet"/><div className="page-content"><div className="redeem-balance"><Sprout size={19}/><span><b>{data.user.balance}</b> points available</span><ShieldCheck size={17}/></div><div className="intro-copy"><h2>Good deeds. Great rewards.</h2><p>Choose a gift voucher that makes you smile.</p></div><div className="voucher-grid">{data.vouchers.flatMap(v => v.brands.map(brand => <Button variant="outline" key={`${v.id}-${brand}`} disabled={!canRedeem(data.user.balance, v.cost)} className="voucher-card" onClick={() => { setError(''); setSelection({ voucher: v, brand }); }}><Merchant brand={brand}/><span className="voucher-brand">{brand}</span><strong>₹{v.value}</strong><span className="voucher-cost"><Sprout size={13}/>{v.cost} points</span><span className="voucher-action">{canRedeem(data.user.balance, v.cost) ? <>Choose voucher<ArrowUpRight size={14}/></> : <><LockKeyhole size={13}/>{v.cost - data.user.balance} more points</>}</span></Button>))}</div><VerifiedNote>Vouchers are for you. Points are non-transferable.</VerifiedNote><p className="demo-note">Demo vouchers · Not valid for purchases</p></div><Dialog.Root open={!!selection} onOpenChange={open => { if (!open && !busy) setSelection(null); }}><Dialog.Portal><Dialog.Overlay className="modal-overlay"/><Dialog.Content className="bottom-sheet"><Dialog.Close asChild><Button variant="ghost" size="icon" className="sheet-close" aria-label="Close confirmation" disabled={busy}><X/></Button></Dialog.Close><div className="sheet-handle"/>{selection && <><div className="sheet-merchant"><Merchant brand={selection.brand}/></div><Dialog.Title className="sheet-title">A well-earned little reward</Dialog.Title><Dialog.Description className="sheet-description">Redeem {selection.voucher.cost} points for a {selection.brand} ₹{selection.voucher.value} gift voucher.</Dialog.Description><div className="confirmation-summary"><div><span>Points used</span><b>{selection.voucher.cost} pts</b></div><div><span>Balance after redemption</span><b>{data.user.balance - selection.voucher.cost} pts</b></div></div><p className="demo-note">This is a demonstration voucher, not a real gift card.</p>{error && <p className="error-message" role="alert">{error}</p>}<Button className="w-full" onClick={confirm} disabled={busy}>{busy ? 'Getting your voucher…' : 'Confirm redemption'}<Gift/></Button><Button className="w-full mt-2" variant="ghost" onClick={() => setSelection(null)} disabled={busy}>Not right now</Button></>}</Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
export function RedemptionDetailPage({ redemptionId }: { redemptionId: string }) {
 const { data } = useSuspenseQuery(snapshotOptions); const r = data.redemptions.find(r => r.id === redemptionId); const [revealed, setRevealed] = useState(false); const [copied, setCopied] = useState(false); const [error, setError] = useState('');
 async function copy() { if (!r) return; try { await navigator.clipboard.writeText(r.code); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setError('Copy is unavailable here. Reveal the code and select it to copy.'); } }
 if (!r) return <><PageHeader title="Your reward" back="/wallet"/><EmptyState title="Voucher not found"/></>;
 return <><PageHeader title="Your well-earned reward" back="/wallet"/><div className="page-content reveal-page"><div className="reward-success"><Check size={24}/></div><h1>A little good, rewarded.</h1><p>Thank you for showing up for your community.</p><div className="reveal-ticket"><Merchant brand={r.brand}/><h2>{r.brand} gift voucher</h2><strong>₹{r.value}</strong><span>{r.cost} civic points, well spent</span><div className="ticket-divider"/><p className="code-label">YOUR VOUCHER CODE</p><div className="voucher-code">{revealed ? r.code : '•••• − •••• − ••••'}</div><div className="code-actions"><Button variant="outline" onClick={() => setRevealed(v => !v)}>{revealed ? <EyeOff/> : <Eye/>}{revealed ? 'Hide' : 'Reveal'}</Button><Button onClick={copy}>{copied ? <Check/> : <Copy/>}{copied ? 'Copied!' : 'Copy'}</Button></div><div className="ticket-expiry"><ClockIcon/>Expires {formatDate(r.expiresAt)}</div></div>{error && <p className="error-message">{error}</p>}<div className="info-note"><ShieldCheck size={21}/><p>Keep your voucher code private. Demo codes are not valid for purchases.</p></div><Button asChild variant="outline" className="w-full"><Link to="/wallet">Back to wallet</Link></Button></div></>;
}
function ClockIcon() { return <span aria-hidden="true">◷</span>; }
