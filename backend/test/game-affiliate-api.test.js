const { body, catalogIds } = require('../test-support/xmltv');
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { networkIdentity } = require('../services/games/BroadcastIdentity');
const { recognizeAffiliate } = require('../services/games/NflAffiliateEvidence');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const HOUR = 3600000;
const teams = [{ id: 'sea', name: 'Seattle Seahawks', shortName: 'Seattle', aliases: ['Seahawks'] }, { id: 'buf', name: 'Buffalo Bills', shortName: 'Buffalo', aliases: ['Bills'] }];
const game = (id = 'game', extra = {}) => ({ id, league: 'NFL', teams, startsAt: new Date(NOW + HOUR / 2).toISOString(), status: 'scheduled', broadcasts: [{ network: 'FOX', region: 'US' }], ...extra });
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function setup(t, channels, games = [game()]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-affiliate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const provider = { async fetchCatalog() { return catalogIds(channels.map(channel => ({ category: networkIdentity(channel.name) || recognizeAffiliate(channel)?.network || 'NFL', ...channel }))); } };
  const service = new GamesService({ source: { async fetchGames() { return { games, coverage: {} }; } }, catalog: provider,
    store: new GamesStore({ filePath: path.join(directory, 'games.json') }), now: () => NOW });
  service.updateCategoryPolicy(['1']);
  const controller = createGamesController(service);
  return { service, provider, async run() { controller.runMatching({ user: { role: 'admin' } }, response()); await service.runMatching(); },
    candidates(id = 'game') { const res = response(); controller.getCandidates({ params: { gameId: id } }, res); return res.body.candidates; } };
}

test('NFL affiliates require a participating market and exclude unrelated and unknown stations', async t => {
  const fixture = setup(t, [{ streamId: '1', name: 'US: FOX KCPQ HD' }, { streamId: '2', name: 'US: FOX WUTV HD' }, { streamId: '3', name: 'US: FOX KTVU HD' }, { streamId: '4', name: 'US: FOX WXYZ HD' }]);
  await fixture.run();
  const candidates = fixture.candidates();
  const score = id => candidates.find(candidate => candidate.sourceId === id).confidenceScore;
  assert.deepEqual(new Set(candidates.map(item => item.sourceId)), new Set(['1', '2']));
  assert.ok(score('1') > 0);
  assert.ok(score('2') > 0);
  const home = candidates.find(candidate => candidate.sourceId === '1').evidence.find(item => item.kind === 'affiliate-market');
  const away = candidates.find(candidate => candidate.sourceId === '2').evidence.find(item => item.kind === 'affiliate-market');
  assert.equal(home.market, 'Seattle/Tacoma');
  assert.equal(away.market, 'Buffalo');
  assert.equal(home.heuristic, true);
  assert.match(home.description, /carriage is unverified/);
  assert.ok(home.sourceUrl.startsWith('https://support.fubo.tv/'));
  assert.equal(candidates[0].evidence.find(item => item.kind === 'broadcast-network').regionalUncertainty, true);
});

test('only unambiguous US primary callsigns infer networks; unsupported subchannels and conflicting labels receive no boost', async t => {
  const fixture = setup(t, [
    { streamId: '1', name: 'US: KCPQ-TV HD' }, { streamId: '2', name: 'US: FOX KCPQ 13.2' },
    { streamId: '3', name: 'US: CBS KCPQ' }, { streamId: '4', name: 'US: FOX KCPQ KTVU' },
    { streamId: '5', name: 'CA: FOX KCPQ' }, { streamId: '6', name: 'UK: FOX WUTV' },
    { streamId: '7', name: 'US: FOX WXYZ' }, { streamId: '8', name: 'US: KIRO Telemundo' },
    { streamId: '9', name: 'US: KCPQ-HD' }, { streamId: '10', name: 'US: FOX KCPQ-DT2' },
    { streamId: '11', name: 'US: KIRO HD' }, { streamId: '12', name: 'CA: FOX KCPQ', region: 'US' },
  ], [game(), game('cbs', { broadcasts: [{ network: 'CBS', region: 'US' }] })]);
  await fixture.run();
  const hasBoost = candidate => candidate.evidence.some(item => item.kind === 'affiliate-market');
  const fox = fixture.candidates();
  assert.ok(fox.find(candidate => candidate.sourceId === '1').evidence.some(item => item.kind === 'broadcast-network' && item.network === 'FOX'));
  assert.ok(hasBoost(fox.find(candidate => candidate.sourceId === '1')));
  assert.ok(hasBoost(fox.find(candidate => candidate.sourceId === '9')));
  assert.ok(fox.filter(candidate => !['1', '9'].includes(candidate.sourceId)).every(candidate => !hasBoost(candidate)));
  const cbs = fixture.candidates('cbs');
  assert.ok(hasBoost(cbs.find(candidate => candidate.sourceId === '11')));
  assert.equal(cbs.some(candidate => candidate.sourceId === '8'), false);
});

