import { useState, useEffect, useMemo, useContext } from 'react';
import { Search, Radio, ChevronDown, Shield, MessageSquare, ListVideo, ListFilter } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import ChannelList from './components/ChannelList';
import Chat from './components/chat/Chat';
import { Channel, ChannelEpg } from './types';
import socketService from './services/SocketService';
import apiService from './services/ApiService';
import { ToastProvider, ToastContext } from './components/notifications/ToastContext';
import ToastContainer from './components/notifications/ToastContainer';
import LogoutButton from './components/LogoutButton';

function AppContent() {

  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [channelSelectRequiresAdmin, setChannelSelectRequiresAdmin] = useState(false);
  const [sidebarView, setSidebarView] = useState<'channels' | 'chat'>('chat');
  const [syncEnabled, setSyncEnabled] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [epgByChannel, setEpgByChannel] = useState<Record<number, ChannelEpg>>({});
  const [epgRefreshVersion, setEpgRefreshVersion] = useState(0);

  const [selectedGroup, setSelectedGroup] = useState<string>('Category');
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false);

  const { addToast } = useContext(ToastContext);

  const filteredChannels = useMemo(() => {
    const filteredByGroup = selectedGroup === 'Category' ? channels : channels.filter(channel =>
      channel.group === selectedGroup
    );

    return filteredByGroup.filter(channel =>
      channel.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [channels, selectedGroup, searchQuery]);

  const groups = useMemo(() => {
    const uniqueGroups = new Set(channels.map(channel => channel.group).filter(group => group !== null));
    return ['Category', ...Array.from(uniqueGroups)];
  }, [channels]);

  useEffect(() => {
    // Check if admin mode is enabled on the server
    apiService
      .request<{ username: string | null; isAdmin: boolean; channelSelectionRequiresAdmin: boolean; streamSynchronizationEnabled: boolean }>('/auth/admin-status', 'GET')
      .then((data) => {
        setUsername(data.username);
        setIsAdmin(data.isAdmin);
        setChannelSelectRequiresAdmin(data.channelSelectionRequiresAdmin);
        setSyncEnabled(data.streamSynchronizationEnabled);
      })
      .catch((error) => console.error('Error checking admin status:', error));

    const refreshChannelState = () => {
      Promise.all([
        apiService.request<Channel[]>('/channels/', 'GET'),
        apiService.request<Channel | null>('/channels/current', 'GET'),
      ])
        .then(([nextChannels, currentChannel]) => {
          setChannels(nextChannels);
          setSelectedChannel(currentChannel);
        })
        .catch((error) => console.error('Error refreshing channels:', error));
    };

    refreshChannelState();

    console.log('Subscribing to events');
    const channelAddedListener = (channel: Channel) => {
      setChannels((prevChannels) => [...prevChannels, channel]);
    };

    const channelSelectedListener = (nextChannel: Channel | null) => {
      setSelectedChannel(nextChannel);
    };

    const channelUpdatedListener = (updatedChannel: Channel) => {
      setChannels((prevChannels) =>
        prevChannels.map((channel) =>
          channel.id === updatedChannel.id ?
            updatedChannel : channel
        )
      );

      setSelectedChannel((selectedChannel: Channel | null) => {
        if (selectedChannel?.id === updatedChannel.id) {
          // Reload stream if the stream attributes (url, headers) have changed
          if (
            (selectedChannel?.url != updatedChannel.url ||
              JSON.stringify(selectedChannel?.headers) !=
              JSON.stringify(updatedChannel.headers)) &&
            selectedChannel?.mode === 'restream'
          ) {
            //TODO: find a better solution instead of reloading (problem is m3u8 needs time to refresh server-side)
            setTimeout(() => {
              window.location.reload();
            }, 3000);
          }
          return updatedChannel;
        }
        return selectedChannel;
      });
    };

    const channelDeletedListener = (deletedChannel: number) => {
      setChannels((prevChannels) =>
        prevChannels.filter((channel) => channel.id !== deletedChannel)
      );
    };

    const errorListener = (error: { message: string }) => {
      addToast({
        type: 'error',
        title: 'Error',
        message: error.message,
        duration: 5000,
      });
    };

    const socketConnectedListener = () => refreshChannelState();
    const epgCacheClearedListener = () => setEpgRefreshVersion((version) => version + 1);

    socketService.subscribeToEvent('channel-added', channelAddedListener);
    socketService.subscribeToEvent('channel-selected', channelSelectedListener);
    socketService.subscribeToEvent('channel-updated', channelUpdatedListener);
    socketService.subscribeToEvent('channel-deleted', channelDeletedListener);
    socketService.subscribeToEvent('app-error', errorListener);
    socketService.subscribeToEvent('socket-connected', socketConnectedListener);
    socketService.subscribeToEvent('epg-cache-cleared', epgCacheClearedListener);

    socketService.connect();

    return () => {
      socketService.unsubscribeFromEvent('channel-added', channelAddedListener);
      socketService.unsubscribeFromEvent(
        'channel-selected',
        channelSelectedListener
      );
      socketService.unsubscribeFromEvent(
        'channel-updated',
        channelUpdatedListener
      );
      socketService.unsubscribeFromEvent(
        'channel-deleted',
        channelDeletedListener
      );
      socketService.unsubscribeFromEvent('app-error', errorListener);
      socketService.unsubscribeFromEvent('socket-connected', socketConnectedListener);
      socketService.unsubscribeFromEvent('epg-cache-cleared', epgCacheClearedListener);
      socketService.disconnect();
      console.log('WebSocket connection closed');
    };
  }, [addToast]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;

    if (channels.length === 0) {
      setEpgByChannel({});
      return;
    }

    const refreshEpg = async () => {
      try {
        const response = await apiService.request<{ guides: Record<number, ChannelEpg> }>('/channels/epg');
        if (cancelled) return;
        setEpgByChannel(response.guides);

        const now = Date.now();
        const nextExpiry = Object.values(response.guides)
          .map((guide) => Date.parse(guide.cacheUntil))
          .filter((expiry) => Number.isFinite(expiry) && expiry > now)
          .sort((left, right) => left - right)[0];
        const delay = nextExpiry ? Math.max(1000, nextExpiry - now + 1000) : 5 * 60 * 1000;
        refreshTimer = window.setTimeout(refreshEpg, delay);
      } catch (error) {
        console.error('Error refreshing EPG:', error);
        if (!cancelled) refreshTimer = window.setTimeout(refreshEpg, 5 * 60 * 1000);
      }
    };

    refreshEpg();
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [channels, epgRefreshVersion]);

  return (
    <main className="player-shell min-h-screen text-[#EAF0F6]">
      <header className="admin-header flex h-16 items-center justify-between px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="signal-mark signal-mark-small shrink-0"><Radio className="h-4 w-4" /></div>
          <a href="/" className="font-semibold tracking-[-0.02em]">StreamHub</a>
          {selectedChannel && (
            <>
              <span className="hidden text-[#435466] sm:inline">/</span>
              <span className="hidden truncate text-sm text-[#91A0AF] sm:block">{selectedChannel.name}</span>
            </>
          )}
          {isAdmin && (
            <span className="hidden items-center gap-1 rounded-full border border-[#44D492]/40 bg-[#44D492]/10 px-2 py-1 text-xs font-medium text-[#70E0AE] md:flex">
              <Shield className="h-3 w-3" /> Admin
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {isAdmin && (
            <a
              href="/admin/"
              aria-label="Open admin panel"
              className="player-header-action text-[#70E0AE]"
            >
              <Shield className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </a>
          )}
          {username && <LogoutButton className="player-header-action" />}
        </div>
      </header>

      <div className="player-workspace">
        <section className="player-stage" aria-label="Video player">
          <VideoPlayer channel={selectedChannel} syncEnabled={syncEnabled} />
        </section>

        <aside className="player-sidebar">
          <div className="sidebar-tabs" role="tablist" aria-label="Player sidebar">
            <button id="chat-tab" type="button" role="tab" aria-controls="chat-panel" aria-selected={sidebarView === 'chat'} onClick={() => setSidebarView('chat')} className={sidebarView === 'chat' ? 'sidebar-tab-active' : 'sidebar-tab'}>
              <MessageSquare className="h-4 w-4" /> Live chat
            </button>
            <button id="channels-tab" type="button" role="tab" aria-controls="channels-panel" aria-selected={sidebarView === 'channels'} onClick={() => setSidebarView('channels')} className={sidebarView === 'channels' ? 'sidebar-tab-active' : 'sidebar-tab'}>
              <ListVideo className="h-4 w-4" /> Channels <span>{filteredChannels.length}</span>
            </button>
          </div>

          <div
            id="channels-panel"
            role="tabpanel"
            aria-labelledby="channels-tab"
            hidden={sidebarView !== 'channels'}
            className={sidebarView === 'channels' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
              <div className="border-b border-[#233242] p-4">
                <div className="relative mb-3">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#617386]" />
                  <input type="search" placeholder="Search channels" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="admin-input w-full py-2 pl-9 pr-3 text-sm" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      onClick={() => {
                        setIsGroupDropdownOpen(!isGroupDropdownOpen);
                      }}
                      className="sidebar-filter group"
                    >
                      <ListFilter className="h-4 w-4 text-[#4EA1FF]" />
                      <span className="max-w-[112px] truncate">{selectedGroup === 'Category' ? 'All categories' : selectedGroup}</span>
                      <ChevronDown className={`h-3.5 w-3.5 text-[#617386] transition-transform duration-200 ${isGroupDropdownOpen ?
                        "rotate-180" : ""}`} />
                    </button>

                    {isGroupDropdownOpen && (
                      <div className="sidebar-menu right-0">
                        <div className="max-h-72 overflow-y-auto scroll-container">
                          {groups.map((group) => (
                            <button
                              key={group}
                              onClick={() => {
                                setSelectedGroup(group);
                                setIsGroupDropdownOpen(false);
                              }}
                              className={`sidebar-menu-item ${selectedGroup === group ? "text-[#8BC3FF] font-semibold" : "text-[#DCE6EF]"}`}
                              style={{
                                whiteSpace: 'normal',
                                wordWrap: 'break-word',
                                overflowWrap: 'anywhere',
                              }}
                            >
                              {group === 'Category' ? 'All Categories' : group}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scroll-container vertical-scroll-container">
              <ChannelList
                channels={filteredChannels}
                selectedChannel={selectedChannel}
                epgByChannel={epgByChannel}
                setSearchQuery={setSearchQuery}
                onChannelSelectCheckPermission={() => {
                  if (channelSelectRequiresAdmin && !isAdmin) {
                    addToast({
                      type: 'error',
                      title: 'Admin access required',
                      message: 'Sign in with the admin site credentials to switch channels.',
                      duration: 4000,
                    });
                    return false;
                  }
                  return true;
                }}
              />
            </div>
          </div>
          <div
            id="chat-panel"
            role="tabpanel"
            aria-labelledby="chat-tab"
            hidden={sidebarView !== 'chat'}
            className={sidebarView === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
          >
            <Chat isActive={sidebarView === 'chat'} />
          </div>
        </aside>
      </div>

      <ToastContainer />
    </main>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
