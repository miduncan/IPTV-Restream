const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const { body, catalogIds } = require('../test-support/xmltv');
const recorded = require('./fixtures/game-matching/schedule-guide.json');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const HOUR = 3600000;
const teams = [
  { id: 'sea', name: 'Seattle Seahawks', shortName: 'Seattle', abbreviation: 'SEA', aliases: ['Seahawks'] },
  { id: 'buf', name: 'Buffalo Bills', shortName: 'Buffalo', abbreviation: 'BUF', aliases: ['Bills'] },
];
const game = (id, extra = {}) => ({ id, league: 'NFL', teams, startsAt: new Date(NOW + HOUR / 2).toISOString(), status: 'scheduled', broadcasts: [], ...extra });
function response() { return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } }; }
function setup(t, { catalog = structuredClone(recorded.catalog), guides = structuredClone(recorded.guides), games = [game('seattle'), game('other', { teams: [
  { id: 'kc', name: 'Kansas City Chiefs', shortName: 'Kansas City', aliases: ['Chiefs'] },
  { id: 'den', name: 'Denver Broncos', shortName: 'Denver', aliases: ['Broncos'] },
] })] } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-guide-matching-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const provider = { async fetchCatalog() { return catalogIds(catalog.map(channel => ({ category: 'NFL', ...channel }))); }, async fetchXmlTv() { return body(guides); } };
  const service = new GamesService({ source: { async fetchGames() { return { games, coverage: {} }; } }, store: new GamesStore({ filePath: path.join(directory, 'games.json') }), catalog: provider, now: () => NOW });
  service.updateCategoryPolicy(['1']);
  const controller = createGamesController(service);
  return { service, provider, guides, async run() { const res = response(); controller.runMatching({ user: { role: 'admin' } }, res); await service.runMatching(); }, candidates(id = 'seattle') { const res = response(); controller.getCandidates({ params: { gameId: id } }, res); return res.body; } };
}

test('Games API ranks full-catalog schedule EPG matches by both teams above single-team evidence and preserves offset-normalized programme evidence', async t => {
  const fixture = setup(t);
  await fixture.run();
  const result = fixture.candidates();
  assert.equal(result.candidates[0].sourceId, '2');
  const score = id => result.candidates.find(candidate => candidate.sourceId === id)?.confidenceScore;
  assert.ok(score('1') > score('3'));
  assert.ok(score('3') < score('5')); // Single-team guide evidence stays below a named feed.
  assert.equal(result.candidates.some(candidate => candidate.sourceId === '6'), false); // matching title on another day
  const evidence = result.candidates.find(candidate => candidate.sourceId === '1').evidence.find(item => item.kind === 'epg');
  assert.equal(evidence.title, 'Seattle Seahawks vs Buffalo Bills');
  assert.equal(evidence.start, '2026-10-28T20:30:00.000Z');
  assert.equal(evidence.end, '2026-10-29T00:30:00.000Z');
  assert.equal(evidence.teams.length, 2);
});

test('explicitly conflicting programme and channel-name matchup evidence reduces confidence and retains both sources', async t => {
  const fixture = setup(t);
  await fixture.run();
  const candidates = fixture.candidates().candidates;
  const consistent = candidates.find(candidate => candidate.sourceId === '2');
  const conflict = candidates.find(candidate => candidate.sourceId === '4');
  assert.ok(conflict.confidenceScore < consistent.confidenceScore);
  assert.ok(conflict.evidence.some(item => item.kind === 'channel-name'));
  assert.ok(conflict.evidence.some(item => item.kind === 'contradiction' && item.title === 'Kansas City Chiefs vs Denver Broncos'));
  const other = fixture.candidates('other').candidates.find(candidate => candidate.sourceId === '4');
  assert.ok(other.evidence.some(item => item.kind === 'epg'));
  assert.ok(other.evidence.some(item => item.kind === 'contradiction'));
});

test('Games API penalizes conflicting EPG matchups with hyphen, en dash, and em dash separators', async t => {
  const fixture = setup(t);
  for (const separator of [' - ', ' – ', ' — ', '-', '–', '—']) {
    const title = `Kansas City Chiefs${separator}Denver Broncos`;
    fixture.guides['4'][0].title = title;
    await fixture.run();
    const candidates = fixture.candidates().candidates;
    const clean = candidates.find(candidate => candidate.sourceId === '2');
    const conflicting = candidates.find(candidate => candidate.sourceId === '4');
    assert.ok(conflicting.confidenceScore < clean.confidenceScore, title);
    assert.ok(conflicting.evidence.some(item => item.kind === 'contradiction' && item.title === title), title);
  }
});

