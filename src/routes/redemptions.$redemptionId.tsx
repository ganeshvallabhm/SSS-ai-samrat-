import { createFileRoute } from '@tanstack/react-router';
import { RedemptionDetailPage } from '@/pages/wallet';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/redemptions/$redemptionId')({
 head: () => ({ meta: [
 { title: 'Your well-earned reward — SSS Civic Tech' },
 { name: 'description', content: 'Reveal and copy your demonstration gift voucher and check its expiry date.' },
 { property: 'og:title', content: 'Your well-earned reward — SSS Civic Tech' },
 { property: 'og:description', content: 'Reveal and copy your demonstration gift voucher and check its expiry date.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: RoutePage,
});
function RoutePage() { const { redemptionId } = Route.useParams(); return <RedemptionDetailPage redemptionId={redemptionId}/>; }
