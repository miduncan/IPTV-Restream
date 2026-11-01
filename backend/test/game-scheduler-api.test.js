const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const HOUR = 3600000;
const defaults = { matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' };
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function setup(t, initialTime = '2026-10-28T12:00:00Z') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-game-scheduler-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = Date.parse(initialTime);
  let scans = 0;
  let failCatalog = false;
  let gamesFactory = () => [game('soon', HOUR / 2), game('boundary', 48 * HOUR), game('outside', 48 * HOUR + 1)];
  const scopes = [];
  const teams = [{ id: 'sea', name: 'Seattle Seahawks', aliases: ['Seahawks'] }, { id: 'buf', name: 'Buffalo Bills', aliases: ['Bills'] }];
  const game = (id, offset, league = 'NFL') => ({ id, league, teams, startsAt: new Date(now + offset).toISOString(), status: 'scheduled', broadcasts: [] });
  const source = { async fetchGames(scope) { scopes.push(scope); return { games: gamesFactory(), coverage: {} }; } };
  const catalog = { async fetchCatalog() { scans += 1; if (failCatalog) throw new Error('provider failure'); return [{ streamId: '1', name: 'Seattle Seahawks vs Buffalo Bills' }]; } };
  const store = new GamesStore({ filePath: path.join(directory, 'games.json') });
  const create = () => new GamesService({ source, catalog, store, now: () => now });
  const service = create();
  const controller = createGamesController(service);
  return { service, store, source, catalog, create, scopes, scans: () => scans, game,
    setTime(value) { now = Date.parse(value); }, setGames(value) { gamesFactory = value; }, fail() { failCatalog = true; },
    save(changes, user = { role: 'admin' }) { const res = response(); controller.updateSettings({ user, body: { settings: { ...service.getSettings(), ...changes } } }, res); return res; },
    list() { return service.getGames({ sidebar: true }); },
    candidates(id) { const res = response(); controller.getCandidates({ params: { gameId: id } }, res); return res.body; },
  };
}

test('Games settings migrate existing snapshots to disabled daily matching at 06:00 America/Los_Angeles', t => {
  const fixture = setup(t);
  for (const [key, value] of Object.entries(defaults)) assert.equal(fixture.list().settings[key], value);
  fixture.store.save({ settings: { enabledLeagues: ['NFL'], estimatedDurationHours: { NFL: 3, CFB: 4 }, broadcastRegions: ['US'] } });
  const migrated = fixture.create();
  assert.equal(migrated.getSettings().matchingEnabled, false);
  assert.equal(migrated.getSettings().matchingTime, '06:00');
  assert.equal(migrated.getSettings().matchingTimezone, 'America/Los_Angeles');
  assert.equal(fixture.scans(), 0);
});

test('enabling runs immediately with the shared 48-hour scope, consumes today, and schedules tomorrow exactly once', async t => {
  const fixture = setup(t);
  assert.equal(fixture.save({ matchingEnabled: true }).statusCode, 200);
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  assert.equal(fixture.candidates('soon').state, 'complete');
  assert.equal(fixture.candidates('boundary').state, 'complete');
  assert.equal(fixture.candidates('outside').state, 'pending');
  assert.deepEqual(fixture.scopes[0].leagues, ['NFL', 'CFB']);
  assert.equal(fixture.scopes[0].to, '2026-10-30T12:00:00.000Z');
  fixture.setTime('2026-10-28T13:00:00Z'); // today's scheduled 06:00 was consumed by initial enable
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  fixture.setTime('2026-10-29T12:59:00Z');
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  fixture.setTime('2026-10-29T13:00:00Z');
  await fixture.service.tickMatchingSchedule();
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  assert.equal(fixture.scopes.at(-1).to, '2026-10-31T13:00:00.000Z');
});

test('only admins can persist valid matching controls and invalid changes leave settings untouched', t => {
  const fixture = setup(t);
  const before = fixture.list().settings;
  assert.equal(fixture.save({ matchingEnabled: true }, { role: 'viewer' }).statusCode, 403);
  assert.equal(fixture.save({ matchingEnabled: true }, null).statusCode, 403);
  for (const change of [{ matchingTime: '25:00' }, { matchingTime: '6:00' }, { matchingTime: '06:60' }, { matchingTime: null }, { matchingEnabled: 'yes' }, { matchingEnabled: null }, { matchingTimezone: 'Invalid/Zone' }, { matchingTimezone: '' }, { matchingTimezone: 123 }]) {
    assert.equal(fixture.save(change).statusCode, 400);
    assert.deepEqual(fixture.list().settings, before);
  }
  assert.equal(fixture.scans(), 0);
});

