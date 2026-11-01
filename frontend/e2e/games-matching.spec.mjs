import { expect, test } from '@playwright/test';

const game = { id: 'espn:NFL:fixture', league: 'NFL', teams: [{ id: '1', name: 'Seattle Seahawks' }, { id: '2', name: 'Buffalo Bills' }], startsAt: '2026-10-28T20:30:00Z', status: 'scheduled', statusDetail: 'Scheduled', group: 'startingSoon', statusEstimated: false, stale: false, matching: { state: 'complete', matchedAt: '2026-10-28T20:00:00Z', count: 2 } };
const candidates = [
  { id: 'xtream:41', sourceId: '41', name: 'Seahawks vs Bills', confidenceScore: 80, evidence: [{ kind: 'channel-name', description: 'Both teams appear in the current provider channel name' }] },
  { id: 'xtream:42', sourceId: '42', name: 'Seattle feed', confidenceScore: 48, evidence: [{ kind: 'channel-name', description: 'One team appears in the current provider channel name' }] },
];
const matching = { running: false, lastSuccessfulAt: '2026-10-28T20:00:00Z', lastAttemptAt: '2026-10-28T20:00:00Z', lastError: null };

async function fixture(page, { admin = true, restricted = false, state = 'complete', empty = false, stale = false, candidateRows = candidates, guideSnapshot = null, savedChannels = [] } = {}) {
  let status = { ...matching, lastError: stale ? 'Channel matching failed; previous results were retained' : null };
  let runs = 0;
  // Substitute only the socket transport's public adapter. The UI still uses
  // the production setCurrentProviderChannel method contract and lifecycle.
  await page.route('**/src/services/SocketService.ts', route => route.fulfill({ contentType: 'application/javascript', body: `
    const listeners = new Map();
    window.__providerSelections = [];
    window.__savedSelections = [];
    const emit = (name, data) => (listeners.get(name) || []).forEach(fn => fn(data));
    export default {
      connect() {}, disconnect() {}, isConnected() { return true; },
      subscribeToEvent(name, fn) { listeners.set(name, [...(listeners.get(name) || []), fn]); },
      unsubscribeFromEvent(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(value => value !== fn)); },
      async setCurrentChannel(id) {
        window.__savedSelections.push(id);
        const channel = { id, name: 'Selected saved feed', mode: 'restream', url: '', headers: [], tags: [] };
        emit('channel-switching', { channel, revision: 1 }); emit('channel-selected', channel);
      },
      async setCurrentProviderChannel(id) {
        window.__providerSelections.push(id);
        if (window.__failProviderSelection) throw new Error('Could not start selected feed');
        const channel = {id: -Number(id), name: 'Selected provider feed', mode: 'restream', url: '', headers: [], tags: []};
        emit('channel-switching', {channel, revision: 1}); emit('channel-selected', channel);
      }
    };
  ` }));
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname === '/api/auth/admin-status') body = { role: admin ? 'admin' : 'viewer', isAdmin: admin, username: null, channelSelectionRequiresAdmin: restricted, streamSynchronizationEnabled: false };
    else if (pathname === '/api/admin/settings') body = { settings: { streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' } };
    else if (pathname === '/api/admin/games/settings') body = { settings: { enabledLeagues: ['NFL', 'CFB'], estimatedDurationHours: { NFL: 4, CFB: 4 }, broadcastRegions: ['US'], matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'UTC' } };
    else if (pathname === '/api/channels/') body = savedChannels;
    else if (pathname === '/api/channels/current') body = null;
    else if (pathname === '/api/channels/epg') body = { guides: {} };
    else if (pathname === '/api/admin/games/matching/cancel') { status = { ...status, running: false, progress: { ...status.progress, phase: 'cancelled' }, lastError: 'Channel matching cancelled; previous results were retained' }; body = { matching: status }; }
    else if (pathname === '/api/admin/games/matching/categories') body = { categories: [], allowedCategoryIds: [] };
    else if (pathname === '/api/admin/games/matching') {
      if (route.request().method() === 'POST') { runs += 1; status = { ...status, running: true }; }
      body = { matching: status, matches: [{ game, matching: { gameId: game.id, state, candidates: candidateRows, guideSnapshot, matchedAt: matching.lastSuccessfulAt, stale } }], settings: { broadcastRegions: ['US'] }, coverage: null };
    }
    else if (pathname.endsWith('/candidates')) body = { gameId: game.id, state, candidates: empty || state === 'pending' ? [] : candidateRows, guideSnapshot, matchedAt: state === 'pending' ? null : matching.lastSuccessfulAt, stale, lastError: status.lastError };
    else if (pathname === '/api/games') body = { games: [{ ...game, matching: { ...game.matching, state } }], matching: status, freshness: { stale: false, lastSuccessfulStatusAt: matching.lastSuccessfulAt, error: null }, coverage: {} };
    await route.fulfill({ json: body });
  });
  await page.route('**/streams/**', route => route.abort());
  return { progress: value => { status = { ...status, progress: value }; }, runs: () => runs, finish: () => { status = { ...status, running: false, lastError: null }; } };
}

