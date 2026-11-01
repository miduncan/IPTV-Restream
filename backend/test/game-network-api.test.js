const { body, catalogIds } = require('../test-support/xmltv');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { networkIdentity } = require('../services/games/BroadcastIdentity');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const HOUR = 3600000;
const teams = [{ id: 'sea', name: 'Seattle Seahawks', shortName: 'Seattle', abbreviation: 'SEA', aliases: ['Seahawks'] }, { id: 'buf', name: 'Buffalo Bills', shortName: 'Buffalo', abbreviation: 'BUF', aliases: ['Bills'] }];
const game = (id, network, extra = {}) => ({ id, league: 'NFL', teams, startsAt: new Date(NOW + HOUR / 2).toISOString(), status: 'scheduled', broadcasts: [{ network, region: 'US' }], ...extra });
const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
function setup(t, games, channels) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-network-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let scope;
  const source = { async fetchGames(options) { scope = options; return { games, coverage: { broadcastRegions: { US: 'available', CA: 'unverified', UK: 'unverified' }, limitations: ['Canadian and UK broadcast assignments are unverified.'] } }; } };
  const store = new GamesStore({ filePath: path.join(directory, 'games.json') });
  const service = new GamesService({ source, store, catalog: { async fetchCatalog() { return catalogIds(channels.map(channel => ({ category: networkIdentity(channel.name) || 'NFL', ...channel }))); } }, now: () => NOW });
  service.updateCategoryPolicy(['1']);
  const controller = createGamesController(service);
  return { service, controller, store, scope: () => scope, async run() { const res = response(); controller.runMatching({ user: { role: 'admin' } }, res); await service.runMatching(); },
    candidates(id) { const res = response(); controller.getCandidates({ params: { gameId: id } }, res); return res.body.candidates; },
    save(settings, role = 'admin') { const res = response(); controller.updateSettings({ user: { role }, body: { settings } }, res); return res; },
  };
}

test('network-only Games candidates keep ESPN, ESPN2 and ESPN+ distinct', async t => {
  const fixture = setup(t, [game('espn', 'ESPN'), game('espn2', 'ESPN2'), game('plus', 'ESPN+')], [
    { streamId: '1', name: 'US: ESPN HD' }, { streamId: '2', name: 'US: ESPN 2 FHD' }, { streamId: '3', name: 'US: ESPN+ 4K' },
  ]);
  await fixture.run();
  assert.deepEqual(fixture.candidates('espn').map(candidate => candidate.sourceId), ['1']);
  assert.deepEqual(fixture.candidates('espn2').map(candidate => candidate.sourceId), ['2']);
  assert.deepEqual(fixture.candidates('plus').map(candidate => candidate.sourceId), ['3']);
  assert.equal(fixture.candidates('plus')[0].evidence[0].kind, 'broadcast-network');
});

for (const { brand, region, prefix, suffix } of [
  { brand: 'ESPN', region: 'US', prefix: 'US:', suffix: 2 },
  { brand: 'TSN', region: 'CA', prefix: 'CA EN:', suffix: 1 },
]) {
  test(`${brand} uses shared network matching for exact identities, numbered services, and quality labels`, async t => {
    const event = (id, network) => game(id, network, { broadcasts: [{ network, region }] });
    const fixture = setup(t, [event('base', brand), event('numbered', `${brand}${suffix}`)], [
      { streamId: '1', name: `${prefix} ${brand} HD` },
      { streamId: '2', name: `${prefix} ${brand}${suffix} FHD` },
      { streamId: '3', name: `${prefix} ${brand} ${suffix} ᴿᴬᵂ` },
      { streamId: '4', name: `${prefix} ${brand} Mystery HD`, category: brand },
      { streamId: '5', name: `${prefix} ${brand} 9 HD`, category: brand },
    ]);
    await fixture.run();
    assert.deepEqual(fixture.candidates('base').map(candidate => candidate.sourceId), ['1']);
    assert.deepEqual(fixture.candidates('numbered').map(candidate => candidate.sourceId).sort(), ['2', '3']);
    assert.ok(fixture.candidates('numbered').every(candidate => candidate.scorer === 'cable'));
  });
}

