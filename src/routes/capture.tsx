import { createFileRoute } from '@tanstack/react-router';
import { CapturePage } from '@/pages/welcome';
export const Route = createFileRoute('/capture')({
 head: () => ({ meta: [
 { title: 'Capture a civic action — SSS Civic Tech' },
 { name: 'description', content: 'The future home of live geo-tagged civic task photos. Camera coming next.' },
 { property: 'og:title', content: 'Capture a civic action — SSS Civic Tech' },
 { property: 'og:description', content: 'The future home of live geo-tagged civic task photos. Camera coming next.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: CapturePage,
});
