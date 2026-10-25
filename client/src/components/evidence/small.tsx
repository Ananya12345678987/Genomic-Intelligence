import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { BadgeCheck, Bot, Calculator, Check, Copy, ExternalLink, HelpCircle } from 'lucide-react';
import clsx from 'clsx';
import { safeUrl } from './labels';

type Kind = 'sourced' | 'ai' | 'computed' | 'unverified';

const KINDS: Record<Kind, { label: string; hint: string; icon: ReactNode; cls: string }> = {
  sourced: { label: 'Sourced', hint: 'Stated by a retrieved source record', icon: <BadgeCheck className="h-3 w-3" aria-hidden />, cls: 'bg-pistachio/70' },
  computed: { label: 'Computed', hint: 'Derived by deterministic matching rules, not by a model', icon: <Calculator className="h-3 w-3" aria-hidden />, cls: 'bg-surface-alt' },
  ai: { label: 'AI summary', hint: 'Written by a model; statements were checked against retrieved records', icon: <Bot className="h-3 w-3" aria-hidden />, cls: 'bg-butter' },
  unverified: { label: 'Unverified input', hint: 'As you entered it. Not checked against a reference sequence', icon: <HelpCircle className="h-3 w-3" aria-hidden />, cls: 'border border-dashed border-ink-soft/60 bg-transparent' },
};

/** Distinguishes sourced facts, computed matches, AI text and raw input. Icon + word, never colour alone. */
export function Provenance({ kind }: { kind: Kind }) {
  const k = KINDS[kind];
  return (
    <span title={k.hint} className={clsx('inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium', k.cls)}>
      {k.icon}
      {k.label}
    </span>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context or denied) */
    }
  };
  return (
    <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-surface-alt" aria-label={`${label}: ${text}`}>
      {done ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  const href = safeUrl(url);
  if (!href) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline decoration-ink-soft/50 underline-offset-2 hover:decoration-ink">
      {children}
      <ExternalLink className="h-3 w-3" aria-hidden />
      <span className="sr-only">(opens source in a new tab)</span>
    </a>
  );
}

/** Technical value (HGVS, coordinates, identifiers) in monospace with a copy affordance. */
export function Tech({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <code className="tech rounded bg-surface-alt px-1.5 py-0.5 break-all">{value}</code>
      <CopyButton text={value} />
    </span>
  );
}

/** Markdown from our own summaries and (verified) AI text. Raw HTML is not rendered; only http(s) links. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-sm max-w-none space-y-2 text-sm leading-relaxed [&_h3]:mt-1 [&_h3]:text-base [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-line [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold">
      <ReactMarkdown
        components={{
          a: ({ href, children: c }) => {
            const safe = safeUrl(href);
            return safe ? (
              <a href={safe} target="_blank" rel="noopener noreferrer" className="rounded bg-pistachio/60 px-1 font-medium underline decoration-ink-soft/50 underline-offset-2">
                {c}
              </a>
            ) : (
              <span>{c}</span>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-pistachio/50', className)} aria-hidden />;
}
