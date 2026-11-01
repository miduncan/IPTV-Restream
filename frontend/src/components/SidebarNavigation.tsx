import { useEffect, useRef, useState } from 'react';
import { MoreVertical, ListVideo, MessageSquare, Trophy } from 'lucide-react';

type SidebarView = 'channels' | 'chat' | 'games';

export default function SidebarNavigation({ activeView, onChange, channelCount }: {
  activeView: SidebarView;
  onChange: (view: SidebarView) => void;
  channelCount: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuContainer = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const channelItem = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    channelItem.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menuContainer.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

  return <div className="sidebar-tabs">
    <div className="grid grid-cols-2" role="tablist" aria-label="Player sidebar">
      <button id="chat-tab" type="button" role="tab" aria-controls="chat-panel" aria-selected={activeView === 'chat'} onClick={() => onChange('chat')} className={activeView === 'chat' ? 'sidebar-tab-active' : 'sidebar-tab'}>
        <MessageSquare className="h-4 w-4" /> Live chat
      </button>
      <button id="games-tab" type="button" role="tab" aria-controls="games-panel" aria-selected={activeView === 'games'} onClick={() => onChange('games')} className={activeView === 'games' ? 'sidebar-tab-active' : 'sidebar-tab'}>
        <Trophy className="h-4 w-4" /> Games
      </button>
    </div>
    <div ref={menuContainer} className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
    }}>
      <button ref={trigger} type="button" aria-label="More sidebar options" title={activeView === 'channels' ? 'Channels selected' : 'More sidebar options'} aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? 'sidebar-overflow-menu' : undefined} onClick={() => setMenuOpen(open => !open)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          setMenuOpen(true);
        }
      }} className={`${activeView === 'channels' ? 'sidebar-tab-active' : 'sidebar-tab'} h-full w-8`}>
        <MoreVertical className="h-5 w-5" />
      </button>
      {menuOpen && <div id="sidebar-overflow-menu" role="menu" aria-label="More sidebar options" className="absolute right-0 top-full z-30 mt-2 w-52 rounded-lg border border-[#304254] bg-[#101B26] p-1 shadow-xl">
        <button ref={channelItem} type="button" role="menuitemradio" aria-checked={activeView === 'channels'} aria-controls="channels-panel" onClick={() => {
          onChange('channels');
          setMenuOpen(false);
          trigger.current?.focus();
        }} onKeyDown={event => {
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) event.preventDefault();
        }} className="flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm text-[#DCE6EF] hover:bg-[#182838] focus:bg-[#182838] focus:outline-none">
          <ListVideo className="h-4 w-4 text-[#91A0AF]" />
          <span className="flex-1">Channels</span>
          <span className="text-xs text-[#91A0AF]">{channelCount}</span>
        </button>
      </div>}
    </div>
  </div>;
}
