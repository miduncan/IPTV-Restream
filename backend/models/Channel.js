class Channel {
    constructor(name, url, avatar, mode, headers = [], group = null, playlist = null, playlistName = null, playlistUpdate = false, source = null, sourceId = null) {
        this.id = null;
        this.name = name;
        this.url = url;
        this.sessionUrl = null;
        this.avatar = avatar;
        this.mode = mode;
        this.headers = headers;
        this.group = group;
        this.playlist = playlist;
        this.playlistName = playlistName;
        this.playlistUpdate = playlistUpdate;
        this.source = source;
        this.sourceId = sourceId;
    }

    restream() {
        return this.mode === 'restream';
    }

    static from(json){
        return Object.assign(Object.create(Channel.prototype), json);
    }
}

module.exports = Channel;