test('a claim-write failure starts no external scan and a successful manual run clears the obsolete automatic error', async t => {
  const fixture = setup(t);
  const save = fixture.store.save.bind(fixture.store);
  fixture.store.save = snapshot => {
    if (snapshot.scheduleState?.claimedOccurrences?.length) throw new Error('disk unavailable');
    save(snapshot);
  };
  fixture.save({ matchingEnabled: true });
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 0);
  assert.equal(fixture.scopes.length, 0);
  assert.match(fixture.list().matching.lastError, /Automatic matching/);
  fixture.store.save = save;
  fixture.save({ matchingEnabled: false });
  await fixture.service.runMatching();
  assert.equal(fixture.scans(), 1);
  assert.equal(fixture.list().matching.lastError, null);
  assert.equal(fixture.candidates('soon').stale, false);
});

test('a daily occurrence with no eligible games preserves old candidates and succeeds without catalog, guide, or clock requests', async t => {
  const fixture = setup(t);
  fixture.setGames(() => [fixture.game('soon', HOUR / 2)]);
  fixture.save({ matchingEnabled: true });
  await fixture.service.tickMatchingSchedule();
  const before = fixture.candidates('soon').candidates;
  fixture.setGames(() => []);
  fixture.setTime('2026-10-29T13:00:00Z');
  fixture.catalog.fetchCatalog = async () => { throw new Error('Catalog must not be touched without matching targets'); };
  fixture.catalog.fetchScheduleEpg = async () => { throw new Error('Guide must not be touched'); };
  fixture.catalog.fetchServerInfo = async () => { throw new Error('Clock must not be touched'); };
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.list().matching.lastSuccessfulAt, '2026-10-29T13:00:00.000Z');
  assert.equal(fixture.list().matching.lastError, null);
  assert.equal(fixture.list().matching.guideCoverage.requestedStreams, 0);
  assert.deepEqual(fixture.candidates('soon').candidates, before);
});

test('daily matching handles nonexistent spring times and repeated autumn times once per local date', async t => {
  const spring = setup(t, '2026-03-07T08:00:00Z');
  spring.save({ matchingEnabled: true, matchingTime: '02:30' });
  await spring.service.tickMatchingSchedule();
  spring.setTime('2026-03-08T09:59:00Z'); // 01:59
  await spring.service.tickMatchingSchedule();
  assert.equal(spring.scans(), 1);
  spring.setTime('2026-03-08T10:00:00Z'); // first valid minute after missing 02:30: 03:00
  await spring.service.tickMatchingSchedule();
  await spring.service.tickMatchingSchedule();
  assert.equal(spring.scans(), 2);
  const autumn = setup(t, '2026-10-31T07:00:00Z');
  autumn.save({ matchingEnabled: true, matchingTime: '01:30' });
  await autumn.service.tickMatchingSchedule();
  autumn.setTime('2026-11-01T08:29:00Z');
  await autumn.service.tickMatchingSchedule();
  assert.equal(autumn.scans(), 1);
  autumn.setTime('2026-11-01T08:30:00Z'); // first 01:30 PDT
  await autumn.service.tickMatchingSchedule();
  autumn.setTime('2026-11-01T09:30:00Z'); // repeated 01:30 PST
  await autumn.service.tickMatchingSchedule();
  assert.equal(autumn.scans(), 2);
});

test('restart catches up only today and persisted occurrence claims prevent same-day configuration A to B to A repeats', async t => {
  const fixture = setup(t, '2026-10-28T15:00:00Z');
  fixture.save({ matchingEnabled: true });
  await fixture.service.tickMatchingSchedule();
  fixture.save({ matchingTime: '07:00' });
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  fixture.save({ matchingTime: '06:00' });
  await fixture.service.tickMatchingSchedule();
  await fixture.create().tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  fixture.setTime('2026-11-01T15:00:00Z'); // several missed days; catch up Nov 1 only
  const restarted = fixture.create();
  restarted.start(); t.after(() => restarted.stop());
  await restarted.tickMatchingSchedule();
  assert.equal(fixture.scans(), 3);
  const again = fixture.create();
  again.start(); t.after(() => again.stop());
  await again.refreshStatus(); await again.tickMatchingSchedule();
  assert.equal(fixture.scans(), 3);
});

test('the occurrence is durably claimed before the first external sports request, so a restart cannot duplicate an in-flight scan', async t => {
  const fixture = setup(t);
  const fetchGames = fixture.source.fetchGames;
  let requests = 0;
  fixture.source.fetchGames = async scope => {
    requests += 1;
    if (requests === 1) await fixture.create().tickMatchingSchedule();
    return fetchGames(scope);
  };
  fixture.save({ matchingEnabled: true });
  await fixture.service.tickMatchingSchedule();
  assert.equal(requests, 1);
  assert.equal(fixture.scans(), 1);
});

