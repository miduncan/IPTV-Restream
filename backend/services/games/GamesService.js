const HOUR = 60 * 60 * 1000;
const UPCOMING_WINDOW_MS = 6 * HOUR;
const MAX_OBSERVATION_AGE_MS = 10 * 60 * 1000;
const SCHEDULE_CHECK_MS = 60 * 1000;
const { matchChannels } = require('./ChannelMatcher');
const { loadScheduleGuide } = require('./ScheduleGuide');
const { defaultGamesSettings } = require('./GamesSettings');
const { scheduledOccurrence } = require('./MatchingSchedule');
const { ProviderRun } = require('./ProviderRun');
const BulkGuideCache = require('./BulkGuideCache');
const { getNamedEvents } = require('./NamedEvents');

class GamesService {
    constructor({ source, store, catalog, now = () => Date.now(), guideLimits, requestBudget, matchingTimeoutMs, getFavoriteStreamIds = () => [] }) {
        this.source = source;
        this.store = store;
        this.now = now;
        this.catalog = catalog;
        this.getFavoriteStreamIds = getFavoriteStreamIds;
        this.guideCache = new BulkGuideCache(store.filePath ? `${store.filePath}.guide.json` : null);
        this.guideLimits = guideLimits;
        this.requestBudget = requestBudget;
        this.matchingTimeoutMs = matchingTimeoutMs;
        this.providerRun = null;
        this.snapshot = { games: [], lastSuccessfulStatusAt: null, coverage: null, candidateResults: {}, matchingMetadata: {}, ...store.load() };
        this.statusError = null;
        this.refreshing = null;
        this.matchingRun = null;
        this.scheduleTimer = null;
        this.scheduleError = null;
    }

    refreshStatus() {
        if (this.refreshing) return this.refreshing;
        this.refreshing = this.loadStatus().finally(() => { this.refreshing = null; });
        return this.refreshing;
    }

    getSettings() {
        const defaults = defaultGamesSettings();
        const stored = this.snapshot.settings || {};
        return structuredClone({ ...defaults, ...stored, estimatedDurationHours: { ...defaults.estimatedDurationHours, ...stored.estimatedDurationHours } });
    }

    updateSettings(settings) {
        const previous = this.getSettings();
        const next = structuredClone({ ...previous, ...settings });
        const snapshot = { ...this.snapshot, settings: next, scheduleState: {
            ...this.snapshot.scheduleState,
            initialPending: next.matchingEnabled && (!previous.matchingEnabled || Boolean(this.snapshot.scheduleState?.initialPending)),
        } };
        this.store.save(snapshot);
        this.snapshot = snapshot;
        if (next.matchingEnabled && (!previous.matchingEnabled || next.matchingTime !== previous.matchingTime || next.matchingTimezone !== previous.matchingTimezone)) {
            void this.tickMatchingSchedule();
        }
        return this.getSettings();
    }

    tickMatchingSchedule() {
        const settings = this.getSettings();
        if (!settings.matchingEnabled) return Promise.resolve(this.getMatchingStatus());
        // A busy manual/automatic run is never followed by a concurrent scan.
        // Leave the occurrence unclaimed and reconsider on the next timer tick.
        if (this.matchingRun) return this.matchingRun;
        try {
            const now = this.now();
            const occurrence = scheduledOccurrence(settings, now);
            const state = this.snapshot.scheduleState || {};
            const claims = (state.claimedOccurrences || []).filter(claim => Date.parse(claim.claimedAt) >= now - 8 * 24 * HOUR);
            if (!state.initialPending && (!occurrence.due || claims.some(claim => claim.key === occurrence.key))) {
                return Promise.resolve(this.getMatchingStatus());
            }
            const claim = { key: occurrence.key, claimedAt: new Date(now).toISOString() };
            const snapshot = { ...this.snapshot, scheduleState: {
                ...state, initialPending: false, lastClaimedAt: claim.claimedAt,
                claimedOccurrences: [...claims.filter(previous => previous.key !== claim.key), claim].slice(-512),
            } };
            // Claim before any sports/catalog/guide I/O. A crash after this write
            // consumes the occurrence, including a failed matching attempt.
            this.store.save(snapshot);
            this.snapshot = snapshot;
            this.scheduleError = null;
            return this.runMatching();
        } catch {
            this.scheduleError = 'Automatic matching could not claim its scheduled run; previous results were retained';
            return Promise.resolve(this.getMatchingStatus());
        }
    }