test('hyphenated city and team text alone does not establish a conflicting matchup', async t => {
  const fixture = setup(t);
  for (const title of ['Kansas-City Chiefs pre-game coverage', 'Seattle-Seahawks pre-game show', 'Kansas City Chiefs - team news']) {
    fixture.guides['4'][0].title = title;
    await fixture.run();
    const candidates = fixture.candidates().candidates;
    const clean = candidates.find(candidate => candidate.sourceId === '2');
    const named = candidates.find(candidate => candidate.sourceId === '4');
    assert.equal(named.confidenceScore, clean.confidenceScore, title);
    assert.equal(named.evidence.some(item => item.kind === 'contradiction'), false, title);
  }
});

test('absent and partial bulk guides are neutral and expose honest observed coverage', async t => {
  const fixture = setup(t);
  fixture.guides['3'] = new Error('private provider URL and password');
  await fixture.run();
  const named = fixture.candidates().candidates.find(candidate => candidate.sourceId === '5');
  const coverage = fixture.service.getGames().matching.guideCoverage;
  assert.equal(coverage.requestedStreams, 6);
  assert.equal(coverage.streamsWithListings, 2);
  assert.equal(coverage.emptyStreams, 4);
  assert.equal(coverage.failedStreams, 0);
  assert.equal(coverage.programmeCount, 2);
  assert.equal(coverage.latestEnd, '2026-10-29T00:30:00.000Z');
  assert.ok(coverage.limitations.some(message => /do not guarantee complete coverage/.test(message)));
  assert.equal(JSON.stringify(coverage).includes('password'), false);
  delete fixture.provider.fetchXmlTv;
  await fixture.run();
  const withoutGuide = fixture.candidates().candidates.find(candidate => candidate.sourceId === '5');
  assert.equal(withoutGuide.confidenceScore, named.confidenceScore);
  assert.deepEqual(withoutGuide.evidence, named.evidence);
  assert.equal(fixture.service.getGames().matching.guideCoverage.unsupportedStreams, 6);
  assert.equal(fixture.candidates().state, 'complete');
});

test('guide evidence discovers tomorrow games only from overlapping future listings within the matching horizon', async t => {
  const tomorrow = game('tomorrow', { startsAt: new Date(NOW + 36 * HOUR).toISOString() });
  const fixture = setup(t, { games: [game('seattle'), tomorrow], catalog: [...recorded.catalog, { streamId: '7', name: 'Generic event feed' }], guides: {
    ...recorded.guides, '7': [{ title: 'Seattle Seahawks vs Buffalo Bills', start_timestamp: (NOW + 36 * HOUR) / 1000, stop_timestamp: (NOW + 40 * HOUR) / 1000 }],
  } });
  await fixture.run();
  assert.equal(fixture.service.getGames().games.some(item => item.id === 'tomorrow'), true); // The picker now shows the full 48-hour window.
  assert.ok(fixture.candidates('tomorrow').candidates.some(item => item.sourceId === '7'));
  assert.equal(fixture.candidates('tomorrow').candidates.some(item => item.sourceId === '1'), false);
  assert.equal(fixture.candidates().candidates.some(item => item.sourceId === '7'), false);
});

test('ambiguous EPG aliases remain below resolved full-team evidence', async t => {
  const fixture = setup(t, { games: [game('seattle', { league: 'CFB', teams: [
    { id: 'lsu', name: 'LSU Tigers', shortName: 'LSU', aliases: ['Tigers'] },
    { id: 'uk', name: 'Kentucky Wildcats', shortName: 'Kentucky', aliases: ['Wildcats'] },
  ] })], catalog: [{ streamId: '1', name: 'Event A' }, { streamId: '2', name: 'Event B' }], guides: {
    '1': [{ ...recorded.guides['3'][0], title: 'LSU Tigers vs Kentucky Wildcats' }],
    '2': [{ ...recorded.guides['3'][0], title: 'Tigers vs Wildcats' }],
  } });
  await fixture.run();
  const candidates = fixture.candidates().candidates;
  assert.deepEqual(candidates.map(item => item.sourceId), ['1', '2']);
  assert.ok(candidates[0].confidenceScore > candidates[1].confidenceScore);
  assert.ok(candidates[1].evidence[0].teams.every(team => team.ambiguous));
});

test('matching scans a duplicated full catalog with one XMLTV request and no clock or single-stream requests', async t => {
  const catalog = Array.from({ length: 12 }, (_, index) => ({ streamId: String(index + 1), name: 'Generic sports' }));
  const fixture = setup(t, { catalog: [...catalog, catalog[0], catalog[1]] });
  let bulk = 0;
  fixture.provider.fetchServerInfo = async () => { assert.fail('No clock request'); };
  fixture.provider.fetchScheduleEpg = async () => { assert.fail('No per-channel request'); };
  fixture.provider.fetchXmlTv = async () => { bulk += 1; return body(Object.fromEntries(catalog.map(channel => [channel.streamId, recorded.guides['1']]))); };
  await fixture.run();
  assert.equal(bulk, 1);
  assert.equal(fixture.service.getGames().matching.guideCoverage.requestedStreams, 12);
});

