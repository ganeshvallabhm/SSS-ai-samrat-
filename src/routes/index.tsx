import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '@/pages/home';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/')({
 head: () => ({ meta: [
 { title: 'Your neighbourhood, a little better — SSS Civic Tech' },
 { name: 'description', content: 'Find nearby civic tasks, track your impact and earn verified civic points in Hyderabad.' },
 { property: 'og:title', content: 'Your neighbourhood, a little better — SSS Civic Tech' },
 { property: 'og:description', content: 'Find nearby civic tasks, track your impact and earn verified civic points in Hyderabad.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: HomePage,
});