    async loadStatus() {
        const now = this.now();
        try {
            const response = await this.source.fetchGames({
                from: new Date(now - 24 * HOUR).toISOString(),
                to: new Date(now + 48 * HOUR).toISOString(),
                leagues: this.getSettings().enabledLeagues, regions: this.getSettings().broadcastRegions,
            });
            const observedNow = response.fetchedAt ? Date.parse(response.fetchedAt) : this.now();
            const previousGames = new Map(this.snapshot.games.map(game => [game.id, game]));
            const games = response.games.map(game => {
                const previous = previousGames.get(game.id);
                let observedCompletedAt = game.status === 'final' ? previous?.observedCompletedAt : null;
                if (game.status === 'final' && !game.completedAt && !observedCompletedAt
                    && previous?.status === 'live' && !previous.observationMissing && !this.statusError
                    && observedNow - Date.parse(previous.observedAt) <= MAX_OBSERVATION_AGE_MS) {
                    observedCompletedAt = new Date(observedNow).toISOString();
                }
                previousGames.delete(game.id);
                return { ...game, observedAt: new Date(observedNow).toISOString(), observedCompletedAt: observedCompletedAt || null, observationMissing: false };
            });
            // Missing rows are not a confirmed end. Keep old live observations
            // explicit and stale, including games continuing through overtime.
            for (const previous of previousGames.values()) {
                if (previous.status === 'live' || Date.parse(previous.startsAt) >= observedNow - 7 * 24 * HOUR) {
                    games.push({ ...previous, observationMissing: true });
                }
            }
            const snapshot = {
                ...this.snapshot,
                games,
                lastSuccessfulStatusAt: new Date(observedNow).toISOString(), coverage: response.coverage,
            };
            this.store.save(snapshot);
            this.snapshot = snapshot;
            this.statusError = null;
        } catch {
            this.statusError = 'Sports data is temporarily unavailable';
        }
        return this.getGames();
    }

    getGames({ sidebar = false } = {}) {
        const now = this.now();
        const settings = this.getSettings();
        const upcomingWindow = sidebar ? UPCOMING_WINDOW_MS : 48 * HOUR;
        const stale = Boolean(this.statusError) || !this.snapshot.lastSuccessfulStatusAt
            || now - Date.parse(this.snapshot.lastSuccessfulStatusAt) > MAX_OBSERVATION_AGE_MS;
        const games = this.snapshot.games.flatMap(game => {
            if (!settings.enabledLeagues.includes(game.league)) return [];
            const start = Date.parse(game.startsAt);
            let group;
            let statusEstimated = false;
            if (game.status === 'live') group = 'live';
            else if (game.status === 'scheduled' && start >= now && start <= now + upcomingWindow) group = 'startingSoon';
            else if (game.status === 'final') {
                const finish = Date.parse(game.completedAt || game.observedCompletedAt);
                if (finish <= now && now - finish < HOUR) group = 'recentlyFinished';
            }
            else if (game.status === 'unknown' || game.status === 'scheduled') {
                const estimatedFinish = start + settings.estimatedDurationHours[game.league] * HOUR;
                statusEstimated = true;
                if (start > now && start <= now + upcomingWindow) group = 'startingSoon';
                else if (start <= now && now < estimatedFinish) group = 'live';
                else if (estimatedFinish <= now && now < estimatedFinish + HOUR) group = 'recentlyFinished';
            }
            if (!group || (sidebar && group === 'recentlyFinished')) return [];
            const observationStale = stale || Boolean(game.observationMissing)
                || now - Date.parse(game.observedAt) > MAX_OBSERVATION_AGE_MS;
            const matching = this.getGameMatching(game.id);
            return [{ ...game, group, stale: observationStale, statusEstimated, matching: { ...matching, count: matching.candidates.length } }];
        }).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
        return {
            games, namedEvents: getNamedEvents(now, { enabledLeagues: settings.enabledLeagues, upcomingWindow }).map(event => {
                const matching = this.getGameMatching(event.id);
                return { ...event, matching: { ...matching, count: matching.candidates.length } };
            }),
            coverage: this.snapshot.coverage, matching: this.getMatchingStatus(), settings: this.getSettings(),
            freshness: { stale, lastSuccessfulStatusAt: this.snapshot.lastSuccessfulStatusAt, error: this.statusError },
        };
    }

