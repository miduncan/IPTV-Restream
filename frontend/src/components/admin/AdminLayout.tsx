import { ReactNode } from 'react';
import { ArrowLeft, ListVideo, Radio, Settings2 } from 'lucide-react';
import LogoutButton from '../LogoutButton';

export type AdminSection = 'settings' | 'channels';

interface AdminLayoutProps {
  children: ReactNode;
  activeSection: AdminSection;
  onSectionChange: (section: AdminSection) => void;
}

function AdminLayout({ children, activeSection, onSectionChange }: AdminLayoutProps) {
  return (
    <main className="admin-shell min-h-screen text-[#EAF0F6]">
      <header className="admin-header flex h-16 items-center justify-between px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="signal-mark signal-mark-small"><Radio className="h-4 w-4" /></div>
          <a href="/" className="font-semibold tracking-[-0.02em]">StreamHub</a>
          <span className="text-[#435466]">/</span>
          <span className="text-sm text-[#91A0AF]">Admin</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <a href="/" className="admin-link flex items-center gap-2 text-sm text-[#91A0AF]">
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">Back to player</span>
          </a>
          <LogoutButton className="admin-link flex items-center gap-2 text-sm text-[#91A0AF]" />
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] md:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="admin-sidebar px-5 py-6 sm:px-8 md:min-h-[calc(100vh-4rem)] md:px-5">
          <nav>
            <button type="button" onClick={() => onSectionChange('settings')} aria-current={activeSection === 'settings' ? 'page' : undefined} className={`${activeSection === 'settings' ? 'admin-nav-active' : 'admin-nav'} flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium`}>
              <Settings2 className="h-4 w-4" /> Settings
            </button>
            <button type="button" onClick={() => onSectionChange('channels')} aria-current={activeSection === 'channels' ? 'page' : undefined} className={`${activeSection === 'channels' ? 'admin-nav-active' : 'admin-nav'} mt-1 flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium`}>
              <ListVideo className="h-4 w-4" /> Channels
            </button>
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