test('CFB, unknown team identities and international direct feeds retain other evidence without NFL market boosts', async t => {
  const fixture = setup(t, [{ streamId: '1', name: 'US: FOX KCPQ' }, { streamId: '2', name: 'CA: KCPQ Seahawks vs Bills' }, { streamId: '3', name: 'UK: WUTV Seahawks vs Bills' }], [
    game('college', { league: 'CFB' }), game('unknown', { teams: [{ id: 'unknown', name: 'Seattle', abbreviation: 'SEA' }, { id: 'other', name: 'Unrecognized team' }] }), game(),
  ]);
  await fixture.run();
  assert.deepEqual(fixture.candidates('college'), []); // No venue or college market establishes location.
  assert.ok(fixture.candidates('college').every(candidate => !candidate.evidence.some(item => item.kind === 'affiliate-market')));
  assert.deepEqual(fixture.candidates('unknown'), []);
  const foreign = fixture.candidates().filter(candidate => ['2', '3'].includes(candidate.sourceId));
  assert.equal(foreign.length, 2);
  assert.ok(foreign.every(candidate => candidate.evidence.some(item => item.kind === 'channel-name')));
  assert.ok(foreign.every(candidate => !candidate.evidence.some(item => item.kind === 'affiliate-market')));
});

test('source-backed non-city team markets use club identity rather than stadium geography', async t => {
  const fixture = setup(t, [{ streamId: '1', name: 'US: FOX KSAZ' }, { streamId: '2', name: 'US: FOX WFXT' }, { streamId: '3', name: 'US: FOX KCPQ' }], [
    game('game', { teams: [{ id: 'ari', name: 'Arizona Cardinals' }, { id: 'ne', name: 'New England Patriots' }] }),
  ]);
  await fixture.run();
  const candidates = fixture.candidates();
  assert.equal(candidates.some(item => item.sourceId === '3'), false);
  for (const id of ['1', '2']) {
    const candidate = candidates.find(item => item.sourceId === id);
    assert.ok(candidate.scores.local > 0);
    assert.ok(candidate.evidence.find(item => item.kind === 'affiliate-market').teamSourceUrls.length >= 2);
  }
});

test('current CBS Atlanta evidence recognizes WUPA without assigning geography to old or unknown callsigns', async t => {
  const fixture = setup(t, [{ streamId: '1', name: 'US: WUPA HD' }, { streamId: '2', name: 'US: CBS WANF' }, { streamId: '3', name: 'US: CBS WGCL' }], [
    game('game', { teams: [{ id: 'atl', name: 'Atlanta Falcons' }, { id: 'buf', name: 'Buffalo Bills' }], broadcasts: [{ network: 'CBS', region: 'US' }] }),
  ]);
  await fixture.run();
  const candidates = fixture.candidates();
  assert.equal(candidates[0].sourceId, '1');
  assert.equal(candidates[0].evidence.find(item => item.kind === 'affiliate-market').callsign, 'WUPA');
  assert.ok(candidates.slice(1).every(candidate => !candidate.evidence.some(item => item.kind === 'affiliate-market')));
});

test('affiliate assignments outrank low-weight EPG while conflicts still lower named feeds', async t => {
  const fixture = setup(t, [{ streamId: '1', name: 'US: FOX KCPQ' }, { streamId: '2', name: 'Generic event feed' },
    { streamId: '3', name: 'US: FOX KCPQ Seahawks vs Bills' }, { streamId: '4', name: 'US: FOX KCPQ Seahawks vs Bills' }], [
    game(), game('other', { teams: [{ id: 'kc', name: 'Kansas City Chiefs' }, { id: 'den', name: 'Denver Broncos' }] }),
  ]);
  const listing = title => [{ title, start_timestamp: (NOW + HOUR / 2) / 1000, stop_timestamp: (NOW + 4 * HOUR) / 1000 }];
  fixture.provider.fetchXmlTv = async () => body({ '2': listing('Seattle Seahawks vs Buffalo Bills'), '3': listing('Kansas City Chiefs vs Denver Broncos') });
  await fixture.run();
  const candidates = fixture.candidates();
  const score = id => candidates.find(candidate => candidate.sourceId === id).confidenceScore;
  assert.ok(score('2') < score('1'));
  assert.ok(score('2') < score('4'));
  assert.ok(score('3') < score('4'));
  const conflict = candidates.find(candidate => candidate.sourceId === '3');
  assert.ok(conflict.evidence.some(item => item.kind === 'affiliate-market'));
  assert.ok(conflict.evidence.some(item => item.kind === 'contradiction'));
});

