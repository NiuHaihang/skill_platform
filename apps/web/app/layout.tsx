import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'SkillForge — AI Agent & Skill Platform',
    template: '%s | SkillForge',
  },
  description:
    'Build, share, and run powerful AI Skills. Create intelligent agents with a drag-and-drop marketplace of reusable capabilities.',
  keywords: ['AI', 'Agent', 'Skills', 'LLM', 'GPT', 'AI platform', 'automation'],
  authors: [{ name: 'SkillForge Team' }],
  openGraph: {
    type: 'website',
    siteName: 'SkillForge',
    title: 'SkillForge — AI Agent & Skill Platform',
    description: 'Build, share, and run powerful AI Skills.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
