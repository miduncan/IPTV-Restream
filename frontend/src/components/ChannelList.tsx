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
    <div className="flex space-x-3 hover:overflow-x-auto overflow-hidden pb-2 px-1 pt-1 scroll-container">
      {channels.length === 0 && (
        <div className="flex min-h-28 w-full items-center justify-center rounded-lg border border-dashed border-gray-700 px-5 text-center text-sm text-gray-400">
          No channels have been added. Add one from the admin panel.
        </div>
      )}
      {channels.map((channel) => (
        <button
          key={channel.id}
          title={channel.name.length > 28 ? channel.name : ""}
          onClick={() => onSelectChannel(channel)}
          className={`group relative p-2 rounded-lg transition-all ${
            selectedChannel?.id === channel.id
              ? "bg-blue-500 bg-opacity-20 ring-2 ring-blue-500"
              : "hover:bg-gray-700"
          }`}
        >
          <div className="h-20 w-20 mb-2 flex items-center justify-center rounded-lg mx-auto">
            <img
              src={channel.avatar}
              alt={channel.name}
              className="w-full h-full object-contain rounded-lg transition-transform group-hover:scale-105"
            />
          </div>
          <p className="text-sm font-medium truncate text-center">
            {channel.name.length > 28
              ? `${channel.name.substring(0, 28)}...`
              : channel.name}
          </p>
        </button>
      ))}
    </div>
  );
}

export default ChannelList;
