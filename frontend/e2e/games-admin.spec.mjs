import { expect, test } from '@playwright/test';

test('admin reviews stored matches, scores, category policy and refresh progress on desktop and mobile', async ({ page }) => {
  let allowedCategoryIds = [];
  let runs = 0;
  let running = false;
  const matching = () => ({ running, lastSuccessfulAt: '2026-10-30T15:00:00Z', lastAttemptAt: '2026-10-30T15:00:00Z', lastError: null });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/auth/admin-status') body = { role: 'admin', isAdmin: true, username: 'fixture' };
    if (path === '/api/admin/settings') body = { settings: { streamSynchronizationEnabled: false, transcodeAudioToAacLc: false, xtreamUrl: '', xtreamUsername: '', xtreamPassword: '' } };
    if (path === '/api/admin/games/settings') body = { settings: { enabledLeagues: ['NFL', 'CFB'], estimatedDurationHours: { NFL: 4, CFB: 4 }, broadcastRegions: ['US'], matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'UTC' } };
    if (path === '/api/admin/games/matching/categories') {
      if (route.request().method() === 'PUT') allowedCategoryIds = route.request().postDataJSON().allowedCategoryIds;
      body = { categories: [{ id: '10', name: 'NFL feeds', channelCount: 200 }, { id: '20', name: 'Movies', channelCount: 300 }], allowedCategoryIds };
    }
    if (path === '/api/admin/games/matching') {
      if (route.request().method() === 'POST') { runs++; running = true; }
      body = { matching: matching(), settings: { broadcastRegions: ['US'] }, coverage: null, matches: [{
        game: { id: 'game', league: 'NFL', teams: [{ name: 'Seattle Seahawks' }, { name: 'Buffalo Bills' }], startsAt: '2026-10-30T20:00:00Z', status: 'scheduled' },
        matching: { gameId: 'game', state: 'complete', stale: false, matchedAt: '2026-10-30T15:00:00Z', candidates: [{ id: 'channel', sourceId: '1', category: 'NFL feeds', name: 'NFL Seahawks vs Bills', confidenceScore: 90, evidence: [{ kind: 'scorer', description: 'ppv scorer selected; ppv: 18/20 → 90/100' }] }] },
      }] };
    }
    await route.fulfill({ json: body });
  });
  await page.route('**/socket.io/**', route => route.abort());
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Game channel matching' })).toBeVisible();
  await expect(page.getByText(/Last successful matching:/)).toBeVisible();
  await page.getByRole('checkbox', { name: /NFL feeds/ }).check();
  await page.getByRole('button', { name: 'Save category allow-list' }).click();
  await expect(page.getByText('Categories saved. Run matching now to refresh the results.')).toBeVisible();
  expect(allowedCategoryIds).toEqual(['10']);
  await expect(page.getByRole('checkbox', { name: /Movies/ })).not.toBeChecked();
  await page.locator('summary').filter({ hasText: 'Seattle Seahawks vs Buffalo Bills' }).click();
  await expect(page.getByText('90/100', { exact: true })).toBeVisible();
  await expect(page.getByText('EPG examined', { exact: true })).toBeVisible();
  await page.getByText('Why this feed', { exact: true }).click();
  await expect(page.getByText('ppv scorer selected; ppv: 18/20 → 90/100')).toBeVisible();
  await page.getByRole('button', { name: 'Run matching now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Matching channels…' })).toBeDisabled();
  expect(runs).toBe(1);
  await page.screenshot({ path: 'test-results/games-admin-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Game channel matching' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/games-admin-mobile.png', fullPage: true });
  await page.reload();
  await page.getByRole('button', { name: 'Game matching', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /NFL feeds/ })).toBeChecked();
});
