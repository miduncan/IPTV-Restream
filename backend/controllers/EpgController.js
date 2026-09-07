const ChannelService = require("../services/ChannelService");
const EpgService = require("../services/EpgService");

module.exports = {
  async list(req, res) {
    try {
      const guides = await EpgService.getGuides(ChannelService.getChannels());
      return res.json({ guides });
    } catch (error) {
      console.error("Could not load EPG:", error);
      return res.status(500).json({ error: "Could not load EPG" });
    }
  },

  clear(req, res) {
    const cleared = EpgService.clear();
    req.app.get("io")?.emit("epg-cache-cleared");
    return res.json({ cleared });
  },
};
