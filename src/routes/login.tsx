import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '@/pages/welcome';
export const Route = createFileRoute('/login')({
 head: () => ({ meta: [
 { title: 'Join your civic community — SSS Civic Tech' },
 { name: 'description', content: 'Sign in to SSS Civic Tech with a mobile number and demonstration verification code.' },
 { property: 'og:title', content: 'Join your civic community — SSS Civic Tech' },
 { property: 'og:description', content: 'Sign in to SSS Civic Tech with a mobile number and demonstration verification code.' },
 { property: 'og:type', content: 'website' },
 { name: 'twitter:card', content: 'summary_large_image' },
 ] }),
 component: LoginPage,
});
