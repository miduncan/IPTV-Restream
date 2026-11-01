const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const { gzipSync } = require('node:zlib');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const game = { id: 'sea-buf', league: 'NFL', teams: [{ id: 'sea', name: 'Seattle Seahawks', aliases: ['Seahawks'] }, { id: 'buf', name: 'Buffalo Bills', aliases: ['Bills'] }], startsAt: '2026-10-28T20:30:00Z', status: 'scheduled', broadcasts: [] };
const xml = '<tv><channel id="football.us"><display-name>Sports</display-name></channel><programme channel="football.us" start="20261028133000 -0700" stop="20261028173000 -0700"><title>Seattle Seahawks vs Buffalo Bills</title></programme></tv>';
function response() { return { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
function setup(t, extra = {}, serviceOptions = {}) {
  let now = NOW;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-bulk-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let downloads = 0;
  const provider = {
    getGuideCacheKey: () => 'fixture-account',
    async fetchCatalog() { return Array.from({ length: 2000 }, (_, index) => ({ categoryId: '1', streamId: String(index + 1), name: 'Generic feed', epgChannelId: index < 2 ? 'football.us' : null })); },
    async fetchXmlTv() { downloads += 1; return (async function* () { yield Buffer.from(xml); })(); },
    async fetchScheduleEpg() { assert.fail('per-channel EPG must never be fetched'); },
    async fetchServerInfo() { assert.fail('XMLTV must not request a server clock'); },
    ...extra,
  };
  const service = new GamesService({ source: { async fetchGames() { return { games: [game], coverage: {} }; } }, store: new GamesStore({ filePath: path.join(directory, 'games.json') }), catalog: provider, now: () => now, ...serviceOptions });
  service.updateCategoryPolicy(['1']);
  t.after(() => service.cancelMatching());
  const controller = createGamesController(service);
  return { directory, service, provider, setTime: value => { now = value; }, downloads: () => downloads, async run() { const res = response(); controller.runMatching({ user: { role: 'admin' } }, res); assert.equal(res.statusCode, 202); await service.runMatching(); }, candidates() { const res = response(); controller.getCandidates({ params: { gameId: game.id } }, res); return res.body; } };
}
test('Games API matches a large catalog using one bulk XMLTV download and exact shared EPG IDs', async t => {
  const fixture = setup(t);
  await fixture.run();
  assert.equal(fixture.downloads(), 1);
  assert.deepEqual(fixture.candidates().candidates.map(candidate => candidate.sourceId), ['1', '2']);
  const evidence = fixture.candidates().candidates[0].evidence.find(item => item.kind === 'epg');
  assert.equal(evidence.start, '2026-10-28T20:30:00.000Z');
  assert.equal(evidence.end, '2026-10-29T00:30:00.000Z');
});


test('complete bulk guides are reused across matching runs and restart, with account and game-scope isolation', async t => {
  const fixture = setup(t);
  await fixture.run();
  await fixture.run();
  assert.equal(fixture.downloads(), 1);
  assert.equal(fixture.service.getMatchingStatus().guideCoverage.cached, true);
  assert.deepEqual(fixture.candidates().guideSnapshot, { fetchedAt: new Date(NOW).toISOString(), cached: true, stale: false });
  const restarted = new GamesService({ source: fixture.service.source, store: new GamesStore({ filePath: path.join(fixture.directory, 'games.json') }), catalog: fixture.provider, now: () => NOW });
  await restarted.runMatching();
  assert.equal(fixture.downloads(), 1);
  fixture.provider.getGuideCacheKey = () => 'different-account';
  fixture.service.updateCategoryPolicy(['1']);
  await fixture.run();
  assert.equal(fixture.downloads(), 2);
  fixture.service.source.fetchGames = async () => ({ games: [{ ...game, id: 'new-game' }], coverage: {} });
  await fixture.run();
  assert.equal(fixture.downloads(), 3);
});
test('admin cancellation aborts a bulk download, retains published results, and permits another run', async t => {
  const fixture = setup(t);
  await fixture.run();
  const previous = fixture.candidates();
  const success = fixture.service.getMatchingStatus().lastSuccessfulAt;
  fixture.setTime(NOW + 31 * 60000);
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  fixture.provider.fetchXmlTv = async run => (async function* () {
    reading();
    await run.wait(new Promise(() => {}));
    yield Buffer.from(xml);
  })();
  const active = fixture.service.runMatching();
  await started;
  const controller = createGamesController(fixture.service);
  const denied = response();
  controller.cancelMatching({ user: { role: 'viewer' } }, denied);
  assert.equal(denied.statusCode, 403);
  assert.equal(fixture.service.getMatchingStatus().running, true);
  const allowed = response();
  controller.cancelMatching({ user: { role: 'admin' } }, allowed);
  assert.equal(allowed.statusCode, 202);
  await active;
  assert.equal(fixture.service.getMatchingStatus().running, false);
  assert.equal(fixture.service.getMatchingStatus().progress.phase, 'cancelled');
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, success);
  assert.deepEqual(fixture.candidates().candidates, previous.candidates);
  fixture.provider.fetchXmlTv = async () => (async function* () { yield Buffer.from(xml); })();
  await fixture.run();
  assert.equal(fixture.service.getMatchingStatus().lastError, null);
});
test('XMLTV subtitles supply matchup evidence while gzip chunks and UTC timestamps remain usable', async t => {
  const body = gzipSync(Buffer.from('<tv><programme channel="football.us" start="20261028203000" stop="20261029003000"><title>NFL Football</title><sub-title>Seattle Seahawks vs Buffalo Bills</sub-title><desc>Live coverage &amp; analysis</desc></programme></tv>'));
  const fixture = setup(t, { async fetchXmlTv() { return (async function* () { for (let i = 0; i < body.length; i += 3) yield body.subarray(i, i + 3); })(); } });
  await fixture.run();
  assert.equal(fixture.candidates().candidates.length, 2);
  const evidence = fixture.candidates().candidates[0].evidence.find(item => item.kind === 'epg');
  assert.equal(evidence.title, 'NFL Football');
  assert.equal(evidence.start, '2026-10-28T20:30:00.000Z');
});
test('unavailable, malformed, oversized, and entity-bearing bulk responses never publish partial guides or fan out', async t => {
  const cases = [
    { body: xml.replace('</tv>', ''), limits: {} },
    { body: '<html>provider login</html>', limits: {} },
    { body: '<!DOCTYPE tv [<!ENTITY bad "Seattle Seahawks vs Buffalo Bills">]><tv/>', limits: {} },
    { body: xml, limits: { decodedBytes: 20 } },
    { body: xml, limits: { retainedRecords: 0 } },
    { body: '<?xml version="1.0" encoding="ISO-8859-1"?><tv/>', limits: {} },
  ];
  for (const item of cases) {
    const fixture = setup(t, { async fetchXmlTv() { return (async function* () { yield Buffer.from(item.body); })(); } }, { guideLimits: item.limits });
    await fixture.run();
    assert.deepEqual(fixture.candidates().candidates, []);
    assert.ok(fixture.service.getMatchingStatus().guideCoverage.limitations.some(value => /no per-channel requests/.test(value)));
  }
});
test('fresh cache fallback is labeled stale on guide failure; a failed later run without a valid cache preserves published results', async t => {
  const fixture = setup(t);
  await fixture.run();
  fixture.setTime(NOW + 31 * 60000);
  fixture.provider.fetchXmlTv = async () => { throw new Error('https://secret-provider.example/password'); };
  await fixture.run();
  assert.equal(fixture.service.getMatchingStatus().guideCoverage.stale, true);
  assert.deepEqual(fixture.candidates().guideSnapshot, { fetchedAt: new Date(NOW).toISOString(), cached: true, stale: true });
  assert.equal(fixture.candidates().candidates.length, 2);
  assert.equal(JSON.stringify(fixture.service.getGames()).includes('secret-provider'), false);
  const previous = fixture.candidates();
  const lastSuccess = fixture.service.getMatchingStatus().lastSuccessfulAt;
  fixture.provider.getGuideCacheKey = () => 'invalidated-cache';
  fixture.service.updateCategoryPolicy(['1']);
  await fixture.run();
  assert.deepEqual(fixture.candidates().candidates, previous.candidates);
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, lastSuccess);
  assert.match(fixture.service.getMatchingStatus().lastError, /previous results were retained/);
});
test('ambiguous duplicate XMLTV IDs and missing stop times produce no guessed guide evidence', async t => {
  const body = '<tv><channel id="football.us"><display-name>A</display-name></channel><channel id="football.us"><display-name>B</display-name></channel>' + xml.slice(4, -5) + '<programme channel="missing.us" start="20261028203000"><title>Seattle Seahawks vs Buffalo Bills</title></programme></tv>';
  const fixture = setup(t, { async fetchXmlTv() { return (async function* () { yield Buffer.from(body); })(); } });
  await fixture.run();
  assert.deepEqual(fixture.candidates().candidates, []);
  assert.equal(fixture.service.getMatchingStatus().guideCoverage.conflictedEpgIds, 1);
  assert.equal(fixture.service.getMatchingStatus().guideCoverage.discardedListings, 1);
});
test('bulk retention preserves a wrong matchup in the current window even when that known matchup is scheduled tomorrow', async t => {
  const wrong = xml.replace('Seattle Seahawks vs Buffalo Bills', 'Kansas City Chiefs vs Denver Broncos');
  const fixture = setup(t, { async fetchCatalog() { return [{ categoryId: '1', streamId: '1', name: 'Seattle Seahawks vs Buffalo Bills', category: 'NFL', epgChannelId: 'football.us' }]; }, async fetchXmlTv() { return (async function* () { yield Buffer.from(wrong); })(); } });
  fixture.service.source.fetchGames = async () => ({ games: [game, { ...game, id: 'kc-den', startsAt: '2026-10-29T20:30:00Z', teams: [{ id: 'kc', name: 'Kansas City Chiefs' }, { id: 'den', name: 'Denver Broncos' }] }], coverage: {} });
  await fixture.run();
  assert.ok(fixture.candidates().candidates[0].evidence.some(item => item.kind === 'contradiction'));
});
test('changing provider identity during a download cannot publish mixed-account results or poison the original cache', async t => {
  const fixture = setup(t);
  let account = 'original';
  fixture.provider.getGuideCacheKey = () => account;
  fixture.service.updateCategoryPolicy(['1']);
  await fixture.run();
  const previous = fixture.candidates();
  const success = fixture.service.getMatchingStatus().lastSuccessfulAt;
  fixture.setTime(NOW + 31 * 60000);
  fixture.provider.fetchXmlTv = async () => (async function* () { account = 'different'; yield Buffer.from(xml.replace('Buffalo Bills', 'Kansas City Chiefs')); })();
  await fixture.run();
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, success);
  assert.deepEqual(fixture.candidates().candidates, []); // The active provider has no allow-list.
  account = 'original';
  fixture.provider.fetchXmlTv = async () => { throw new Error('Unavailable'); };
  await fixture.run();
  assert.deepEqual(fixture.candidates().candidates, previous.candidates);
});
test('an oversized bulk response cancels its unread body instead of draining the remaining download', async t => {
  let cancelled = false;
  const fixture = setup(t, { async fetchXmlTv() { return new ReadableStream({ start(controller) { controller.enqueue(Buffer.from(xml)); }, pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }); } }, { guideLimits: { decodedBytes: 20 } });
  await fixture.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
  assert.deepEqual(fixture.candidates().candidates, []);
});