test('browse/status refresh never rescan guides, and a failed later run retains prior guide evidence and coverage', async t => {
  const fixture = setup(t);
  let guideRequests = 0;
  const fetchGuide = fixture.provider.fetchXmlTv;
  fixture.provider.fetchXmlTv = id => { guideRequests += 1; return fetchGuide(id); };
  await fixture.run();
  const before = fixture.candidates();
  const metadata = fixture.service.getGames().matching;
  await fixture.service.refreshStatus();
  fixture.service.getGames(); fixture.candidates();
  assert.equal(guideRequests, 1);
  assert.deepEqual(fixture.candidates(), before);
  fixture.provider.fetchCatalog = async () => { throw new Error('provider unavailable'); };
  await fixture.run();
  assert.deepEqual(fixture.candidates().candidates, before.candidates);
  assert.equal(fixture.candidates().matchedAt, before.matchedAt);
  assert.equal(fixture.candidates().stale, true);
  assert.equal(fixture.service.getGames().matching.lastSuccessfulAt, metadata.lastSuccessfulAt);
  assert.deepEqual(fixture.service.getGames().matching.guideCoverage, metadata.guideCoverage);
  assert.equal(guideRequests, 1);
});

test('candidate inspection shows the exact overlapping scorer input including generic titles, conflicts and zero-point listings', async t => {
  const listing = (title, description = '', offset = 0, duration = 4.5) => ({ title, description,
    start_timestamp: (NOW + offset * HOUR) / 1000, stop_timestamp: (NOW + (offset + duration) * HOUR) / 1000 });
  const fixture = setup(t, { games: [game('seattle', { broadcasts: [{ network: 'NBC', region: 'US' }] })], catalog: [
    { streamId: '1', name: 'US: NBC Seattle HD', category: 'NBC' }, { streamId: '2', name: 'Seattle Seahawks vs Buffalo Bills' },
    { streamId: '3', name: 'Seattle Seahawks vs Buffalo Bills alternate' },
  ], guides: {
    '1': [listing('SNF', 'Live Sunday Night Football'), listing('Evening News', 'Local news bulletin', 3, 1.5), listing('Earlier show', '', -4, 1)],
    '2': [listing('Seattle Seahawks vs Buffalo Bills Volleyball')],
    '3': [listing('Evening News', 'No football matchup in the guide')],
  } });
  await fixture.run();
  const result = fixture.candidates();
  const candidate = id => result.candidates.find(item => item.sourceId === id);
  assert.deepEqual(candidate('1').epgInspection.programmes.map(item => item.title), ['SNF', 'Evening News']);
  assert.equal(candidate('1').epgInspection.programmes[0].start, '2026-10-28T20:00:00.000Z');
  assert.equal(candidate('1').epgInspection.programmes[1].description, 'Local news bulletin');
  assert.equal(candidate('1').epgInspection.programmes[1].points, 0);
  assert.ok(candidate('1').epgInspection.score > 0);
  assert.ok(candidate('1').evidence.some(item => item.kind === 'epg-programme'));
  assert.deepEqual(candidate('1').epgInspection.window, { start: '2026-10-28T20:30:00.000Z', end: '2026-10-29T00:30:00.000Z' });
  assert.equal(candidate('2').epgInspection.score, 0);
  assert.match(candidate('2').epgInspection.programmes[0].treatment, /different sport/i);
  assert.ok(candidate('2').confidenceScore < candidate('3').confidenceScore);
  assert.equal(candidate('3').epgInspection.programmes[0].points, 0);
  assert.deepEqual(result.guideSnapshot, { fetchedAt: '2026-10-28T20:00:00.000Z', cached: false, stale: false });
  const restarted = new GamesService({ source: {}, store: fixture.service.store, now: () => NOW });
  assert.deepEqual(restarted.getGameMatching('seattle'), result);
});

test('XMLTV categories distinguish football from another sport and remain visible in scorer inspection', async t => {
  const fixture = setup(t, { games: [game('seattle')], catalog: [
    { streamId: '1', name: 'Event feed' }, { streamId: '2', name: 'Seattle Seahawks vs Buffalo Bills' },
  ], guides: {} });
  fixture.provider.fetchXmlTv = async () => (async function* () {
    yield Buffer.from('<tv>' + ['Football', 'Volleyball'].map((sport, index) =>
      `<programme channel="epg-${index + 1}" start="20261028200000 +0000" stop="20261029003000 +0000"><title>Seattle Seahawks vs Buffalo Bills</title><category>Sports</category><category>${sport}</category></programme>`).join('') + '</tv>');
  })();
  await fixture.run();
  const candidates = fixture.candidates().candidates;
  const football = candidates.find(item => item.sourceId === '1');
  const volleyball = candidates.find(item => item.sourceId === '2');
  assert.deepEqual(football.epgInspection.programmes[0].categories, ['Sports', 'Football']);
  assert.equal(football.epgInspection.score, 20);
  assert.equal(volleyball.epgInspection.score, 0);
  assert.equal(volleyball.epgInspection.penalty, 11); // 10 raw PPV points, normalized and rounded.
  assert.match(volleyball.epgInspection.programmes[0].treatment, /different sport/i);
});

