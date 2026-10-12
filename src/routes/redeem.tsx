import { createFileRoute } from '@tanstack/react-router';
import { RedeemPage } from '@/pages/wallet';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/redeem')({
 head: () => ({ meta: [
 { title: 'Redeem your civic rewards — SSS Civic Tech' },
 { name: 'description', content: 'Choose Amazon or Flipkart demonstration vouchers with your verified civic points.' },
 { property: 'og:title', content: 'Redeem your civic rewards — SSS Civic Tech' },
 { property: 'og:description', content: 'Choose Amazon or Flipkart demonstration vouchers with your verified civic points.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: RedeemPage,
});
