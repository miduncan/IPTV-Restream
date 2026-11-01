const { createHash } = require('node:crypto');
const { parseXmlTv } = require('./XmlTv');
const FRESH_MS = 30 * 60000;
const STALE_MS = 6 * 3600000;
async function loadScheduleGuide(catalog, provider, { games = [], estimatedDurationHours = {}, run, cache, now = Date.now(), limits } = {}) {
    const streams = [...new Map(catalog.map(channel => [String(channel.streamId), channel])).values()];
    const ids = new Set(streams.map(channel => channel.epgChannelId).filter(id => typeof id === 'string' && id));
    let mappedIds = new Set();
    const coverage = { mode: 'xmltv', requestedStreams: streams.length, streamsWithListings: 0, emptyStreams: 0, failedStreams: 0, unsupportedStreams: 0,
        mappedStreams: 0, streamsWithEpgIds: streams.filter(channel => ids.has(channel.epgChannelId)).length, programmeCount: 0, discardedListings: 0,
        earliestStart: null, latestEnd: null, cached: false, stale: false,
        limitations: ['Available guide listings do not guarantee complete coverage for the next 48 hours.'] };
    const finish = byId => {
        const epgByStream = new Map();
        for (const channel of streams) {
            const programmes = byId.get(channel.epgChannelId) || [];
            epgByStream.set(String(channel.streamId), programmes);
            if (programmes.length) coverage.streamsWithListings += 1;
            else coverage.emptyStreams += 1;
        }
        for (const programmes of byId.values()) for (const programme of programmes) {
            coverage.programmeCount += 1;
            if (!coverage.earliestStart || programme.start < coverage.earliestStart) coverage.earliestStart = programme.start;
            if (!coverage.latestEnd || programme.end > coverage.latestEnd) coverage.latestEnd = programme.end;
        }
        if (coverage.emptyStreams) coverage.limitations.push(`${coverage.emptyStreams} catalog streams have no usable, mapped game-window guide listings.`);
        return { epgByStream, coverage, mappedIds: [...mappedIds] };
    };
    if (!streams.length) { coverage.limitations = ['No catalog streams required guide retrieval.']; return finish(new Map()); }
    if (!ids.size) { coverage.unsupportedStreams = streams.length; coverage.limitations.push('Catalog has no EPG identifiers; matching uses names and networks without per-channel requests.'); return finish(new Map()); }
    if (typeof provider.fetchXmlTv !== 'function') { coverage.unsupportedStreams = streams.length; coverage.limitations.push('Bulk XMLTV access is unavailable; no per-channel requests were made.'); return finish(new Map()); }
    const account = provider.getGuideCacheKey?.();
    const scope = games.map(game => ({ id: game.id, startsAt: game.startsAt, endsAt: game.endsAt, league: game.league, teams: game.teams })).sort((a, b) => a.id.localeCompare(b.id));
    const key = account && createHash('sha256').update(JSON.stringify({ retentionVersion: 2, account, scope, estimatedDurationHours, ids: [...ids].sort() })).digest('hex');
    const previous = key && cache?.get(key);
    const useCache = stale => {
        run.phase('guide-cache');
        const mapped = new Set(previous.mappedIds || []);
        mappedIds = mapped;
        coverage.mappedStreams = streams.filter(channel => mapped.has(channel.epgChannelId)).length;
        coverage.discardedListings = previous.discarded || 0; coverage.conflictedEpgIds = previous.conflicts || 0;
        if (previous.conflicts) coverage.limitations.push(`${previous.conflicts} conflicting XMLTV channel identifiers were excluded.`);
        coverage.cached = true; coverage.stale = stale; coverage.fetchedAt = previous.fetchedAt;
        if (stale) coverage.limitations.push('Bulk guide download failed; retained guide evidence is stale. No per-channel requests were made.');
        return finish(new Map(previous.entries));
    };
    if (previous && now >= Date.parse(previous.fetchedAt) && now - Date.parse(previous.fetchedAt) < FRESH_MS) return useCache(false);
    try {
        run.phase('guide');
        const body = await provider.fetchXmlTv(run);
        const windows = games.map(game => ({ game, start: Date.parse(game.startsAt), end: game.endsAt ? Date.parse(game.endsAt) : Date.parse(game.startsAt) + (estimatedDurationHours[game.league] || 4) * 3600000 }));
        const result = await parseXmlTv(body, { run, ids, limits,
            keep: programme => windows.some(window => programme.startMs < window.end && programme.endMs > window.start) });
        run.signal.throwIfAborted();
        if (account !== provider.getGuideCacheKey?.()) throw new Error('Provider changed during guide download');
        const mapped = new Set(result.mappedIds);
        mappedIds = mapped;
        coverage.mappedStreams = streams.filter(channel => mapped.has(channel.epgChannelId)).length;
        coverage.discardedListings = result.discarded; coverage.conflictedEpgIds = result.conflicts;
        coverage.fetchedAt = new Date(now).toISOString();
        if (result.conflicts) coverage.limitations.push(`${result.conflicts} conflicting XMLTV channel identifiers were excluded.`);
        if (key) cache?.put({ key, fetchedAt: coverage.fetchedAt, entries: [...result.byId], mappedIds: result.mappedIds, discarded: result.discarded, conflicts: result.conflicts });
        return finish(result.byId);
    } catch {
        run.signal.throwIfAborted();
        if (previous && now >= Date.parse(previous.fetchedAt) && now - Date.parse(previous.fetchedAt) <= STALE_MS) return useCache(true);
        coverage.failedStreams = streams.length;
        coverage.limitations.push('Bulk XMLTV was unavailable, invalid, or exceeded its limits; no per-channel requests were made.');
        return { ...finish(new Map()), failed: true };
    }
}
module.exports = { loadScheduleGuide };
