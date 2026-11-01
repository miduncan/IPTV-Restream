import { expect, test } from '@playwright/test';
const automaticDefaults = { matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' };
const settings = { ...automaticDefaults, enabledLeagues: ['NFL', 'CFB'], estimatedDurationHours: { NFL: 4, CFB: 4 }, broadcastRegions: ['US', 'CA', 'UK'] };
const nfl = { id: 'nfl', league: 'NFL', teams: [{ id: '1', name: 'Seattle Seahawks' }, { id: '2', name: 'Buffalo Bills' }], startsAt: '2026-10-28T20:00:00Z', status: 'live', statusDetail: 'Live', group: 'live', statusEstimated: false, stale: false, matching: { state: 'pending' } };
const cfb = { ...nfl, id: 'cfb', league: 'CFB', teams: [{ id: '3', name: 'UConn Huskies' }, { id: '4', name: 'Central Connecticut' }] };
function gamesResponse() { return { games: [nfl, cfb], settings, freshness: { stale: false, lastSuccessfulStatusAt: '2026-10-28T20:00:00Z', error: null }, coverage: {} }; }
async function mockApi(page, { admin = false, getGames = gamesResponse, getSettings = () => settings, saveSettings = () => {} } = {}) {
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname === '/api/auth/admin-status') body = { role: admin ? 'admin' : 'viewer', username: 'fixture', isAdmin: admin, channelSelectionRequiresAdmin: false, streamSynchronizationEnabled: false };
    else if (pathname === '/api/channels/') body = [];
    else if (pathname === '/api/channels/current') body = null;
    else if (pathname === '/api/channels/epg') body = { guides: {} };
    else if (pathname === '/api/games') body = getGames();
    else if (pathname === '/api/admin/games/matching') body = { matches: [], matching: { running: false, lastSuccessfulAt: null }, settings: getSettings(), coverage: null };
    else if (pathname === '/api/admin/games/matching/categories') body = { categories: [], allowedCategoryIds: [] };
    else if (/^\/api\/games\/[^/]+\/candidates$/.test(pathname)) body = { gameId: pathname.split('/')[3], state: 'pending', candidates: [], matchedAt: null, stale: false };
    else if (pathname === '/api/admin/games/settings') {
      if (route.request().method() === 'PUT') saveSettings(route.request().postDataJSON().settings);
      body = { settings: getSettings() };
    } else if (pathname === '/api/admin/settings') body = { settings: { streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' } };
    await route.fulfill({ json: body });
  });
  await page.route('**/socket.io/**', route => route.abort());
}

test('sidebar shows enabled leagues without viewer filters and retains selection through refresh', async ({ page }) => {
  let response = gamesResponse();
  await mockApi(page, { getGames: () => response });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /UConn.*Central/ })).toBeVisible();
  await page.getByRole('button', { name: /Seattle.*Buffalo/ }).click();
  response = { ...response, games: [{ ...nfl, status: 'final', statusDetail: 'Final', group: 'recentlyFinished' }, cfb] };
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('button', { name: /Seattle.*Buffalo/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('heading', { name: 'Recently finished' })).toBeVisible();
  response = { ...response, settings: { ...settings, enabledLeagues: ['NFL'] } };
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('button', { name: /UConn.*Central/ })).toHaveCount(0);
});

test('admin persists league and duration controls independently of Xtream settings', async ({ page }) => {
  let saved = structuredClone(settings);
  await mockApi(page, { admin: true, getSettings: () => saved, saveSettings: value => { saved = value; } });
  await page.goto('/admin/');
  await expect(page.getByRole('region', { name: 'Games settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Broadcast regions' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Enable NFL games' }).uncheck();
  await page.getByRole('spinbutton', { name: 'CFB estimated duration (hours)' }).fill('5');
  await page.getByRole('button', { name: 'Save Games settings', exact: true }).click();
  await expect(page.getByText('Games settings saved', { exact: true })).toBeVisible();
  expect(saved).toEqual({ ...automaticDefaults, enabledLeagues: ['CFB'], estimatedDurationHours: { NFL: 4, CFB: 5 }, broadcastRegions: ['US', 'CA', 'UK'] });
  await page.reload();
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Enable NFL games' })).not.toBeChecked();
  await expect(page.getByRole('spinbutton', { name: 'CFB estimated duration (hours)' })).toHaveValue('5');
});

test('admin configures and persists automatic matching without showing matching controls in the sidebar', async ({ page }) => {
  let saved = structuredClone(settings);
  await mockApi(page, { admin: true, getSettings: () => saved, saveSettings: value => { saved = value; }, getGames: () => ({ ...gamesResponse(), settings: saved, matching: { running: false, lastSuccessfulAt: null, lastError: null } }) });
  await page.goto('/admin/');
  await expect(page.getByRole('region', { name: 'Games settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Broadcast regions' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Enable automatic game matching' })).not.toBeChecked();
  await expect(page.getByLabel('Daily matching time')).toHaveValue('06:00');
  await expect(page.getByLabel('Matching timezone')).toHaveValue('America/Los_Angeles');
  await page.getByRole('checkbox', { name: 'Enable automatic game matching' }).check();
  await page.getByLabel('Daily matching time').fill('17:45');
  await page.getByLabel('Matching timezone').fill('Invalid/Zone');
  await expect(page.getByRole('button', { name: 'Save Games settings', exact: true })).toBeDisabled();
  await page.getByLabel('Matching timezone').fill('UTC');
  await page.getByRole('button', { name: 'Save Games settings', exact: true }).click();
  await expect(page.getByText('Games settings saved', { exact: true })).toBeVisible();
  expect(saved.matchingEnabled).toBe(true);
  expect(saved.matchingTime).toBe('17:45');
  expect(saved.matchingTimezone).toBe('UTC');
  await page.reload();
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Enable automatic game matching' })).toBeChecked();
  await expect(page.getByLabel('Daily matching time')).toHaveValue('17:45');
  await expect(page.getByLabel('Matching timezone')).toHaveValue('UTC');
  await page.getByRole('checkbox', { name: 'Enable automatic game matching' }).uncheck();
  await page.getByRole('button', { name: 'Save Games settings', exact: true }).click();
  await expect(page.getByText('Games settings saved', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run matching now', exact: true })).toHaveCount(0);
});
