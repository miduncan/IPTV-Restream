const crypto = require('crypto');

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

class AirPlaySessionService {
    constructor({
        ttlMs = Number(process.env.AIRPLAY_SESSION_TTL_MS) || DEFAULT_SESSION_TTL_MS,
        now = () => Date.now(),
        createId = () => crypto.randomBytes(32).toString('base64url'),
    } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.createId = createId;
        this.sessions = new Map();
    }

    create(channelId) {
        this.pruneExpired();
        const id = this.createId();
        const session = {
            id,
            channelId,
            expiresAt: this.now() + this.ttlMs,
            resources: new Map(),
        };
        this.sessions.set(id, session);
        return session;
    }

    get(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        if (session.expiresAt <= this.now()) {
            this.sessions.delete(sessionId);
            return null;
        }
        return session;
    }

    registerResource(sessionId, resource) {
        const session = this.get(sessionId);
        if (!session) return null;

        const identity = `${resource.kind}\0${resource.url || resource.path}`;
        const resourceId = crypto.createHash('sha256').update(identity).digest('base64url');
        session.resources.set(resourceId, resource);
        return resourceId;
    }

    getResource(sessionId, resourceId) {
        return this.get(sessionId)?.resources.get(resourceId) || null;
    }

    pruneExpired() {
        const currentTime = this.now();
        for (const [id, session] of this.sessions) {
            if (session.expiresAt <= currentTime) this.sessions.delete(id);
        }
    }
}

module.exports = new AirPlaySessionService();
module.exports.AirPlaySessionService = AirPlaySessionService;
module.exports.DEFAULT_SESSION_TTL_MS = DEFAULT_SESSION_TTL_MS;
