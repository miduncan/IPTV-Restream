import { useState } from 'react';
import { Loader, LogOut } from 'lucide-react';

interface LogoutButtonProps {
  className?: string;
}

function LogoutButton({ className = '' }: LogoutButtonProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = () => {
    setIsLoggingOut(true);

    // HTTP Basic Auth has no server-side session to destroy. Sending an
    // intentionally invalid login makes the browser discard its cached login.
    const request = new XMLHttpRequest();
    const nonce = Date.now().toString();
    request.open('GET', `/api/auth/admin-status?logout=${nonce}`, true, `logout-${nonce}`, nonce);
    request.setRequestHeader('Cache-Control', 'no-store');

    const returnToLogin = () => window.location.replace('/');
    request.addEventListener('loadend', returnToLogin, { once: true });
    request.send();
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={isLoggingOut}
      className={`${className} disabled:cursor-wait disabled:opacity-60`}
      aria-label="Log out"
    >
      {isLoggingOut ? <Loader className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      <span className="hidden sm:inline">Log out</span>
    </button>
  );
}

export default LogoutButton;
