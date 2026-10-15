# Frontend Architecture & API Audit: SSS Civic Tech

This document audits the mobile web frontend of **SSS Civic Tech** prior to backend API implementation and database provisioning.

---

## 1. Tech Stack & Framework Versions

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Runtime & Bundler** | Vite | `8.1.5` | Fast ESM build tool and local dev server |
| **Framework** | React | `19.2.0` | UI component rendering |
| **Fullstack Framework** | TanStack Start | `1.168.60` | SSR / Fullstack React architecture |
| **Routing** | TanStack Router | `1.170.41` | Type-safe, file-based routing (`src/routes`) |
| **State & Cache** | TanStack Query | `5.101.1` | Asynchronous query management & cache keys |
| **Styling** | Tailwind CSS | `4.2.1` | Utility-first CSS via `@tailwindcss/vite` |
| **UI Components** | Radix UI primitives | `^1.1.x`–`^2.x` | Accessible headless primitives (Dialog, Tabs, Accordion) |
| **Icons** | Lucide React | `0.575.0` | SVG icons across navigation and actions |
| **Forms & Validation**| React Hook Form & Zod | `7.71.2` / `3.25.76` | Form state management and schema validation |
| **Testing** | Vitest & Testing Library | `4.1.10` / `16.0.0` | Unit & component tests in JSDOM environment |

### Routing Mechanism
- Uses **TanStack Router file-based route generation** via `@tanstack/router-plugin`.
- Generated tree is compiled into `src/routeTree.gen.ts`.
- Root shell is defined in `src/routes/__root.tsx` providing the mobile frame layout (`max-w-md mx-auto`), header navigation, and bottom navigation bar (`Home`, `Tasks`, `Capture`, `Submissions`, `Wallet`).

---

## 2. Route & Page Directory

| Route Path | File | Component / Page | Description |
| :--- | :--- | :--- | :--- |
| `/` | `src/routes/index.tsx` | `HomePage` (`src/pages/home.tsx`) | Feed with greeting, monthly points progress bar, quick actions, and recent activity list |
| `/onboarding` | `src/routes/onboarding.tsx` | Onboarding | Introduction slides explaining civic tasks, verified photos, and vouchers |
| `/consent` | `src/routes/consent.tsx` | Consent | Terms of service and privacy consent step before login/onboarding |
| `/login` | `src/routes/login.tsx` | `WelcomePage` (`src/pages/welcome.tsx`) | Phone number input and 6-digit OTP verification screen |
| `/tasks` | `src/routes/tasks.index.tsx` | `TasksPage` (`src/pages/tasks.tsx`) | Browse tasks with category filter chips (`civic`, `green`, `health`, `governance`) and distance |
| `/tasks/$taskId` | `src/routes/tasks.$taskId.tsx` | Task Details | Full requirements, reward points, location, and "Start Task" / "Capture" CTA |
| `/capture` | `src/routes/capture.tsx` | `CapturePage` (`src/pages/capture.tsx`) | Multi-step live camera capture flow (category picker → explainer → viewfinder → preview → details → success) |
| `/submissions` | `src/routes/submissions.index.tsx` | `SubmissionsPage` (`src/pages/submissions.tsx`) | List of user's past and in-flight submissions with status badges (`under_review`, `approved`, `rejected`) |
| `/submissions/$submissionId`| `src/routes/submissions.$submissionId.tsx` | Submission Detail | Submission timeline, photo preview, reviewed timestamp, and rejection reason if rejected |
| `/wallet` | `src/routes/wallet.tsx` | `WalletPage` (`src/pages/wallet.tsx`) | Balance card, points transaction history, monthly cap progress, and redeemed vouchers carousel |
| `/redeem` | `src/routes/redeem.tsx` | Voucher Catalog | Redeemable gift card options (₹100, ₹250, ₹500 for Amazon / Flipkart) |
| `/redemptions/$redemptionId`| `src/routes/redemptions.$redemptionId.tsx` | Redemption Detail | Barcode, voucher code reveal, expiry date, and usage instructions |
| `/notifications` | `src/routes/notifications.tsx` | Notifications | In-app notification list for task approval, points addition, or rejection notices |
| `/profile` | `src/routes/profile.index.tsx` | `AccountPage` (`src/pages/account.tsx`) | User profile, ward info, phone, and links to app settings |
| `/profile/$topic` | `src/routes/profile.$topic.tsx` | Profile Topic | Informational pages (terms, privacy, help, FAQs) |

---

## 3. TypeScript Type Definitions

Defined in `src/types/index.ts` and `src/lib/submissionStore.ts`:

### Core Enums & Literals
- `TaskCategory`: `'civic' | 'green' | 'health' | 'governance'`
- `SubmissionStatus`: `'under_review' | 'approved' | 'rejected'`
- `VoucherBrand`: `'Amazon' | 'Flipkart'`