test('manual overlap defers the initial occurrence without concurrent scans; disabling cancels a deferred initial run', async t => {
  const fixture = setup(t);
  const fetchCatalog = fixture.catalog.fetchCatalog;
  let release;
  let active = 0;
  let maximum = 0;
  const held = new Promise(resolve => { release = resolve; });
  fixture.catalog.fetchCatalog = async () => {
    active += 1; maximum = Math.max(maximum, active);
    await held;
    const result = await fetchCatalog(); active -= 1; return result;
  };
  const manual = fixture.service.runMatching();
  await new Promise(resolve => setImmediate(resolve));
  fixture.save({ matchingEnabled: true });
  const overlapping = fixture.service.tickMatchingSchedule();
  assert.equal(fixture.list().matching.running, true);
  assert.equal(fixture.scans(), 0);
  release(); await manual; await overlapping;
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  assert.equal(maximum, 1);
  fixture.save({ matchingEnabled: false });
  fixture.setTime('2026-10-29T14:00:00Z');
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  await fixture.service.runMatching(); // manual matching stays available while automatic matching is off
  assert.equal(fixture.scans(), 3);
  fixture.save({ matchingEnabled: true });
  fixture.save({ matchingEnabled: false }); // already started runs finish; future automatic runs stop
  await fixture.service.runMatching();
  const finished = fixture.scans();
  fixture.setTime('2026-10-30T14:00:00Z');
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), finished);
});

test('an automatic failure retains candidates and last success, leaves new games pending, and is not replayed after restart', async t => {
  const fixture = setup(t);
  fixture.save({ matchingEnabled: true }); await fixture.service.tickMatchingSchedule();
  const previous = fixture.candidates('soon');
  const lastSuccess = fixture.list().matching.lastSuccessfulAt;
  fixture.setTime('2026-10-29T13:00:00Z');
  fixture.setGames(() => [fixture.game('soon', HOUR / 2), fixture.game('new', HOUR / 2)]);
  fixture.fail();
  await fixture.service.tickMatchingSchedule();
  assert.deepEqual(fixture.candidates('soon').candidates, previous.candidates);
  assert.equal(fixture.candidates('soon').matchedAt, previous.matchedAt);
  assert.equal(fixture.candidates('soon').stale, true);
  assert.equal(fixture.candidates('new').state, 'pending');
  assert.equal(fixture.list().matching.lastSuccessfulAt, lastSuccess);
  assert.match(fixture.list().matching.lastError, /retained/);
  const beforeRestart = fixture.scans();
  await fixture.create().tickMatchingSchedule();
  assert.equal(fixture.scans(), beforeRestart);
});

test('browsing, status refresh and non-schedule settings changes do not run due matching; a scheduler tick does', async t => {
  const fixture = setup(t);
  fixture.save({ matchingEnabled: true }); await fixture.service.tickMatchingSchedule();
  fixture.setTime('2026-10-29T13:00:00Z');
  await fixture.service.refreshStatus(); fixture.list(); fixture.candidates('soon');
  fixture.save({ estimatedDurationHours: { NFL: 5, CFB: 4 }, enabledLeagues: ['CFB'] });
  assert.equal(fixture.scans(), 1);
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1); // no CFB targets: successful zero-scan occurrence
  assert.equal(fixture.list().matching.lastSuccessfulAt, '2026-10-29T13:00:00.000Z');
  assert.deepEqual(fixture.scopes.at(-1).leagues, ['CFB']);
});

test('a due daily run defers behind a manual scan and executes once when the shared guard becomes idle', async t => {
  const fixture = setup(t);
  fixture.save({ matchingEnabled: true }); await fixture.service.tickMatchingSchedule();
  fixture.setTime('2026-10-29T12:59:00Z');
  const fetchCatalog = fixture.catalog.fetchCatalog;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  fixture.catalog.fetchCatalog = async () => { await held; return fetchCatalog(); };
  const manual = fixture.service.runMatching();
  await new Promise(resolve => setImmediate(resolve));
  fixture.setTime('2026-10-29T13:00:00Z');
  const overlapping = fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  release(); await manual; await overlapping;
  await fixture.service.tickMatchingSchedule();
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 3); // initial, manual, deferred daily
});

test('disabling cancels a pending initial occurrence, and an explicit re-enable gets a fresh initial run even on a previously claimed date', async t => {
  const fixture = setup(t);
  const fetchCatalog = fixture.catalog.fetchCatalog;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  fixture.catalog.fetchCatalog = async () => { await held; return fetchCatalog(); };
  const manual = fixture.service.runMatching();
  await new Promise(resolve => setImmediate(resolve));
  fixture.save({ matchingEnabled: true }); fixture.save({ matchingEnabled: false });
  release(); await manual; await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  fixture.save({ matchingEnabled: true }); await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
  fixture.save({ matchingEnabled: false }); fixture.save({ matchingEnabled: true });
  await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 3);
});

test('the configured timezone controls the daily minute independently of the process timezone', async t => {
  const fixture = setup(t, '2026-10-28T05:00:00Z');
  fixture.save({ matchingEnabled: true, matchingTime: '22:15', matchingTimezone: 'UTC' });
  await fixture.service.tickMatchingSchedule();
  fixture.setTime('2026-10-29T22:14:00Z'); await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 1);
  fixture.setTime('2026-10-29T22:15:00Z'); await fixture.service.tickMatchingSchedule();
  assert.equal(fixture.scans(), 2);
});
