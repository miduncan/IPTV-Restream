const ChannelService = require('../services/ChannelService');

module.exports = {

    getChannels(req, res) {
        const channels = ChannelService.getFilteredChannels(req.query);
        res.json(channels); 
    },

    getChannel(req, res) {
        const { channelId } = req.params;
        const channelIdInt = parseInt(channelId, 10);
        const channel = ChannelService.getChannelById(channelIdInt);
        if (channel) {
            res.json(channel);
        } else {
            res.status(404).json({ error: 'Channel not found' });
        }
    },

    getCurrentChannel(req, res) {
        res.json(ChannelService.getCurrentChannel() ?? null);
    },

    deleteChannel(req, res) {
        try {
            const { channelId } = req.params;
            const channelIdInt = parseInt(channelId, 10);
            ChannelService.deleteChannel(channelIdInt);
            res.status(204).send();
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    async updateChannel(req, res) {
        try {
            const { channelId } = req.params;
            const channelIdInt = parseInt(channelId, 10);
            const updatedChannel = await ChannelService.updateChannel(channelIdInt, req.body);
            res.json(updatedChannel);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    addChannel(req, res) {
        try {
            //const { name, url, avatar, mode, headersJson, group, playlist } = req.body;
            const newChannel = ChannelService.addChannel(req.body);
            res.status(201).json(newChannel);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    clearChannels(req, res) {
        ChannelService.clearChannels();
        res.status(204).send();
    }
};
