import { createFileRoute } from '@tanstack/react-router';
import { WalletPage } from '@/pages/wallet';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/wallet')({
 head: () => ({ meta: [
 { title: 'Your civic points wallet — SSS Civic Tech' },
 { name: 'description', content: 'View earned civic points, reward history and gift voucher redemptions.' },
 { property: 'og:title', content: 'Your civic points wallet — SSS Civic Tech' },
 { property: 'og:description', content: 'View earned civic points, reward history and gift voucher redemptions.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: WalletPage,
});
