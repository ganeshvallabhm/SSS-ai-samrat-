import { createFileRoute } from '@tanstack/react-router';
import { TaskDetailPage } from '@/pages/tasks';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/tasks/$taskId')({
 head: () => ({ meta: [
 { title: 'Civic task details — SSS Civic Tech' },
 { name: 'description', content: 'See the requirements and verified points reward for a nearby civic task.' },
 { property: 'og:title', content: 'Civic task details — SSS Civic Tech' },
 { property: 'og:description', content: 'See the requirements and verified points reward for a nearby civic task.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: RoutePage,
});
function RoutePage() { const { taskId } = Route.useParams(); return <TaskDetailPage taskId={taskId}/>; }