### Interfaces
```typescript
export interface User {
  id: string;
  name: string;
  phone: string;
  ward: string;
  city: string;
  balance: number;
  monthlyPoints: number;
}

export interface Task {
  id: string;
  title: string;
  category: TaskCategory;
  points: number;
  distance: number;
  location: string;
  description: string;
  requirements: string[];
  date: string;
}

export interface Submission {
  id: string;
  taskId: string;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reason?: string;
}

export interface PointsTransaction {
  id: string;
  title: string;
  points: number;
  date: string;
  type: 'earned' | 'redeemed';
}

export interface Voucher {
  id: string;
  value: 100 | 250 | 500;
  cost: number;
  brands: ('Amazon' | 'Flipkart')[];
}

export interface Redemption {
  id: string;
  brand: 'Amazon' | 'Flipkart';
  value: number;
  cost: number;
  code: string;
  redeemedAt: string;
  expiresAt: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'approved' | 'rejected' | 'points_added' | 'voucher_ready';
  date: string;
  read: boolean;
  submissionId?: string;
  redemptionId?: string;
}

export interface AppSnapshot {
  user: User;
  tasks: Task[];
  submissions: Submission[];
  transactions: PointsTransaction[];
  vouchers: Voucher[];
  redemptions: Redemption[];
  notifications: Notification[];
}

export interface LocalSubmission extends Submission {
  photoDataUrl?: string;
  note?: string;
  address?: string;
}
```

---

## 4. Functions in `src/api`

All client operations currently run against in-memory state in `src/api/index.ts`:

| Function Name | Parameters | Return Type | Callers / Pages |
| :--- | :--- | :--- | :--- |
| `getSnapshot()` | `none` | `Promise<AppSnapshot>` | Root loader / TanStack Query `['civic-app']` |
| `sendOtp(phone)` | `phone: string` | `Promise<{ sent: boolean }>` | `src/pages/welcome.tsx` |
| `verifyOtp(phone, code)`| `phone: string, code: string` | `Promise<User>` | `src/pages/welcome.tsx` |
| `acceptConsent()` | `none` | `Promise<{ accepted: boolean }>` | `src/routes/consent.tsx` |
| `logOut()` | `none` | `Promise<{ signedOut: boolean }>` | `src/pages/account.tsx` |
| `markNotificationsRead()`| `none` | `Promise<void>` | `src/routes/notifications.tsx` |
| `redeemVoucher(voucherId, brand)` | `voucherId: string, brand: 'Amazon' \| 'Flipkart'` | `Promise<Redemption>` | `src/pages/wallet.tsx`, `src/routes/redeem.tsx` |
| `monthlyProgress(points)`| `points: number` | `number` (0 to 100) | `src/pages/home.tsx`, `src/pages/wallet.tsx` |
| `canRedeem(balance, cost)` | `balance: number, cost: number` | `boolean` | `src/pages/wallet.tsx`, `src/routes/redeem.tsx` |
| `validOtp(code)` | `code: string` | `boolean` | `src/pages/welcome.tsx` |

---

## 5. Live Capture Storage & Metadata Collected

### Where submissions are stored:
- Submissions created via `/capture` are saved into an **in-memory pub/sub store** in `src/lib/submissionStore.ts` via `submissionStore.add(submission)`.
- The list pages (`src/pages/submissions.tsx`) and the Home activity feed subscribe to this store using `useSyncExternalStore`.
- Submissions are transient and reset on full page reload.

### Metadata collected during capture:
| Field | Type | Source | Purpose |
| :--- | :--- | :--- | :--- |
| `id` | `string` | Client UUID (`cap-${uuid.slice(0, 8)}`) | Temporary identifier |
| `taskId` | `string` | Mapped from chosen category (`t1`, `t2`, `t7`, `t10`) | Task association |
| `status` | `SubmissionStatus` | Set to `'under_review'` | Initial review state |
| `submittedAt` | `string` | ISO8601 string (`new Date().toISOString()`) | Timestamp of submission |
| `photoDataUrl` | `string` | Canvas snapshot of live `getUserMedia` stream | Live image with burned-in timestamp + lat/lng text watermark |
| `lat` & `lng` | `number` | `navigator.geolocation.watchPosition` | Exact GPS coordinates |
| `accuracy` | `number` | `geolocation.coords.accuracy` (meters) | Accuracy validation (< 50m requirement) |
| `address` | `string` | OpenStreetMap Nominatim reverse geocoding | Street and ward context |
| `note` | `string` | User text input (optional) | Explanatory description from citizen |

---

## 6. Simulated Backend Behaviors in the Current UI

1. **OTP Dispatch & Verification**: `sendOtp` and `verifyOtp` accept any valid format without talking to an SMS gateway; any 6-digit code succeeds.
2. **Points Minting & Balance Deduction**: Point ledger transactions are mutated in client memory without double-spend protection or append-only ledger security.
3. **Voucher Generation**: Voucher redemption generates fake demo voucher codes (`SSS-DEMO-AMZ-...`) and increments expiry by 1 year locally.
4. **Task Verification**: Review approvals and rejections are static fixtures seeded in `src/data/mock.ts`. No moderator queue or automated geofencing check exists yet.
5. **Reverse Geocoding**: Direct browser fetch to OpenStreetMap Nominatim API, subject to client rate limits.
6. **Authentication State**: User profile is held in memory and resets when the app is refreshed.
