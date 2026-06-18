'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Zap, MessageSquare, Trash2, Settings2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function AgentsPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const { data: agents, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('/v1/agents').then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent deleted');
    },
    onError: () => toast.error('Failed to delete agent'),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Agents</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {agents?.length ?? 0} agents configured
          </p>
        </div>
        <Link href="/dashboard/agents/new" className="btn-primary">
          <Plus className="w-4 h-4" /> New Agent
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && (!agents || agents.length === 0) && (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-500/10 flex items-center justify-center mx-auto mb-4">
            <Bot className="w-8 h-8 text-brand-400 opacity-60" />
          </div>
          <h2 className="font-semibold text-lg mb-2">No agents yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Create your first AI agent and give it skills to work with.
          </p>
          <Link href="/dashboard/agents/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Create Agent
          </Link>
        </div>
      )}

      {/* Agent grid */}
      {agents && agents.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent: any) => (
            <div key={agent.id} className="glass rounded-2xl p-5 flex flex-col gap-4 hover:neon-border transition-all duration-300 group">
              {/* Top row */}
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-5 h-5 text-brand-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate group-hover:text-brand-400 transition-colors">
                    {agent.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{agent.modelName}</p>
                </div>
              </div>

              {/* Description */}
              {agent.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" /> {agent.skills?.length ?? 0} skills
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" /> {timeAgo(agent.createdAt)}
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <Link
                  href={`/dashboard/chat?agent=${agent.id}`}
                  className="btn-primary flex-1 justify-center text-xs py-2"
                >
                  <MessageSquare className="w-3.5 h-3.5" /> Chat
                </Link>
                <Link
                  href={`/dashboard/agents/${agent.id}/edit`}
                  className="btn-ghost px-3 py-2 text-muted-foreground hover:text-foreground"
                  title="Edit agent"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${agent.name}"?`)) {
                      deleteMutation.mutate(agent.id);
                    }
                  }}
                  className="btn-ghost text-red-400 hover:text-red-300 hover:bg-red-500/10 px-3 py-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
