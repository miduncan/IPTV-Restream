const assert = require('node:assert/strict');
const test = require('node:test');
const { getNamedEvents } = require('../services/games/NamedEvents');
const { createGamesController } = require('../controllers/GamesController');
const GamesService = require('../services/games/GamesService');
const { body } = require('../test-support/xmltv');

const options = { enabledLeagues: ['NFL'], upcomingWindow: 6 * 3600000 };
const eventsAt = time => getNamedEvents(Date.parse(time), options);

test('named events use the six-hour upcoming window and exact Sunday Pacific start/end boundaries', () => {
    assert.deepEqual(eventsAt('2026-11-01T11:59:59Z'), []);
    const [upcoming] = eventsAt('2026-11-01T12:00:00Z');
    assert.equal(upcoming.group, 'startingSoon');
    assert.equal(upcoming.name, 'NFL RedZone');
    assert.equal(upcoming.channel, undefined);
    assert.equal(upcoming.startsAt, '2026-11-01T18:00:00.000Z');
    assert.equal(upcoming.endsAt, '2026-11-02T01:00:00.000Z');
    assert.equal(eventsAt('2026-11-01T18:00:00Z')[0].group, 'live');
    assert.equal(eventsAt('2026-11-02T00:59:59Z')[0].group, 'live');
    assert.deepEqual(eventsAt('2026-11-02T01:00:00Z'), []);
    assert.deepEqual(eventsAt('2026-11-02T20:00:00Z'), []);
});

test('weekly recurrence handles daylight saving and respects enabled leagues', () => {
    assert.equal(eventsAt('2026-10-25T17:00:00Z')[0].startsAt, '2026-10-25T17:00:00.000Z');
    assert.equal(eventsAt('2026-03-08T17:00:00Z')[0].startsAt, '2026-03-08T17:00:00.000Z');
    assert.equal(eventsAt('2026-11-08T18:00:00Z')[0].startsAt, '2026-11-08T18:00:00.000Z');
    assert.deepEqual(getNamedEvents(Date.parse('2026-11-01T20:00:00Z'), { ...options, enabledLeagues: ['CFB'] }), []);
});

test('Games API includes scheduled named events through a sports outage without scanning the provider', async () => {
    const service = new GamesService({
        source: { async fetchGames() { throw new Error('offline'); } },
        store: { load: () => ({}), save() {} },
        catalog: { fetchCatalog() { throw new Error('browse must not scan'); } },
        now: () => Date.parse('2026-11-01T20:00:00Z'),
    });
    let response;
    await createGamesController(service).list({}, { json(body) { response = body; } });
    assert.equal(response.namedEvents[0].name, 'NFL RedZone');
    assert.equal(response.namedEvents[0].group, 'live');
    assert.equal(response.freshness.stale, true);
});

test('named events share the matching run, scoring, persistence, and candidate endpoint without browse-time scans', async () => {
    const now = Date.parse('2026-11-01T20:00:00Z');
    let saved = {};
    let scans = 0;
    let fail = false;
    const catalog = { async fetchCatalog() {
        scans++;
        if (fail) throw new Error('provider unavailable');
        return [
            { streamId: '1', name: 'CA | TSN HD', categoryId: '10' },
            { streamId: '2', name: 'CA | TSN1 HD', categoryId: '10' },
            { streamId: '3', name: 'CA | TSN5 HD', categoryId: '10' },
            { streamId: '4', name: 'TSN', categoryId: '20' },
            { streamId: '5', name: 'NOTTSN', categoryId: '10' },
        ];
    } };
    const store = { load: () => structuredClone(saved), save(snapshot) { saved = structuredClone(snapshot); } };
    const source = { async fetchGames() { return { games: [], coverage: {} }; } };
    const service = new GamesService({ source, store, catalog, now: () => now });
    service.updateCategoryPolicy(['10']);
    const event = service.getGames({ sidebar: true }).namedEvents[0];
    const lookup = () => {
        let body;
        createGamesController(service).getCandidates({ params: { gameId: event.id } }, { json(value) { body = value; } });
        return body;
    };
    assert.equal(lookup().state, 'pending');
    assert.equal(scans, 0);
    await service.runMatching();
    const result = lookup();
    assert.equal(scans, 1);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.candidates.map(candidate => candidate.sourceId), ['2']);
    assert.ok(result.candidates.every(candidate => candidate.scorer === 'cable' && candidate.confidenceScore > 0 && candidate.confidenceScore < 100));
    assert.equal(result.candidates[0].epgInspection.window.end, event.endsAt);
    assert.equal(service.getGames({ sidebar: true }).namedEvents[0].matching.matchedAt, result.matchedAt);
    assert.deepEqual(service.getGames({ sidebar: true }).namedEvents[0].matching.candidates, result.candidates);
    assert.equal(service.getMatchingHistory().matches[0].game.name, 'NFL RedZone');
    lookup();
    assert.equal(scans, 1);
    const restarted = new GamesService({ source, store, catalog, now: () => now });
    assert.deepEqual(restarted.getGameMatching(event.id), result);
    fail = true;
    await service.runMatching();
    assert.deepEqual(lookup().candidates, result.candidates);
    assert.equal(lookup().stale, true);
    service.updateCategoryPolicy([]);
    assert.deepEqual(lookup().candidates, []);
});

