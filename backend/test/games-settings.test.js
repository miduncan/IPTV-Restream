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
const automaticDefaults = { matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' };
const defaults = { ...automaticDefaults, enabledLeagues: ['NFL', 'CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 4 } };
function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function setup(t, source = { async fetchGames() { return { games: [], coverage: {} }; } }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-games-settings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new GamesStore({ filePath: path.join(directory, 'games.json') });
  const service = new GamesService({ source, store, now: () => NOW });
  const controller = createGamesController(service);
  return { source, store, service, controller, save(settings, role = 'admin') {
    const res = response(); controller.updateSettings({ user: { role }, body: { settings } }, res); return res;
  }, list() { return service.getGames({ sidebar: true }); } };
}
function game(id, league, status = 'unknown') {
  return { id, league, teams: [{ id: '1', name: 'Team One' }, { id: '2', name: 'Team Two' }], startsAt: new Date(NOW - 3 * HOUR).toISOString(), status, broadcasts: [] };
}

test('Games API exposes NFL/CFB defaults and admin settings persist independently across restart', async t => {
  const fixture = setup(t);
  assert.deepEqual(fixture.list().settings, defaults);
  const settings = { ...automaticDefaults, enabledLeagues: ['CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 3, CFB: 5 } };
  const saved = fixture.save(settings);
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.settings, settings);
  const restarted = createGamesController(new GamesService({ source: fixture.source, store: fixture.store, now: () => NOW }));
  const res = response(); await restarted.list({}, res);
  assert.deepEqual(res.body.settings, settings);
});

test('Games settings reject unauthorized reads/writes and invalid settings without changing shared values', t => {
  const fixture = setup(t);
  for (const role of ['viewer', null]) {
    const res = response(); fixture.controller.getSettings({ user: { role } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(fixture.save(defaults, role).statusCode, 403);
  }
  for (const settings of [null, [], {}, { ...defaults, enabledLeagues: ['NBA'] }, { ...defaults, enabledLeagues: ['NFL', 'NFL'] }, { ...defaults, enabledLeagues: 'NFL' }, { ...defaults, broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 0, CFB: 4 } }, { ...defaults, broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: '4', CFB: 4 } }, { ...defaults, broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: Infinity } }]) {
    assert.equal(fixture.save(settings).statusCode, 400);
    assert.deepEqual(fixture.list().settings, defaults);
  }
});

test('enabled leagues govern visible games and source scope; configured durations change estimates while live overtime overrides them', async t => {
  let scope;
  const source = { async fetchGames(options) { scope = options.leagues; return { games: [game('nfl-estimate', 'NFL'), game('cfb-estimate', 'CFB'), game('cfb-overtime', 'CFB', 'live')], coverage: {} }; } };
  const fixture = setup(t, source);
  await fixture.service.refreshStatus();
  assert.deepEqual(scope, ['NFL', 'CFB']);
  assert.deepEqual(fixture.list().games.map(item => item.id), ['nfl-estimate', 'cfb-estimate', 'cfb-overtime']);
  fixture.save({ ...automaticDefaults, enabledLeagues: ['CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 2.5 } });
  const response = fixture.list();
  assert.deepEqual(response.games.map(item => [item.id, item.group, item.statusEstimated]), [['cfb-overtime', 'live', false]]);
  await fixture.service.refreshStatus();
  assert.deepEqual(scope, ['CFB']);
  fixture.save({ ...automaticDefaults, enabledLeagues: [], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 4 } });
  assert.deepEqual(fixture.list().games, []);
});

test('recorded complete FBS slate flows through Games API with independent and FBS-FCS contests and stable deduplication', async t => {
  const EspnSportsSource = require('../services/games/EspnSportsSource');
  const recorded = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/sports', name)));
  const fixture = setup(t, new EspnSportsSource({ fetchJson: async url => {
    if (url.includes('/children?')) return recorded('fbs-groups.json');
    if (url.includes('/teams?')) return recorded('fbs-teams.json');
    if (url.includes('/nfl/')) return { events: [] };
    const group = new URL(url).searchParams.get('groups');
    const data = recorded(`cfb-${group}.json`);
    // Recorded matchup data with a current live-status observation at this clock.
    for (const event of data.events) event.status = { type: { state: 'in', detail: 'Live' } };
    return data;
  } }));
  fixture.service.now = () => Date.parse('2025-08-30T20:00:00Z');
  await fixture.service.refreshStatus();
  const games = fixture.list().games;
  assert.deepEqual(games.map(item => item.id.split(':')[2]).sort(), recorded('completeness-check.json').teamScheduleGameIds);
  assert.ok(games.find(item => item.id === 'espn:CFB:401757167')); // independent UConn against FCS opponent
  assert.ok(games.every(item => item.league === 'CFB' && item.group === 'live'));
});

test('saving settings while a sports refresh is pending survives the completed refresh and restart', async t => {
  let finish;
  const fixture = setup(t, { fetchGames: () => new Promise(resolve => { finish = resolve; }) });
  const pending = fixture.service.refreshStatus();
  const settings = { ...automaticDefaults, enabledLeagues: ['CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 2, CFB: 5 } };
  fixture.save(settings);
  finish({ games: [game('cfb', 'CFB')], coverage: {} });
  await pending;
  assert.deepEqual(fixture.list().settings, settings);
  const restarted = new GamesService({ source: fixture.source, store: fixture.store, now: () => NOW });
  assert.deepEqual(restarted.getGames().settings, settings);
  assert.equal(restarted.getGames().games[0].id, 'cfb');
});

test('saving the existing Xtream settings does not erase persisted Games settings', t => {
  const fixture = setup(t);
  process.env.SETTINGS_DB_PATH = path.join(path.dirname(fixture.store.filePath), 'settings.db');
  const generalSettings = require('../controllers/AdminSettingsController');
  const settings = { ...automaticDefaults, enabledLeagues: ['CFB'], broadcastRegions: ["US", "CA", "UK"], estimatedDurationHours: { NFL: 4, CFB: 6 } };
  assert.equal(fixture.save(settings).statusCode, 200);
  const res = response();
  generalSettings.replace({ body: { settings: { streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' } } }, res);
  assert.equal(res.statusCode, 200);
  const restarted = new GamesService({ source: fixture.source, store: fixture.store, now: () => NOW });
  assert.deepEqual(restarted.getGames().settings, settings);
});