    getCategoryPolicy() {
        let account;
        try { account = this.catalog?.getGuideCacheKey?.() || null; } catch { return { allowedCategoryIds: [] }; }
        const policy = this.snapshot.matchingCategoryPolicy;
        return { allowedCategoryIds: policy?.account === account ? policy.allowedCategoryIds : [] };
    }

    updateCategoryPolicy(allowedCategoryIds) {
        const snapshot = { ...this.snapshot, matchingCategoryPolicy: {
            account: this.catalog?.getGuideCacheKey?.() || null, allowedCategoryIds: [...allowedCategoryIds],
        } };
        this.store.save(snapshot);
        this.snapshot = snapshot;
        return this.getCategoryPolicy();
    }

    async getMatchingCategories() {
        const account = this.catalog?.getGuideCacheKey?.();
        const catalog = await this.catalog.fetchCatalog();
        if (account !== this.catalog?.getGuideCacheKey?.()) throw new Error('Provider changed');
        const categories = new Map();
        for (const channel of catalog) {
            if (!channel.categoryId) continue;
            const id = String(channel.categoryId);
            const category = categories.get(id) || { id, name: channel.category || 'Uncategorized', channelCount: 0 };
            category.channelCount += 1;
            categories.set(id, category);
        }
        return { categories: [...categories.values()].sort((a, b) => a.name.localeCompare(b.name)), ...this.getCategoryPolicy() };
    }

    getMatchingHistory() {
        const cutoff = this.now() - 48 * HOUR;
        const games = new Map(this.snapshot.games.map(game => [game.id, game]));
        const matches = Object.entries(this.snapshot.candidateResults).flatMap(([id, result]) => {
            const game = games.get(id) || result.game;
            if (!game || Date.parse(result.matchedAt) < cutoff) return [];
            const { game: matchedGame, ...matching } = result;
            return [{ game, matching: { gameId: id, state: 'complete', ...matching,
                stale: this.getGameMatching(id).stale, lastError: this.getMatchingStatus().lastError } }];
        }).sort((a, b) => b.matching.matchedAt.localeCompare(a.matching.matchedAt) || a.game.startsAt.localeCompare(b.game.startsAt));
        return { matches, matching: this.getMatchingStatus(), coverage: this.snapshot.coverage, settings: this.getSettings() };
    }

    getMatchingStatus() {
        const metadata = { lastSuccessfulAt: null, lastAttemptAt: null, lastError: null, ...this.snapshot.matchingMetadata };
        return { ...metadata, lastError: this.scheduleError || metadata.lastError, running: Boolean(this.matchingRun), progress: this.providerRun?.status() || metadata.progress };
    }

    getGameMatching(gameId) {
        const hasResult = Object.hasOwn(this.snapshot.candidateResults, gameId);
        if (!hasResult && !this.snapshot.games.some(game => game.id === gameId)
            && !getNamedEvents(this.now(), { enabledLeagues: this.getSettings().enabledLeagues, upcomingWindow: 48 * HOUR }).some(event => event.id === gameId)) return null;
        const result = hasResult ? this.snapshot.candidateResults[gameId] : null;
        const metadata = this.getMatchingStatus();
        const allowed = new Set(this.getCategoryPolicy().allowedCategoryIds);
        return {
            gameId, state: result ? 'complete' : 'pending', candidates: (result?.candidates || []).filter(candidate => allowed.has(candidate.categoryId)), matchedAt: result?.matchedAt || null,
            guideSnapshot: result?.guideSnapshot || null,
            stale: Boolean(result && (metadata.guideCoverage?.stale || metadata.lastError || this.now() - Date.parse(result.matchedAt) > 24 * HOUR)),
            lastError: metadata.lastError,
        };
    }

    runMatching() {
        if (this.matchingRun) return this.matchingRun;
        const run = new ProviderRun({ now: this.now, requestBudget: this.requestBudget, timeoutMs: this.matchingTimeoutMs });
        this.providerRun = run;
        this.matchingRun = Promise.resolve().then(() => this.performMatching(run)).finally(() => { run.close(); this.providerRun = null; this.matchingRun = null; });
        return this.matchingRun;
    }

    cancelMatching() {
        this.providerRun?.cancel();
        return this.getMatchingStatus();
    }

