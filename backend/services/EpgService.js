const XtreamService = require("./XtreamService");

const EMPTY_CACHE_MS = 5 * 60 * 1000;
const FETCH_CONCURRENCY = 5;
const SERVER_CLOCK_CACHE_MS = 60 * 60 * 1000;

function decodeEpgText(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return text;

  try {
    const decoded = Buffer.from(text, "base64");
    const roundTrip = decoded.toString("base64").replace(/=+$/, "");
    if (roundTrip !== text.replace(/=+$/, "")) return text;
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decoded).trim();
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decodedText) ? text : decodedText;
  } catch {
    return text;
  }
}

function timestampMilliseconds(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

function wallClockMilliseconds(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function programmeTimestamp(timestamp, wallClock, serverOffsetMs) {
  const wallClockMs = wallClockMilliseconds(wallClock);
  if (wallClockMs !== null && Number.isFinite(serverOffsetMs)) return wallClockMs - serverOffsetMs;
  return timestampMilliseconds(timestamp ?? wallClock);
}

function normalizeProgramme(listing, serverOffsetMs = null) {
  const startMs = programmeTimestamp(listing?.start_timestamp, listing?.start, serverOffsetMs);
  const endMs = programmeTimestamp(
    listing?.stop_timestamp ?? listing?.end_timestamp,
    listing?.end,
    serverOffsetMs
  );
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return {
    id: String(listing.id ?? `${startMs}-${endMs}`),
    title: decodeEpgText(listing.title) || "No info available",
    description: decodeEpgText(listing.description),
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

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
