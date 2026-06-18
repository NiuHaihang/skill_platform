'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot, ChevronLeft, Loader2, Save, Zap, X, Plus,
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const MODEL_OPTIONS = [
  { value: 'gpt-4o',                      label: 'GPT-4o',              provider: 'OpenAI' },
  { value: 'gpt-4o-mini',                  label: 'GPT-4o Mini',         provider: 'OpenAI' },
  { value: 'claude-3-5-sonnet-20241022',   label: 'Claude 3.5 Sonnet',   provider: 'Anthropic' },
  { value: 'claude-3-haiku-20240307',      label: 'Claude 3 Haiku',      provider: 'Anthropic' },
  { value: 'deepseek-chat',                label: 'DeepSeek Chat',       provider: 'DeepSeek' },
  { value: 'llama-3.1-70b-versatile',      label: 'Llama 3.1 70B',       provider: 'Groq' },
];

export default function EditAgentPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const qc = useQueryClient();

  // ── Load agent ─────────────────────────────────────────────────
  const { data: agent, isLoading: agentLoading } = useQuery({
    queryKey: ['agent', id],
    queryFn: () => api.get(`/v1/agents/${id}`).then((r) => r.data),
  });

  // ── Load all user skills (for skill picker) ────────────────────
  const { data: allSkills } = useQuery({
    queryKey: ['my-skills'],
    queryFn: () => api.get('/v1/skills/my').then((r) => r.data),
  });

  // ── Form state ─────────────────────────────────────────────────
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [modelName, setModelName]     = useState('gpt-4o');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [attachedSkillIds, setAttachedSkillIds] = useState<string[]>([]);
  const [isDirty, setIsDirty]         = useState(false);

  // Hydrate form once agent loads
  useEffect(() => {
    if (!agent) return;
    setName(agent.name || '');
    setDescription(agent.description || '');
    setModelName(agent.modelName || 'gpt-4o');
    setSystemPrompt(agent.systemPrompt || '');
    setTemperature(agent.modelConfig?.temperature ?? 0.7);
    setAttachedSkillIds((agent.skills ?? []).map((s: any) => s.id));
  }, [agent]);

  // ── Save basic info ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => api.put(`/v1/agents/${id}`, {
      name:         name.trim(),
      description:  description.trim() || undefined,
      modelName,
      systemPrompt,
      skillIds:     attachedSkillIds,
      modelConfig:  { temperature, maxTokens: 4096 },
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['agent', id] });
      toast.success('Agent updated!');
      setIsDirty(false);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to update agent');
    },
  });

  const toggleSkill = (skillId: string) => {
    setIsDirty(true);
    setAttachedSkillIds((prev) =>
      prev.includes(skillId) ? prev.filter((s) => s !== skillId) : [...prev, skillId],
    );
  };

  const markDirty = () => setIsDirty(true);

  if (agentLoading) {
    return (
      <div className="flex items-center justify-center h-full py-32">
        <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Agent not found.{' '}
        <Link href="/dashboard/agents" className="text-brand-400 hover:underline">
          Back to Agents
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/dashboard/agents" className="btn-ghost mb-6 inline-flex -ml-2 text-muted-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Agents
      </Link>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20 flex items-center justify-center">
            <Bot className="w-5 h-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Edit Agent</h1>
            <p className="text-sm text-muted-foreground">{agent.name}</p>
          </div>
        </div>
        {isDirty && (
          <span className="text-xs text-amber-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
            Unsaved changes
          </span>
        )}
      </div>

      <div className="space-y-6">
        {/* ── Basic Info ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
            <Bot className="w-4 h-4" /> Basic Info
          </h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Agent Name *</label>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); markDirty(); }}
              className="input-field"
              placeholder="e.g. Code Assistant"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <input
              value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty(); }}
              className="input-field"
              placeholder="What does this agent do?"
              maxLength={1000}
            />
          </div>
        </div>

        {/* ── Model Config ─────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
            Model Configuration
          </h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Model</label>
            <select
              value={modelName}
              onChange={(e) => { setModelName(e.target.value); markDirty(); }}
              className="input-field"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label} ({m.provider})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 flex items-center justify-between">
              <span>Temperature</span>
              <span className="text-muted-foreground font-mono text-xs">{temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0" max="2" step="0.1"
              value={temperature}
              onChange={(e) => { setTemperature(parseFloat(e.target.value)); markDirty(); }}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>Precise (0)</span>
              <span>Creative (2)</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">System Prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => { setSystemPrompt(e.target.value); markDirty(); }}
              rows={5}
              className="input-field resize-none"
              placeholder="You are a helpful AI assistant…"
            />
          </div>
        </div>

        {/* ── Skills ───────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-purple-400" /> Attached Skills
            </h2>
            <span className="badge-muted text-xs">{attachedSkillIds.length} selected</span>
          </div>

          {/* Currently attached pills */}
          {attachedSkillIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachedSkillIds.map((sid) => {
                const skill = allSkills?.data?.find((s: any) => s.id === sid)
                           ?? agent.skills?.find((s: any) => s.id === sid);
                if (!skill) return null;
                return (
                  <div
                    key={sid}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-brand-500/15 border border-brand-500/30 text-xs text-brand-300"
                  >
                    <Zap className="w-3 h-3" />
                    {skill.name}
                    <button
                      onClick={() => toggleSkill(sid)}
                      className="ml-1 hover:text-red-400 transition-colors"
                      title="Remove skill"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Skill picker */}
          {!allSkills?.data || allSkills.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No skills yet.{' '}
              <Link href="/dashboard/skills/new" className="text-brand-400 hover:underline">
                Create one first
              </Link>
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Click to add / remove skills:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {allSkills.data.map((skill: any) => {
                  const active = attachedSkillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150',
                        active
                          ? 'border-brand-500/50 bg-brand-500/10 text-foreground'
                          : 'border-border bg-secondary/30 text-muted-foreground hover:border-brand-500/30 hover:bg-secondary/60',
                      )}
                    >
                      <Zap className={cn('w-3.5 h-3.5 flex-shrink-0', active && 'text-brand-400')} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{skill.name}</p>
                        <p className="text-xs truncate opacity-70">{skill.category}</p>
                      </div>
                      {active
                        ? <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                        : <Plus className="w-3.5 h-3.5 flex-shrink-0" />
                      }
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 justify-end">
          <Link href="/dashboard/agents" className="btn-secondary">
            Cancel
          </Link>
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
