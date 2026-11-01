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
const teams = [
  { id: 'sea', name: 'Seattle Seahawks', shortName: 'Seattle', abbreviation: 'SEA', aliases: ['Seahawks', 'Seattle', 'SEA'] },
  { id: 'buf', name: 'Buffalo Bills', shortName: 'Buffalo', abbreviation: 'BUF', aliases: ['Bills', 'Buffalo', 'BUF'] },
];
const game = (id, offset = HOUR / 2, extra = {}) => ({ id, league: 'NFL', teams, startsAt: new Date(NOW + offset).toISOString(), status: 'scheduled', statusDetail: '', completedAt: null, broadcasts: [], ...extra });
const catalog = [
  { streamId: '41', name: 'Seahawks vs Bills', category: 'NFL', url: 'https://private.example/password', avatar: '' },
  { streamId: '42', name: 'Seattle Seahawks', category: 'NFL', avatar: '' },
  { streamId: '43', name: 'SEA', category: 'NFL', avatar: '' },
  { streamId: '44', name: 'Unrelated movie channel', avatar: '' },
];
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function setup(t, games = [game('visible'), game('tomorrow', 36 * HOUR), game('outside', 49 * HOUR)]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-matching-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = NOW;
  let sourceGames = games;
  let providerResponse = catalog;
  const store = new GamesStore({ filePath: path.join(directory, 'games.json') });
  const service = new GamesService({ store, now: () => now,
    source: { async fetchGames() { return { games: sourceGames, coverage: {} }; } },
    catalog: { async fetchCatalog() { if (providerResponse instanceof Error) throw providerResponse; return providerResponse.map(channel => ({ categoryId: '1', ...channel })); } },
  });
  service.updateCategoryPolicy(['1']);
  const controller = createGamesController(service);
  return { service, controller, store, setTime: value => { now = value; }, setGames: value => { sourceGames = value; }, setCatalog: value => { providerResponse = value; },
    async run(user = { role: 'admin' }) { const res = response(); await controller.runMatching({ user }, res); return res; },
    candidates(id) { const res = response(); controller.getCandidates({ params: { gameId: id } }, res); return res; },
  };
}

test('manual admin matching ranks current full-catalog names and stores results across the visible 48-hour window', async t => {
  const fixture = setup(t);
  await fixture.service.refreshStatus();
  assert.equal(fixture.candidates('visible').body.state, 'pending');
  assert.equal((await fixture.run()).statusCode, 202);
  await fixture.service.runMatching();
  const result = fixture.candidates('visible').body;
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.candidates.map(candidate => candidate.sourceId), ['41', '42', '43']);
  assert.ok(result.candidates[0].confidenceScore > result.candidates[1].confidenceScore);
  assert.ok(result.candidates[1].confidenceScore > result.candidates[2].confidenceScore);
  assert.ok(result.candidates.every(candidate => candidate.confidenceScore >= 0 && candidate.confidenceScore <= 100 && candidate.evidence.length));
  assert.equal(JSON.stringify(result).includes('private.example'), false);
  assert.deepEqual(fixture.service.getGames({ sidebar: true }).games.find(game => game.id === 'visible').matching.candidates, result.candidates);
  assert.equal(fixture.candidates('tomorrow').body.state, 'complete');
  assert.equal(fixture.candidates('outside').body.state, 'pending');
  assert.deepEqual(fixture.service.getGames().games.map(item => item.id), ['visible', 'tomorrow']);
});

test('unauthorized users cannot start matching and unknown identities cannot obtain another game result', async t => {
  const fixture = setup(t);
  for (const user of [{ role: 'viewer' }, undefined]) assert.equal((await fixture.run(user || null)).statusCode, 403);
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, null);
  assert.equal(fixture.candidates('unknown').statusCode, 404);
  assert.equal(fixture.candidates('constructor').statusCode, 404);
});

test('live overtime is matched alongside future games while final and beyond-horizon games are not', async t => {
  const fixture = setup(t, [game('overtime', -8 * HOUR, { status: 'live' }), game('final', -HOUR, { status: 'final' }), game('boundary', 48 * HOUR), game('later', 48 * HOUR + 1)]);
  await fixture.run();
  await fixture.service.runMatching();
  assert.equal(fixture.candidates('overtime').body.state, 'complete');
  assert.equal(fixture.candidates('boundary').body.state, 'complete');
  assert.equal(fixture.candidates('final').body.state, 'pending');
  assert.equal(fixture.candidates('later').body.state, 'pending');
});

test('games shown as estimated live can be matched on the first manual run', async t => {
  const fixture = setup(t, [game('estimated-live', -3 * HOUR, { status: 'unknown' })]);
  await fixture.run();
  await fixture.service.runMatching();
  assert.equal(fixture.candidates('estimated-live').body.state, 'complete');
});

