import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from 'react';
import { Check, ListVideo, Loader, Plus, Radio, RefreshCw, Search, Trash2 } from 'lucide-react';
import apiService, { ApiError } from '../../services/ApiService';
import { ChannelMode } from '../../types';
import ChannelModal, { ChannelFormValues } from '../add_channel/ChannelModal';

interface XtreamChannel {
  streamId: string;
  name: string;
  avatar: string;
  categoryId: string;
  category: string;
  addedChannelId: number | null;
  addedMode: ChannelMode | null;
}

interface CurrentChannel {
  id: number;
  name: string;
  avatar: string;
  group: string | null;
  mode: ChannelMode;
  source: string | null;
  sourceId: string | null;
}

interface ChannelResponse {
  channels: XtreamChannel[];
  currentChannels: CurrentChannel[];
  catalogError: string | null;
}

const DIRECTORY_HEIGHT = 680;
const DIRECTORY_ROW_HEIGHT = 69;
const DIRECTORY_OVERSCAN = 6;
const VIRTUALIZE_THRESHOLD = 100;

function ChannelLogo({ avatar, name }: { avatar: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#233242] bg-[#0b1118]">
      {!failed && avatar ? (
        <img src={avatar} alt="" className="h-full w-full object-contain p-1" onError={() => setFailed(true)} />
      ) : (
        <Radio className="h-5 w-5 text-[#496177]" aria-label={`${name} has no logo`} />
      )}
    </div>
  );
}

