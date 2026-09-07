import { useState } from 'react';
import { Loader, LogOut } from 'lucide-react';
import apiService from '../services/ApiService';

interface LogoutButtonProps {
  className?: string;
}

function LogoutButton({ className = '' }: LogoutButtonProps) {
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const logout = async () => {
    setIsLoggingOut(true);
    try {
      await apiService.request<void>('/auth/logout', 'POST');
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      window.location.replace('/');
    }
  };

  return (
    <button
      type="button"
      onClick={logout}
      disabled={isLoggingOut}
      className={className + ' disabled:cursor-wait disabled:opacity-60'}
      aria-label="Log out"
    >
      {isLoggingOut ? <Loader className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
      <span className="hidden sm:inline">Log out</span>
    </button>
  );
}

export default LogoutButton;
