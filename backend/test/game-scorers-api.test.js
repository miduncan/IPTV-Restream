const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GamesService = require('../services/games/GamesService');
const GamesStore = require('../services/games/GamesStore');
const { createGamesController } = require('../controllers/GamesController');
const { body, catalogIds } = require('../test-support/xmltv');
const NOW = Date.parse('2026-10-28T20:00:00Z');
const teams = [{ id: 'sea', name: 'Seattle Seahawks' }, { id: 'buf', name: 'Buffalo Bills' }];
const game = extra => ({ id: 'game', league: 'NFL', teams, startsAt: new Date(NOW).toISOString(), status: 'scheduled', broadcasts: [], ...extra });
const listing = title => [{ title, start_timestamp: NOW / 1000, stop_timestamp: (NOW + 4 * 3600000) / 1000 }];
async function candidates(t, channels, { event = game(), guides = {}, favorites = [] } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-scorers-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const service = new GamesService({ now: () => NOW, getFavoriteStreamIds: () => favorites,
        source: { async fetchGames() { return { games: [event], coverage: {} }; } },
        catalog: { async fetchCatalog() { return catalogIds(channels); }, async fetchXmlTv() { return body(guides); } },
        store: new GamesStore({ filePath: path.join(directory, 'games.json') }),
    });
    service.updateCategoryPolicy(['1']);
    await service.runMatching();
    const res = { status() { return this; }, json(value) { this.body = value; } };
    createGamesController(service).getCandidates({ params: { gameId: event.id } }, res);
    assert.equal(res.body.state, 'complete');
    return res.body.candidates;
}

test('PPV requires a team plus league category or channel sport; both teams rank higher', async t => {
    const result = await candidates(t, [
        { streamId: '1', name: 'Seattle Seahawks', category: 'NFL PPV' },
        { streamId: '2', name: 'Seattle Seahawks vs Buffalo Bills', category: 'NFL PPV' },
        { streamId: '3', name: 'Football Seattle Seahawks vs Buffalo Bills' },
        { streamId: '4', name: 'Seattle Seahawks vs Buffalo Bills', category: 'Sports' },
        { streamId: '5', name: 'Event 5', category: 'NFL PPV' },
        { streamId: '6', name: 'Seattle Seahawks', category: 'NCAAF' },
    ]);
    assert.deepEqual(new Set(result.map(item => item.sourceId)), new Set(['1', '2', '3']));
    assert.ok(result.find(item => item.sourceId === '2').scores.ppv > result.find(item => item.sourceId === '1').scores.ppv);
});

test('streaming category establishes service assignment with optional name and EPG bonuses', async t => {
    for (const service of ['Netflix', 'Prime Video', 'Peacock', 'ESPN+', 'Paramount+', 'Apple TV+']) {
        const result = await candidates(t, [
            { streamId: '1', name: 'Event 1', category: service },
            { streamId: '2', name: `US: ${service} HD`, category: service },
            { streamId: '3', name: 'Event 3', category: service },
            { streamId: '4', name: `US: ${service} HD`, category: 'Sports' },
            { streamId: '5', name: 'Event 5', category: 'Other service' },
            { streamId: '6', name: 'US: ESPN HD', category: service },
        ], { event: game({ broadcasts: [{ network: service, region: 'US' }] }), guides: { '3': listing('NFL Seattle Seahawks vs Buffalo Bills') } });
        assert.deepEqual(new Set(result.map(item => item.sourceId)), new Set(['1', '2', '3', '6']));
        const score = id => result.find(item => item.sourceId === id).scores.streaming;
        assert.ok(score('2') > score('1'), service);
        assert.ok(score('3') > score('1'), service);
        assert.equal(score('6'), score('1'), service);
    }
});

test('cable uses exact assignments, EPG and a large saved-channel boost without parent-network suffix matches', async t => {
    const result = await candidates(t, [
        { streamId: '1', name: 'US: ESPN HD' }, { streamId: '2', name: 'US: ESPN FHD' },
        { streamId: '3', name: 'US: ESPN 2 HD' }, { streamId: '4', name: 'US: ESPNEWS HD' },
        { streamId: '5', name: 'US: ESPN 4 HD', category: 'ESPN' },
        { streamId: '6', name: 'Generic feed' }, { streamId: '7', name: 'Unrelated saved channel' },
    ], { event: game({ broadcasts: [{ network: 'ESPN', region: 'US' }] }), favorites: ['2', '7'],
        guides: { '1': listing('NFL Seattle Seahawks vs Buffalo Bills'), '6': listing('NFL Seattle Seahawks vs Buffalo Bills') } });
    assert.deepEqual(new Set(result.map(item => item.sourceId)), new Set(['1', '2', '6']));
    assert.equal(result[0].sourceId, '2');
    assert.ok(result[0].scores.cable - result.find(item => item.sourceId === '1').scores.cable >= 30);
    assert.ok(result[0].evidence.some(item => item.kind === 'favorite'));
});