test('admin broadcast regions persist, guide source discovery, and migrate older snapshots', async t => {
  const fixture = setup(t, [game('game', 'ESPN')], []);
  assert.deepEqual(fixture.service.getGames().settings.broadcastRegions, ['US', 'CA', 'UK']);
  const settings = { ...fixture.service.getSettings(), broadcastRegions: ['US', 'AU'] };
  assert.equal(fixture.save(settings, 'viewer').statusCode, 403);
  assert.equal(fixture.save(settings).statusCode, 200);
  await fixture.service.refreshStatus();
  assert.deepEqual(fixture.scope().regions, ['US', 'AU']);
  assert.equal(fixture.service.getMatchingStatus().lastSuccessfulAt, null);
  const restarted = new GamesService({ source: {}, store: fixture.store, now: () => NOW });
  assert.deepEqual(restarted.getSettings().broadcastRegions, ['US', 'AU']);
  fixture.store.save({ settings: { enabledLeagues: ['NFL'], estimatedDurationHours: { NFL: 3, CFB: 5 } } });
  const migrated = createGamesController(new GamesService({ source: {}, store: fixture.store, now: () => NOW }));
  const res = response(); migrated.getSettings({ user: { role: 'admin' } }, res);
  assert.deepEqual(res.body.settings, { ...{ matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' }, enabledLeagues: ['NFL'], estimatedDurationHours: { NFL: 3, CFB: 5 }, broadcastRegions: ['US', 'CA', 'UK'] });
});

test('invalid broadcast region updates are rejected without changing prior shared settings', t => {
  const fixture = setup(t, [], []);
  const settings = fixture.service.getSettings();
  for (const regions of [null, 'US', ['US', 'US'], ['us'], ['USA!'], [123]]) {
    assert.equal(fixture.save({ ...settings, broadcastRegions: regions }).statusCode, 400);
    assert.deepEqual(fixture.service.getSettings(), settings);
  }
});

test('overlapping regional network assignments reduce confidence and retain uncertainty evidence', async t => {
  const channels = [{ streamId: '1', name: 'US: FOX Seattle HD' }, { streamId: '2', name: 'US: FOX Football Seahawks vs Bills', category: 'FOX' }];
  const single = setup(t, [game('first', 'Fox')], channels);
  await single.run();
  const multiple = setup(t, [game('first', 'Fox'), game('other', 'FOX', { teams: [{ id: 'kc', name: 'Kansas City Chiefs' }, { id: 'den', name: 'Denver Broncos' }] })], channels);
  await multiple.run();
  const networkOnly = multiple.candidates('first').find(candidate => candidate.sourceId === '1');
  assert.ok(networkOnly.confidenceScore < single.candidates('first').find(candidate => candidate.sourceId === '1').confidenceScore);
  const assignment = networkOnly.evidence.find(item => item.kind === 'broadcast-network');
  assert.equal(assignment.regionalUncertainty, true);
  assert.equal(assignment.possibleGames, 2);
  const direct = multiple.candidates('first').find(candidate => candidate.sourceId === '2');
  assert.ok(direct.confidenceScore > networkOnly.confidenceScore);
  assert.deepEqual(direct.evidence.map(item => item.kind), ['channel-name', 'sport', 'broadcast-network', 'scorer']);
});

test('region controls exclude unsupported network assignments while direct foreign matchup matches remain eligible', async t => {
  const fixture = setup(t, [game('game', 'ESPN')], [{ streamId: '1', name: 'US: ESPN HD' }, { streamId: '2', name: 'DE: Seahawks vs Bills' }, { streamId: '3', name: 'CA: ESPN HD' }]);
  fixture.save({ ...fixture.service.getSettings(), broadcastRegions: ['CA'] });
  await fixture.run();
  assert.deepEqual(fixture.candidates('game').map(candidate => candidate.sourceId), ['2']);
  assert.deepEqual(fixture.service.getGames().coverage.broadcastRegions, { US: 'available', CA: 'unverified', UK: 'unverified' });
  const unqualified = setup(t, [game('missing-region', 'ESPN', { broadcasts: [{ network: 'ESPN' }] })], [{ streamId: '1', name: 'US: ESPN HD' }]);
  await unqualified.run();
  assert.deepEqual(unqualified.candidates('missing-region'), []);
});

test('a future game on the same network outside the time overlap does not increase regional uncertainty', async t => {
  const channels = [{ streamId: '1', name: 'US: ESPN HD' }];
  const fixture = setup(t, [game('first', 'ESPN'), game('later', 'ESPN', { startsAt: new Date(NOW + 10 * HOUR).toISOString() })], channels);
  await fixture.run();
  assert.equal(fixture.candidates('first')[0].evidence[0].possibleGames, 1);
});

test('EPG stays below network and matchup names while conflicts weakly penalize selectable candidates', async t => {
  const fixture = setup(t, [game('first', 'ESPN'), game('other', 'ESPN', { teams: [{ id: 'kc', name: 'Kansas City Chiefs' }, { id: 'den', name: 'Denver Broncos' }] })], [
    { streamId: '1', name: 'US: ESPN HD' }, { streamId: '2', name: 'Event feed' },
    { streamId: '3', name: 'US: ESPN Seahawks vs Bills' }, { streamId: '4', name: 'US: ESPN Seahawks vs Bills' },
    { streamId: '5', name: 'US: ESPN SEA' },
  ]);
  const listing = title => [{ title, start_timestamp: (NOW + HOUR / 2) / 1000, stop_timestamp: (NOW + 4 * HOUR) / 1000 }];
  fixture.service.catalog.fetchXmlTv = async () => body({ '2': listing('Seattle Seahawks vs Buffalo Bills'), '3': listing('Kansas City Chiefs vs Denver Broncos'), '5': listing('Kansas City Chiefs vs Denver Broncos') });
  await fixture.run();
  const candidates = fixture.candidates('first');
  const score = id => candidates.find(candidate => candidate.sourceId === id).confidenceScore;
  assert.ok(score('2') < score('1'));
  assert.ok(score('2') < score('4'));
  assert.ok(score('3') < score('4'));
  assert.ok(candidates.find(candidate => candidate.sourceId === '3').evidence.some(item => item.kind === 'contradiction'));
  assert.ok(candidates.find(candidate => candidate.sourceId === '1').evidence.some(item => item.kind === 'broadcast-network'));
  const rawScore = id => { const candidate = candidates.find(item => item.sourceId === id); return candidate.rawScores[candidate.scorer]; };
  assert.ok(rawScore('4') - rawScore('3') <= 10);
  assert.ok(score('5') >= 1);
});

test('network assignments exclude unknown ESPN variants and CBS Sports from their parent channels', async t => {
  const fixture = setup(t, [game('espn', 'ESPN'), game('cbs', 'CBS'), game('sports', 'CBS Sports Network')], [
    { streamId: '1', name: 'US: ESPN 4K' }, { streamId: '2', name: 'US: ESPN 4' },
    { streamId: '3', name: 'US: ESPN PPV HD' }, { streamId: '4', name: 'US: ESPN U FHD' },
    { streamId: '5', name: 'US: ESPN Mystery HD' }, { streamId: '6', name: 'US: CBS Seattle HD' },
    { streamId: '7', name: 'US: CBS Sports HD' }, { streamId: '8', name: 'US: CBSSN FHD' },
    { streamId: '9', name: 'US: CBS Sports HQ KIRO' },
    { streamId: '10', name: 'US: CBSSN KIRO HD' }, { streamId: '11', name: 'US: ESPN 4 KIRO HD' },
    { streamId: '12', name: 'US: CBS | Sports HD' },
  ]);
  await fixture.run();
  assert.deepEqual(fixture.candidates('espn').map(item => item.sourceId), ['1']);
  assert.deepEqual(fixture.candidates('cbs').map(item => item.sourceId), ['6']);
  assert.deepEqual(fixture.candidates('sports').map(item => item.sourceId).sort(), ['12', '7', '8']);
});


test('decorative non-ASCII labels are ignored while standard channel suffixes retain their meaning', async t => {
  const fixture = setup(t, [game('espn', 'ESPN'), game('espn2', 'ESPN2'), game('plus', 'ESPN+')], [
    { streamId: '1', name: 'US: ESPN ᴿᴬᵂ' },
    { streamId: '2', name: 'US: ESPN ⁶⁰ ᶠᵖˢ' },
    { streamId: '3', name: 'US: ESPN2' },
    { streamId: '4', name: 'US: ESPN 2' },
    { streamId: '5', name: 'US: ESPN 2 ᴿᴬᵂ' },
    { streamId: '6', name: 'US: ESPN+ ᴿᴬᵂ' },
    { streamId: '7', name: 'US: ESPN Mystery ᴿᴬᵂ', category: 'ESPN' },
    { streamId: '8', name: 'US: ESPN RAW', category: 'ESPN' },
    { streamId: '9', name: 'US: ESPN 60 FPS' },
  ]);
  await fixture.run();
  assert.deepEqual(fixture.candidates('espn').map(item => item.sourceId).sort(), ['1', '2', '9']);
  assert.deepEqual(fixture.candidates('espn2').map(item => item.sourceId).sort(), ['3', '4', '5']);
  assert.equal(new Set(fixture.candidates('espn2').map(item => item.confidenceScore)).size, 1);
  assert.deepEqual(fixture.candidates('plus').map(item => item.sourceId), ['6']);
});