function DirectoryRow({
  channel,
  isLast,
  onAdd,
  style,
}: {
  channel: XtreamChannel;
  isLast: boolean;
  onAdd: (channel: XtreamChannel) => void;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={`flex h-[69px] items-center gap-3 px-4 py-3 sm:px-5 ${isLast ? '' : 'border-b border-[#233242]'}`}
    >
      <ChannelLogo avatar={channel.avatar} name={channel.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#EAF0F6]">{channel.name}</p>
        <p className="mt-0.5 truncate text-xs text-[#738496]">{channel.category} · Stream {channel.streamId}</p>
      </div>
      {channel.addedChannelId !== null ? (
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#315c4c] bg-[#14271f] px-3 py-1.5 text-xs font-medium text-[#72DFAD]"><Check className="h-3.5 w-3.5" /> Added</span>
      ) : (
        <button type="button" onClick={() => onAdd(channel)} className="admin-secondary flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs font-medium"><Plus className="h-3.5 w-3.5" /> Add</button>
      )}
    </div>
  );
}

function ChannelManager() {
  const [catalog, setCatalog] = useState<XtreamChannel[]>([]);
  const [currentChannels, setCurrentChannels] = useState<CurrentChannel[]>([]);
  const [selected, setSelected] = useState<XtreamChannel | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All categories');
  const [isLoading, setIsLoading] = useState(true);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [directoryScrollTop, setDirectoryScrollTop] = useState(0);
  const directoryRef = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await apiService.request<ChannelResponse>('/admin/channels');
      setCatalog(response.channels);
      setCurrentChannels(response.currentChannels);
      setError(response.catalogError || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load channels');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const categories = useMemo(
    () => ['All categories', ...Array.from(new Set(catalog.map((channel) => channel.category))).sort()],
    [catalog]
  );

  const filteredChannels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.filter((channel) =>
      (category === 'All categories' || channel.category === category) &&
      (!normalizedQuery || channel.name.toLowerCase().includes(normalizedQuery) || channel.streamId.includes(normalizedQuery))
    );
  }, [catalog, category, query]);

  const selectedPreset = useMemo(
    () => selected ? { name: selected.name, avatar: selected.avatar, mode: 'proxy' as ChannelMode, headers: [] } : null,
    [selected]
  );

  const shouldVirtualize = filteredChannels.length > VIRTUALIZE_THRESHOLD;
  const virtualRange = useMemo(() => {
    const firstVisible = Math.floor(directoryScrollTop / DIRECTORY_ROW_HEIGHT);
    const start = Math.max(0, firstVisible - DIRECTORY_OVERSCAN);
    const visibleCount = Math.ceil(DIRECTORY_HEIGHT / DIRECTORY_ROW_HEIGHT);
    const end = Math.min(filteredChannels.length, firstVisible + visibleCount + DIRECTORY_OVERSCAN);
    return { start, end };
  }, [directoryScrollTop, filteredChannels.length]);

  useEffect(() => {
    setDirectoryScrollTop(0);
    if (directoryRef.current) directoryRef.current.scrollTop = 0;
  }, [query, category]);

  const handleDirectoryScroll = (event: UIEvent<HTMLDivElement>) => {
    if (shouldVirtualize) setDirectoryScrollTop(event.currentTarget.scrollTop);
  };

  const addChannel = async (values: ChannelFormValues) => {
    if (!selected) return;
    await apiService.request('/admin/channels', 'POST', undefined, {
      streamId: selected.streamId,
      name: values.name,
      avatar: values.avatar,
      mode: values.mode,
      headers: values.headers,
    });
    await loadChannels();
  };

  const removeChannel = async (channelId: number) => {
    setRemovingId(channelId);
    setError('');
    try {
      await apiService.request(`/admin/channels/${channelId}`, 'DELETE');
      await loadChannels();
    } catch (removeError) {
      if (removeError instanceof ApiError && (removeError.status === 401 || removeError.status === 403)) window.location.reload();
      setError(removeError instanceof Error ? removeError.message : 'Could not remove channel');
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section className="min-w-0 px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-5 border-b border-[#233242] pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm text-[#44D492]">
              <ListVideo className="h-4 w-4" /> Live channel directory
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Channels</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#91A0AF]">
              Choose channels from the Xtream account configured in Settings.
            </p>
          </div>
          <button type="button" onClick={loadChannels} disabled={isLoading} className="admin-secondary flex items-center justify-center gap-2 px-4 py-2.5 text-sm">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} /> Refresh directory
          </button>
        </div>

        {error && (
          <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-[#6f3a3a] bg-[#26191c] px-4 py-3 text-sm text-[#FFB2B2]" role="alert">
            <span>{error}</span>
            <button type="button" onClick={loadChannels} className="shrink-0 font-medium text-[#EAF0F6]">Try again</button>
          </div>
        )}

        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-[#DCE6EF]">Current lineup</h2>
            <span className="text-xs text-[#738496]">{currentChannels.length} added</span>
          </div>
          <div className="admin-panel overflow-hidden">
            {currentChannels.length === 0 ? (
              <div className="admin-empty border-0 px-5 py-8 text-center text-sm text-[#91A0AF]">Your channel list is empty. Add a channel from the directory below.</div>
            ) : currentChannels.map((channel) => (
              <div key={channel.id} className="flex items-center gap-3 border-b border-[#233242] px-4 py-3 last:border-b-0 sm:px-5">
                <ChannelLogo avatar={channel.avatar} name={channel.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[#EAF0F6]">{channel.name}</p>
                  <p className="mt-0.5 truncate text-xs text-[#738496]">{channel.group || 'Uncategorized'} · {channel.mode}{channel.source !== 'xtream' ? ' · Legacy channel' : ''}</p>
                </div>
                <button type="button" onClick={() => removeChannel(channel.id)} disabled={removingId === channel.id} className="admin-icon-button flex h-9 w-9 items-center justify-center" aria-label={`Remove ${channel.name}`}>
                  {removingId === channel.id ? <Loader className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-9">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-[#DCE6EF]">Xtream directory</h2>
            {!isLoading && <span className="text-xs text-[#738496]">{filteredChannels.length} of {catalog.length}</span>}
          </div>
          <div className="mb-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
            <label className="relative">
              <span className="sr-only">Search channels</span>
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#617386]" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="admin-input w-full py-2.5 pl-10 pr-3 text-sm" placeholder="Search name or stream ID" />
            </label>
            <select value={category} onChange={(event) => setCategory(event.target.value)} className="admin-input w-full px-3 py-2.5 text-sm">
              {categories.map((name) => <option key={name}>{name}</option>)}
            </select>
          </div>

          <div
            ref={directoryRef}
            onScroll={handleDirectoryScroll}
            className={`admin-panel overflow-y-auto scroll-container ${shouldVirtualize ? 'h-[680px]' : 'max-h-[680px]'}`}
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-3 px-5 py-16 text-sm text-[#91A0AF]"><Loader className="h-5 w-5 animate-spin text-[#4EA1FF]" /> Loading Xtream channels</div>
            ) : filteredChannels.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-[#91A0AF]">No channels match this search and category.</div>
            ) : shouldVirtualize ? (
              <div className="relative" style={{ height: filteredChannels.length * DIRECTORY_ROW_HEIGHT }}>
                {filteredChannels.slice(virtualRange.start, virtualRange.end).map((channel, offset) => {
                  const index = virtualRange.start + offset;
                  return (
                    <DirectoryRow
                      key={channel.streamId}
                      channel={channel}
                      isLast={index === filteredChannels.length - 1}
                      onAdd={setSelected}
                      style={{ position: 'absolute', insetInline: 0, top: index * DIRECTORY_ROW_HEIGHT }}
                    />
                  );
                })}
              </div>
            ) : filteredChannels.map((channel, index) => (
              <DirectoryRow
                key={channel.streamId}
                channel={channel}
                isLast={index === filteredChannels.length - 1}
                onAdd={setSelected}
              />
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <ChannelModal
          channelOnly
          preset={selectedPreset}
          sourceDescription={`${selected.category} · Stream ${selected.streamId}. The server builds the URL from your saved Xtream credentials.`}
          onAddChannel={addChannel}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

export default ChannelManager;
