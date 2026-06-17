'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, Zap, MessageSquare, TrendingUp, Plus, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useAuthStore } from '@/lib/auth-store';
import api from '@/lib/api';
import { formatCount, timeAgo } from '@/lib/utils';

export default function DashboardPage() {
  const { user } = useAuthStore();

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/v1/agents').then((r) => r.data),
  });

  const { data: skills } = useQuery({
    queryKey: ['my-skills'],
    queryFn: () => api.get('/v1/skills/my').then((r) => r.data),
  });

  const stats = [
    { icon: Bot,          label: 'Agents',     value: agents?.length ?? 0,        color: 'text-brand-400',   bg: 'bg-brand-500/10' },
    { icon: Zap,          label: 'Skills',     value: skills?.data?.length ?? 0,  color: 'text-purple-400',  bg: 'bg-purple-500/10' },
    { icon: MessageSquare, label: 'Conversations', value: 0,                       color: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
    { icon: TrendingUp,   label: 'Executions', value: 0,                           color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold">
          Welcome back,{' '}
          <span className="gradient-text">{user?.username}</span> 👋
        </h1>
        <p className="text-muted-foreground mt-1">Here's what's happening with your agents.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {stats.map((s) => (
          <div key={s.label} className="glass rounded-2xl p-5">
            <div className={`w-10 h-10 rounded-xl ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div className="text-2xl font-bold">{formatCount(s.value)}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid md:grid-cols-3 gap-4 mb-10">
        {[
          { href: '/dashboard/agents/new',  icon: Bot,  label: 'Create Agent',  desc: 'Build a new AI agent',              grad: 'from-brand-500 to-purple-500' },
          { href: '/dashboard/skills/new',  icon: Zap,  label: 'Create Skill',  desc: 'Write or generate a Skill',         grad: 'from-purple-500 to-pink-500' },
          { href: '/marketplace',           icon: ArrowRight, label: 'Browse Marketplace', desc: 'Find Skills built by the community', grad: 'from-cyan-500 to-blue-500' },
        ].map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="glass rounded-2xl p-5 hover:neon-border transition-all duration-300 group flex items-center gap-4"
          >
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.grad} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
              <action.icon className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="font-semibold group-hover:text-brand-400 transition-colors">{action.label}</div>
              <div className="text-sm text-muted-foreground">{action.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      {/* Recent agents */}
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-semibold text-lg">Recent Agents</h2>
          <Link href="/dashboard/agents" className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-1">
            View all <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {!agents || agents.length === 0 ? (
          <div className="text-center py-12">
            <Bot className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground text-sm">No agents yet.</p>
            <Link href="/dashboard/agents/new" className="btn-primary mt-4 inline-flex">
              <Plus className="w-4 h-4" /> Create your first agent
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {agents.slice(0, 5).map((agent: any) => (
              <Link
                key={agent.id}
                href={`/dashboard/chat?agent=${agent.id}`}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary/50 transition-colors group"
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium group-hover:text-brand-400 transition-colors truncate">{agent.name}</p>
                  <p className="text-xs text-muted-foreground">{agent.skills?.length ?? 0} skills · {agent.modelName}</p>
                </div>
                <span className="text-xs text-muted-foreground">{timeAgo(agent.createdAt)}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
