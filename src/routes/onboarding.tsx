import { createFileRoute } from '@tanstack/react-router';
import { OnboardingPage } from '@/pages/welcome';
export const Route = createFileRoute('/onboarding')({
 head: () => ({ meta: [
 { title: 'Small actions. Shared impact. — SSS Civic Tech' },
 { name: 'description', content: 'Do a civic task, get verified and earn meaningful community rewards.' },
 { property: 'og:title', content: 'Small actions. Shared impact. — SSS Civic Tech' },
 { property: 'og:description', content: 'Do a civic task, get verified and earn meaningful community rewards.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: OnboardingPage,
});
