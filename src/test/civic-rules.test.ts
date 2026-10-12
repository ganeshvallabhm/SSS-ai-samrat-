import { describe, expect, it, vi } from 'vitest';
import { MONTHLY_CAP, OTP_RESEND_SECONDS, canRedeem, monthlyProgress, validOtp, getSnapshot, redeemVoucher } from '@/api';
import { mockData } from '@/data/mock';
describe('Civic reward and login rules', () => {
 it('caps monthly progress at 500 points', () => { expect(MONTHLY_CAP).toBe(500); expect(monthlyProgress(180)).toBe(36); expect(monthlyProgress(600)).toBe(100); });
 it('accepts any six digit OTP and rejects incomplete input', () => { expect(validOtp('000000')).toBe(true); expect(validOtp('123456')).toBe(true); expect(validOtp('12345')).toBe(false); expect(validOtp('abcdef')).toBe(false); });
 it('waits 30 seconds before OTP resend', () => { expect(OTP_RESEND_SECONDS).toBe(30); });
 it('requires enough points for a voucher', () => { expect(canRedeem(320, 500)).toBe(false); expect(canRedeem(100, 100)).toBe(true); expect(canRedeem(99, 100)).toBe(false); });
 it('contains the requested seed counts and statuses', () => { expect(mockData.tasks).toHaveLength(12); expect(mockData.submissions).toHaveLength(8); expect(mockData.transactions).toHaveLength(12); expect(mockData.vouchers).toHaveLength(3); expect(mockData.notifications).toHaveLength(6); expect(new Set(mockData.submissions.map(s => s.status)).size).toBe(3); });
 it('delays mock reads by 500ms', async () => { vi.useFakeTimers(); let done = false; const request = getSnapshot().then(() => done = true); await vi.advanceTimersByTimeAsync(499); expect(done).toBe(false); await vi.advanceTimersByTimeAsync(1); await request; expect(done).toBe(true); vi.useRealTimers(); });
 it('deducts points and records a non-transferable voucher redemption', async () => { const before = await getSnapshot(); const r = await redeemVoucher('v100', 'Flipkart'); const after = await getSnapshot(); expect(after.user.balance).toBe(before.user.balance - 100); expect(after.redemptions[0]?.id).toBe(r.id); expect(after.transactions[0]?.points).toBe(-100); expect(r.brand).toBe('Flipkart'); await expect(redeemVoucher('v500', 'Amazon')).rejects.toThrow('more points'); });
});
