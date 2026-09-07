class Channel {
    static nextId = 0;
    constructor(name, url, avatar, mode, headers = [], group = null, playlist = null, playlistName = null, playlistUpdate = false, source = null, sourceId = null) {
        this.id = Channel.nextId++;
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
        return Object.assign(new Channel(), json);
    }
}

module.exports = Channel;
