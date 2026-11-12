import { ListVideo, MessageSquare, Trophy } from 'lucide-react';

type SidebarView = 'channels' | 'chat' | 'games';

const tabs = [
  { view: 'chat', label: 'Live chat', Icon: MessageSquare },
  { view: 'games', label: 'Games', Icon: Trophy },
  { view: 'channels', label: 'Channels', Icon: ListVideo },
] as const;

export default function SidebarNavigation({ activeView, onChange }: {
  activeView: SidebarView;
  onChange: (view: SidebarView) => void;
}) {
  return <div className="sidebar-tabs" role="tablist" aria-label="Player sidebar">
    {tabs.map(({ view, label, Icon }) => <button
      key={view}
      id={`${view}-tab`}
      type="button"
      role="tab"
      aria-label={label}
      title={label}
      aria-controls={`${view}-panel`}
      aria-selected={activeView === view}
      onClick={() => onChange(view)}
      className={activeView === view ? 'sidebar-tab-active' : 'sidebar-tab'}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>)}
  </div>;
}
