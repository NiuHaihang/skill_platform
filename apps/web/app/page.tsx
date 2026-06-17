import Link from 'next/link';
import { Zap, Store, Bot, Shield, ArrowRight, Star, Download, Sparkles } from 'lucide-react';

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* ── Navigation ── */}
      <nav className="fixed top-0 inset-x-0 z-50 glass border-b border-border/50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg gradient-text">SkillForge</span>
          </div>

          <div className="hidden md:flex items-center gap-1">
            <Link href="/marketplace" className="btn-ghost">Marketplace</Link>
            <Link href="/docs" className="btn-ghost">Docs</Link>
          </div>

          <div className="flex items-center gap-3">
            <Link href="/login" className="btn-ghost">Sign in</Link>
            <Link href="/register" className="btn-primary">
              Get started <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="pt-40 pb-24 px-6 text-center relative overflow-hidden">
        {/* Background orbs */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-purple-500/8 rounded-full blur-3xl animate-pulse delay-1000" />
        </div>

        <div className="relative max-w-4xl mx-auto animate-slide-up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-brand-500/30 text-sm text-brand-400 mb-8">
            <Sparkles className="w-3.5 h-3.5" />
            MVP v0.1 — Now in Development
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold leading-tight mb-6 text-balance">
            Build{' '}
            <span className="gradient-text">AI Agents</span>
            <br />
            with Reusable Skills
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            SkillForge is an open AI Agent platform where you create, share, and install
            modular Skills — turning language into powerful, executable capabilities.
          </p>

          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/register" className="btn-primary text-base px-8 py-3">
              Start Building <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="/marketplace" className="btn-secondary text-base px-8 py-3">
              <Store className="w-5 h-5" /> Browse Skills
            </Link>
          </div>

          {/* Stats row */}
          <div className="mt-16 grid grid-cols-3 gap-8 max-w-lg mx-auto">
            {[
              { label: 'Skills Available', value: '200+' },
              { label: 'Active Agents', value: '1.2K' },
              { label: 'Executions / day', value: '50K' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold gradient-text">{stat.value}</div>
                <div className="text-sm text-muted-foreground mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">
            Everything you need to build{' '}
            <span className="gradient-text">production AI agents</span>
          </h2>
          <p className="text-center text-muted-foreground mb-16 max-w-xl mx-auto">
            From Skill creation to sandboxed execution, SkillForge handles the hard parts.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((f) => (
              <div
                key={f.title}
                className="glass rounded-2xl p-6 hover:neon-border transition-all duration-300 group"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <f.icon className="w-6 h-6 text-brand-400" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Marketplace Preview ── */}
      <section className="py-24 px-6 relative">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-12">
            <div>
              <h2 className="text-3xl font-bold mb-2">
                Featured <span className="gradient-text">Skills</span>
              </h2>
              <p className="text-muted-foreground">Install and run in seconds.</p>
            </div>
            <Link href="/marketplace" className="btn-secondary">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {demoSkills.map((skill) => (
              <SkillCard key={skill.slug} {...skill} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <div className="glass-lg rounded-3xl p-12 neon-border">
            <h2 className="text-4xl font-extrabold mb-4">
              Ready to <span className="gradient-text">forge your Skills?</span>
            </h2>
            <p className="text-muted-foreground mb-8 text-lg">
              Join developers building the next generation of AI-powered workflows.
            </p>
            <Link href="/register" className="btn-primary text-base px-10 py-3.5">
              Create free account <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border py-12 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center">
              <Zap className="w-3 h-3 text-white" />
            </div>
            <span className="font-semibold text-sm gradient-text">SkillForge</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2026 SkillForge. Built with ❤️ for the AI community.
          </p>
        </div>
      </footer>
    </main>
  );
}

// ─── Feature cards data ───────────────────────────────────────────

const features = [
  {
    icon: Sparkles,
    title: 'AI-Generated Skills',
    desc: 'Describe in plain language. Our LLM pipeline generates a production-ready SKILL.md in seconds.',
  },
  {
    icon: Store,
    title: 'Skill Marketplace',
    desc: 'Browse 200+ community Skills across coding, data analysis, writing, and more.',
  },
  {
    icon: Bot,
    title: 'Agent Builder',
    desc: 'Compose agents by combining Skills. Full SSE streaming for real-time responses.',
  },
  {
    icon: Shield,
    title: 'Sandboxed Execution',
    desc: 'Code runs in isolated Docker containers with seccomp-BPF. Your server stays safe.',
  },
];

// ─── Demo skill cards ─────────────────────────────────────────────

const demoSkills = [
  {
    slug: 'csv-analyzer',
    name: 'CSV Analyzer',
    description: 'Upload any CSV and get instant statistical summaries, visualizations, and insights.',
    category: 'data-analysis',
    tags: ['pandas', 'matplotlib', 'statistics'],
    downloads: 4821,
    rating: 4.8,
  },
  {
    slug: 'code-review-assistant',
    name: 'Code Review Assistant',
    description: 'Deep code review with security checks, performance tips, and best practice suggestions.',
    category: 'coding',
    tags: ['code-review', 'security', 'typescript'],
    downloads: 3247,
    rating: 4.9,
  },
  {
    slug: 'meeting-summarizer',
    name: 'Meeting Summarizer',
    description: 'Paste meeting transcripts to get structured summaries, action items, and decisions.',
    category: 'productivity',
    tags: ['summarization', 'action-items', 'nlp'],
    downloads: 6103,
    rating: 4.7,
  },
];

function SkillCard({
  name,
  description,
  category,
  tags,
  downloads,
  rating,
}: (typeof demoSkills)[0]) {
  const emoji: Record<string, string> = {
    'data-analysis': '📊',
    coding: '💻',
    productivity: '⚡',
  };

  return (
    <div className="glass rounded-2xl p-5 hover:neon-border transition-all duration-300 group cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div className="text-2xl">{emoji[category] || '🤖'}</div>
        <span className="badge-muted text-xs">{category}</span>
      </div>
      <h3 className="font-semibold text-foreground mb-2 group-hover:text-brand-400 transition-colors">
        {name}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{description}</p>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {tags.slice(0, 3).map((t) => (
          <span key={t} className="badge-muted">{t}</span>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Download className="w-3.5 h-3.5" />
          {downloads.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          {rating}
        </span>
      </div>
    </div>
  );
}