    async performMatching(run) {
        const lastAttemptAt = new Date(this.now()).toISOString();
        try {
            run.signal.throwIfAborted();
            await run.wait(this.refreshStatus());
            if (this.statusError) throw new Error('Sports source unavailable');
            const now = this.now();
            const enabled = this.getSettings().enabledLeagues;
            const liveGames = new Set(this.getGames().games.filter(game => game.group === 'live').map(game => game.id));
            const games = this.snapshot.games.filter(game => enabled.includes(game.league)
                && (liveGames.has(game.id) || (Date.parse(game.startsAt) >= now && Date.parse(game.startsAt) <= now + 48 * HOUR
                    && !['final', 'cancelled', 'postponed'].includes(game.status))))
                .concat(getNamedEvents(now, { enabledLeagues: enabled, upcomingWindow: 48 * HOUR }));
            const account = games.length ? this.catalog?.getGuideCacheKey?.() : undefined;
            const verifyAccount = () => { if (games.length && account !== this.catalog?.getGuideCacheKey?.()) throw new Error('Provider changed during matching'); };
            run.phase('catalog');
            const policy = JSON.stringify(this.getCategoryPolicy());
            const allowed = new Set(this.getCategoryPolicy().allowedCategoryIds);
            const fullCatalog = games.length ? await run.wait(this.catalog.fetchCatalog(run)) : [];
            const catalog = fullCatalog.filter(channel => allowed.has(String(channel.categoryId || '')));
            run.signal.throwIfAborted();
            verifyAccount();
            const guide = await loadScheduleGuide(catalog, this.catalog, { games, estimatedDurationHours: this.getSettings().estimatedDurationHours, run, cache: this.guideCache, now: this.now(), limits: this.guideLimits });
            if (guide.failed && this.snapshot.matchingMetadata.lastSuccessfulAt) throw new Error('Bulk guide failed');
            verifyAccount();
            run.phase('ranking');
            const matches = matchChannels(games, catalog, { favoriteStreamIds: new Set(this.getFavoriteStreamIds().map(String)), epgByStream: guide.epgByStream, guideCoverage: guide.coverage,
                guideMappedIds: new Set(guide.mappedIds), regions: this.getSettings().broadcastRegions, estimatedDurationHours: this.getSettings().estimatedDurationHours });
            run.signal.throwIfAborted();
            verifyAccount();
            run.phase('complete');
            if (policy !== JSON.stringify(this.getCategoryPolicy())) throw new Error('Matching categories changed during run');
            const matchedAt = new Date(this.now()).toISOString();
            const candidateResults = Object.fromEntries(Object.entries(this.snapshot.candidateResults).filter(([, result]) => Date.parse(result.matchedAt) >= this.now() - 48 * HOUR));
            const guideSnapshot = { fetchedAt: guide.coverage.fetchedAt || null, cached: guide.coverage.cached, stale: guide.coverage.stale };
            for (const game of games) candidateResults[game.id] = { game, candidates: matches[game.id], matchedAt, guideSnapshot };
            const snapshot = { ...this.snapshot, candidateResults, matchingMetadata: { lastSuccessfulAt: matchedAt, lastAttemptAt, lastError: null, guideCoverage: guide.coverage, progress: run.status() } };
            this.store.save(snapshot);
            this.snapshot = snapshot;
            this.scheduleError = null;
        } catch {
            run.progress.phase = run.cancelled ? 'cancelled' : 'failed';
            const snapshot = { ...this.snapshot, matchingMetadata: { ...this.snapshot.matchingMetadata, lastAttemptAt, lastError: run.cancelled ? 'Channel matching cancelled; previous results were retained' : 'Channel matching failed; previous results were retained', progress: run.status() } };
            try { this.store.save(snapshot); } catch { /* Keep the prior stored results if storage itself is unavailable. */ }
            this.snapshot = snapshot;
        }
        return this.getMatchingStatus();
    }

    start() {
        if (this.scheduleTimer) return;
        void this.tickMatchingSchedule();
        this.scheduleTimer = setInterval(() => { void this.tickMatchingSchedule(); }, SCHEDULE_CHECK_MS);
        this.scheduleTimer.unref?.();
    }

    stop() {
        clearInterval(this.scheduleTimer);
        this.scheduleTimer = null;
    }
}

module.exports = GamesService;
module.exports.UPCOMING_WINDOW_MS = UPCOMING_WINDOW_MS;
