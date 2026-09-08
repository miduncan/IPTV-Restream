class ViewerPresence {
  constructor(io) {
    this.io = io;
    this.viewerIds = new Set();
  }

  connected(viewerId) {
    this.viewerIds.add(viewerId);
    this.broadcast();
  }

  disconnected(viewerId) {
    this.viewerIds.delete(viewerId);
    this.broadcast();
  }

  broadcast() {
    this.io.emit('viewer-count', { count: this.viewerIds.size });
  }
}

module.exports = ViewerPresence;
