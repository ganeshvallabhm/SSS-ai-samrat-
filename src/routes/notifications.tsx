import { createFileRoute } from '@tanstack/react-router';
import { NotificationsPage } from '@/pages/account';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/notifications')({
 head: () => ({ meta: [
 { title: 'Your civic updates — SSS Civic Tech' },
 { name: 'description', content: 'Get updates on approved tasks, verification, points and gift vouchers.' },
 { property: 'og:title', content: 'Your civic updates — SSS Civic Tech' },
 { property: 'og:description', content: 'Get updates on approved tasks, verification, points and gift vouchers.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: NotificationsPage,
});