test('a ranked candidate shares playback only after the common confirmation and cancellation leaves playback unchanged', async ({ page }, testInfo) => {
  const mocked = await fixture(page);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run matching now' })).toHaveCount(0);
  expect(mocked.runs()).toBe(0);
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  const watch = page.getByRole('button', { name: /Watch/ });
  await expect(watch).toHaveCount(2);
  await expect(watch).toHaveText(['Seahawks vs Bills', 'Seattle feed']);
  await expect(page.getByText('Ranking score · not a probability')).toHaveCount(0);
  await expect(page.getByText(/\d+\/100/)).toHaveCount(0);
  await expect(page.getByText('Why this feed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('EPG examined', { exact: true })).toHaveCount(0);
  const modal = page.getByRole('alertdialog', { name: 'Change channel for everyone?' });
  await watch.first().click();
  await expect(modal).toContainText('Seahawks vs Bills');
  expect(await page.evaluate(() => window.__providerSelections)).toEqual([]);
  await modal.getByRole('checkbox', { name: 'Don’t show this again' }).check();
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(watch.first()).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('streamhub:skip-channel-change-confirmation'))).toBeNull();
  expect(await page.evaluate(() => window.__providerSelections)).toEqual([]);
  await watch.first().click();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => window.__providerSelections)).toEqual([]);
  await watch.first().click();
  await page.screenshot({ path: testInfo.outputPath('game-feed-confirmation.png') });
  await modal.getByRole('button', { name: 'Change channel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__providerSelections)).toEqual(['41']);
  await expect(page.getByText('Selected provider feed', { exact: true })).toBeVisible();
  await watch.first().click();
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => window.__providerSelections)).toEqual(['41']);
  await watch.nth(1).click();
  await expect(modal).toContainText('Seattle feed');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('restricted viewers cannot switch candidate channels or start matching', async ({ page }) => {
  await fixture(page, { admin: false, restricted: true });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run matching now' })).toHaveCount(0);
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  await expect(page.getByRole('button', { name: /Watch/ }).first()).toBeDisabled();
  await expect(page.getByText('Admin access required to switch channels')).toBeVisible();
  expect(await page.evaluate(() => window.__providerSelections)).toEqual([]);
});

test('candidate restream loads backend HLS without exposing an upstream URL', async ({ page }) => {
  await fixture(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  const manifest = page.waitForRequest(request => new URL(request.url()).pathname === '/streams/-41/-41.m3u8', { timeout: 5000 });
  await page.getByRole('button', { name: 'Watch Seahawks vs Bills', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change channel', exact: true }).click();
  await manifest;
  expect(await page.evaluate(() => window.__providerSelections)).toEqual(['41']);
});

for (const state of ['pending', 'empty']) test(`${state} matching has a distinct visible state`, async ({ page }) => {
  await fixture(page, { state: state === 'pending' ? 'pending' : 'complete', empty: state === 'empty' });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  await expect(page.getByText(state === 'pending' ? 'Channel matching pending' : 'No matching channels')).toBeVisible();
});

test('stale candidates remain selectable and playback failure leaves the next choice to the viewer', async ({ page }) => {
  await fixture(page, { stale: true });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  await expect(page.getByText('Stored candidates may be stale')).toBeVisible();
  await page.evaluate(() => { window.__failProviderSelection = true; });
  await page.getByRole('button', { name: /Watch Seahawks vs Bills/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Change channel', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Could not start selected feed');
  expect(await page.evaluate(() => window.__providerSelections)).toEqual(['41']);
  await expect(page.getByRole('button', { name: /Watch Seattle feed/ })).toBeEnabled();
});

test('bulk matching reports provider request budget and guide progress and can be cancelled without server shutdown', async ({ page }) => {
  const mocked = await fixture(page);
  await page.clock.install();
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await page.getByRole('button', { name: 'Run matching now' }).click();
  mocked.progress({ phase: 'guide', requestsUsed: 3, requestBudget: 6, decodedBytes: 10485760, programmesParsed: 12000, programmesKept: 42, elapsedMs: 15000 });
  await page.clock.fastForward(2_000);
  await expect(page.getByText('Provider requests: 3/6')).toBeVisible();
  await expect(page.getByText(/Guide data: 10.0 MiB decoded/)).toBeVisible();
  await expect(page.getByText(/12,000 programmes parsed/)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel matching', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run matching now' })).toBeEnabled();
  await expect(page.getByText(/Channel matching cancelled; previous results were retained/)).toBeVisible();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  await expect(page.getByRole('button', { name: /Watch Seahawks vs Bills/ })).toBeEnabled();
});


test('every candidate exposes scorer EPG input, zero-point listings and snapshot provenance', async ({ page }) => {
  const window = { start: '2026-10-28T20:30:00.000Z', end: '2026-10-29T00:30:00.000Z' };
  await fixture(page, { guideSnapshot: { fetchedAt: '2026-10-28T19:45:00Z', cached: true, stale: true }, candidateRows: [
    { ...candidates[0], epgInspection: { status: 'available', window, score: 15, bonus: 5, penalty: 0, programmes: [
      { title: 'Seattle Seahawks vs Buffalo Bills', description: 'Full programme description from the scoring snapshot', categories: ['Sports'], start: window.start, end: window.end, points: 15, treatment: 'Both teams; sport unverified; 15 EPG ranking points' },
      { title: 'Evening News', description: 'Local news bulletin', categories: [], start: '2026-10-28T23:30:00Z', end: window.end, points: 0, treatment: 'No matching teams or supported programme label; no points' },
    ] } },
    { ...candidates[1], epgInspection: { status: 'empty', window, score: 0, bonus: 0, penalty: 0, programmes: [] } },
  ] });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Seattle Seahawks vs Buffalo Bills' }).click();
  const sections = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'EPG examined' }) });
  await expect(sections).toHaveCount(2);
  await sections.first().locator('summary').click();
  await expect(sections.first()).toContainText('Full programme description from the scoring snapshot');
  await expect(sections.first()).toContainText('Evening News');
  await expect(sections.first()).toContainText('no points');
  await expect(sections.first()).toContainText('Game window');
  await expect(sections.first()).toContainText('Guide retrieved');
  await expect(sections.first()).toContainText('Matching run');
  await expect(sections.first()).toContainText('cached');
  await expect(sections.first()).toContainText('stale');
  await expect(sections.first().locator('time')).not.toHaveCount(0);
  await sections.nth(1).locator('summary').click();
  await expect(sections.nth(1)).toContainText('No overlapping guide listings');
});

