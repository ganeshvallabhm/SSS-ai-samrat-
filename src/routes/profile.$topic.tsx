import { createFileRoute } from '@tanstack/react-router';
import { InformationPage } from '@/pages/account';
import { snapshotOptions } from '@/api';
import { LoadingPage } from '@/components/civic/shared';
import { infoContent } from '@/components/civic/shared';
export const Route = createFileRoute('/profile/$topic')({
 head: ({ params }) => {
 const info = infoContent[params.topic as keyof typeof infoContent];
 const title = `${info?.title ?? 'Citizen information'} — SSS Civic Tech`;
 const description = info?.text ?? 'Civic information and help for SSS Civic Tech.';
 return { meta: [
 { title },
 { name: 'description', content: description },
 { property: 'og:title', content: title },
 { property: 'og:description', content: description },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }; },
 loader: ({ context }) => context.queryClient.ensureQueryData(snapshotOptions),
 pendingComponent: LoadingPage,
 pendingMs: 0,
 pendingMinMs: 500,
 component: RoutePage,
});
function RoutePage() { const { topic } = Route.useParams(); return <InformationPage topic={topic}/>; }