test('local categories require area evidence while sports-category feeds can use cable scoring', async t => {
    const result = await candidates(t, [
        { streamId: '1', name: 'US: FOX HD', category: 'FOX locals' },
        { streamId: '2', name: 'US: FOX Seattle', category: 'FOX locals' },
        { streamId: '3', name: 'US: FOX 13', category: 'FOX locals' },
        { streamId: '4', name: 'US: KCPQ', category: 'FOX locals' },
        { streamId: '5', name: 'US: FOX HD', category: 'FOX locals' },
        { streamId: '6', name: 'US: FOX Seattle', category: 'Sports' },
        { streamId: '7', name: 'US: CBS Seattle', category: 'FOX locals' },
        { streamId: '8', name: 'US: FOX 13 KTVU', category: 'FOX locals' },
        { streamId: '9', name: 'US: KIRO', category: 'FOX locals' },
        { streamId: '10', name: 'US: FOX Seattle', category: 'FOX locals' },
        { streamId: '11', name: 'US: FOX KTVU', category: 'FOX locals' },
    ], { event: game({ broadcasts: [{ network: 'FOX', region: 'US' }] }), guides: Object.fromEntries(['5', '10', '11'].map(id => [id, listing('NFL Seattle Seahawks vs Buffalo Bills')])) });
    const score = id => result.find(item => item.sourceId === id).scores.local;
    for (const id of ['2', '4', '10']) assert.ok(score(id) > 0, id);
    assert.ok(score('10') > score('2')); // EPG corroborates an eligible local feed.
    assert.ok(result.find(item => item.sourceId === '6').scores.cable > 0);
    assert.equal(result.find(item => item.sourceId === '6').scores.local, 0);
    for (const id of ['1', '3', '5', '7', '8', '9', '11']) assert.equal(result.some(item => item.sourceId === id), false, id);
});

test('CFB venue city supports KXLY while channel numbers earn no points; NCAAF supplies category and EPG football context', async t => {
    const event = game({ league: 'CFB', teams: [{ id: 'w', name: 'Washington Huskies' }, { id: 'o', name: 'Oregon Ducks' }],
        venue: { city: 'Spokane' }, broadcasts: [{ network: 'ABC', region: 'US' }] });
    const result = await candidates(t, [
        { streamId: '1', name: 'US: ABC HD', category: 'ABC' },
        { streamId: '2', name: 'US: KXLY HD', category: 'ABC' },
        { streamId: '3', name: 'US: ABC 4', category: 'ABC' },
        { streamId: '4', name: 'Washington Huskies vs Oregon Ducks', category: 'NCAAF' },
        { streamId: '5', name: 'NCAAF Washington Huskies vs Oregon Ducks' },
        { streamId: '6', name: 'Generic feed' },
    ], { event, guides: { '6': listing('NCAAF Washington Huskies vs Oregon Ducks') } });
    const item = id => result.find(entry => entry.sourceId === id);
    assert.equal(item('1'), undefined);
    assert.ok(item('2').scores.local > 0);
    assert.equal(item('3'), undefined);
    assert.ok(item('4').scores.ppv > 0);
    assert.equal(item('4').scores.ppv, item('5').scores.ppv);
    assert.equal(item('6').epgInspection.score, 20);
    assert.equal(item('6').epgInspection.programmes[0].points, 20);
});

test('channel score is the maximum of eligible scorers and persists the complete breakdown', async t => {
    const result = await candidates(t, [{ streamId: '1', name: 'US: FOX Football Seattle Seahawks vs Buffalo Bills', category: 'FOX' }],
        { event: game({ broadcasts: [{ network: 'FOX', region: 'US' }] }) });
    assert.equal(result.length, 1);
    assert.ok(result[0].scores.ppv > 0);
    assert.ok(result[0].scores.local > 0);
    assert.equal(result[0].confidenceScore, Math.max(...Object.values(result[0].scores)));
    assert.equal(result[0].scorer, 'ppv');
});


test('each scorer reaches 100 using its own fixed maximum and preserves raw evidence', async t => {
    const cases = [
        { scorer: 'ppv', maximum: 95, channel: { name: 'NFL Seattle Seahawks vs Buffalo Bills' } },
        { scorer: 'streaming', maximum: 60, channel: { name: 'US: Peacock', category: 'Peacock' }, network: 'Peacock' },
        { scorer: 'cable', maximum: 77, channel: { name: 'US: ESPN' }, network: 'ESPN', favorites: ['1'] },
        { scorer: 'local', maximum: 44, channel: { name: 'US: FOX Seattle', category: 'FOX' }, network: 'FOX' },
    ];
    for (const { scorer, maximum, channel, network, favorites = [] } of cases) {
        const [candidate] = await candidates(t, [{ streamId: '1', ...channel }], {
            event: game({ broadcasts: network ? [{ network, region: 'US' }] : [] }), favorites,
            guides: { '1': listing('NFL Seattle Seahawks vs Buffalo Bills') },
        });
        assert.equal(candidate.scorer, scorer);
        assert.equal(candidate.rawScores[scorer], maximum);
        assert.equal(candidate.scoreMaximums[scorer], maximum);
        assert.equal(candidate.scores[scorer], 100);
        assert.equal(candidate.confidenceScore, 100);
        assert.ok(candidate.evidence.some(item => item.description.includes(`${maximum}/${maximum} → 100/100`)));
    }
});

