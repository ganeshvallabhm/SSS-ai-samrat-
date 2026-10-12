import { createFileRoute } from '@tanstack/react-router';
import { ConsentPage } from '@/pages/welcome';
export const Route = createFileRoute('/consent')({
 head: () => ({ meta: [
 { title: 'Your trust comes first — SSS Civic Tech' },
 { name: 'description', content: 'Understand how task photos, location and civic data are used before you start.' },
 { property: 'og:title', content: 'Your trust comes first — SSS Civic Tech' },
 { property: 'og:description', content: 'Understand how task photos, location and civic data are used before you start.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: ConsentPage,
});
