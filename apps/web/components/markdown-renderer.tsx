'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import { memo, useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A shared Markdown renderer used for both streaming and historical messages.
 * Supports GFM tables, code blocks with syntax highlighting, math, etc.
 */
function MarkdownRendererInner({ content }: { content: string }) {
  if (!content) return null;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Code blocks with copy button
        pre({ children }) {
          return (
            <div className="relative group my-3">
              <CopyButton content={extractCodeText(children)} />
              <pre className="overflow-x-auto rounded-lg bg-[#0d1117] border border-white/5 p-4 text-sm leading-relaxed">
                {children}
              </pre>
            </div>
          );
        },
        // Inline code
        code({ className, children, ...props }) {
          const isInline = !className;
          if (isInline) {
            return (
              <code className="px-1.5 py-0.5 rounded bg-white/10 text-brand-300 text-[0.85em] font-mono" {...props}>
                {children}
              </code>
            );
          }
          return <code className={className} {...props}>{children}</code>;
        },
        // Tables
        table({ children }) {
          return (
            <div className="overflow-x-auto my-3">
              <table className="min-w-full text-sm border-collapse">
                {children}
              </table>
            </div>
          );
        },
        thead({ children }) {
          return <thead className="border-b border-white/10 text-left">{children}</thead>;
        },
        th({ children }) {
          return <th className="px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">{children}</th>;
        },
        td({ children }) {
          return <td className="px-3 py-2 border-b border-white/5">{children}</td>;
        },
        // Links
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:text-brand-300 underline underline-offset-2">
              {children}
            </a>
          );
        },
        // Lists
        ul({ children }) {
          return <ul className="list-disc list-inside space-y-1 my-2">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside space-y-1 my-2">{children}</ol>;
        },
        // Blockquotes
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-brand-500/50 pl-4 my-3 text-muted-foreground italic">
              {children}
            </blockquote>
          );
        },
        // Paragraphs
        p({ children }) {
          return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
        },
        // Headings
        h1({ children }) { return <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>; },
        h2({ children }) { return <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>; },
        h3({ children }) { return <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>; },
        // Horizontal rules
        hr() { return <hr className="my-4 border-white/10" />; },
        // Strong
        strong({ children }) { return <strong className="font-semibold text-foreground">{children}</strong>; },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/** Copy button for code blocks. */
function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
      title="复制代码"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/** Extract plain text from code block children for the copy button. */
function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractCodeText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractCodeText((children as any).props.children);
  }
  return '';
}

export const MarkdownRenderer = memo(MarkdownRendererInner);
