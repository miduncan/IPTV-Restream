const ChannelService = require("../services/ChannelService");
const XtreamService = require("../services/XtreamService");
const broadcastChannelSelection = require("../socket/broadcastChannelSelection");

function sendError(res, error, fallback) {
  console.error(fallback, error);
  res.status(error.statusCode || 502).json({ error: error.message || fallback });
}

module.exports = {
  async list(req, res) {
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
        currentChannels: currentChannels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          avatar: channel.avatar,
          group: channel.group,
          mode: channel.mode,
          source: channel.source ?? null,
          sourceId: channel.sourceId ?? null,
        })),
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
};
