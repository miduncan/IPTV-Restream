import { expect, test } from '@playwright/test';
const automaticDefaults = { matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' };

const initial = { ...automaticDefaults, enabledLeagues: ['NFL', 'CFB'], estimatedDurationHours: { NFL: 4, CFB: 4 }, broadcastRegions: ['US', 'CA', 'UK'] };
const game = { id: 'network-game', league: 'NFL', teams: [{ id: '1', name: 'Seattle Seahawks' }, { id: '2', name: 'Buffalo Bills' }], startsAt: '2026-10-28T20:30:00Z', status: 'scheduled', statusDetail: 'Scheduled', group: 'startingSoon', statusEstimated: false, stale: false, matching: { state: 'complete', matchedAt: '2026-10-28T20:00:00Z' } };
async function fixture(page, { admin = false } = {}) {
  let saved = structuredClone(initial);
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname === '/api/auth/admin-status') body = { role: admin ? 'admin' : 'viewer', isAdmin: admin, username: null, channelSelectionRequiresAdmin: false, streamSynchronizationEnabled: false };
    else if (pathname === '/api/admin/settings') body = { settings: { streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' } };
    else if (pathname === '/api/admin/games/settings') {
      if (route.request().method() === 'PUT') saved = route.request().postDataJSON().settings;
      body = { settings: saved };
    }
    else if (pathname === '/api/admin/games/matching') body = { matches: [], matching: { running: false, lastSuccessfulAt: null }, settings: saved, coverage: { broadcastRegions: { CA: 'unverified' } } };
    else if (pathname === '/api/admin/games/matching/categories') body = { categories: [], allowedCategoryIds: [] };
    else if (pathname === '/api/channels/') body = [];
    else if (pathname === '/api/channels/current') body = null;
    else if (pathname.endsWith('/candidates')) body = { gameId: game.id, state: 'complete', matchedAt: '2026-10-28T20:00:00Z', candidates: [{ id: 'xtream:2', sourceId: '2', name: 'US: ESPN2 HD', confidenceScore: 28, evidence: [{ kind: 'broadcast-network', description: 'Scheduled ESPN2 assignment (US); 2 overlapping games may use this network; regional carriage is unverified' }] }] };
    else if (pathname === '/api/games') body = { games: [game], settings: saved, freshness: { stale: false, lastSuccessfulStatusAt: '2026-10-28T20:00:00Z', error: null }, coverage: { broadcastRegions: { US: 'available', CA: 'unverified', UK: 'unverified' } }, matching: { running: false, lastSuccessfulAt: '2026-10-28T20:00:00Z', lastError: null, guideCoverage: { limitations: ['Available guide listings do not guarantee complete coverage for the next 48 hours.'] } } };
    await route.fulfill({ json: body });
  });
  await page.route('**/socket.io/**', route => route.abort());
  return () => saved;
}

test('Games settings live in Game matching without broadcast region controls or notices', async ({ page }) => {
  await fixture(page, { admin: true });
  await page.goto('/admin/');
  await expect(page.getByRole('region', { name: 'Games settings' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Games settings' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Broadcast regions' })).toHaveCount(0);
  await expect(page.getByText(/Broadcast assignments unverified/)).toHaveCount(0);
});

test('Games keeps coverage details out of the sidebar and feed evidence out of the sidebar', async ({ page }) => {
  await fixture(page);
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByText(/Broadcast assignments unverified: Canada, UK/)).toHaveCount(0);
  await expect(page.getByText(/Guide listings do not guarantee complete coverage for the next 48 hours/)).toHaveCount(0);
  await page.getByRole('button', { name: /Seattle Seahawks vs Buffalo Bills/ }).click();
  await expect(page.getByRole('button', { name: 'Watch US: ESPN2 HD' })).toBeVisible();
  await expect(page.getByText('Why this feed')).toHaveCount(0);
  await expect(page.getByText(/2 overlapping games may use this network/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Run matching now' })).toHaveCount(0);
});
