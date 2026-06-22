'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Zap, ChevronLeft, Loader2, Save, Globe, Lock, AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const CATEGORIES = [
  'productivity', 'coding', 'writing', 'data-analysis',
  'design', 'marketing', 'education', 'business',
  'customer-service', 'translation', 'research', 'automation',
] as const;

export default function EditSkillPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const qc = useQueryClient();

  // ── Load skill ─────────────────────────────────────────────────
  const { data: skill, isLoading } = useQuery({
    queryKey: ['skill', id],
    queryFn: () => api.get(`/v1/skills/${id}/detail`).then((r) => r.data),
  });

  // ── Form state ─────────────────────────────────────────────────
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState('productivity');
  const [tags, setTags]               = useState('');
  const [skillMd, setSkillMd]         = useState('');
  const [isPublic, setIsPublic]       = useState(false);
  const [isDirty, setIsDirty]         = useState(false);

  // Hydrate form once skill loads
  useEffect(() => {
    if (!skill) return;
    setName(skill.name || '');
    setDescription(skill.description || '');
    setCategory(skill.category || 'productivity');
    setTags((skill.tags ?? []).join(', '));
    setSkillMd(skill.skillMd || '');
    setIsPublic(skill.status === 'published');
  }, [skill]);

  const markDirty = () => setIsDirty(true);

  // ── Save mutation ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () =>
      api.put(`/v1/skills/${id}`, {
        name:        name.trim(),
        description: description.trim() || undefined,
        category,
        tags:        tags.split(',').map((t) => t.trim()).filter(Boolean),
        skillMd:     skillMd || undefined,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-skills'] });
      qc.invalidateQueries({ queryKey: ['skill', id] });
      toast.success('Skill updated!');
      setIsDirty(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update skill');
    },
  });

  // ── Publish / Unpublish ────────────────────────────────────────
  const publishMutation = useMutation({
    mutationFn: () =>
      api.patch(`/v1/skills/${id}/publish`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-skills'] });
      qc.invalidateQueries({ queryKey: ['skill', id] });
      setIsPublic(true);
      toast.success('Skill published to marketplace!');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to publish skill');
    },
  });

  // ── Loading state ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-32">
        <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Skill not found.{' '}
        <Link href="/dashboard/skills" className="text-brand-400 hover:underline">
          Back to Skills
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/dashboard/skills" className="btn-ghost mb-6 inline-flex -ml-2 text-muted-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Skills
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-brand-500/20 border border-purple-500/20 flex items-center justify-center">
            <Zap className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Edit Skill</h1>
            <p className="text-sm text-muted-foreground">{skill.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
              Unsaved changes
            </span>
          )}
          <span className={cn(
            'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border',
            isPublic
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              : 'bg-muted text-muted-foreground border-border',
          )}>
            {isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
            {isPublic ? 'Published' : 'Draft'}
          </span>
        </div>
      </div>

      <div className="space-y-6">
        {/* ── Basic Info ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
            <Zap className="w-4 h-4 text-purple-400" /> Basic Info
          </h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Skill Name *</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); markDirty(); }}
              className="input-field"
              placeholder="e.g. CSV Analyzer"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Description *</label>
            <textarea
              value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty(); }}
              rows={3}
              className="input-field resize-none"
              placeholder="What does this skill do?"
              maxLength={2000}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Category</label>
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); markDirty(); }}
              className="input-field"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Tags</label>
            <input
              value={tags}
              onChange={(e) => { setTags(e.target.value); markDirty(); }}
              className="input-field"
              placeholder="csv, data, analytics (comma separated)"
            />
          </div>
        </div>

        {/* ── SKILL.md Content ─────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            SKILL.md Content
          </h2>
          <textarea
            value={skillMd}
            onChange={(e) => { setSkillMd(e.target.value); markDirty(); }}
            rows={14}
            className="input-field resize-none font-mono text-xs"
            placeholder="Paste or edit your SKILL.md content here…"
          />
          <p className="text-xs text-muted-foreground">{skillMd.length} chars</p>
        </div>

        {/* ── Publish ───────────────────────────────────────────────── */}
        {!isPublic && (
          <div className="glass rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Publish to Marketplace</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Make this skill visible to everyone. You must have SKILL.md content saved first.
                </p>
              </div>
              <button
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || !skill.skillMd}
                className="btn-secondary text-xs px-3 py-2 whitespace-nowrap"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <><Globe className="w-3.5 h-3.5" /> Publish</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end">
          <button
            onClick={() => router.back()}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim()}
            className="btn-primary"
          >
            {saveMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
              : <><Save className="w-4 h-4" /> Save Changes</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
