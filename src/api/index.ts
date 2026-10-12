import { queryOptions } from '@tanstack/react-query';
import { mockData } from '@/data/mock';
import type { AppSnapshot, Redemption } from '@/types';
export const MONTHLY_CAP = 500;
export const OTP_RESEND_SECONDS = 30;
let state: AppSnapshot = structuredClone(mockData);
export const delay = () => new Promise<void>(resolve => setTimeout(resolve, 500));
export function monthlyProgress(points: number) { return Math.min(100, Math.max(0, points / MONTHLY_CAP * 100)); }
export function canRedeem(balance: number, cost: number) { return cost > 0 && balance >= cost; }
export function validOtp(code: string) { return /^\d{6}$/.test(code); }
export async function getSnapshot() { await delay(); return structuredClone(state); }
export const snapshotOptions = queryOptions({ queryKey: ['civic-app'], queryFn: getSnapshot, staleTime: 30_000 });
export async function sendOtp(phone: string) { await delay(); if (!/^\d{10}$/.test(phone)) throw new Error('Enter a valid 10-digit mobile number.'); return { sent: true }; }
export async function verifyOtp(phone: string, code: string) { await delay(); if (!validOtp(code)) throw new Error('Enter all six digits.'); state.user.phone = phone; return structuredClone(state.user); }
export async function acceptConsent() { await delay(); return { accepted: true }; }
export async function logOut() { await delay(); return { signedOut: true }; }
export async function markNotificationsRead() { await delay(); state.notifications.forEach(n => n.read = true); }
export async function redeemVoucher(voucherId: string, brand: Redemption['brand']) {
 await delay();
 const voucher = state.vouchers.find(v => v.id === voucherId);
 if (!voucher || !voucher.brands.includes(brand)) throw new Error('This voucher is not available.');
 if (!canRedeem(state.user.balance, voucher.cost)) throw new Error('You need a few more points for this voucher.');
 const now = new Date(); const expiry = new Date(now); expiry.setFullYear(expiry.getFullYear() + 1);
 const id = `r-${crypto.randomUUID()}`;
 const redemption: Redemption = { id, brand, value: voucher.value, cost: voucher.cost, code: `SSS-DEMO-${brand === 'Amazon' ? 'AMZ' : 'FLK'}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, redeemedAt: now.toISOString(), expiresAt: expiry.toISOString() };
 state.user.balance -= voucher.cost;
 state.redemptions.unshift(redemption);
 state.transactions.unshift({ id: `p-${id}`, title: `${brand} ₹${voucher.value} voucher`, points: -voucher.cost, type: 'redeemed', date: now.toISOString() });
 state.notifications.unshift({ id: `n-${id}`, title: `Your ${brand} voucher is ready`, message: `Your ₹${voucher.value} gift voucher is ready to reveal.`, type: 'voucher_ready', date: now.toISOString(), read: false, redemptionId: id });
 return structuredClone(redemption);
}