test('expanded Sacramento directory qualifies all five local networks by callsign and rejects number-only feeds', async t => {
  const stations = [['CBS', 'KOVR', 13, 'KPIX'], ['NBC', 'KCRA', 3, 'KNTV'], ['ABC', 'KXTV', 10, 'KGO'],
    ['FOX', 'KTXL', 40, 'KTVU'], ['The CW', 'KQCA', 58, 'KRON']];
  const games = stations.map(([network], index) => game(`sac-${index}`, { league: 'CFB', venue: { city: 'Sacramento' },
    teams: [{ id: 'davis', name: 'UC Davis Aggies' }, { id: 'sac', name: 'Sacramento State Hornets' }], broadcasts: [{ network, region: 'US' }] }));
  const channels = stations.flatMap(([network, callsign, number, distant], index) => [
    { streamId: `${index + 1}1`, name: `US: ${callsign} HD`, category: network },
    { streamId: `${index + 1}2`, name: `US: ${network} ${number} HD`, category: network },
    { streamId: `${index + 1}3`, name: `US: ${network} HD`, category: network },
    { streamId: `${index + 1}4`, name: `US: ${distant} HD`, category: network },
  ]);
  const fixture = setup(t, channels, games);
  await fixture.run();
  for (const [index, [network, callsign]] of stations.entries()) {
    const results = fixture.candidates(`sac-${index}`);
    const candidate = suffix => results.find(item => item.sourceId === `${index + 1}${suffix}`);
    assert.ok(candidate('1').scores.local > 0, callsign);
    assert.equal(candidate('2'), undefined, `${network} number alone establishes no area`);
    assert.equal(candidate('3'), undefined, 'a network-only feed has no local support');
    assert.equal(candidate('4'), undefined, 'a station in another market has no local support');
    assert.ok(candidate('1').evidence.some(item => item.kind === 'local-location' && item.sourceUrls.length));
  }
});

test('expanded station market aliases join NFL teams consistently across ABC CBS NBC FOX and CW', async t => {
  const networks = [['ABC', 'KGO'], ['CBS', 'KPIX'], ['NBC', 'KNTV'], ['FOX', 'KTVU'], ['The CW', 'KRON']];
  const games = networks.map(([network], index) => game(`sf-${index}`, { teams: [{ id: 'sf', name: 'San Francisco 49ers' }, ...teams.slice(0, 1)],
    broadcasts: [{ network, region: 'US' }] }));
  const fixture = setup(t, networks.map(([network, callsign], index) => ({ streamId: String(index + 1), name: `US: ${callsign} HD`, category: network })), games);
  await fixture.run();
  for (const [index, [network, callsign]] of networks.entries()) {
    const candidate = fixture.candidates(`sf-${index}`).find(item => item.sourceId === String(index + 1));
    assert.ok(candidate, network);
    assert.ok(candidate.evidence.some(item => item.kind === 'affiliate-market' && item.callsign === callsign && item.teams.some(team => team.id === 'sf')), network);
  }
});

