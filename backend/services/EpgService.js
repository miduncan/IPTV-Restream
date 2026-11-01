const XtreamService = require("./XtreamService");

const EMPTY_CACHE_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY = 5;
const SERVER_CLOCK_CACHE_MS = 60 * 60 * 1000;

const { decodeEpgText, timestampMilliseconds, wallClockMilliseconds, normalizeProgramme } = require("./epg/Programme");

function publicProgramme(programme) {
  if (!programme) return null;
  const { startMs, endMs, ...result } = programme;
  return result;
}

function emptyGuide(expiresAt) {
  return {
    current: null,
    next: null,
    cacheUntil: new Date(expiresAt).toISOString(),
  };
}

class EpgService {
  constructor({ xtreamService = XtreamService, now = () => Date.now() } = {}) {
    this.xtreamService = xtreamService;
    this.now = now;
    this.cache = new Map();
    this.pending = new Map();
    this.serverClock = null;
    this.serverClockPending = null;
  }

  cacheKey(channel) {
    return `${channel.source}:${channel.sourceId}`;
  }

  async getChannelGuide(channel) {
    const nowMs = this.now();
    if (channel?.source !== "xtream" || channel.sourceId == null) {
      return emptyGuide(nowMs + EMPTY_CACHE_MS);
    }

    const key = this.cacheKey(channel);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > nowMs) return cached.guide;
    if (this.pending.has(key)) return this.pending.get(key);

    const request = this.loadChannelGuide(channel, nowMs)
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }

  async loadChannelGuide(channel, nowMs) {
    const key = this.cacheKey(channel);
    let guide;
    let expiresAt;

    try {
      const serverOffsetMs = await this.getServerOffset();
      const listings = await this.xtreamService.fetchShortEpg(channel.sourceId, 6);
      const programmes = listings
        .map((listing) => normalizeProgramme(listing, serverOffsetMs))
        .filter(Boolean)
        .sort((left, right) => left.startMs - right.startMs);
      const current = programmes.find((programme) => programme.startMs <= nowMs && nowMs < programme.endMs) ?? null;
      const next = programmes.find((programme) =>
        programme !== current && programme.startMs >= (current?.endMs ?? nowMs)
      ) ?? null;

      expiresAt = current?.endMs ?? Math.min(next?.startMs ?? nowMs + EMPTY_CACHE_MS, nowMs + EMPTY_CACHE_MS);
      if (expiresAt <= nowMs) expiresAt = nowMs + EMPTY_CACHE_MS;
      guide = {
        current: publicProgramme(current),
        next: publicProgramme(next),
        cacheUntil: new Date(expiresAt).toISOString(),
      };
    } catch (error) {
      expiresAt = nowMs + EMPTY_CACHE_MS;
      guide = emptyGuide(expiresAt);
      console.warn(`Could not load EPG for Xtream stream ${channel.sourceId}:`, error.message);
    }

    this.cache.set(key, { expiresAt, guide });
    return guide;
  }

  async getServerOffset() {
    const nowMs = this.now();
    if (this.serverClock && this.serverClock.expiresAt > nowMs) return this.serverClock.offsetMs;
    if (this.serverClockPending) return this.serverClockPending;

    this.serverClockPending = (async () => {
      try {
        if (typeof this.xtreamService.fetchServerInfo !== "function") return null;
        const serverInfo = await this.xtreamService.fetchServerInfo();
        const timestampMs = timestampMilliseconds(serverInfo?.timestamp_now);
        const wallClockMs = wallClockMilliseconds(serverInfo?.time_now);
        if (timestampMs === null || wallClockMs === null) return null;
        const offsetMs = wallClockMs - timestampMs;
        this.serverClock = { offsetMs, expiresAt: nowMs + SERVER_CLOCK_CACHE_MS };
        return offsetMs;
      } catch (error) {
        console.warn("Could not determine the Xtream server clock offset:", error.message);
        return null;
      } finally {
        this.serverClockPending = null;
      }
    })();

    return this.serverClockPending;
  }

  async getGuides(channels) {
    const result = {};
    let nextIndex = 0;
    const workerCount = Math.min(FETCH_CONCURRENCY, channels.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < channels.length) {
        const channel = channels[nextIndex++];
        result[channel.id] = await this.getChannelGuide(channel);
      }
    });
    await Promise.all(workers);
    return result;
  }

  clear() {
    const cleared = this.cache.size;
    this.cache.clear();
    this.serverClock = null;
    return cleared;
  }
}

module.exports = new EpgService();
module.exports.EpgService = EpgService;
module.exports.decodeEpgText = decodeEpgText;
module.exports.normalizeProgramme = normalizeProgramme;
