'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Zap, Plus, Trash2, Loader2, Tag, Globe, Lock } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { timeAgo, CATEGORY_EMOJI, CATEGORY_LABELS, truncate } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function SkillsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['my-skills'],
    queryFn: () => api.get('/v1/skills/my').then((r) => r.data),
  });

  const skills = data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/skills/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-skills'] });
      toast.success('Skill deleted');
    },
    onError: () => toast.error('Failed to delete skill'),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">My Skills</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {skills.length} skills created
          </p>
        </div>
        <Link href="/dashboard/skills/new" className="btn-primary">
          <Plus className="w-4 h-4" /> New Skill
        </Link>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && skills.length === 0 && (
        <div className="glass rounded-2xl p-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-4">
            <Zap className="w-8 h-8 text-purple-400 opacity-60" />
          </div>
          <h2 className="font-semibold text-lg mb-2">No skills yet</h2>
          <p className="text-muted-foreground text-sm mb-6">
            Create skills to give your agents superpowers.
          </p>
          <Link href="/dashboard/skills/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Create Skill
          </Link>
        </div>
      )}

      {/* Grid */}
      {skills.length > 0 && (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {skills.map((skill: any) => (
            <div key={skill.id} className="glass rounded-2xl p-5 flex flex-col gap-3 hover:neon-border transition-all duration-300 group">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0 text-xl">
                  {CATEGORY_EMOJI[skill.category] ?? '⚡'}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold truncate group-hover:text-purple-400 transition-colors">
                    {skill.name}
                  </h3>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{skill.slug}</p>
                </div>
                {/* visibility badge */}
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${
                  skill.isPublic
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-muted text-muted-foreground border-border'
                }`}>
                  {skill.isPublic ? <Globe className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                  {skill.isPublic ? 'Public' : 'Private'}
                </span>
              </div>

              {skill.description && (
                <p className="text-sm text-muted-foreground">{truncate(skill.description, 80)}</p>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                {skill.category && (
                  <span className="badge-muted text-xs">
                    {CATEGORY_LABELS[skill.category] ?? skill.category}
                  </span>
                )}
                <span className="text-xs text-muted-foreground ml-auto">
                  {timeAgo(skill.createdAt)}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <Link
                  href={`/dashboard/skills/${skill.id}/edit`}
                  className="btn-ghost flex-1 justify-center text-xs py-2"
                >
                  Edit
                </Link>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${skill.name}"?`)) {
                      deleteMutation.mutate(skill.id);
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
