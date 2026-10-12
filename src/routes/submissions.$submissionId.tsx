import { createFileRoute } from '@tanstack/react-router';
import { SubmissionDetailPage } from '@/pages/submissions';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
export const Route = createFileRoute('/submissions/$submissionId')({
 head: () => ({ meta: [
 { title: 'Submission journey — SSS Civic Tech' },
 { name: 'description', content: 'Follow your civic task from submission and review to verified points.' },
 { property: 'og:title', content: 'Submission journey — SSS Civic Tech' },
 { property: 'og:description', content: 'Follow your civic task from submission and review to verified points.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: RoutePage,
});
function RoutePage() { const { submissionId } = Route.useParams(); return <SubmissionDetailPage submissionId={submissionId}/>; }
