'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Loader2, Copy, Check, Save, Wand2, Eye } from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const MODES = [
  { value: 'two-stage',   label: 'High Quality', desc: '2 LLM calls — better output' },
  { value: 'single-shot', label: 'Quick Preview', desc: '1 LLM call — faster' },
] as const;

const EXAMPLE_PROMPTS = [
  '创建一个能分析 CSV 文件并生成可视化图表的数据分析 Skill',
  '制作一个代码审查助手，能识别安全漏洞和性能问题',
  '开发一个会议纪要整理 Skill，提取行动项和决策',
  '构建一个多语言翻译 Skill，保留专业术语准确性',
];

export default function SkillGeneratorPage() {
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'two-stage' | 'single-shot'>('two-stage');
  const [result, setResult] = useState<{ skillMd: string; usage: { totalTokens: number } } | null>(null);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);

  const generate = useMutation({
    mutationFn: (data: { description: string; mode: string }) =>
      api.post('/v1/skills/generate', data).then((r) => r.data),
    onSuccess: (data) => {
      if (data.success) {
        setResult(data);
        toast.success('Skill generated! Review and save.');
      } else {
        toast.error(data.error || 'Generation failed');
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to generate skill');
    },
  });

  const save = useMutation({
    mutationFn: (skillMd: string) => {
      // Parse name from YAML front matter
      const nameMatch = skillMd.match(/^name:\s*(.+)$/m);
      const descMatch = skillMd.match(/^description:\s*(.+)$/m);
      const categoryMatch = skillMd.match(/^category:\s*(.+)$/m);

      return api.post('/v1/skills', {
        name: nameMatch?.[1]?.trim() || 'New Skill',
        description: descMatch?.[1]?.trim() || description,
        category: categoryMatch?.[1]?.trim() || 'productivity',
        skillMd,
        tags: [],
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      toast.success(`Skill "${data.name}" saved as draft!`);
    },
    onError: () => {
      toast.error('Failed to save skill');
    },
  });

  const handleCopy = async () => {
    if (!result?.skillMd) return;
    await navigator.clipboard.writeText(result.skillMd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center shadow-glow">
              <Wand2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Skill Generator</h1>
              <p className="text-sm text-muted-foreground">Describe your idea in plain language</p>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Input */}
          <div className="space-y-5">
            {/* Mode selector */}
            <div className="glass rounded-xl p-4">
              <p className="text-sm font-medium mb-3">Generation Mode</p>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all duration-200',
                      mode === m.value
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <div className="font-medium text-sm">{m.label}</div>
                    <div className="text-xs opacity-70 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Description input */}
            <div className="glass rounded-xl p-4">
              <p className="text-sm font-medium mb-3">Describe your Skill</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. 创建一个能分析 CSV 文件、生成可视化图表，并给出数据洞察报告的 Skill..."
                rows={6}
                className="input-field resize-none"
              />
              <p className="text-xs text-muted-foreground mt-2">{description.length} chars</p>
            </div>

            {/* Example prompts */}
            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Quick examples</p>
              <div className="space-y-2">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setDescription(p)}
                    className="w-full text-left text-sm p-3 rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 hover:border-primary/30 transition-all duration-200 text-muted-foreground hover:text-foreground"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <button
              onClick={() => generate.mutate({ description, mode })}
              disabled={!description.trim() || generate.isPending}
              className="btn-primary w-full justify-center py-3 text-base"
            >
              {generate.isPending ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="w-5 h-5" /> Generate SKILL.md</>
              )}
            </button>
          </div>

          {/* Right: Output */}
          <div>
            {!result && !generate.isPending && (
              <div className="glass rounded-2xl h-full flex items-center justify-center py-24">
                <div className="text-center">
                  <Sparkles className="w-12 h-12 text-brand-400/40 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">Your generated SKILL.md will appear here</p>
                </div>
              </div>
            )}

            {generate.isPending && (
              <div className="glass rounded-2xl h-full flex items-center justify-center py-24">
                <div className="text-center">
                  <Loader2 className="w-10 h-10 text-brand-400 animate-spin mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">
                    {mode === 'two-stage' ? 'Running 2-stage generation…' : 'Generating…'}
                  </p>
                </div>
              </div>
            )}

            {result && !generate.isPending && (
              <div className="glass rounded-2xl overflow-hidden flex flex-col h-full">
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">SKILL.md</span>
                    <span className="badge-muted text-xs">{result.usage.totalTokens} tokens</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPreview(!preview)}
                      className={cn('btn-ghost px-2 py-1 text-xs', preview && 'text-brand-400')}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={handleCopy} className="btn-ghost px-2 py-1 text-xs">
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => save.mutate(result.skillMd)}
                      disabled={save.isPending}
                      className="btn-primary px-3 py-1.5 text-xs"
                    >
                      {save.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      Save draft
                    </button>
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto">
                  <pre className="code-block rounded-none border-none p-5 h-full text-xs leading-relaxed whitespace-pre-wrap">
                    {result.skillMd}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
