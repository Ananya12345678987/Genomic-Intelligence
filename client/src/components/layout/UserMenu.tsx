import { useState, type FormEvent } from 'react';
import { LogOut, Trash2, UserRound } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../services/api';
import { AiConsent } from './AiConsent';

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, logout, deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  const confirmDelete = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await deleteAccount(password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete the account. Please try again.');
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={clsx('flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-pistachio/60', collapsed && 'justify-center')}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pistachio-deep/50">
          <UserRound className="h-4 w-4" aria-hidden />
        </span>
        {!collapsed && (
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block text-[11px] text-ink-soft">
              {user.role === 'clinician' ? 'Clinical professional' : 'Researcher'} · self-declared
            </span>
          </span>
        )}
      </button>

      {open && (
        <div role="menu" className="absolute bottom-14 left-0 z-30 w-64 rounded-card border border-line bg-surface p-1.5 shadow-lift">
          <div className="truncate px-2.5 py-1.5 text-xs text-ink-soft">{user.email}</div>
          <AiConsent />
          <button role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-surface-alt" onClick={() => void logout()}>
            <LogOut className="h-4 w-4" /> Sign out
          </button>
          <button
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-danger hover:bg-danger-bg"
            onClick={() => {
              setOpen(false);
              setDeleting(true);
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete account…
          </button>
        </div>
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" role="dialog" aria-modal="true" aria-labelledby="del-title">
          <form onSubmit={confirmDelete} className="card w-full max-w-sm space-y-3 p-5 shadow-lift">
            <h2 id="del-title" className="text-lg font-semibold">Delete your account?</h2>
            <p className="text-sm text-ink-soft">
              This permanently deletes your account, all investigations and all messages. It can&apos;t be undone.
            </p>
            {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Confirm with your password</span>
              <input
                type="password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => { setDeleting(false); setPassword(''); setError(null); }}>
                Cancel
              </button>
              <button type="submit" className="btn border-transparent bg-danger text-canvas hover:bg-danger/90">
                Delete permanently
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
