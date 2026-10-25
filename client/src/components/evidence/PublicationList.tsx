import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import type { PublicationRecord } from '../../types/research';
import { formatDate } from './labels';
import { SourceLink } from './small';

function authorLine(authors: string[]): string {
  if (authors.length === 0) return 'Authors not listed';
  return authors.length > 3 ? `${authors.slice(0, 3).join(', ')} et al.` : authors.join(', ');
}

function Publication({ p }: { p: PublicationRecord }) {
  const [open, setOpen] = useState(false);
  const year = p.publicationDate?.slice(0, 4) ?? 'year not stated';
  return (
    <li className="rounded-md border border-line p-3 text-xs">
      <div className="text-sm font-medium leading-snug">
        <SourceLink url={p.canonicalUrl}>{p.title}</SourceLink>
      </div>
      <div className="mt-1 text-ink-soft">
        {authorLine(p.authors)} · {p.journal ?? 'journal not stated'} · {year}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        <span>
          PMID <code className="tech">{p.pmid}</code>
        </span>
        {p.doi && (
          <span>
            DOI <code className="tech">{p.doi}</code>
          </span>
        )}
        <span className="text-ink-soft">Retrieved {formatDate(p.retrievedAt)}</span>
      </div>
      {p.abstract ? (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-2 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline">
            Abstract <ChevronDown className={clsx('h-3 w-3 transition-transform', open && 'rotate-180')} aria-hidden />
          </button>
          {open && (
            <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">
              {p.abstract}
              <span className="mt-1.5 block text-ink-soft">Abstract only. The full article was not reviewed.</span>
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-ink-soft">No abstract available from PubMed for this record.</p>
      )}
    </li>
  );
}

export function PublicationList({ items }: { items: PublicationRecord[] }) {
  if (items.length === 0) return <p className="text-xs text-ink-soft">No publications were returned for this search.</p>;
  return (
    <ul className="space-y-2">
      {items.map((p) => (
        <Publication key={p.pmid} p={p} />
      ))}
    </ul>
  );
}
