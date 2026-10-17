import { createFileRoute } from '@tanstack/react-router';
import { CapturePage } from '@/pages/capture';
export const Route = createFileRoute('/capture')({
  validateSearch: (search: Record<string, unknown>): { taskId?: string } => ({
    taskId: typeof search.taskId === 'string' ? search.taskId : undefined,
  }),
  head: () => ({ meta: [
  { title: 'Report a civic issue — SSS Civic Tech' },
  { name: 'description', content: 'Use your live camera to geo-tag and submit a civic report in seconds.' },
  { property: 'og:title', content: 'Report a civic issue — SSS Civic Tech' },
  { property: 'og:description', content: 'Use your live camera to geo-tag and submit a civic report in seconds.' },
  { property: 'og:type', content: 'website' },
  { name: 'twitter:card', content: 'summary_large_image' },
  ] }),
  component: CapturePage,
});
