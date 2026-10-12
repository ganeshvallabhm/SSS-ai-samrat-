export type TaskCategory = 'civic' | 'green' | 'health' | 'governance';
export type SubmissionStatus = 'under_review' | 'approved' | 'rejected';
export interface User { id: string; name: string; phone: string; ward: string; city: string; balance: number; monthlyPoints: number; }
export interface Task { id: string; title: string; category: TaskCategory; points: number; distance: number; location: string; description: string; requirements: string[]; date: string; }
export interface Submission { id: string; taskId: string; status: SubmissionStatus; submittedAt: string; reviewedAt?: string; reason?: string; }
export interface PointsTransaction { id: string; title: string; points: number; date: string; type: 'earned' | 'redeemed'; }
export interface Voucher { id: string; value: 100 | 250 | 500; cost: number; brands: ('Amazon' | 'Flipkart')[]; }
export interface Redemption { id: string; brand: 'Amazon' | 'Flipkart'; value: number; cost: number; code: string; redeemedAt: string; expiresAt: string; }
export interface Notification { id: string; title: string; message: string; type: 'approved' | 'rejected' | 'points_added' | 'voucher_ready'; date: string; read: boolean; submissionId?: string; redemptionId?: string; }
export interface AppSnapshot { user: User; tasks: Task[]; submissions: Submission[]; transactions: PointsTransaction[]; vouchers: Voucher[]; redemptions: Redemption[]; notifications: Notification[]; }
