const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');

const NOW = Date.parse('2026-10-28T20:00:00Z');
const HOUR = 3600000;
function game(id, start, status = 'scheduled', extra = {}) {
  return { id, league: 'NFL', teams: [{ id: '1', name: 'Seattle Seahawks', shortName: 'Seattle', abbreviation: 'SEA', aliases: [] }, { id: '2', name: 'Buffalo Bills', shortName: 'Buffalo', abbreviation: 'BUF', aliases: [] }], startsAt: new Date(start).toISOString(), status, statusDetail: '', completedAt: null, broadcasts: [], ...extra };
}
function setup(t, games) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-games-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = NOW;
  let response = { games, coverage: { source: 'recorded fixture', broadcastRegions: { US: 'available', CA: 'unverified', UK: 'unverified' } } };
  const source = { async fetchGames() { if (response instanceof Error) throw response; return response; } };
  const store = new GamesStore({ filePath: path.join(directory, 'games.json') });
  const service = new GamesService({ source, store, now: () => now });
  const controller = createGamesController(service);
  return { service, source, store, setTime: value => { now = value; }, setResponse: value => { response = value; }, async list() {
    let body;
    await controller.list({}, { json: value => { body = value; } });
    return body;
  } };
}

test('Games API includes only live games and starts within six hours, including the exact boundary', async t => {
  const fixture = setup(t, [game('later', NOW + 6 * HOUR + 1), game('boundary', NOW + 6 * HOUR),
    game('estimated', NOW + 6 * HOUR - 1, 'unknown'), game('estimated-later', NOW + 6 * HOUR + 1, 'unknown'),
    game('soon', NOW + 1000), game('overtime', NOW - 6 * HOUR, 'live')]);
  await fixture.service.refreshStatus();
  const response = await fixture.list();
  assert.deepEqual(response.games.map(item => [item.id, item.group]), [['overtime', 'live'], ['soon', 'startingSoon'], ['estimated', 'startingSoon'], ['boundary', 'startingSoon']]);
  assert.equal(response.games[0].statusEstimated, false);
  assert.equal(response.games[0].matching.state, 'pending');
});

test('the sidebar hides finals even during the previous finish grace window', async t => {
  const fixture = setup(t, [
    game('recent', NOW - 4 * HOUR, 'final', { completedAt: new Date(NOW - HOUR + 1).toISOString() }),
    game('expired', NOW - 4 * HOUR, 'final', { completedAt: new Date(NOW - HOUR).toISOString() }),
    game('unknown-finish', NOW - 4 * HOUR, 'final'),
  ]);
  await fixture.service.refreshStatus();
  assert.deepEqual((await fixture.list()).games.map(item => [item.id, item.group]), []);
});

test('a fresh live-to-final observation supplies a stable finish across refresh and restart', async t => {
  const fixture = setup(t, [game('transition', NOW - 3 * HOUR, 'live')]);
  await fixture.service.refreshStatus();
  fixture.setTime(NOW + 5 * 60000);
  fixture.setResponse({ games: [game('transition', NOW - 3 * HOUR, 'final')], coverage: {} });
  await fixture.service.refreshStatus();
  assert.deepEqual((await fixture.list()).games, []);
  fixture.setTime(NOW + HOUR);
  await fixture.service.refreshStatus();
  assert.equal(fixture.service.snapshot.games[0].observedCompletedAt, '2026-10-28T20:05:00.000Z');
  const restarted = new GamesService({ source: fixture.source, store: fixture.store, now: () => NOW + HOUR + 5 * 60000 });
  assert.deepEqual(restarted.getGames().games, []);
});

test('an old live observation followed by final does not create a new finish grace period', async t => {
  const fixture = setup(t, [game('old-live', NOW - 3 * HOUR, 'live')]);
  await fixture.service.refreshStatus();
  fixture.setTime(NOW + 2 * HOUR);
  fixture.setResponse({ games: [game('old-live', NOW - 3 * HOUR, 'final')], coverage: {} });
  await fixture.service.refreshStatus();
  assert.deepEqual((await fixture.list()).games, []);
});

test('unavailable live status uses the four-hour estimate and disappears at its estimated finish', async t => {
  const fixture = setup(t, [game('estimated', NOW - 4 * HOUR + 1, 'unknown'), game('late-schedule', NOW - HOUR), game('cancelled', NOW, 'cancelled')]);
  await fixture.service.refreshStatus();
  assert.deepEqual((await fixture.list()).games.map(item => [item.id, item.group, item.statusEstimated]), [['estimated', 'live', true], ['late-schedule', 'live', true]]);
  fixture.setTime(NOW + 1);
  assert.deepEqual((await fixture.list()).games.map(item => item.id), ['late-schedule']);
  fixture.setTime(NOW + HOUR + 1);
  assert.equal((await fixture.list()).games.some(item => item.id === 'estimated'), false);
});

test('feed failures retain games with stale status while browse never scans the provider', async t => {
  const fixture = setup(t, [game('retained', NOW - HOUR, 'live')]);
  await fixture.service.refreshStatus();
  fixture.setResponse(new Error('sports source failed'));
  await fixture.service.refreshStatus();
  const response = await fixture.list();
  assert.equal(response.games[0].id, 'retained');
  assert.equal(response.games[0].stale, true);
  assert.equal(response.freshness.error, 'Sports data is temporarily unavailable');
  assert.equal(response.freshness.lastSuccessfulStatusAt, '2026-10-28T20:00:00.000Z');
  assert.deepEqual(await fixture.list(), response);
  const restarted = new GamesService({ source: fixture.source, store: fixture.store, now: () => NOW + HOUR });
  assert.equal(restarted.getGames().games[0].stale, true);
});

