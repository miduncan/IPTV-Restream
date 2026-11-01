const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-bulk-http-'));
process.env.SETTINGS_DB_PATH = path.join(directory, 'settings.db');
const settings = require('../services/settings/SettingsService');
const provider = require('../services/XtreamService');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const game = { id: 'game', league: 'NFL', teams: [{ id: 'sea', name: 'Seattle Seahawks' }, { id: 'buf', name: 'Buffalo Bills' }], startsAt: '2026-10-28T20:30:00Z', status: 'scheduled', broadcasts: [] };
const xml = '<tv><programme channel="event.us" start="20261028203000 +0000" stop="20261029003000 +0000"><title>Seattle Seahawks vs Buffalo Bills</title></programme></tv>';
function setup(t, options = {}) {
  settings.replace({ streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: 'https://provider.example', xtreamUsername: 'fixture-user', xtreamPassword: 'fixture-secret' });
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const requests = [];
  global.fetch = async (value, init) => {
    const url = new URL(value);
    requests.push(url.pathname + ':' + (url.searchParams.get('action') || 'xmltv'));
    assert.equal(init.redirect, 'manual');
    if (url.searchParams.get('action') === 'get_live_streams') return Response.json(Array.from({ length: 2000 }, (_, index) => ({ category_id: '1', stream_id: index + 1, name: 'Generic', epg_channel_id: index < 2 ? 'event.us' : null })));
    if (url.searchParams.get('action') === 'get_live_categories') return Response.json([]);
    assert.equal(url.searchParams.has('stream_id'), false);
    return options.redirect ? new Response(null, { status: 302, headers: { Location: '/redirected-guide.xml' } }) : new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
  };
  const service = new GamesService({ source: { async fetchGames() { return { games: [game], coverage: {} }; } }, store: new GamesStore({ filePath: path.join(directory, `games-${Math.random()}.json`) }), catalog: provider, now: () => NOW, ...options.service });
  service.updateCategoryPolicy(['1']);
  const controller = createGamesController(service);
  return { service, requests, async run() { controller.runMatching({ user: { role: 'admin' } }, { status() { return this; }, json() {} }); await service.runMatching(); } };
}
test('actual provider transport uses three HTTP requests for 2,000 catalog channels, then two with cached XMLTV', async t => {
  const fixture = setup(t);
  await fixture.run();
  assert.equal(fixture.requests.length, 3);
  assert.equal(fixture.service.getMatchingStatus().progress.requestsUsed, 3);
  assert.equal(fixture.service.getGameMatching(game.id).candidates.length, 2);
  await fixture.run();
  assert.equal(fixture.requests.length, 5);
  assert.equal(fixture.service.getMatchingStatus().progress.requestsUsed, 2);
});
test('redirected bulk guide requests consume the same hard budget and cannot start per-stream fallback', async t => {
  const fixture = setup(t, { redirect: true, service: { requestBudget: 3 } });
  await fixture.run();
  assert.equal(fixture.requests.length, 3);
  assert.equal(fixture.service.getMatchingStatus().progress.requestsUsed, 3);
  assert.equal(fixture.service.getMatchingStatus().progress.requestBudget, 3);
  assert.equal(fixture.requests.some(value => /get_simple_data_table|get_short_epg/.test(value)), false);
  assert.ok(fixture.service.getMatchingStatus().guideCoverage.limitations.some(value => /no per-channel requests/.test(value)));
});
test('an empty matching window does not require configured provider credentials or make HTTP requests', async t => {
  const fixture = setup(t);
  settings.replace({ streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' });
  fixture.service.source.fetchGames = async () => ({ games: [], coverage: {} });
  await fixture.run();
  assert.equal(fixture.requests.length, 0);
  assert.equal(fixture.service.getMatchingStatus().lastError, null);
});
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
