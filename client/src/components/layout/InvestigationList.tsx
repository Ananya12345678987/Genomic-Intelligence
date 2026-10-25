import { useEffect, useState } from 'react';
import { Check, Loader2, MoreHorizontal, Pencil, Search, Trash2, X } from 'lucide-react';
import clsx from 'clsx';
import { useInvestigationList, useInvestigationMutations } from '../../hooks/useInvestigations';
import type { Investigation } from '../../types/api';

interface Props {
  activeId?: string;
  onOpen: (id: string) => void;
  onDeleted: (id: string) => void;
}

function useDebounced(value: string, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function InvestigationList({ activeId, onOpen, onDeleted }: Props) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const { data, isLoading, isError, refetch } = useInvestigationList(debounced);
  const { rename, remove } = useInvestigationMutations();

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const startRename = (inv: Investigation) => {
    setMenuFor(null);
    setRenaming(inv.id);
    setDraft(inv.title);
  };

  const commitRename = async (id: string) => {
    const title = draft.trim();
    setRenaming(null);
    if (title) await rename.mutateAsync({ id, title }).catch(() => undefined);
  };

  const doDelete = async (id: string) => {
    setConfirmDelete(null);
    await remove.mutateAsync(id).then(() => onDeleted(id)).catch(() => undefined);
  };

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
      <label className="relative block">
        <span className="sr-only">Search saved investigations</span>
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-soft" aria-hidden />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search investigations"
          maxLength={100}
          className="w-full rounded-pill border border-line bg-surface py-2 pl-9 pr-3 text-sm placeholder:text-ink-soft"
        />
      </label>

      <nav className="mt-3 min-h-0 flex-1 overflow-y-auto" aria-label="Saved investigations">
        {isLoading && (
          <ul className="space-y-2" aria-busy="true" aria-label="Loading investigations">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-9 animate-pulse rounded-lg bg-pistachio/50" />
            ))}
          </ul>
        )}

        {isError && (
          <div className="rounded-lg bg-danger-bg p-3 text-xs text-danger" role="alert">
            Couldn&apos;t load investigations.{' '}
            <button className="underline" onClick={() => void refetch()}>
              Retry
            </button>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="mt-6 text-center text-sm text-ink-soft">
            <p className="font-medium text-ink">{debounced ? 'No matches' : 'No saved investigations yet'}</p>
            <p className="mt-1 text-xs">
              {debounced ? 'Try a different search.' : 'Your investigations will appear here.'}
            </p>
          </div>
        )}

        <ul className="space-y-0.5">
          {data?.items.map((inv) => (
            <li key={inv.id} className="group relative">
              {renaming === inv.id ? (
                <form
                  className="flex items-center gap-1 rounded-lg bg-surface p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void commitRename(inv.id);
                  }}
                >
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={160}
                    aria-label="Investigation name"
                    className="min-w-0 flex-1 rounded-md border border-line bg-canvas px-2 py-1 text-sm"
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                  <button type="submit" className="btn !p-1" aria-label="Save name">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="btn !p-1" aria-label="Cancel rename" onClick={() => setRenaming(null)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </form>
              ) : confirmDelete === inv.id ? (
                <div className="rounded-lg bg-danger-bg p-2 text-xs text-danger" role="alertdialog" aria-label="Confirm delete">
                  <p>Delete &ldquo;{inv.title}&rdquo; and its messages? This can&apos;t be undone.</p>
                  <div className="mt-2 flex gap-2">
                    <button className="btn !px-2.5 !py-1 text-xs" onClick={() => void doDelete(inv.id)} disabled={remove.isPending}>
                      {remove.isPending && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Delete
                    </button>
                    <button className="btn !px-2.5 !py-1 text-xs" onClick={() => setConfirmDelete(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => onOpen(inv.id)}
                    aria-current={inv.id === activeId ? 'page' : undefined}
                    className={clsx(
                      'w-full truncate rounded-lg px-3 py-2 pr-9 text-left text-sm transition-colors hover:bg-pistachio/60',
                      inv.id === activeId && 'bg-pistachio font-medium',
                    )}
                    title={inv.title}
                  >
                    {inv.title}
                  </button>
                  <button
                    className="absolute right-1 top-1.5 rounded-md p-1 text-ink-soft opacity-0 hover:bg-surface focus:opacity-100 group-hover:opacity-100"
                    aria-label={`Actions for ${inv.title}`}
                    aria-expanded={menuFor === inv.id}
                    onClick={() => setMenuFor(menuFor === inv.id ? null : inv.id)}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {menuFor === inv.id && (
                    <div className="absolute right-1 top-9 z-20 w-36 rounded-card border border-line bg-surface p-1 shadow-lift" role="menu">
                      <button role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-alt" onClick={() => startRename(inv)}>
                        <Pencil className="h-3.5 w-3.5" /> Rename
                      </button>
                      <button
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-danger hover:bg-danger-bg"
                        onClick={() => {
                          setMenuFor(null);
                          setConfirmDelete(inv.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
