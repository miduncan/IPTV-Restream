const streamController = require('./restream/StreamController');
const Channel = require('../models/Channel');
const ChannelStorage = require('./ChannelStorage');


class ChannelService {
    constructor() {
        this.channels = ChannelStorage.load();
        this.currentChannel = this.channels[0];
        this.channelSwitchQueue = Promise.resolve();
        this.previousStreamRetirement = Promise.resolve();
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

    setCurrentChannel(id) {
        const switchOperation = this.channelSwitchQueue.then(() =>
            this.performChannelSwitch(id)
        );

        // Keep later switches moving even if one request fails, while still
        // returning the original rejection to the caller.
        this.channelSwitchQueue = switchOperation.catch(() => undefined);
        return switchOperation;
    }

    async performChannelSwitch(id) {
        const nextChannel = this.channels.find(channel => channel.id === id);
        if (!nextChannel) {
            throw new Error('Channel does not exist');
        }

        if (this.currentChannel === nextChannel && nextChannel.restream()) {
            const ready = await streamController.ensureReady(nextChannel);
            if (!ready) throw new Error('The current restream is not ready');
            return nextChannel;
        }

        if (this.currentChannel !== nextChannel) {
            const previousChannel = this.currentChannel;
            if (nextChannel.restream()) {
                // Keep the normal overlap capped at the current stream plus
                // one warming stream, even when viewers click rapidly.
                await this.previousStreamRetirement.catch(() => undefined);
                const started = await streamController.start(nextChannel);
                if (!started) throw new Error('The restream could not start without an active viewer');
            }
            this.currentChannel = nextChannel;
            if (previousChannel) {
                // Give the socket handler a chance to publish the ready channel
                // before retiring the stream clients are currently watching.
                this.previousStreamRetirement = new Promise(resolve => {
                    setImmediate(() => {
                        streamController.stop(previousChannel).catch(error => {
                            console.error(`Failed to stop previous channel ${previousChannel.id}:`, error);
                        }).finally(resolve);
                    });
                });
            }
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
