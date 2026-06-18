'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, ChevronLeft, Loader2, Plus, X, Zap } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import toast from 'react-hot-toast';

const MODEL_OPTIONS = [
  { value: 'gpt-4o',              label: 'GPT-4o',              provider: 'OpenAI' },
  { value: 'gpt-4o-mini',         label: 'GPT-4o Mini',         provider: 'OpenAI' },
  { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { value: 'claude-3-haiku-20240307',    label: 'Claude 3 Haiku',    provider: 'Anthropic' },
  { value: 'deepseek-chat',        label: 'DeepSeek Chat',       provider: 'DeepSeek' },
  { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B',  provider: 'Groq' },
];

export default function NewAgentPage() {
  const router = useRouter();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modelName, setModelName] = useState('gpt-4o');
  const [systemPrompt, setSystemPrompt] = useState(
    'You are a helpful AI assistant with access to specialized Skills.',
  );
  const [temperature, setTemperature] = useState(0.7);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);

  const { data: skills } = useQuery({
    queryKey: ['my-skills'],
    queryFn: () => api.get('/v1/skills/my').then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload: any) => api.post('/v1/agents', payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agent created!');
      router.push('/dashboard/agents');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to create agent');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error('Name is required');
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      modelName,
      systemPrompt,
      skillIds: selectedSkillIds,
      modelConfig: { temperature, maxTokens: 4096 },
    });
  };

  const toggleSkill = (id: string) => {
    setSelectedSkillIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  };

  return (
    <div className="p-8 max-w-3xl mx-auto">
      {/* Back */}
      <Link href="/dashboard/agents" className="btn-ghost mb-6 inline-flex -ml-2 text-muted-foreground">
        <ChevronLeft className="w-4 h-4" /> Back to Agents
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold">Create Agent</h1>
        <p className="text-muted-foreground text-sm mt-1">Configure your AI agent's behavior and skills.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-brand-400" /> Basic Info
          </h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Agent Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="e.g. Code Assistant"
              maxLength={60}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field"
              placeholder="What does this agent do?"
              maxLength={200}
            />
          </div>
        </div>

        {/* Model */}
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold">Model Configuration</h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Model</label>
            <select
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
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
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
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
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={4}
              className="input-field resize-none"
              placeholder="You are a helpful AI assistant…"
            />
          </div>
        </div>

        {/* Skills */}
        <div className="glass rounded-2xl p-6 space-y-4">
          <h2 className="font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-400" /> Attach Skills
            <span className="badge-muted ml-auto">{selectedSkillIds.length} selected</span>
          </h2>

          {(!skills?.data || skills.data.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No skills yet.{' '}
              <Link href="/dashboard/skills/new" className="text-brand-400 hover:underline">
                Create one first
              </Link>
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
              {skills.data.map((skill: any) => {
                const active = selectedSkillIds.includes(skill.id);
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => toggleSkill(skill.id)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all duration-150 ${
                      active
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border bg-secondary/30 text-muted-foreground hover:border-primary/30 hover:bg-secondary/60'
                    }`}
                  >
                    <Zap className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-primary' : ''}`} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{skill.name}</p>
                      <p className="text-xs truncate opacity-70">{skill.slug}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex items-center gap-3 justify-end">
          <Link href="/dashboard/agents" className="btn-secondary">Cancel</Link>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="btn-primary"
          >
            {createMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
            ) : (
              <><Plus className="w-4 h-4" /> Create Agent</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
