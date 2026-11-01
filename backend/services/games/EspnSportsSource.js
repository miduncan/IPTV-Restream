const CACHE_TTL_MS = 2 * 60 * 1000;
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons';

function referenceIds(data, kind) {
    if (!Array.isArray(data.items) || data.pageCount > 1 || data.count !== data.items.length) {
        throw new Error('Sports source returned an incomplete FBS directory');
    }
    return data.items.map(item => {
        const id = item.$ref?.match(new RegExp(`/${kind}/(\\d+)(?:\\?|$)`))?.[1];
        if (!id) throw new Error('Sports source returned an invalid FBS directory');
        return id;
    });
}

async function fetchJson(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Sports source returned HTTP ${response.status}`);
    return response.json();
}

function darkTeamLogo(team) {
    const variant = team.logos?.find(logo => logo.rel?.includes('dark'))?.href;
    if (variant) return variant;
    // Scoreboards supply only the default URL. ESPN's standard team-logo CDN
    // has a corresponding dark-background path; the UI falls back if absent.
    return /^https:\/\/a\.espncdn\.com\/i\/teamlogos\/(?:ncaa|nfl)\/500\//.test(team.logo || '')
        ? team.logo.replace('/500/', '/500-dark/') : null;
}

function normalize(event, league, regions) {
    const competition = event.competitions?.[0];
    const type = event.status?.type || competition?.status?.type || {};
    const startsAt = new Date(event.date);
    if (!event.id || !Number.isFinite(startsAt.getTime()) || competition?.competitors?.length !== 2) {
        throw new Error('Sports source returned an invalid game');
    }
    let status = { pre: 'scheduled', in: 'live', post: 'final' }[type.state] || 'unknown';
    if (/POSTPONED|DELAYED|SUSPENDED/.test(type.name || '')) status = 'postponed';
    if (/CANCEL/.test(type.name || '')) status = 'cancelled';
    const broadcasts = [];
    // Only geoBroadcasts supplies an explicit region. Bare `broadcast`/`broadcasts`
    // strings cannot establish Canadian or UK carriage.
    for (const broadcast of competition.geoBroadcasts || []) {
        const region = { us: 'US', ca: 'CA', gb: 'UK', uk: 'UK' }[broadcast.region?.toLowerCase()];
        const network = broadcast.media?.shortName;
        if (region && network && regions.includes(region) && !broadcasts.some(item => item.region === region && item.network === network)) {
            broadcasts.push({ network, region });
        }
    }
    return {
        id: `espn:${league}:${event.id}`, league,
        teams: competition.competitors.map(({ team, score }) => ({
            id: String(team.id), name: team.displayName,
            location: team.location || null,
            shortName: team.shortDisplayName || team.location || team.displayName,
            abbreviation: team.abbreviation || '',
            logo: team.logo || null,
            darkLogo: darkTeamLogo(team),
            score: ['live', 'final'].includes(status) && /^\d+$/.test(String(score)) ? Number(score) : null,
            aliases: [...new Set([team.displayName, team.shortDisplayName, team.location, team.name, team.abbreviation].filter(Boolean))],
        })),
        startsAt: startsAt.toISOString(), status,
        statusDetail: type.detail || type.description || '',
        // ESPN scoreboards do not provide a reliable actual end timestamp.
        completedAt: null, broadcasts,
        venue: competition.venue?.address?.city ? { city: competition.venue.address.city, state: competition.venue.address.state || '' } : null,
    };
}

class EspnSportsSource {
    constructor({ fetchJson: fetcher = fetchJson, now = () => Date.now(), cacheTtlMs = CACHE_TTL_MS } = {}) {
        this.fetchJson = fetcher;
        this.now = now;
        this.cacheTtlMs = cacheTtlMs;
        this.cache = new Map();
    }

    async fetchGames({ from, to, leagues = ['NFL', 'CFB'], regions = ['US', 'CA', 'UK'] }) {
        const start = new Date(from);
        const end = new Date(to);
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start || end - start > 7 * 86400000) {
            throw new Error('Sports source requires a valid window of at most seven days');
        }
        // Cache complete calendar slates, not the moving second-level query window.
        // This lets every viewer reuse the same fetch while visibility still advances.
        const key = JSON.stringify([start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), [...leagues].sort(), [...regions].sort()]);
        const now = this.now();
        for (const [scope, entry] of this.cache) {
            if (entry.expiresAt <= now) this.cache.delete(scope);
        }
        let entry = this.cache.get(key);
        if (!entry) {
            entry = { expiresAt: Infinity };
            entry.promise = this.loadGames({ start, end, leagues, regions }).then(response => {
                entry.expiresAt = this.now() + this.cacheTtlMs;
                return { ...response, fetchedAt: new Date(now).toISOString() };
            }).catch(error => {
                this.cache.delete(key);
                throw error;
            });
            this.cache.set(key, entry);
        }
        const response = await entry.promise;
        return { ...response, games: response.games.filter(game => new Date(game.startsAt) >= start && new Date(game.startsAt) <= end) };
    }

    async loadGames({ start, end, leagues, regions }) {
        const games = new Map();
        const directories = new Map();
        const requests = [];
        // ESPN slates follow US calendar days. Include the preceding UTC day so
        // an evening game after UTC midnight cannot fall between requested slates.
        const day = new Date(start);
        day.setUTCHours(0, 0, 0, 0);
        day.setUTCDate(day.getUTCDate() - 1);
        for (; day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
            const date = day.toISOString().slice(0, 10).replaceAll('-', '');
            for (const league of leagues) {
                if (league === 'NFL') {
                    requests.push({ url: `${SITE}/nfl/scoreboard?dates=${date}&limit=1000`, league });
                } else if (league === 'CFB') {
                    const season = day.getUTCFullYear() - (day.getUTCMonth() < 6 ? 1 : 0);
                    if (!directories.has(season)) {
                        const base = `${CORE}/${season}/types/2/groups/80`;
                        const children = await this.fetchJson(`${base}/children?limit=1000`);
                        const teams = await this.fetchJson(`${base}/teams?limit=1000`);
                        directories.set(season, { groups: referenceIds(children, 'groups'), teams: new Set(referenceIds(teams, 'teams')) });
                    }
                    const directory = directories.get(season);
                    for (const group of directory.groups) {
                        requests.push({ url: `${SITE}/college-football/scoreboard?dates=${date}&groups=${group}&limit=1000`, league, teams: directory.teams });
                    }
                } else {
                    throw new Error(`Unsupported sports league: ${league}`);
                }
            }
        }
        let nextRequest = 0;
        // Bound provider pressure; a failed constituent feed rejects the whole
        // refresh so callers retain their previous complete/stale snapshot.
        const worker = async () => {
            while (nextRequest < requests.length) {
                const { url, league, teams } = requests[nextRequest++];
                const data = await this.fetchJson(url);
                if (!Array.isArray(data.events)) throw new Error('Sports source is missing events');
                for (const event of data.events) {
                    if (teams && !event.competitions?.[0]?.competitors?.some(competitor => teams.has(String(competitor.team?.id)))) continue;
                    const game = normalize(event, league, regions);
                    games.set(game.id, game);
                }
            }
        };
        await Promise.all([worker(), worker()]);
        return { games: [...games.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), coverage: {
            source: 'ESPN public feeds',
            broadcastRegions: { US: 'available', CA: 'unverified', UK: 'unverified' },
            limitations: ['Canadian and UK broadcast assignments are unverified.', 'Actual completion timestamps are unavailable.'],
        } };
    }
}

module.exports = EspnSportsSource;