test('completed-empty matching is distinct from pending and stored candidates remain game-specific', async t => {
  const fixture = setup(t, [game('seattle'), game('unrelated', HOUR / 2, { teams: [
    { id: 'kc', name: 'Kansas City Chiefs', shortName: 'Kansas City', aliases: ['Chiefs'] },
    { id: 'den', name: 'Denver Broncos', shortName: 'Denver', aliases: ['Broncos'] },
  ] })]);
  await fixture.run();
  await fixture.service.runMatching();
  assert.equal(fixture.candidates('seattle').body.candidates.length, 3);
  assert.equal(fixture.candidates('unrelated').body.state, 'complete');
  assert.deepEqual(fixture.candidates('unrelated').body.candidates, []);
});

test('failed matching retains prior results and last success while new discoveries remain pending', async t => {
  const fixture = setup(t);
  await fixture.run();
  await fixture.service.runMatching();
  const before = fixture.candidates('visible').body;
  fixture.setTime(NOW + 60000);
  fixture.setGames([game('visible'), game('new')]);
  fixture.setCatalog(new Error('provider failed with private credentials'));
  await fixture.run();
  await fixture.service.runMatching();
  const retained = fixture.candidates('visible').body;
  assert.deepEqual(retained.candidates, before.candidates);
  assert.equal(retained.matchedAt, before.matchedAt);
  assert.equal(retained.stale, true);
  assert.equal(fixture.candidates('new').body.state, 'pending');
  assert.equal(fixture.candidates('new').body.stale, false);
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, '2026-10-28T20:00:00.000Z');
  assert.equal(JSON.stringify(fixture.service.getGames()).includes('private credentials'), false);
  const restarted = new GamesService({ store: fixture.store, source: {}, now: () => NOW + 60000 });
  assert.deepEqual(restarted.getGameMatching('visible'), retained);
});

test('status refreshes and browsing leave stored candidate evidence and freshness unchanged', async t => {
  const fixture = setup(t);
  await fixture.run();
  await fixture.service.runMatching();
  const before = fixture.candidates('visible').body;
  fixture.setCatalog([{ streamId: '41', name: 'Renamed unrelated feed' }]);
  fixture.setTime(NOW + 60000);
  await fixture.service.refreshStatus();
  fixture.service.getGames();
  assert.deepEqual(fixture.candidates('visible').body, before);
});

test('overlapping admin triggers share one provider scan and expose running state', async t => {
  const fixture = setup(t);
  let complete;
  let scans = 0;
  fixture.service.catalog = { async fetchCatalog() { scans += 1; return new Promise(resolve => { complete = resolve; }); } };
  await fixture.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.service.getMatchingStatus().running, true);
  assert.equal((await fixture.run()).body.matching.running, true);
  const done = fixture.service.runMatching();
  complete(catalog.map(channel => ({ categoryId: '1', ...channel })));
  await done;
  assert.equal(scans, 1);
  assert.equal(fixture.service.getMatchingStatus().running, false);
  assert.equal(fixture.candidates('visible').body.state, 'complete');
});

test('matching honors enabled leagues and preserves admin settings changed during a provider scan', async t => {
  const fixture = setup(t, [game('nfl'), game('cfb', HOUR / 2, { league: 'CFB' })]);
  const settings = { ...{ matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' }, enabledLeagues: ['CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 5 } };
  fixture.service.updateSettings(settings);
  let complete;
  fixture.service.catalog = { async fetchCatalog() { return new Promise(resolve => { complete = resolve; }); } };
  await fixture.run();
  await new Promise(resolve => setImmediate(resolve));
  const updated = { ...settings, broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 6 } };
  fixture.service.updateSettings(updated);
  const done = fixture.service.runMatching();
  complete(catalog.map(channel => ({ categoryId: '1', ...channel })));
  await done;
  assert.equal(fixture.candidates('nfl').body.state, 'pending');
  assert.equal(fixture.candidates('cfb').body.state, 'complete');
  assert.deepEqual(fixture.service.getSettings(), updated);
});

test('college matchup names reward both teams and football while single schools and conflicting sports remain weak', async t => {
  const fixture = setup(t, [game('college', HOUR / 2, { league: 'CFB', teams: [
    { id: 'mich', name: 'Michigan Wolverines', shortName: 'Michigan', abbreviation: 'MICH' },
    { id: 'osu', name: 'Ohio State Buckeyes', shortName: 'Ohio State', abbreviation: 'OSU' },
  ], broadcasts: [{ network: 'ESPN', region: 'US' }] })]);
  fixture.setCatalog([
    { streamId: '1', name: 'Michigan' }, { streamId: '2', name: 'Michigan vs Ohio State', category: 'CFB' },
    { streamId: '3', name: 'CFB Michigan vs Ohio State' }, { streamId: '4', name: 'Michigan vs Ohio State Volleyball' },
    { streamId: '5', name: 'US: ESPN HD' }, { streamId: '6', name: 'NCAA Michigan vs Ohio State', category: 'CFB' },
    { streamId: '7', name: 'NFL Michigan vs Ohio State' }, { streamId: '8', name: 'CFB Michigan vs Ohio State Replay' },
  ]);
  await fixture.run();
  await fixture.service.runMatching();
  const candidates = fixture.candidates('college').body.candidates;
  const score = id => candidates.find(candidate => candidate.sourceId === id).confidenceScore;
  assert.equal(score('3'), score('2')); // League category supplies the required football context.
  assert.equal(score('2'), score('6')); // NCAA alone does not identify the sport.
  assert.ok(score('2') > score('5'));
  for (const id of ['1', '4', '7']) assert.equal(candidates.some(candidate => candidate.sourceId === id), false);
  assert.ok(score('8') <= 5);
});

