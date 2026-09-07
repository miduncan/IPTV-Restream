import { FormEvent, useState } from 'react';
import { ArrowLeft, KeyRound, Radio } from 'lucide-react';

interface AdminLoginProps {
  message: string;
  onLogin: (password: string) => Promise<void>;
}

function AdminLogin({ message, onLogin }: AdminLoginProps) {
  const [password, setPassword] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await onLogin(password);
  };

  return (
    <main className="admin-shell min-h-screen px-5 py-8 text-[#EAF0F6] sm:px-8">
      <a href="/" className="admin-link inline-flex items-center gap-2 text-sm text-[#91A0AF]">
        <ArrowLeft className="h-4 w-4" /> Back to StreamHub
      </a>
      <section className="mx-auto mt-[12vh] max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <div className="signal-mark"><Radio className="h-6 w-6" /></div>
          <div>
            <p className="text-sm text-[#91A0AF]">StreamHub control</p>
            <h1 className="text-3xl font-semibold tracking-[-0.03em]">Administrator access</h1>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="admin-panel p-6 sm:p-8">
          <label htmlFor="admin-password" className="mb-2 block text-sm font-medium">
            Admin password
          </label>
          <div className="relative">
            <KeyRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#617386]" />
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="admin-input w-full py-3 pl-12 pr-4"
              placeholder="Enter password"
              required
            />
          </div>
          {message && <p className="mt-3 text-sm text-[#FF8B8B]">{message}</p>}
          <button className="admin-primary mt-5 w-full px-4 py-3" type="submit">
            Open control panel
          </button>
        </form>
      </section>
    </main>
  );
}

export default AdminLogin;
