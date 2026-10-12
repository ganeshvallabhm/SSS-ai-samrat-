import { createFileRoute } from '@tanstack/react-router';
import { TasksPage } from '@/pages/tasks';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/tasks/')({
 head: () => ({ meta: [
 { title: 'Explore civic tasks — SSS Civic Tech' },
 { name: 'description', content: 'Discover community tasks, planting drives, road reports, health camps and local surveys in Hyderabad.' },
 { property: 'og:title', content: 'Explore civic tasks — SSS Civic Tech' },
 { property: 'og:description', content: 'Discover community tasks, planting drives, road reports, health camps and local surveys in Hyderabad.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: TasksPage,
});
