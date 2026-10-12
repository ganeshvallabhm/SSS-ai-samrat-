import { createFileRoute } from '@tanstack/react-router';
import { SubmissionsPage } from '@/pages/submissions';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/submissions/')({
 head: () => ({ meta: [
 { title: 'My civic submissions — SSS Civic Tech' },
 { name: 'description', content: 'Track your submitted civic tasks and see their verification status.' },
 { property: 'og:title', content: 'My civic submissions — SSS Civic Tech' },
 { property: 'og:description', content: 'Track your submitted civic tasks and see their verification status.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: SubmissionsPage,
});