test('ambiguous callsigns require a service label while WSVN preserves its verified FOX primary', async t => {
  const fixture = setup(t, [
    { streamId: '1', name: 'US: WLOX HD', category: 'CBS' },
    { streamId: '2', name: 'US: CBS WLOX HD', category: 'CBS' },
    { streamId: '3', name: 'US: ABC WLOX HD', category: 'ABC' },
    { streamId: '4', name: 'US: WSVN HD', category: 'FOX' },
    { streamId: '5', name: 'US: ABC WSVN HD', category: 'ABC' },
    { streamId: '6', name: 'US: ABC 7 HD', category: 'ABC' },
    { streamId: '7', name: 'US: FOX 7 HD', category: 'FOX' },
  ], [
    game('biloxi-cbs', { league: 'CFB', venue: { city: 'Biloxi' }, broadcasts: [{ network: 'CBS', region: 'US' }] }),
    game('biloxi-abc', { league: 'CFB', venue: { city: 'Biloxi' }, broadcasts: [{ network: 'ABC', region: 'US' }] }),
    game('miami-fox', { league: 'CFB', venue: { city: 'Miami' }, broadcasts: [{ network: 'FOX', region: 'US' }] }),
    game('miami-abc', { league: 'CFB', venue: { city: 'Miami' }, broadcasts: [{ network: 'ABC', region: 'US' }] }),
  ]);
  await fixture.run();
  const location = candidate => candidate.evidence.some(item => item.kind === 'local-location');
  const biloxi = fixture.candidates('biloxi-cbs');
  assert.equal(biloxi.some(item => item.sourceId === '1'), false);
  assert.equal(location(biloxi.find(item => item.sourceId === '2')), true);
  assert.equal(location(fixture.candidates('biloxi-abc').find(item => item.sourceId === '3')), true);
  assert.equal(location(fixture.candidates('miami-fox').find(item => item.sourceId === '4')), true);
  assert.equal(fixture.candidates('miami-fox').some(item => item.sourceId === '7'), false);
  const abc = fixture.candidates('miami-abc');
  assert.equal(location(abc.find(item => item.sourceId === '5')), true);
  assert.equal(abc.some(item => item.sourceId === '6'), false); // A number alone cannot establish an area.
  assert.equal(abc.some(item => item.sourceId === '4'), false);
});

test('station numbers earn no local points and do not increase city or callsign scores', async t => {
  const fixture = setup(t, [
    { streamId: '1', name: 'US: NBC 5 HD', category: 'NBC' },
    { streamId: '2', name: 'US: NBC 25 HD', category: 'NBC' },
    { streamId: '3', name: 'US: KING HD', category: 'NBC' },
    { streamId: '4', name: 'US: NBC Seattle HD', category: 'NBC' },
    { streamId: '5', name: 'US: NBC 5 Seattle HD', category: 'NBC' },
    { streamId: '6', name: 'US: KING NBC 5 HD', category: 'NBC' },
  ], [game('seattle-nbc', { broadcasts: [{ network: 'NBC', region: 'US' }] })]);
  await fixture.run();
  const results = fixture.candidates('seattle-nbc');
  const score = id => results.find(item => item.sourceId === id).scores.local;
  assert.equal(results.some(item => item.sourceId === '1'), false);
  assert.equal(results.some(item => item.sourceId === '2'), false);
  assert.ok(score('3') > 0);
  assert.equal(score('4'), score('5'));
  assert.equal(score('3'), score('6'));
});

test('source-backed low-power station suffixes and multi-city markets work for CFB venue matching', async t => {
  const fixture = setup(t, [
    { streamId: '1', name: 'US: KXDF-CD HD', category: 'CBS' },
    { streamId: '2', name: 'US: KXDF-LD HD', category: 'CBS' },
    { streamId: '3', name: 'US: KOVR HD', category: 'CBS' },
  ], [
    game('fairbanks', { league: 'CFB', venue: { city: 'Fairbanks' }, broadcasts: [{ network: 'CBS', region: 'US' }] }),
    game('stockton', { league: 'CFB', venue: { city: 'Stockton' }, broadcasts: [{ network: 'CBS', region: 'US' }] }),
  ]);
  await fixture.run();
  const hasLocation = candidate => candidate.evidence.some(item => item.kind === 'local-location');
  const fairbanks = fixture.candidates('fairbanks');
  assert.equal(hasLocation(fairbanks.find(item => item.sourceId === '1')), true);
  assert.equal(fairbanks.some(item => item.sourceId === '2'), false);
  assert.equal(hasLocation(fixture.candidates('stockton').find(item => item.sourceId === '3')), true);
});

test('venue state distinguishes same-named cities in the expanded directory', async t => {
  const fixture = setup(t, [
    { streamId: '1', name: 'US: WSHM-LD HD', category: 'CBS' },
    { streamId: '2', name: 'US: KOLR HD', category: 'CBS' },
  ], [game('springfield', { league: 'CFB', venue: { city: 'Springfield', state: 'MA' }, broadcasts: [{ network: 'CBS', region: 'US' }] })]);
  await fixture.run();
  const results = fixture.candidates('springfield');
  assert.ok(results.find(item => item.sourceId === '1').scores.local > 0);
  assert.equal(results.some(item => item.sourceId === '2'), false);
});
