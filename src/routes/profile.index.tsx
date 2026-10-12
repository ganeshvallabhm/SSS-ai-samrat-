import { createFileRoute } from '@tanstack/react-router';
import { ProfilePage } from '@/pages/account';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/profile/')({
 head: () => ({ meta: [
 { title: 'Your citizen profile — SSS Civic Tech' },
 { name: 'description', content: 'Manage your civic profile, theme and privacy information.' },
 { property: 'og:title', content: 'Your citizen profile — SSS Civic Tech' },
 { property: 'og:description', content: 'Manage your civic profile, theme and privacy information.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: ProfilePage,
});
