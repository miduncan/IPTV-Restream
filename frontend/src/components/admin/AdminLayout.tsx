import { ReactNode } from 'react';
import { ArrowLeft, LogOut, Radio, Settings2 } from 'lucide-react';

interface AdminLayoutProps {
  authRequired: boolean;
  children: ReactNode;
  onSignOut: () => void;
}

function AdminLayout({ authRequired, children, onSignOut }: AdminLayoutProps) {
  return (
    <main className="admin-shell min-h-screen text-[#EAF0F6]">
      <header className="admin-header flex h-16 items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="signal-mark signal-mark-small"><Radio className="h-4 w-4" /></div>
          <a href="/" className="font-semibold tracking-[-0.02em]">StreamHub</a>
          <span className="text-[#435466]">/</span>
          <span className="text-sm text-[#91A0AF]">Admin</span>
        </div>
        {authRequired ? (
          <button type="button" onClick={onSignOut} className="admin-link flex items-center gap-2 text-sm text-[#91A0AF]">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        ) : (
          <a href="/" className="admin-link flex items-center gap-2 text-sm text-[#91A0AF]">
            <ArrowLeft className="h-4 w-4" /> Back to player
          </a>
        )}
      </header>

      <div className="mx-auto grid max-w-[1500px] md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="admin-sidebar px-5 py-6 sm:px-8 md:min-h-[calc(100vh-4rem)] md:px-5">
          <nav>
            <a href="/admin/" aria-current="page" className="admin-nav-active flex items-center gap-3 px-3 py-2.5 text-sm font-medium">
              <Settings2 className="h-4 w-4" /> Settings
            </a>
          </nav>
          <div className="mt-8 space-y-3 px-3 text-xs text-[#91A0AF] md:mt-12">
            <p className="flex items-center gap-2"><span className="status-light bg-[#44D492]" /> API connected</p>
            <p className="flex items-center gap-2"><span className="status-light bg-[#4EA1FF]" /> SQLite storage</p>
            <p className="flex items-center gap-2"><span className="status-light bg-[#D7A94B]" /> Admin session</p>
          </div>
        </aside>

        {children}
      </div>
    </main>
  );
}

export default AdminLayout;