test('named event matching retains late-window guide evidence and scores it through the cable scorer', async () => {
    const now = Date.parse('2026-11-01T20:00:00Z');
    const service = new GamesService({
        source: { async fetchGames() { return { games: [], coverage: {} }; } },
        store: { load: () => ({}), save() {} }, now: () => now,
        catalog: {
            async fetchCatalog() { return [
                { streamId: '1', name: 'CA | TSN1 HD', epgChannelId: 'epg-1', categoryId: '10' },
                { streamId: '2', name: 'CA | TSN1 HD', epgChannelId: 'epg-2', categoryId: '10' },
            ]; },
            async fetchXmlTv() { return body({
                '1': [{ title: 'NFL RedZone', start_timestamp: Date.parse('2026-11-02T00:00:00Z') / 1000, stop_timestamp: Date.parse('2026-11-02T01:00:00Z') / 1000 }],
                '2': [{ title: 'Hockey', start_timestamp: Date.parse('2026-11-02T00:00:00Z') / 1000, stop_timestamp: Date.parse('2026-11-02T01:00:00Z') / 1000 }],
            }); },
        },
    });
    service.updateCategoryPolicy(['10']);
    await service.runMatching();
    const event = service.getGames({ sidebar: true }).namedEvents[0];
    const [supported, conflicting] = service.getGameMatching(event.id).candidates;
    assert.equal(supported.sourceId, '1');
    assert.ok(supported.confidenceScore > conflicting.confidenceScore);
    assert.ok(supported.evidence.some(item => item.kind === 'epg-programme' && item.title === 'NFL RedZone'));
    assert.equal(supported.epgInspection.programmes[0].points, 12);
    assert.equal(supported.epgInspection.window.end, event.endsAt);
    assert.ok(conflicting.evidence.some(item => item.kind === 'contradiction'));
});

test('named events match on-demand event names and guide titles while TSN1 assignments stay exact', async () => {
    const now = Date.parse('2026-11-01T20:00:00Z');
    const channels = [
        { streamId: '1', name: 'NFL: RedZone', category: 'NFL On Demand' },
        { streamId: '2', name: 'NFL: Red Zone HD', category: 'NFL On Demand' },
        { streamId: '3', name: 'RedZone', category: 'Sports events' },
        { streamId: '4', name: 'CA EN: TSN 1', category: 'CA| SPORTS EN' },
        { streamId: '5', name: 'CA | TSN 2 HD', category: 'Canada' },
        { streamId: '6', name: 'CA | TSN3 HD', category: 'Canada' },
        { streamId: '7', name: 'NFL Event 7', category: 'NFL On Demand', epgChannelId: 'epg-7' },
        { streamId: '8', name: 'NFL Event 8', category: 'NFL On Demand' },
        { streamId: '9', name: 'Hockey RedZone', category: 'Hockey' },
        { streamId: '10', name: 'CA | TSN HD', category: 'Canada' },
        { streamId: '11', name: 'CA EN: TSN 4', category: 'CA| SPORTS EN' },
        { streamId: '12', name: 'CA EN: TSN 5', category: 'CA| SPORTS EN' },
    ];
    const service = new GamesService({
        source: { async fetchGames() { return { games: [], coverage: {} }; } },
        store: { load: () => ({}), save() {} }, now: () => now,
        catalog: {
            async fetchCatalog() { return channels.map(channel => ({ categoryId: '10', ...channel })); },
            async fetchXmlTv() { return body({ '7': [{ title: 'NFL RedZone',
                start_timestamp: Date.parse('2026-11-01T18:00:00Z') / 1000,
                stop_timestamp: Date.parse('2026-11-02T01:00:00Z') / 1000 }] }); },
        },
    });
    service.updateCategoryPolicy(['10']);
    await service.runMatching();
    const event = service.getGames({ sidebar: true }).namedEvents[0];
    const candidates = service.getGameMatching(event.id).candidates;
    assert.deepEqual(candidates.map(candidate => candidate.sourceId).sort(), ['1', '2', '3', '4', '7']);
    for (const id of ['1', '2', '3']) {
        const candidate = candidates.find(candidate => candidate.sourceId === id);
        assert.equal(candidate.scorer, 'ppv');
        assert.ok(candidate.evidence.some(item => item.kind === 'event-name'));
    }
    assert.ok(candidates.find(candidate => candidate.sourceId === '7').evidence.some(item => item.kind === 'epg-programme'));
});