test('EPG inspection explains missing mappings, unavailable guides and older stored results', async ({ page }) => {
  const inspection = { window: { start: '2026-10-28T20:30:00Z', end: '2026-10-29T00:30:00Z' }, score: 0, bonus: 0, penalty: 0, programmes: [] };
  await fixture(page, { candidateRows: [
    { ...candidates[0], epgInspection: { ...inspection, status: 'unmapped' } },
    { ...candidates[1], epgInspection: { ...inspection, status: 'unavailable' } },
    { ...candidates[1], id: 'xtream:43', sourceId: '43', name: 'Older stored feed' },
  ] });
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Seattle Seahawks vs Buffalo Bills' }).click();
  const sections = page.locator('details').filter({ has: page.locator(':scope > summary', { hasText: 'EPG examined' }) });
  await expect(sections).toHaveCount(3);
  for (const section of await sections.all()) await section.locator('summary').click();
  await expect(page.getByText('No usable EPG mapping for this channel.')).toBeVisible();
  await expect(page.getByText('Guide unavailable during this matching run.')).toBeVisible();
  await expect(page.getByText(/Inspection data unavailable for this stored result/)).toBeVisible();
});


for (const rememberAt of ['games', 'channels']) test(`confirmation preference set in ${rememberAt} is shared with the other picker and survives reload`, async ({ page }) => {
  const saved = { id: 7, name: 'Saved news', avatar: '', mode: 'restream', url: '', headers: [], tags: [] };
  await fixture(page, { savedChannels: [saved] });
  await page.goto('/');
  const choose = async (picker) => {
    if (picker === 'games') {
      await page.getByRole('tab', { name: 'Games', exact: true }).click();
      await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
      await page.getByRole('button', { name: 'Watch Seahawks vs Bills', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'More sidebar options' }).click();
      await page.getByRole('menuitemradio', { name: /Channels/ }).click();
      await page.getByRole('button', { name: /Saved news/ }).click();
    }
  };
  await choose(rememberAt);
  const modal = page.getByRole('alertdialog', { name: 'Change channel for everyone?' });
  await expect(modal).toBeVisible();
  expect(await page.evaluate(() => [window.__providerSelections, window.__savedSelections])).toEqual([[], []]);
  await modal.getByRole('checkbox', { name: 'Don’t show this again' }).check();
  await modal.getByRole('button', { name: 'Change channel', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__providerSelections.length + window.__savedSelections.length)).toBe(1);
  await page.reload();
  await choose(rememberAt === 'games' ? 'channels' : 'games');
  await expect.poll(() => page.evaluate(() => window.__providerSelections.length + window.__savedSelections.length)).toBe(1);
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(() => [window.__providerSelections, window.__savedSelections])).toEqual(rememberAt === 'games' ? [[], [7]] : [['41'], []]);
});
