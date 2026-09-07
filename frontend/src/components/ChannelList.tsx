import React from "react";
import { Channel } from "../types";
import socketService from "../services/SocketService";

interface ChannelListProps {
  channels: Channel[];
  selectedChannel: Channel | null;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  onChannelSelectCheckPermission: () => boolean;
}

function ChannelList({
  channels,
  selectedChannel,
  setSearchQuery,
  onChannelSelectCheckPermission,
}: ChannelListProps) {

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
      {channels.map((channel) => (
        <button
          key={channel.id}
          title={channel.name.length > 28 ? channel.name : ""}
          onClick={() => onSelectChannel(channel)}
          className={`channel-row group ${
            selectedChannel?.id === channel.id
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
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium text-[#DCE6EF]">{channel.name}</p>
            <p className="mt-0.5 truncate text-xs text-[#617386]">{channel.group || channel.playlistName || 'Live channel'}</p>
          </div>
          {selectedChannel?.id === channel.id && <span className="status-light shrink-0 bg-[#44D492] text-[#44D492]" aria-label="Currently playing" />}
        </button>
      ))}
    </div>
  );
}

export default ChannelList;
