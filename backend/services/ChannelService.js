const streamController = require('./restream/StreamController');
const Channel = require('../models/Channel');
const storageService = require('./restream/StorageService');
const ChannelStorage = require('./ChannelStorage');


class ChannelService {
    constructor() {
        this.channels = ChannelStorage.load();
        this.currentChannel = this.channels[0];
    }

    clearChannels() {
        ChannelStorage.clear();
        this.channels = [];
        this.currentChannel = undefined;
    }

    getChannels() {
        return this.channels;
    }

    getChannelById(id) {
        return this.channels.find(channel => channel.id === id);
    }

    getFilteredChannels({ playlistName, group }) {
        let filtered = this.channels;
        if (playlistName) {
            filtered = filtered.filter(ch => ch.playlistName && ch.playlistName.toLowerCase() == playlistName.toLowerCase());
        }
        if (group) {
            filtered = filtered.filter(ch => ch.group && ch.group.toLowerCase() === group.toLowerCase());
        }
        return filtered;
    }

    addChannel({ name, url, avatar, mode, headersJson, group = null, playlist = null, playlistName = null, playlistUpdate = false, source = null, sourceId = null }, save = true) {

        let headers = headersJson;
        try {
            //Try to parse headers if not already parsed
            headers = JSON.parse(headersJson);
        } catch (error) {
        }

        const newChannel = new Channel(name, url, avatar, mode, headers, group, playlist, playlistName, playlistUpdate, source, sourceId);
        if(save) newChannel.id = ChannelStorage.insert(newChannel);
        this.channels.push(newChannel);

        return newChannel;
    }

    async setCurrentChannel(id) {
        const nextChannel = this.channels.find(channel => channel.id === id);
        if (!nextChannel) {
            throw new Error('Channel does not exist');
        }

        if (this.currentChannel !== nextChannel) {
            if (this.currentChannel) {
                await streamController.stop(this.currentChannel);
            }
            if (nextChannel.restream()) {
                storageService.deleteChannelStorage(nextChannel.id);
                await streamController.start(nextChannel);
            }
            this.currentChannel = nextChannel;
        }
        return nextChannel;
    }

    getCurrentChannel() {
        return this.currentChannel;
    }

    getChannelById(id) {
        return this.channels.find(channel => channel.id === id);
    }

    async deleteChannel(id, save = true) {
        const channelIndex = this.channels.findIndex(channel => channel.id === id);
        if (channelIndex === -1) {
            throw new Error('Channel does not exist');
        }

        const [deletedChannel] = this.channels.splice(channelIndex, 1);

        // If we deleted the current channel, switch to another one
        if (this.currentChannel?.id === id) {
            const nextChannel = this.channels[0];
            if (nextChannel) {
                await this.setCurrentChannel(nextChannel.id);
            } else {
                await streamController.stop(deletedChannel);
                this.currentChannel = undefined;
            }
        }

        if(save) ChannelStorage.delete(id);

        return this.currentChannel;
    }

    async updateChannel(id, updatedAttributes, save = true) {

        const channelIndex = this.channels.findIndex(channel => channel.id === id);
        if (channelIndex === -1) {
            throw new Error('Channel does not exist');
        }

        const channel = this.channels[channelIndex];
        const streamChanged = updatedAttributes.url != channel.url ||
            JSON.stringify(updatedAttributes.headers) != JSON.stringify(channel.headers) ||
            updatedAttributes.mode != channel.mode;
        Object.assign(channel, updatedAttributes);

        if (this.currentChannel?.id == id) {
            if (streamChanged) {
                streamController.stop(channel);
                if (channel.restream()) {
                    await streamController.start(channel);
                }
            }
        }

        if(save) ChannelStorage.update(channel);

        return channel;
    }
}

module.exports = new ChannelService();
