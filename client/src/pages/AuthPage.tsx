import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { BrandLockup } from '../components/layout/BrandMark';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../services/api';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'researcher' | 'clinician'>('researcher');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const isRegister = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (isRegister) await register({ name, email, password, role });
      else await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        setError(isRegister ? 'Check your details. The password needs at least 12 characters.' : 'Enter a valid email and password.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm placeholder:text-ink-soft';

  return (
    <div className="flex min-h-full items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandLockup />
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6 shadow-lift" aria-labelledby="auth-title">
          <div>
            <h1 id="auth-title" className="text-xl font-semibold">
              {isRegister ? 'Create your account' : 'Welcome back'}
            </h1>
            <p className="mt-1 text-sm text-ink-soft">
              {isRegister ? 'Save investigations and export reports.' : 'Sign in to continue your investigations.'}
            </p>
          </div>

          {error && (
            <div role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm text-danger">
              {error}
            </div>
          )}

          {isRegister && (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Name</span>
              <input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
            </label>
          )}

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input
              className={field}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={isRegister ? 12 : 1}
              maxLength={128}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {isRegister && <span className="mt-1 block text-xs text-ink-soft">At least 12 characters.</span>}
          </label>

          {isRegister && (
            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">I am a</legend>
              <div className="flex gap-2">
                {(['researcher', 'clinician'] as const).map((r) => (
                  <label
                    key={r}
                    className={`flex-1 cursor-pointer rounded-xl border px-3 py-2 text-center ${
                      role === r ? 'border-ink bg-pistachio' : 'border-line bg-surface'
                    }`}
                  >
                    <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} className="sr-only" />
                    {r === 'researcher' ? 'Researcher / bioinformatician' : 'Clinical professional'}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-ink-soft">
                Self-declared. It does not verify clinical credentials or authorize patient-data use.
              </p>
            </fieldset>
          )}

          <button type="submit" className="btn btn-primary w-full !py-2.5" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {isRegister ? 'Create account' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-ink-soft">
            {isRegister ? (
              <>
                Already registered? <Link to="/login" className="font-medium text-ink underline">Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link to="/register" className="font-medium text-ink underline">Create an account</Link>
              </>
            )}
          </p>
        </form>
        <p className="mt-4 text-center text-xs text-ink-soft">
          Research prototype. Do not enter patient-identifiable information.
        </p>
      </div>
    </div>
  );
}
