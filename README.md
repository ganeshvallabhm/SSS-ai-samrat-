# Civic Spark

Build the frontend of "SSS Civic Tech", a MOBILE-ONLY civic-engagement app. Design for 360–430px phone screens only. On wider screens show the app inside a centered 430px phone-width frame. No desktop layout and no admin or reviewer screens. No backend: use typed mock data in /src/data/mock.ts and async functions in /src/api returning Promises with a 500ms delay.

CONCEPT
Citizens complete small verified civic tasks and earn points. Each task is proven with a live geo-tagged photo. Approved tasks add points to a non-transferable wallet, and points are redeemed for gift vouchers (Amazon, Flipkart). No cash, no crypto.

DESIGN
Calm, trustworthy civic style. Primary deep green #1F7A5A, accent amber #F59E0B, slate neutrals, success green, warning amber, danger red. Font Inter. Cards with rounded-2xl and soft shadows. Tap targets at least 44px. Status chips always show icon plus label: Under review (amber), Approved (green), Rejected (red). Add skeleton loaders and friendly empty states. Respect safe areas and use 100dvh.

TYPES
User, Task, TaskCategory, Submission (status: under_review | approved | rejected), PointsTransaction, Voucher, Redemption, Notification.

NAVIGATION
Bottom tab bar: Home, Tasks, Wallet, Profile, with a raised circular camera button in the centre that goes to /capture. For now /capture is a simple placeholder page saying "Camera coming next". Hide the tab bar on onboarding, login and capture.

SCREENS (all fully working with mock data)
1. Onboarding: 3 swipeable slides (Do a task, Get verified, Earn rewards) with Skip.
2. Login: +91 phone number, then 6-digit OTP boxes (any code works, 30-second resend timer).
3. Consent: plain-language explainer for camera, location and data use, with an Accept button.
4. Home: greeting, points balance card with a monthly progress bar (cap 500 points), "Near you today" task cards, impact summary, recent activity.
5. Tasks: category chips (Civic Audits & Road Reports, Green Plantation & Clean Drives, Blood Donation & Health Camps, Local Governance Surveys), search, task cards showing points and distance. Task detail page with a requirements checklist, reward and a sticky "Start task" button that goes to /capture.
6. Submissions: list with status filter. Detail page with a status timeline (Submitted, Under review, Approved/Rejected, Points added) and, for rejected items, the reason and a Resubmit button.
7. Wallet: balance hero, toggle between Points History and Redemptions, and the note "Points can't be transferred or exchanged for cash".
8. Redeem: voucher grid (Amazon, Flipkart; ₹100, ₹250, ₹500), disabled when points are insufficient, a confirmation sheet, then a reveal screen with a masked code, Reveal and Copy buttons, and expiry.
9. Notifications list (approved, rejected, points added, voucher ready).
10. Profile: name, ward, theme toggle, How points work, Privacy summary, Help, Log out.

SEED DATA
One user in Hyderabad, 12 tasks across the four categories, 8 submissions covering every status, 12 ledger entries, 3 vouchers, 6 notifications. Use realistic names, ward names and dates.

Every button must lead somewhere or show a meaningful result. Keep the code organised in /pages, /components, /api, /data and /types.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/340bb6d4-9588-4ea7-81b5-f8c2794a852a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
