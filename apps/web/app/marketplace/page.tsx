'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Filter, Download, Star, TrendingUp, Loader2, Store } from 'lucide-react';
import Link from 'next/link';
import api from '@/lib/api';
import { cn, CATEGORY_LABELS, CATEGORY_EMOJI, formatCount, truncate } from '@/lib/utils';

const CATEGORIES = ['all', ...Object.keys(CATEGORY_LABELS)] as const;
const SORT_OPTIONS = [
  { value: 'downloads', label: 'Most Downloaded' },
  { value: 'rating',    label: 'Highest Rated' },
  { value: 'created_at', label: 'Newest' },
] as const;

export default function MarketplacePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('downloads');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['marketplace', query, category, sortBy, page],
    queryFn: () =>
      api
        .get('/v1/marketplace/skills', {
          params: {
            query: query || undefined,
            category: category !== 'all' ? category : undefined,
            sortBy,
            page,
            limit: 18,
          },
        })
        .then((r) => r.data),
    placeholderData: (prev) => prev,
  });

  return (
    <div className="min-h-screen">
      {/* ── Hero header ── */}
      <div className="glass border-b border-border px-8 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <Store className="w-6 h-6 text-brand-400" />
            <h1 className="text-3xl font-bold">Skill Marketplace</h1>
          </div>
          <p className="text-muted-foreground mb-6 max-w-xl">
            Browse and install community-built Skills for your AI agents.
          </p>

          {/* Search */}
          <div className="relative max-w-xl">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search skills by name, category, or tag…"
              className="input-field pl-10"
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          {/* Category chips */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.slice(0, 8).map((cat) => (
              <button
                key={cat}
                onClick={() => { setCategory(cat); setPage(1); }}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200',
                  category === cat
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'bg-secondary/60 text-muted-foreground border border-border hover:text-foreground',
                )}
              >
                {cat === 'all' ? '✨ All' : `${CATEGORY_EMOJI[cat]} ${CATEGORY_LABELS[cat]}`}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="input-field w-auto text-sm"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
          </div>
        ) : !data?.data?.length ? (
          <div className="text-center py-24">
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">No skills found.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              {data.total} skills found
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {data.data.map((skill: any) => (
                <SkillCard key={skill.id} skill={skill} />
              ))}
            </div>

            {/* Pagination */}
            {data.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-10">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn-secondary px-4 py-2 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-sm text-muted-foreground px-4">
                  Page {page} of {data.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  disabled={page === data.totalPages}
                  className="btn-secondary px-4 py-2 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: any }) {
  return (
    <Link
      href={`/marketplace/${skill.slug}`}
      className="glass rounded-2xl p-5 hover:neon-border transition-all duration-300 group flex flex-col"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="text-2xl">{CATEGORY_EMOJI[skill.category] || '🤖'}</div>
        <span className="badge-muted text-xs">{CATEGORY_LABELS[skill.category] || skill.category}</span>
      </div>

      {/* Content */}
      <h3 className="font-semibold text-foreground mb-2 group-hover:text-brand-400 transition-colors">
        {skill.name}
      </h3>
      <p className="text-sm text-muted-foreground mb-4 flex-1 leading-relaxed">
        {truncate(skill.description, 120)}
      </p>

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {(skill.tags || []).slice(0, 3).map((t: string) => (
          <span key={t} className="badge-muted text-xs">{t}</span>
        ))}
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border/50 pt-3">
        <span className="flex items-center gap-1">
          <Download className="w-3.5 h-3.5" />
          {formatCount(skill.downloadCount)}
        </span>
        <span className="flex items-center gap-1">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          {skill.ratingAvg?.toFixed(1) || '—'}
        </span>
        <span className="text-xs">v{skill.version}</span>
      </div>
    </Link>
  );
}