test('programme aliases require an overlapping assigned network and generic CFB does not identify a matchup', async t => {
  for (const [title, network] of [['SNF', 'NBC'], ['MNF', 'ESPN'], ['TNF', 'Prime Video']]) {
    const fixture = setup(t, { games: [game('seattle', { broadcasts: [{ network, region: 'US' }] })], catalog: [
      { streamId: '1', name: `US: ${network}${network === 'NBC' ? ' Seattle' : ''} HD`, category: network }, { streamId: '2', name: `US: ${network}${network === 'NBC' ? ' Seattle' : ''} FHD`, category: network },
      { streamId: '3', name: 'Generic event feed' }, { streamId: '4', name: 'Generic other feed' },
    ], guides: Object.fromEntries([['1', title], ['2', `${title} Replay`], ['3', title], ['4', 'CFB']].map(([id, label]) => [id, [
      { title: label, start_timestamp: NOW / 1000, stop_timestamp: (NOW + 4 * HOUR) / 1000 },
    ]])) });
    await fixture.run();
    const candidates = fixture.candidates().candidates;
    assert.deepEqual(candidates.map(item => item.sourceId), ['1', '2']);
    assert.ok(candidates[0].epgInspection.score > 0);
    assert.equal(candidates[1].epgInspection.score, 0);
    assert.ok(candidates[0].rawScores[candidates[0].scorer] - candidates[1].rawScores[candidates[1].scorer] <= 5);
  }
});

test('candidate inspection distinguishes missing mappings, empty game windows and unavailable guides', async t => {
  const names = [1, 2, 3].map(id => ({ streamId: String(id), name: `Seattle Seahawks vs Buffalo Bills ${id}`, category: 'NFL' }));
  const fixture = setup(t, { games: [game('seattle')], catalog: names, guides: {} });
  fixture.provider.fetchCatalog = async () => [{ ...names[0], epgChannelId: 'empty' }, names[1], { ...names[2], epgChannelId: 'unknown' }].map(channel => ({ categoryId: '1', ...channel }));
  fixture.provider.fetchXmlTv = async () => (async function* () {
    yield Buffer.from('<tv><channel id="empty"><display-name>Known channel without listings</display-name></channel></tv>');
  })();
  await fixture.run();
  const candidates = fixture.candidates().candidates;
  const status = id => candidates.find(item => item.sourceId === id).epgInspection.status;
  assert.equal(status('1'), 'empty');
  assert.equal(status('2'), 'unmapped');
  assert.equal(status('3'), 'unmapped');
  const unavailable = setup(t, { games: [game('seattle')], catalog: names, guides: {} });
  delete unavailable.provider.fetchXmlTv;
  await unavailable.run();
  assert.ok(unavailable.candidates().candidates.every(item => item.epgInspection.status === 'unavailable'));
  assert.equal(unavailable.candidates().guideSnapshot.fetchedAt, null);
});

test('inspection reports applied EPG bonus and penalty after score caps and floors', async t => {
  const fixture = setup(t, { games: [game('seattle')], catalog: [
    { streamId: '1', name: 'NFL Seattle Seahawks vs Buffalo Bills' },
    { streamId: '2', name: 'Seattle Seahawks' },
    { streamId: '3', name: 'Seattle Seahawks vs Buffalo Bills Volleyball' },
  ], guides: {
    '1': [{ ...recorded.guides['3'][0], title: 'NFL Seattle Seahawks vs Buffalo Bills' }],
    '2': [{ ...recorded.guides['3'][0], title: 'Volleyball' }],
    '3': [{ ...recorded.guides['3'][0], title: 'Volleyball' }],
  } });
  await fixture.run();
  const candidates = fixture.candidates().candidates;
  const candidate = id => candidates.find(item => item.sourceId === id);
  assert.equal(candidate('1').confidenceScore, 100);
  assert.equal(candidate('1').epgInspection.bonus, 0);
  assert.equal(candidate('2').confidenceScore, 11);
  assert.equal(candidate('2').epgInspection.penalty, 10); // League category establishes football context.
  assert.equal(candidate('3').confidenceScore, 5);
  assert.equal(candidate('3').epgInspection.penalty, 0); // Channel-label cap already dominates.
});