test('category allow-list defaults closed, filters before ranking, persists, and scopes IDs to the provider', async t => {
  const fixture = setup(t);
  const empty = new GamesService({ store: { load: () => ({}), save() {} }, source: {}, catalog: fixture.service.catalog });
  assert.deepEqual(empty.getCategoryPolicy(), { allowedCategoryIds: [] });
  fixture.service.updateCategoryPolicy([]);
  fixture.setCatalog([
    { streamId: '1', categoryId: '10', category: 'Football', name: 'NFL Seahawks vs Bills' },
    { streamId: '2', categoryId: '20', category: 'Other', name: 'NFL Seahawks vs Bills' },
    { streamId: '3', categoryId: '', name: 'NFL Seahawks vs Bills' },
  ]);
  await fixture.service.runMatching();
  assert.deepEqual(fixture.candidates('visible').body.candidates, []);
  fixture.service.updateCategoryPolicy(['10']);
  await fixture.service.runMatching();
  assert.deepEqual(fixture.candidates('visible').body.candidates.map(item => item.sourceId), ['1']);
  const restarted = new GamesService({ store: fixture.store, source: {}, now: () => NOW });
  assert.deepEqual(restarted.getCategoryPolicy().allowedCategoryIds, ['10']);
  assert.deepEqual(restarted.getGameMatching('visible').candidates.map(item => item.sourceId), ['1']);
  fixture.service.catalog.getGuideCacheKey = () => 'different-provider';
  assert.deepEqual(fixture.service.getCategoryPolicy().allowedCategoryIds, []);
  assert.deepEqual(fixture.candidates('visible').body.candidates, []);
});

test('admin history retains finished and upcoming matches for 48 hours with full evidence across restart', async t => {
  const fixture = setup(t);
  await fixture.service.runMatching();
  fixture.setGames([game('visible', 0, { status: 'final' }), game('tomorrow', 36 * HOUR)]);
  await fixture.service.refreshStatus();
  const history = fixture.service.getMatchingHistory();
  assert.deepEqual(history.matches.map(item => item.game.id), ['visible', 'tomorrow']);
  assert.equal(history.matches[0].game.status, 'final');
  assert.ok(history.matches[0].matching.candidates[0].evidence.length);
  const res = response(); await fixture.controller.list({}, res);
  assert.deepEqual(res.body.games, []);
  const restarted = new GamesService({ store: fixture.store, source: {}, now: () => NOW + 48 * HOUR });
  assert.equal(restarted.getMatchingHistory().matches.length, 2);
  restarted.now = () => NOW + 48 * HOUR + 1;
  assert.deepEqual(restarted.getMatchingHistory().matches, []);
});

test('category changes hide removed channels immediately and prevent in-flight results from publishing', async t => {
  const fixture = setup(t);
  await fixture.service.runMatching();
  const before = fixture.service.getMatchingHistory();
  let finish;
  fixture.service.catalog.fetchCatalog = () => new Promise(resolve => { finish = resolve; });
  const pending = fixture.service.runMatching();
  await new Promise(resolve => setImmediate(resolve));
  fixture.service.updateCategoryPolicy([]);
  finish(catalog.map(channel => ({ ...channel, categoryId: '1' })));
  await pending;
  assert.ok(fixture.service.getMatchingStatus().lastError);
  assert.deepEqual(fixture.candidates('visible').body.candidates, []);
  assert.deepEqual(fixture.service.getMatchingHistory().matches[0].matching.candidates, before.matches[0].matching.candidates);
});

test('history and category endpoints require admin access and validate allow-list updates', async t => {
  const fixture = setup(t);
  for (const method of ['history', 'categories', 'updateCategories']) {
    const res = response(); await fixture.controller[method]({ user: { role: 'viewer' } }, res);
    assert.equal(res.statusCode, 403);
  }
  for (const ids of [null, '1', [1], ['1', '1'], [''], ['bad']]) {
    const res = response(); fixture.controller.updateCategories({ user: { role: 'admin' }, body: { allowedCategoryIds: ids } }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await fixture.controller.categories({ user: { role: 'admin' } }, res);
  assert.deepEqual(res.body.categories, [{ id: '1', name: 'NFL', channelCount: 4 }]);
  const saved = response(); fixture.controller.updateCategories({ user: { role: 'admin' }, body: { allowedCategoryIds: [] } }, saved);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.allowedCategoryIds, []);
});