test('normalization selects the stronger fraction even when another scorer has more raw points', async t => {
    const [candidate] = await candidates(t, [{ streamId: '1', name: 'Peacock NFL Seattle Seahawks vs Bears', category: 'Peacock' }], {
        event: game({ teams: [teams[0], { id: 'chi', name: 'Chicago Bears', shortName: 'Bears' }],
            broadcasts: [{ network: 'Peacock', region: 'US' }] }),
    });
    assert.ok(candidate.rawScores.ppv > candidate.rawScores.streaming);
    assert.ok(candidate.scores.streaming > candidate.scores.ppv);
    assert.equal(candidate.scorer, 'streaming');
    assert.equal(candidate.confidenceScore, Math.round(100 * 45 / 60));
});

test('missing local area evidence scores zero for NFL and CFB while independent PPV support remains eligible', async t => {
    for (const [league, label, entries, matchup] of [
        ['NFL', 'NFL', [{ ...teams[0], aliases: ['Seahawks'] }, { ...teams[1], aliases: ['Bills'] }], 'Seahawks vs Bills'],
        ['CFB', 'NCAAF', [{ id: 'w', name: 'Washington Huskies', aliases: ['Huskies'] }, { id: 'o', name: 'Oregon Ducks', aliases: ['Ducks'] }], 'Huskies vs Ducks'],
    ]) {
        const title = `${label} ${entries.map(team => team.name).join(' vs ')}`;
        const result = await candidates(t, [
            { streamId: '1', name: `US: FOX ${label} ${matchup}`, category: 'FOX' },
            { streamId: '2', name: 'US: FOX HD', category: 'FOX' },
            { streamId: '3', name: 'US: FOX KTVU HD', category: 'FOX' },
        ], { event: game({ league, teams: entries, broadcasts: [{ network: 'FOX', region: 'US' }] }),
            guides: Object.fromEntries(['1', '2', '3'].map(id => [id, listing(title)])), favorites: ['2', '3'] });
        assert.deepEqual(result.map(item => item.sourceId), ['1'], league);
        assert.equal(result[0].rawScores.local, 0, league);
        assert.equal(result[0].scores.local, 0, league);
        assert.equal(result[0].scorer, 'ppv', league);
        assert.ok(result[0].scores.ppv > 0, league);
    }
});

test('cable scoring excludes local-network categories but accepts assigned broadcast names in NCAAF categories', async t => {
    for (const network of ['ABC', 'CBS', 'NBC', 'FOX', 'The CW']) {
        const label = network === 'The CW' ? 'CW' : network;
        const event = game({ league: 'CFB', teams: [{ id: '150', name: 'Duke Blue Devils' }, { id: '103', name: 'Boston College Eagles' }],
            venue: { city: 'Durham', state: 'NC' }, broadcasts: [{ network, region: 'US' }] });
        const title = 'NCAAF Duke Blue Devils vs Boston College Eagles';
        const result = await candidates(t, [
            { streamId: '1', name: `NCAAF: ${label}`, category: 'US | NCAAF' },
            { streamId: '2', name: `NCAAF: ${label}`, category: `US | ${label}` },
            { streamId: '3', name: 'US: ESPN HD', category: `US | ${label}` },
            { streamId: '4', name: 'Generic feed', category: `US | ${label}` },
            { streamId: '5', name: `NCAAF: ${label} HD`, category: 'US | NCAAF' },
            { streamId: '6', name: `US: ${label} Durham`, category: `US | ${label}` },
            { streamId: '7', name: 'NCAAF: ESPN', category: 'US | NCAAF' },
        ], { event, guides: { '3': listing(title), '4': listing(title), '5': listing(title) } });
        const item = id => result.find(entry => entry.sourceId === id);
        assert.ok(item('1')?.scores.cable > 0, network);
        assert.equal(item('1').scores.local, 0, network);
        assert.equal(item('1').scorer, 'cable', network);
        assert.ok(item('5').scores.cable > item('1').scores.cable, network);
        for (const id of ['2', '3', '4', '7']) assert.equal(item(id), undefined, `${network}: ${id}`);
        assert.ok(item('6').scores.local > 0, network);
        assert.equal(item('6').scores.cable, 0, network);
    }
});
