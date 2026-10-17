import { createFileRoute } from '@tanstack/react-router';
import { ReviewerPage } from '@/pages/reviewer';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';

export const Route = createFileRoute('/reviewer')({
  head: () => ({
    meta: [
      { title: 'Reviewer Portal (Demo) — SSS Civic Tech' },
      { name: 'description', content: 'Verification portal for evaluating and approving citizen civic submissions.' },
      { property: 'og:title', content: 'Reviewer Portal (Demo) — SSS Civic Tech' },
      { property: 'og:description', content: 'Verification portal for evaluating and approving citizen civic submissions.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
  pendingComponent: LoadingPage,
  pendingMs: 0,
  pendingMinMs: 500,
  component: ReviewerPage,
});
