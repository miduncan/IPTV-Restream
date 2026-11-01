const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EspnSportsSource = require('../services/games/EspnSportsSource');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sports', name)));

test('sports adapter exposes stable NFL identity, teams, kickoff and qualified broadcasts without inventing a finish', async () => {
    const source = new EspnSportsSource({ fetchJson: async () => fixture('nfl.json') });
    const { games, coverage } = await source.fetchGames({ from: '2025-09-07T00:00:00Z', to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
    const game = games.find(game => game.id === 'espn:NFL:401772830');
    assert.deepEqual(game.teams.map(team => team.location).sort(), ['Atlanta', 'Tampa Bay']);
    assert.equal(game.startsAt, '2025-09-07T17:00:00.000Z');
    assert.deepEqual(game.teams.map(team => team.name).sort(), ['Atlanta Falcons', 'Tampa Bay Buccaneers']);
    assert.equal(game.status, 'final');
    assert.equal(game.completedAt, null);
    assert.deepEqual(game.broadcasts, [{ network: 'Fox', region: 'US' }]);
    assert.equal(coverage.broadcastRegions.CA, 'unverified');
});

function cfbFeed(url) {
    if (url.includes('/children?')) return fixture('fbs-groups.json');
    if (url.includes('/teams?')) return fixture('fbs-teams.json');
    const group = new URL(url).searchParams.get('groups');
    const data = fixture(`cfb-${group}.json`);
    // A source error that adds FCS-only contests must not expand launch scope.
    data.events.push(fixture('cfb-81.json').events.find(event => event.id === '401767732'));
    return data;
}

test('CFB includes conference, independent and FBS-FCS games omitted from the default scoreboard, deduplicating feeds and excluding FCS-only games', async () => {
    const source = new EspnSportsSource({ fetchJson: async url => cfbFeed(url) });
    const { games } = await source.fetchGames({ from: '2025-08-29T00:00:00Z', to: '2025-09-01T23:59:59Z', leagues: ['CFB'] });
    assert.equal(games.length, 60);
    assert.deepEqual(games.map(game => game.id.split(':')[2]).sort(), fixture('completeness-check.json').teamScheduleGameIds);
    assert.equal(new Set(games.map(game => game.id)).size, 60);
    assert.ok(games.find(game => game.id === 'espn:CFB:401757167')); // CCSU at independent UConn
    assert.ok(games.find(game => game.id === 'espn:CFB:401754520')); // Duquesne at Pitt
    assert.ok(games.find(game => game.id === 'espn:CFB:401752665')); // Alabama at FSU, two feeds
    assert.ok(!games.find(game => game.id === 'espn:CFB:401767732')); // Richmond at Lehigh
    const defaultIds = new Set(fixture('cfb-80.json').events.map(event => event.id));
    assert.equal(games.filter(game => !defaultIds.has(game.id.split(':')[2])).length, 35);
});

test('independent Notre Dame is included on a separate Sunday slate', async () => {
    const source = new EspnSportsSource({ fetchJson: async url => {
        if (url.includes('dates=20250831&groups=18&')) return fixture('cfb-independent-sunday.json');
        return cfbFeed(url);
    } });
    const { games } = await source.fetchGames({ from: '2025-08-31T12:00:00Z', to: '2025-09-01T04:00:00Z', leagues: ['CFB'] });
    assert.ok(games.find(game => game.id === 'espn:CFB:401754522'));
});

test('regional query parameters are not evidence of Canadian or UK assignments', async () => {
    for (const name of ['nfl-ca.json', 'nfl-gb.json']) {
        const source = new EspnSportsSource({ fetchJson: async () => fixture(name) });
        const { games, coverage } = await source.fetchGames({ from: '2025-09-07T00:00:00Z', to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
        assert.ok(games.flatMap(game => game.broadcasts).every(broadcast => broadcast.region === 'US'));
        assert.equal(coverage.broadcastRegions.UK, 'unverified');
    }
});

test('an incomplete conference directory or failed constituent feed rejects refresh instead of publishing partial coverage', async () => {
    const incomplete = new EspnSportsSource({ fetchJson: async () => ({ count: 11, items: [], pageCount: 2 }) });
    await assert.rejects(incomplete.fetchGames({ from: '2025-08-30', to: '2025-08-31', leagues: ['CFB'] }), /incomplete FBS directory/);
    const failed = new EspnSportsSource({ fetchJson: async url => {
        if (url.includes('groups=18&')) throw new Error('Source unavailable');
        return cfbFeed(url);
    } });
    await assert.rejects(failed.fetchGames({ from: '2025-08-30', to: '2025-08-31', leagues: ['CFB'] }), /Source unavailable/);
});

test('sports adapter retains venue city for local channel scoring and tolerates missing venue data', async () => {
    const feed = fixture('nfl.json');
    const event = feed.events.find(event => event.id === '401772830');
    event.competitions[0].competitors[0].team.logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png';
    delete event.competitions[0].competitors[1].team.logo;
    event.competitions[0].venue = { address: { city: 'Atlanta', state: 'GA' } };
    const source = new EspnSportsSource({ fetchJson: async () => feed });
    const { games } = await source.fetchGames({ from: '2025-09-07T00:00:00Z', to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
    assert.deepEqual(games.find(game => game.id === 'espn:NFL:401772830').venue, { city: 'Atlanta', state: 'GA' });
    const teams = games.find(game => game.id === 'espn:NFL:401772830').teams;
    assert.equal(teams[0].logo, 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png');
    assert.equal(teams[0].darkLogo, 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/tb.png');
    assert.equal(teams[1].logo, null);
    assert.equal(teams[1].darkLogo, null);
    assert.ok(games.some(game => game.venue === null));
});


test('scores follow their teams for live and final games, preserve zero, and omit pregame or missing values', async () => {
    for (const [state, scores, expected] of [
        ['in', ['0', '14'], [0, 14]],
        ['post', ['24', '21'], [24, 21]],
        ['pre', ['0', '0'], [null, null]],
        ['in', [undefined, ''], [null, null]],
        ['in', ['bad', '-1'], [null, null]],
    ]) {
        const feed = fixture('nfl.json');
        const event = feed.events.find(event => event.id === '401772830');
        event.status = { type: { state } };
        event.competitions[0].competitors.forEach((competitor, index) => { competitor.score = scores[index]; });
        const source = new EspnSportsSource({ fetchJson: async () => feed });
        const { games } = await source.fetchGames({ from: '2025-09-07T00:00:00Z', to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
        const game = games.find(game => game.id === 'espn:NFL:401772830');
        assert.deepEqual(game.teams.map(team => team.score), expected);
    }
});

test('ESPN shares a two-minute slate cache across concurrent and moving-window requests and refreshes on demand at expiry', async () => {
    let now = Date.parse('2025-09-07T18:00:00Z');
    let requests = 0;
    let quarter = '1st Quarter';
    const source = new EspnSportsSource({ now: () => now, fetchJson: async () => {
        requests++;
        const feed = fixture('nfl.json');
        for (const event of feed.events) event.status = { type: { state: 'in', detail: quarter } };
        return feed;
    } });
    const query = (from = '2025-09-07T00:00:00Z') => ({ from, to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
    const results = await Promise.all([source.fetchGames(query()), source.fetchGames(query())]);
    assert.equal(requests, 3); // safety day plus September 7 and 8, shared by both callers
    assert.deepEqual(results[0], results[1]);
    const fetchedAt = results[0].fetchedAt;
    quarter = '2nd Quarter';
    now += 119999;
    const cached = await source.fetchGames(query('2025-09-07T17:30:00Z'));
    assert.equal(requests, 3);
    assert.equal(cached.fetchedAt, fetchedAt);
    assert.ok(cached.games.every(game => game.startsAt >= '2025-09-07T17:30:00.000Z'));
    assert.ok(cached.games.every(game => game.statusDetail === '1st Quarter'));
    now++;
    assert.equal(requests, 3); // expiry itself does no work
    const refreshed = await source.fetchGames(query());
    assert.equal(requests, 6);
    assert.notEqual(refreshed.fetchedAt, fetchedAt);
    assert.ok(refreshed.games.every(game => game.statusDetail === '2nd Quarter'));
});

test('ESPN caches complete slates, separates scope changes, and retries failed refreshes', async () => {
    let now = 0;
    let requests = 0;
    let failed = false;
    const source = new EspnSportsSource({ now: () => now, cacheTtlMs: 1000, fetchJson: async () => {
        requests++;
        if (failed) throw new Error('ESPN unavailable');
        return fixture('nfl.json');
    } });
    const query = { from: '2025-09-07T19:00:00Z', to: '2025-09-07T23:59:59Z', leagues: ['NFL'], regions: ['US'] };
    const later = await source.fetchGames(query);
    const earlier = await source.fetchGames({ ...query, from: '2025-09-07T00:00:00Z' });
    assert.equal(requests, 2);
    assert.ok(earlier.games.length > later.games.length);
    await source.fetchGames({ ...query, regions: ['CA'] });
    assert.equal(requests, 4);
    now = 1000;
    failed = true;
    await assert.rejects(source.fetchGames(query), /ESPN unavailable/);
    failed = false;
    const recovered = await source.fetchGames(query);
    assert.ok(recovered.games.length > 0);
    assert.equal(recovered.fetchedAt, new Date(now).toISOString());
    assert.ok(source.cache.size <= 2);
});

test('team logos prefer ESPN-declared dark variants and leave unfamiliar CDN paths unchanged', async () => {
    const feed = fixture('nfl.json');
    const event = feed.events.find(event => event.id === '401772830');
    const [first, second] = event.competitions[0].competitors;
    first.team.logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png';
    first.team.logos = [{ href: 'https://a.espncdn.com/custom-dark-logo.png', rel: ['full', 'dark'] }];
    second.team.logo = 'https://example.com/team.png';
    const source = new EspnSportsSource({ fetchJson: async () => feed });
    const { games } = await source.fetchGames({ from: '2025-09-07T00:00:00Z', to: '2025-09-08T00:00:00Z', leagues: ['NFL'] });
    const teams = games.find(game => game.id === 'espn:NFL:401772830').teams;
    assert.equal(teams[0].darkLogo, 'https://a.espncdn.com/custom-dark-logo.png');
    assert.equal(teams[1].darkLogo, null);
    assert.equal(teams[1].logo, 'https://example.com/team.png');
});
