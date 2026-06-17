import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class names safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number with K/M suffix. */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/** Format a relative timestamp (e.g. "2 days ago"). */
export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Extract user initials from username. */
export function getInitials(username: string): string {
  return username
    .split(/[_\- ]/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/** Category display label map. */
export const CATEGORY_LABELS: Record<string, string> = {
  productivity: '效率工具',
  coding: '编程开发',
  writing: '写作创作',
  'data-analysis': '数据分析',
  design: '设计创意',
  marketing: '营销推广',
  education: '教育学习',
  business: '商业决策',
  'customer-service': '客服支持',
  translation: '翻译语言',
  research: '研究调研',
  automation: '自动化',
};

/** Category emoji map. */
export const CATEGORY_EMOJI: Record<string, string> = {
  productivity: '⚡',
  coding: '💻',
  writing: '✍️',
  'data-analysis': '📊',
  design: '🎨',
  marketing: '📣',
  education: '🎓',
  business: '💼',
  'customer-service': '🤝',
  translation: '🌐',
  research: '🔬',
  automation: '🤖',
};

/** Truncate text to N characters. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}