test('initial sports failure returns a useful state without an empty result being presented as current', async t => {
  const fixture = setup(t, []);
  fixture.setResponse(new Error('failed'));
  await fixture.service.refreshStatus();
  const response = await fixture.list();
  assert.deepEqual(response.games, []);
  assert.equal(response.freshness.lastSuccessfulStatusAt, null);
  assert.equal(response.freshness.stale, true);
  assert.equal(response.freshness.error, 'Sports data is temporarily unavailable');
});

test('a live game missing from a later successful slate is retained with its own stale observation', async t => {
  const fixture = setup(t, [game('missing-live', NOW - 20 * HOUR, 'live')]);
  await fixture.service.refreshStatus();
  fixture.setTime(NOW + HOUR);
  fixture.setResponse({ games: [], coverage: {} });
  await fixture.service.refreshStatus();
  const response = await fixture.list();
  assert.equal(response.games[0].id, 'missing-live');
  assert.equal(response.games[0].stale, true);
  assert.equal(response.freshness.stale, false);
});

test('a stale observation does not become a fresh final grace period after a source gap', async t => {
  const fixture = setup(t, [game('gap', NOW - 3 * HOUR, 'live')]);
  await fixture.service.refreshStatus();
  fixture.setTime(NOW + 5 * 60000);
  fixture.setResponse({ games: [], coverage: {} });
  await fixture.service.refreshStatus();
  fixture.setTime(NOW + 6 * 60000);
  fixture.setResponse({ games: [game('gap', NOW - 3 * HOUR, 'final')], coverage: {} });
  await fixture.service.refreshStatus();
  assert.deepEqual((await fixture.list()).games, []);
});

test('recorded NFL source fixtures flow through Games API with stable identity and pending matching', async t => {
  const fixture = setup(t, []);
  const EspnSportsSource = require('../services/games/EspnSportsSource');
  fixture.service.updateSettings({ enabledLeagues: ['NFL'], estimatedDurationHours: { NFL: 4, CFB: 4 } });
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sports/nfl.json'), 'utf8'));
  // The recorded final has no reliable completion time; a live observation of
  // the same matchup exercises visibility without inventing a finish timestamp.
  const live = structuredClone(recorded.events.find(event => event.id === '401772830'));
  live.status.type = { state: 'in', detail: 'Overtime' };
  fixture.service.source = new EspnSportsSource({ fetchJson: async () => ({ events: [live] }) });
  fixture.setTime(Date.parse('2025-09-07T23:00:00Z'));
  await fixture.service.refreshStatus();
  const response = await fixture.list();
  assert.equal(response.games[0].id, 'espn:NFL:401772830');
  assert.equal(response.games[0].statusDetail, 'Overtime');
  assert.deepEqual(response.games[0].teams.map(team => team.name).sort(), ['Atlanta Falcons', 'Tampa Bay Buccaneers']);
  assert.equal(response.games[0].matching.state, 'pending');
});

test('startup stays idle and sidebar requests share the ESPN cache without refreshing its observation timestamp', async t => {
  const fixture = setup(t, []);
  const EspnSportsSource = require('../services/games/EspnSportsSource');
  let now = NOW;
  let requests = 0;
  let fail = false;
  fixture.service.updateSettings({ enabledLeagues: ['NFL'] });
  const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sports/nfl.json'), 'utf8'));
  const event = structuredClone(recorded.events[0]);
  event.date = new Date(NOW - HOUR).toISOString();
  event.status = { type: { state: 'in', detail: '1st Quarter' } };
  fixture.service.source = new EspnSportsSource({ now: () => now, fetchJson: async () => {
    requests++;
    if (fail) throw new Error('ESPN unavailable');
    return { events: [event] };
  } });
  fixture.service.start();
  t.after(() => fixture.service.stop());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 0);
  const first = await Promise.all([fixture.list(), fixture.list()]);
  const initialRequests = requests;
  assert.ok(initialRequests > 0);
  assert.deepEqual(first[0], first[1]);
  assert.equal(first[0].games[0].statusDetail, '1st Quarter');
  now += 30000; fixture.setTime(now);
  event.status.type.detail = '2nd Quarter';
  const cached = await fixture.list();
  assert.equal(requests, initialRequests);
  assert.equal(cached.freshness.lastSuccessfulStatusAt, first[0].freshness.lastSuccessfulStatusAt);
  assert.equal(cached.games[0].statusDetail, '1st Quarter');
  now = NOW + 120000; fixture.setTime(now);
  const fresh = await fixture.list();
  assert.equal(requests, initialRequests * 2);
  assert.equal(fresh.games[0].statusDetail, '2nd Quarter');
  now += 120000; fixture.setTime(now); fail = true;
  const stale = await fixture.list();
  assert.equal(stale.games[0].statusDetail, '2nd Quarter');
  assert.equal(stale.games[0].stale, true);
  assert.equal(stale.freshness.error, 'Sports data is temporarily unavailable');
});
