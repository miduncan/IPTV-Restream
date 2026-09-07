import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { Loader, LockKeyhole, Radio, ShieldAlert } from 'lucide-react';
import apiService, { ApiError } from '../../services/ApiService';
import LogoutButton from '../LogoutButton';

type AuthStatus = {
  username: string | null;
  role: 'viewer' | 'admin';
  isAdmin: boolean;
};

interface AuthGateProps {
  children: ReactNode;
  requireAdmin?: boolean;
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: (status: AuthStatus) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setIsSubmitting(true);
    try {
      const response = await apiService.request<{ user: AuthStatus }>(
        '/auth/login',
        'POST',
        undefined,
        { username, password }
      );
      onAuthenticated(response.user);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="admin-shell flex min-h-screen items-center justify-center px-5 text-[#EAF0F6]">
      <section className="admin-panel w-full max-w-md p-7 sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="signal-mark signal-mark-small"><Radio className="h-4 w-4" /></div>
          <div>
            <h1 className="text-xl font-semibold tracking-[-0.02em]">Sign in to StreamHub</h1>
            <p className="mt-1 text-sm text-[#91A0AF]">Enter your viewer or admin credentials.</p>
          </div>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <label className="block text-sm text-[#B8C4D0]">
            Username
            <input
              className="admin-input mt-2 w-full px-3 py-2.5"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="block text-sm text-[#B8C4D0]">
            Password
            <input
              className="admin-input mt-2 w-full px-3 py-2.5"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {message && <p role="alert" className="text-sm text-[#FF8A8A]">{message}</p>}
          <button
            type="submit"
            disabled={isSubmitting}
            className="admin-primary flex w-full items-center justify-center gap-2 px-5 py-2.5 disabled:cursor-wait disabled:opacity-60"
          >
            {isSubmitting ? <Loader className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}

function AuthGate({ children, requireAdmin = false }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  const checkSession = useCallback(async () => {
    setIsChecking(true);
    try {
      const nextStatus = await apiService.request<AuthStatus>('/auth/admin-status');
      setStatus(nextStatus);
    } catch {
      setStatus(null);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
    const sessionExpired = () => {
      setStatus(null);
      setIsChecking(false);
    };
    window.addEventListener('auth-expired', sessionExpired);
    return () => window.removeEventListener('auth-expired', sessionExpired);
  }, [checkSession]);

  if (isChecking) {
    return (
      <main className="admin-shell flex min-h-screen items-center justify-center text-[#EAF0F6]">
        <Loader className="h-6 w-6 animate-spin text-[#4EA1FF]" aria-label="Checking session" />
      </main>
    );
  }

  if (!status) return <LoginScreen onAuthenticated={setStatus} />;

  if (requireAdmin && !status.isAdmin) {
    return (
      <main className="admin-shell flex min-h-screen items-center justify-center px-5 text-[#EAF0F6]">
        <section className="admin-panel max-w-lg p-8 text-center">
          <ShieldAlert className="mx-auto h-9 w-9 text-[#D7A94B]" />
          <h1 className="mt-4 text-2xl font-semibold">Admin access required</h1>
          <p className="mt-2 text-[#91A0AF]">You are signed in as {status.username || 'a viewer'}.</p>
          <div className="mt-6 flex justify-center gap-3">
            <a href="/" className="admin-primary px-5 py-2.5">Back to player</a>
            <LogoutButton className="admin-link flex items-center gap-2 px-3 py-2.5 text-sm text-[#91A0AF]" />
          </div>
        </section>
      </main>
    );
  }

  return children;
}

export default AuthGate;
