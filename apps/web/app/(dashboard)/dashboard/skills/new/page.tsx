'use client';

import { useState, useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import JSZip from 'jszip';
import {
  Sparkles, Loader2, Copy, Check, Save, Wand2, Upload,
  FileText, X, ChevronLeft, Zap, Package, FolderOpen, AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

// ─── Constants ────────────────────────────────────────────────────

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

const CATEGORIES = [
  'productivity', 'coding', 'writing', 'data-analysis',
  'design', 'marketing', 'education', 'business',
  'customer-service', 'translation', 'research', 'automation',
] as const;

const SKILL_MD_TEMPLATE = `---
name: My Custom Skill
slug: my-custom-skill
version: 1.0.0
description: A brief description of what this skill does.
category: productivity
tags: [tool, utility]
author: your-username
---

## Overview

Describe what your skill does here.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input | string | Yes | The input to process |

## Examples

\`\`\`python
# Example code
result = process(input)
print(result)
\`\`\`
`;

// ─── Helper: parse SKILL.md front matter ───────────────────────────

function parseFrontMatter(md: string) {
  const nameMatch = md.match(/^name:\s*(.+)$/m);
  const descMatch = md.match(/^description:\s*(.+)$/m);
  const catMatch  = md.match(/^category:\s*(.+)$/m);
  const tagsMatch = md.match(/^tags:\s*\[(.+)\]$/m);
  return {
    name:        nameMatch?.[1]?.trim()  || '',
    description: descMatch?.[1]?.trim()  || '',
    category:    catMatch?.[1]?.trim()   || 'productivity',
    tags:        tagsMatch?.[1]?.split(',').map((t) => t.trim().replace(/['"]/g, '')).filter(Boolean) || [],
  };
}

// ─── Zip entry type ────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  isSkillMd: boolean;
  isMetadata: boolean;
}

// ─── Main Component ────────────────────────────────────────────────

type Tab = 'generate' | 'upload';

export default function NewSkillPage() {
  const [tab, setTab] = useState<Tab>('generate');

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto">
        {/* Back */}
        <Link href="/dashboard/skills" className="btn-ghost mb-6 inline-flex -ml-2 text-muted-foreground">
          <ChevronLeft className="w-4 h-4" /> Back to Skills
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-purple-500 flex items-center justify-center shadow-glow">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Create Skill</h1>
            <p className="text-sm text-muted-foreground">Generate with AI or upload your own SKILL.md</p>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-secondary/40 border border-border w-fit mb-8">
          {([
            { key: 'generate', label: 'AI Generate', icon: Wand2 },
            { key: 'upload',   label: 'Manual Upload', icon: Upload },
          ] as { key: Tab; label: string; icon: any }[]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200',
                tab === key
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        {tab === 'generate' ? <GenerateTab /> : <UploadTab />}
      </div>
    </div>
  );
}

// ─── Generate Tab ─────────────────────────────────────────────────

function GenerateTab() {
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'two-stage' | 'single-shot'>('two-stage');
  const [result, setResult] = useState<{ skillMd: string; usage: { totalTokens: number } } | null>(null);
  const [copied, setCopied] = useState(false);

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
      const { name, description: desc, category, tags } = parseFrontMatter(skillMd);
      return api.post('/v1/skills', {
        name: name || 'New Skill',
        description: desc || description,
        category: category || 'productivity',
        skillMd,
        tags,
      }).then((r) => r.data);
    },
    onSuccess: (data) => {
      toast.success(`Skill "${data.name}" saved!`);
    },
    onError: () => toast.error('Failed to save skill'),
  });

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Left: Input */}
      <div className="space-y-5">
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
          <div className="glass rounded-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">SKILL.md</span>
                <span className="badge-muted text-xs">{result.usage.totalTokens} tokens</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.skillMd);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="btn-ghost px-2 py-1 text-xs"
                >
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
            <div className="overflow-auto max-h-[60vh]">
              <pre className="code-block rounded-none border-none p-5 text-xs leading-relaxed whitespace-pre-wrap">
                {result.skillMd}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Upload Tab ───────────────────────────────────────────────────

function UploadTab() {
  const router = useRouter();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging]     = useState(false);
  const [fileName, setFileName]     = useState('');
  const [fileType, setFileType]     = useState<'zip' | 'md' | ''>('');
  const [skillMd, setSkillMd]       = useState('');
  const [zipEntries, setZipEntries] = useState<ZipEntry[]>([]);
  const [zipWarning, setZipWarning] = useState('');

  // Editable metadata fields (auto-filled from file)
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory]       = useState('productivity');
  const [tags, setTags]               = useState('');
  const [isPublic, setIsPublic]       = useState(false);

  const fillFromFrontMatter = useCallback((md: string) => {
    const parsed = parseFrontMatter(md);
    if (parsed.name)        setName(parsed.name);
    if (parsed.description) setDescription(parsed.description);
    if (parsed.category && CATEGORIES.includes(parsed.category as any)) setCategory(parsed.category);
    if (parsed.tags.length) setTags(parsed.tags.join(', '));
  }, []);

  const fillFromMetadataJson = (json: Record<string, any>) => {
    if (json.name)                       setName(json.name);
    if (json.description)                setDescription(json.description);
    if (json.category && CATEGORIES.includes(json.category)) setCategory(json.category);
    if (Array.isArray(json.tags))        setTags(json.tags.join(', '));
  };

  const reset = () => {
    setFileName(''); setFileType(''); setSkillMd('');
    setZipEntries([]); setZipWarning('');
    setName(''); setDescription(''); setCategory('productivity');
    setTags(''); setIsPublic(false);
  };

  // ── Handle plain .md / .txt ─────────────────────────────────────
  const handleMdFile = (file: File) => {
    setFileName(file.name);
    setFileType('md');
    setZipEntries([]);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setSkillMd(content);
      fillFromFrontMatter(content);
    };
    reader.readAsText(file);
  };

  // ── Handle .zip bundle from SkillHub ───────────────────────────
  const handleZipFile = async (file: File) => {
    setFileName(file.name);
    setFileType('zip');
    setSkillMd('');
    setZipWarning('');
    setZipEntries([]);

    try {
      const zip = await JSZip.loadAsync(file);
      const entries: ZipEntry[] = [];

      for (const [path, entry] of Object.entries(zip.files)) {
        if (entry.dir || path.startsWith('__MACOSX') || path.includes('/.')) continue;
        const baseName = path.split('/').pop() || path;
        entries.push({
          name:       path,
          isSkillMd:  baseName.toLowerCase() === 'skill.md',
          isMetadata: baseName.toLowerCase() === 'metadata.json',
        });
      }
      setZipEntries(entries);

      // Extract SKILL.md
      const skillMdEntry = Object.entries(zip.files).find(
        ([path, f]) => !f.dir && path.split('/').pop()?.toLowerCase() === 'skill.md',
      );
      if (skillMdEntry) {
        const content = await skillMdEntry[1].async('string');
        setSkillMd(content);
        fillFromFrontMatter(content);
      } else {
        setZipWarning('No SKILL.md found in the zip. Please fill in the metadata manually or paste the content below.');
      }

      // Extract metadata.json (overrides front-matter values if present)
      const metaEntry = Object.entries(zip.files).find(
        ([path, f]) => !f.dir && path.split('/').pop()?.toLowerCase() === 'metadata.json',
      );
      if (metaEntry) {
        try {
          const jsonStr = await metaEntry[1].async('string');
          fillFromMetadataJson(JSON.parse(jsonStr));
        } catch { /* invalid JSON, skip */ }
      }

      if (entries.length === 0) {
        setZipWarning('The zip file appears to be empty.');
      } else {
        toast.success(`Extracted ${entries.length} file(s) from zip`);
      }
    } catch {
      toast.error('Failed to read zip file. Make sure it is a valid archive.');
      reset();
    }
  };

  const handleFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'zip')                  handleZipFile(file);
    else if (ext === 'md' || ext === 'txt') handleMdFile(file);
    else toast.error('Please upload a .zip, .md, or .txt file');
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useMutation({
    mutationFn: () => api.post('/v1/skills', {
      name:        name.trim() || 'New Skill',
      description: description.trim() || 'No description',
      category,
      tags:        tags.split(',').map((t) => t.trim()).filter(Boolean),
      skillMd:     skillMd || undefined,
      isPublic,
    }).then((r) => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['my-skills'] });
      toast.success(`Skill "${data.name}" created!`);
      router.push('/dashboard/skills');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create skill');
    },
  });

  return (
    <div className="grid lg:grid-cols-2 gap-8">
      {/* Left: upload + content editor */}
      <div className="space-y-5">

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            'relative glass rounded-2xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200',
            dragging
              ? 'border-primary bg-primary/10 scale-[1.01]'
              : 'border-border hover:border-primary/50 hover:bg-secondary/40',
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.md,.txt"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />

          {!fileName ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Upload className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-sm">Drop your Skill file here</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Supports{' '}
                  <span className="text-purple-400 font-medium">.zip</span> from SkillHub
                  {' · '}
                  <span className="text-brand-400 font-medium">.md</span> SKILL.md
                  {' · '}
                  <span className="text-muted-foreground">.txt</span>
                </p>
              </div>
              <div className="flex items-center gap-5 text-xs text-muted-foreground mt-1">
                <span className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-purple-400" />
                  ZIP bundle
                </span>
                <span className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-brand-400" />
                  SKILL.md
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className={cn(
                'w-12 h-12 rounded-xl flex items-center justify-center',
                fileType === 'zip'
                  ? 'bg-purple-500/20 border border-purple-500/30'
                  : 'bg-emerald-500/20 border border-emerald-500/30',
              )}>
                {fileType === 'zip'
                  ? <Package className="w-6 h-6 text-purple-400" />
                  : <FileText className="w-6 h-6 text-emerald-400" />
                }
              </div>
              <div>
                <p className="font-medium text-sm">{fileName}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {fileType === 'zip'
                    ? `${zipEntries.length} files extracted · Click to replace`
                    : `${skillMd.length} chars · Click to replace`
                  }
                </p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); reset(); }}
                className="btn-ghost text-xs text-muted-foreground px-2 py-1"
              >
                <X className="w-3 h-3" /> Remove
              </button>
            </div>
          )}
        </div>

        {/* Warning */}
        {zipWarning && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <p>{zipWarning}</p>
          </div>
        )}

        {/* Zip file tree */}
        {fileType === 'zip' && zipEntries.length > 0 && (
          <div className="glass rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <FolderOpen className="w-4 h-4 text-purple-400" />
              <p className="text-sm font-medium">Zip Contents</p>
              <span className="badge-muted text-xs ml-auto">{zipEntries.length} files</span>
            </div>
            <div className="space-y-1 max-h-44 overflow-y-auto">
              {zipEntries.map((entry) => (
                <div
                  key={entry.name}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono',
                    entry.isSkillMd  && 'bg-brand-500/10 text-brand-300 border border-brand-500/20',
                    entry.isMetadata && 'bg-purple-500/10 text-purple-300 border border-purple-500/20',
                    !entry.isSkillMd && !entry.isMetadata && 'text-muted-foreground',
                  )}
                >
                  <FileText className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{entry.name}</span>
                  {entry.isSkillMd  && <span className="ml-auto text-brand-400 font-sans whitespace-nowrap">✓ SKILL.md</span>}
                  {entry.isMetadata && <span className="ml-auto text-purple-400 font-sans whitespace-nowrap">✓ metadata</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SKILL.md content editor */}
        <div className="glass rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium">
              SKILL.md Content
              {fileType === 'zip' && skillMd && (
                <span className="ml-2 text-xs text-brand-400">（从 zip 中提取）</span>
              )}
            </p>
            {!skillMd && (
              <button
                onClick={() => { setSkillMd(SKILL_MD_TEMPLATE); fillFromFrontMatter(SKILL_MD_TEMPLATE); }}
                className="btn-ghost text-xs px-2 py-1"
              >
                Use template
              </button>
            )}
          </div>
          <textarea
            value={skillMd}
            onChange={(e) => { setSkillMd(e.target.value); fillFromFrontMatter(e.target.value); }}
            placeholder="Paste your SKILL.md content here, or upload a file above…"
            rows={10}
            className="input-field resize-none font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground mt-1.5">{skillMd.length} chars</p>
        </div>
      </div>

      {/* Right: Metadata form */}
      <div className="space-y-5">
        <div className="glass rounded-2xl p-6 space-y-5">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Skill Metadata</h2>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Name *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder="e.g. CSV Analyzer"
              maxLength={200}
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
              onChange={(e) => setCategory(e.target.value)}
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
              onChange={(e) => setTags(e.target.value)}
              className="input-field"
              placeholder="csv, data, analytics (comma separated)"
            />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">Publish to Marketplace</p>
              <p className="text-xs text-muted-foreground">Make this skill visible to others</p>
            </div>
            <button
              type="button"
              onClick={() => setIsPublic((v) => !v)}
              className={cn(
                'relative w-11 h-6 rounded-full transition-colors duration-200',
                isPublic ? 'bg-primary' : 'bg-border',
              )}
            >
              <span
                className={cn(
                  'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
                  isPublic && 'translate-x-5',
                )}
              />
            </button>
          </div>
        </div>

        {/* Submit */}
        <div className="flex gap-3">
          <Link href="/dashboard/skills" className="btn-secondary flex-1 justify-center">
            Cancel
          </Link>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !name.trim() || !description.trim()}
            className="btn-primary flex-1 justify-center"
          >
            {save.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : (
              <><Save className="w-4 h-4" /> Save Skill</>
            )}
          </button>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          SKILL.md is optional — you can add it later by editing the skill.
        </p>
      </div>
    </div>
  );
}
