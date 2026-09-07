import React, { useEffect, useState } from "react";
import { Channel, ChannelEpg } from "../types";
import socketService from "../services/SocketService";

interface ChannelListProps {
  channels: Channel[];
  selectedChannel: Channel | null;
  epgByChannel: Record<number, ChannelEpg>;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onChannelSelectCheckPermission: () => boolean;
}

function ChannelList({
  channels,
  selectedChannel,
  epgByChannel,
  setSearchQuery,
  onChannelSelectCheckPermission,
}: ChannelListProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const formatTime = (value: string) => new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

  const onSelectChannel = (channel: Channel) => {
    setSearchQuery("");
    if (channel.id === selectedChannel?.id) return;
    if (!onChannelSelectCheckPermission()) return;
    socketService.setCurrentChannel(channel.id);
  };

  return (
    <div className="space-y-1">
      {channels.length === 0 && (
        <div className="flex min-h-32 w-full items-center justify-center rounded-lg border border-dashed border-[#304254] px-5 text-center text-sm text-[#91A0AF]">
          No channels have been added. Add one from the admin panel.
        </div>
      )}
      {channels.map((channel) => {
        const guide = epgByChannel[channel.id];
        const current = guide?.current;
        const next = guide?.next;
        const isSelected = selectedChannel?.id === channel.id;
        const start = current ? Date.parse(current.start) : 0;
        const end = current ? Date.parse(current.end) : 0;
        const progress = end > start ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100)) : 0;

        return <button
          key={channel.id}
          title={channel.name.length > 28 ? channel.name : ""}
          onClick={() => onSelectChannel(channel)}
          className={`channel-row group relative ${isSelected ? "items-start" : ""} ${
            isSelected
              ? "channel-row-active"
              : ""
          }`}
        >
          <div className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#0B1118]">
            <img
              src={channel.avatar}
              alt={channel.name}
              className="h-full w-full object-contain"
            />
          </div>
          <div className="min-w-0 flex-1 py-0.5 text-left">
            <p className="truncate text-sm font-medium text-[#DCE6EF]">{channel.name}</p>
            <p className={`mt-0.5 truncate text-xs ${current ? 'text-[#AEBECC]' : 'italic text-[#617386]'}`}>
              {current?.title || 'No info available'}
            </p>
            {isSelected && current && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-3 text-[11px] text-[#718396]">
                  <span>{formatTime(current.start)}–{formatTime(current.end)}</span>
                  <span>{Math.max(0, Math.ceil((end - now) / 60_000))} min left</span>
                </div>
                <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-[#293B4D]">
                  <div className="h-full rounded-full bg-[#4EA1FF]" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}
            {isSelected && next && (
              <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-[#294052] pt-2 text-[11px]">
                <span className="shrink-0 font-semibold text-[#8A9BAA]">Next</span>
                <span className="truncate text-[#B4C3CF]">{next.title}</span>
                <span className="ml-auto shrink-0 text-[#718396]">{formatTime(next.start)}</span>
              </div>
            )}
          </div>
          {isSelected && <span className="status-light mt-1.5 shrink-0 bg-[#44D492] text-[#44D492]" aria-label="Currently playing" />}
        </button>;
      })}
    </div>
  );
}

export default ChannelList;
