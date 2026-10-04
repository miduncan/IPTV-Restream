const ChannelService = require("../services/ChannelService");
const XtreamService = require("../services/XtreamService");
const broadcastChannelSelection = require("../socket/broadcastChannelSelection");

function sendError(res, error, fallback) {
  console.error(fallback, error);
  res.status(error.statusCode || 502).json({ error: error.message || fallback });
}

function serializeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    url: channel.url,
    avatar: channel.avatar,
    group: channel.group,
    mode: channel.mode,
    headers: Array.isArray(channel.headers) ? channel.headers : [],
    playlist: channel.playlist,
    playlistName: channel.playlistName,
    playlistUpdate: Boolean(channel.playlistUpdate),
    source: channel.source ?? null,
    sourceId: channel.sourceId ?? null,
  };
}

function getChannelUpdates(channel, body = {}) {
  const name = String(body.name ?? "").trim();
  if (!name) {
    const error = new Error("Channel name is required");
    error.statusCode = 400;
    throw error;
  }

  const mode = String(body.mode ?? "");
  if (!["direct", "proxy", "restream"].includes(mode)) {
    const error = new Error("Channel mode must be direct, proxy, or restream");
    error.statusCode = 400;
    throw error;
  }

  const url = channel.source === "xtream" ? channel.url : String(body.url ?? "").trim();
  if (!url) {
    const error = new Error("Stream URL is required");
    error.statusCode = 400;
    throw error;
  }

  return {
    name,
    url,
    avatar: String(body.avatar ?? "").trim() || "https://via.placeholder.com/64",
    mode,
    headers: Array.isArray(body.headers) ? body.headers : [],
  };
}

module.exports = {
  list(req, res) {
    res.json({
      channels: ChannelService.getChannels().map(serializeChannel),
    });
  },

  async catalog(req, res) {
    const currentChannels = ChannelService.getChannels();
    let catalog = [];
    let catalogError = null;
    try {
      catalog = await XtreamService.fetchCatalog();
    } catch (error) {
      catalogError = error.message || "Could not load Xtream channels";
      console.error("Could not load Xtream channels:", error);
    }

    const addedBySourceId = new Map(
      currentChannels
        .filter((channel) => channel.source === "xtream" && channel.sourceId != null)
        .map((channel) => [String(channel.sourceId), channel])
    );

    res.json({
      catalogError,
      channels: catalog.map((entry) => {
        const added = addedBySourceId.get(entry.streamId);
        return {
          ...entry,
          addedChannelId: added?.id ?? null,
          addedMode: added?.mode ?? null,
        };
      }),
    });
  },

  async add(req, res) {
    try {
      const streamId = XtreamService.normalizeStreamId(req.body?.streamId);
      const existing = ChannelService.getChannels().find(
        (channel) => channel.source === "xtream" && String(channel.sourceId) === streamId
      );
      if (existing) {
        return res.status(409).json({ error: "This Xtream channel is already in the channel list" });
      }

      const stream = await XtreamService.findStream(streamId);
      const hadCurrentChannel = Boolean(ChannelService.getCurrentChannel());
      const channel = ChannelService.addChannel(XtreamService.buildChannel(stream, req.body));
      if (!hadCurrentChannel) await ChannelService.setCurrentChannel(channel.id);
      const io = req.app.get("io");
      io?.emit("channel-added", channel);
      if (!hadCurrentChannel) broadcastChannelSelection(io, channel);
      return res.status(201).json({ channel });
    } catch (error) {
      return sendError(res, error, "Could not add Xtream channel");
    }
  },

  async remove(req, res) {
    try {
      const channelId = Number.parseInt(req.params.channelId, 10);
      if (!Number.isInteger(channelId)) {
        return res.status(400).json({ error: "Invalid channel ID" });
      }

      const channel = ChannelService.getChannelById(channelId);
      if (!channel) return res.status(404).json({ error: "Channel not found" });

      const wasCurrent = ChannelService.getCurrentChannel()?.id === channelId;
      const currentChannel = await ChannelService.deleteChannel(channelId);
      const io = req.app.get("io");
      io?.emit("channel-deleted", channelId);
      if (wasCurrent) broadcastChannelSelection(io, currentChannel ?? null);
      return res.json({ currentChannel: currentChannel ?? null });
    } catch (error) {
      return sendError(res, error, "Could not remove channel");
    }
  },

  async update(req, res) {
    try {
      const channelId = Number.parseInt(req.params.channelId, 10);
      if (!Number.isInteger(channelId)) {
        return res.status(400).json({ error: "Invalid channel ID" });
      }

      const channel = ChannelService.getChannelById(channelId);
      if (!channel) return res.status(404).json({ error: "Channel not found" });

      const updatedChannel = await ChannelService.updateChannel(
        channelId,
        getChannelUpdates(channel, req.body)
      );
      req.app.get("io")?.emit("channel-updated", updatedChannel);
      return res.json({ channel: serializeChannel(updatedChannel) });
    } catch (error) {
      return sendError(res, error, "Could not update channel");
    }
  },
};
