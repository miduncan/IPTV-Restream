const DEFAULT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

class RestreamIdleManager {
    constructor({
        getCurrentChannel,
        streamController,
        idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
        setTimer = setTimeout,
        clearTimer = clearTimeout,
    }) {
        this.getCurrentChannel = getCurrentChannel;
        this.streamController = streamController;
        this.idleTimeoutMs = idleTimeoutMs;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.viewerIds = new Set();
        this.idleTimer = null;
        this.streamingAllowed = false;
        this.operationQueue = Promise.resolve();
    }

    isStreamingAllowed() {
        return this.streamingAllowed;
    }

    viewerConnected(viewerId) {
        const hadViewers = this.viewerIds.size > 0;
        this.viewerIds.add(viewerId);

        if (hadViewers) return;

        if (this.idleTimer) {
            this.clearTimer(this.idleTimer);
            this.idleTimer = null;
        }

        this.streamingAllowed = true;
        this.enqueue(async () => {
            const currentChannel = this.getCurrentChannel();
            if (
                this.streamingAllowed &&
                currentChannel?.restream() &&
                !this.streamController.isRunning()
            ) {
                await this.streamController.start(currentChannel);
            }
        });
    }

    viewerDisconnected(viewerId) {
        this.viewerIds.delete(viewerId);
        if (this.viewerIds.size > 0 || this.idleTimer || !this.streamingAllowed) return;

        this.idleTimer = this.setTimer(() => {
            this.idleTimer = null;
            this.streamingAllowed = false;
            this.enqueue(async () => {
                if (this.streamingAllowed || this.viewerIds.size > 0) return;

                const currentChannel = this.getCurrentChannel();
                if (currentChannel?.restream() && this.streamController.isRunning()) {
                    console.log('Stopping restream after five minutes without viewers');
                    await this.streamController.stop(currentChannel);
                }
            });
        }, this.idleTimeoutMs);

        // An idle timer should not keep the backend process alive by itself.
        this.idleTimer.unref?.();
    }

    enqueue(operation) {
        const pending = this.operationQueue.then(operation);
        this.operationQueue = pending.catch(error => {
            console.error('Failed to update restream for viewer activity:', error);
        });
        return pending;
    }

    waitForPendingOperations() {
        return this.operationQueue;
    }
}

module.exports = RestreamIdleManager;
module.exports.DEFAULT_IDLE_TIMEOUT_MS = DEFAULT_IDLE_TIMEOUT_MS;
