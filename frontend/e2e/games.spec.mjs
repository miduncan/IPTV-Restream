import { expect, test } from '@playwright/test';

const game = {
  id: 'espn:NFL:fixture', league: 'NFL',
  teams: [{ id: '1', name: 'Seattle Seahawks', shortName: 'Seattle' }, { id: '2', name: 'Buffalo Bills', shortName: 'Buffalo' }],
  startsAt: '2026-10-28T20:00:00.000Z', status: 'live', statusDetail: 'Overtime',
  group: 'live', statusEstimated: false, stale: false, matching: { state: 'pending' },
};

async function mockPlayer(page, gamesResponse) {
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname === '/api/auth/admin-status') body = { role: 'viewer', username: null, isAdmin: false, channelSelectionRequiresAdmin: false, streamSynchronizationEnabled: false };
    else if (pathname === '/api/channels/') body = [{ id: 7, name: 'Saved news', tags: [], avatar: '', mode: 'direct', url: '', headers: [] }];
    else if (pathname === '/api/channels/current') body = null;
    else if (pathname === '/api/channels/epg') body = { guides: {} };
    else if (pathname === '/api/games') body = gamesResponse();
    else if (pathname.endsWith('/candidates')) body = { gameId: game.id, state: 'pending', candidates: [], matchedAt: null, stale: false, lastError: null };
    await route.fulfill({ json: body });
  });
  await page.route('**/socket.io/**', route => route.abort());
}

for (const browserName of ['chromium', 'webkit']) {
  test(`${browserName}: tapping Channels opens the saved channels panel`, async ({ playwright, baseURL }) => {
    const browser = await playwright[browserName].launch({ channel: browserName === 'chromium' ? 'chrome' : undefined });
    try {
      const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await mockPlayer(page, () => ({ games: [], freshness: { stale: false, error: null }, coverage: {} }));
      await page.goto('/');
      await page.getByRole('tab', { name: 'Games', exact: true }).tap();
      await page.getByRole('tab', { name: 'Channels', exact: true }).tap();
      await expect(page.getByRole('region', { name: 'Channels', exact: true })).toBeVisible();
      await expect(page.getByText('Saved news')).toBeVisible();
    } finally {
      await browser.close();
    }
  });
}

test('upcoming named events sort first when sharing kickoff time with games', async ({ page }) => {
  const event = { id: 'named:nfl-redzone:2026-11-01', name: 'NFL RedZone', league: 'NFL',
    logo: 'nfl-redzone', startsAt: game.startsAt, endsAt: '2026-10-29T03:00:00Z',
    group: 'startingSoon', matching: { state: 'pending' } };
  await mockPlayer(page, () => ({ games: [{ ...game, group: 'startingSoon', status: 'scheduled' }], namedEvents: [event],
    freshness: { stale: false, error: null }, coverage: {} }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Starting soon' }).locator('article').first().getByRole('button', { name: event.name, exact: true })).toBeVisible();
});

test('named event card shows only its start time like game cards', async ({ page }) => {
  const event = { id: 'named:nfl-redzone:2026-11-01', name: 'NFL RedZone', league: 'NFL',
    logo: 'nfl-redzone', startsAt: game.startsAt, endsAt: '2026-10-29T03:00:00Z',
    group: 'live', matching: { state: 'pending' } };
  await mockPlayer(page, () => ({ games: [game], namedEvents: [event], freshness: { stale: false, error: null }, coverage: {} }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  const startTime = await page.evaluate(value => new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), event.startsAt);
  await expect(page.getByRole('button', { name: event.name, exact: true }).locator('svg').first().locator('..')).toHaveText(startTime);
});

test('stored channel results render immediately for games and named events without candidate requests or loading text', async ({ page }) => {
  const stored = (id, name) => ({ gameId: id, state: 'complete', candidates: [{ id: `xtream:${id}`, sourceId: id, name, confidenceScore: 42, evidence: [] }], matchedAt: game.startsAt, stale: false, lastError: null });
  const event = { id: 'named:nfl-redzone:2026-11-01', name: 'NFL RedZone', league: 'NFL', logo: 'nfl',
    startsAt: game.startsAt, endsAt: '2026-10-29T03:00:00Z', group: 'live', matching: stored('42', 'TSN') };
  let response = { games: [{ ...game, matching: stored('41', 'Game feed') }], namedEvents: [event], freshness: { stale: false, error: null }, coverage: {} };
  let candidateRequests = 0;
  await mockPlayer(page, () => response);
  await page.route('**/api/games/*/candidates', route => { candidateRequests++; return route.abort(); });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.evaluate(() => {
    window.candidateLoadingSeen = false;
    const observer = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node => /Loading candidate channels|Channel matching pending/.test(node.textContent || '')))) window.candidateLoadingSeen = true;
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  for (const [card, feed] of [[event.name, 'TSN'], ['Seattle Seahawks vs Buffalo Bills', 'Game feed'], [event.name, 'TSN']]) {
    await page.getByRole('button', { name: card, exact: true }).click();
    await expect(page.getByRole('button', { name: `Watch ${feed}`, exact: true })).toBeVisible();
  }
  response = { ...response, namedEvents: [{ ...event, matching: stored('43', 'Updated TSN') }] };
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('button', { name: 'Watch Updated TSN', exact: true })).toBeVisible();
  expect(candidateRequests).toBe(0);
  expect(await page.evaluate(() => window.candidateLoadingSeen)).toBe(false);
});

test('games and named events show the top three channels with a show-all button', async ({ page }) => {
  const matching = { gameId: game.id, state: 'complete', matchedAt: game.startsAt, stale: false, lastError: null,
    candidates: Array.from({ length: 6 }, (_, index) => ({ id: `xtream:${index + 1}`, sourceId: `${index + 1}`, name: `Feed ${index + 1}`, confidenceScore: 100 - index, evidence: [] })) };
  const event = { id: 'named:nfl-redzone:2026-11-01', name: 'NFL RedZone', league: 'NFL', logo: 'nfl',
    startsAt: game.startsAt, endsAt: '2026-10-29T03:00:00Z', group: 'live', matching };
  await mockPlayer(page, () => ({ games: [{ ...game, matching }], namedEvents: [event], freshness: { stale: false, error: null }, coverage: {} }));
  let candidateRequests = 0;
  await page.route('**/api/games/*/candidates', route => { candidateRequests++; return route.abort(); });
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  for (const name of [event.name, 'Seattle Seahawks vs Buffalo Bills']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name: /^Watch Feed/ })).toHaveText(['Feed 1', 'Feed 2', 'Feed 3']);
    await page.getByRole('button', { name: 'Show all', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Watch Feed/ })).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Show all', exact: true })).toHaveCount(0);
    await page.clock.fastForward(30_000);
    await expect(page.getByRole('button', { name: /^Watch Feed/ })).toHaveCount(6);
  }
  expect(candidateRequests).toBe(0);
});

test('named events appear alongside games with a local logo, TSN feeds, and retained expansion', async ({ page }, testInfo) => {
  const event = { id: 'named:nfl-redzone:2026-11-01', name: 'NFL RedZone', league: 'NFL', matching: { state: 'pending', matchedAt: null },
    logo: 'nfl-redzone', startsAt: '2026-11-01T18:00:00Z', endsAt: '2026-11-02T01:00:00Z', group: 'live' };
  let response = { games: [game], namedEvents: [event], freshness: { stale: false, error: null }, coverage: {} };
  await mockPlayer(page, () => response);
  let matchingComplete = false;
  await page.route('**/api/games/named%3Anfl-redzone%3A2026-11-01/candidates', route => route.fulfill({ json: {
    gameId: event.id, state: matchingComplete ? 'complete' : 'pending',
    candidates: matchingComplete ? [{ id: 'xtream:42', sourceId: '42', name: 'CA | TSN HD', confidenceScore: 42, evidence: [] }] : [],
    matchedAt: matchingComplete ? event.startsAt : null, stale: false, lastError: null,
  } }));
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  const card = page.getByRole('button', { name: event.name, exact: true });
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: /Seattle.*Buffalo/ })).toBeVisible();
  await expect(card).not.toContainText('TSN');
  await expect(card).not.toContainText('Scheduled');
  await expect(page.getByRole('region', { name: 'Live', exact: true }).locator('article').first().getByRole('button', { name: event.name, exact: true })).toBeVisible();
  await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 500);
  await expect(card.locator('img')).toHaveAttribute('src', /\/nfl\.png/);
  await card.click();
  await expect(page.getByText('Channel matching pending')).toBeVisible();
  matchingComplete = true;
  response = { ...response, namedEvents: [{ ...event, matching: { state: 'complete', matchedAt: event.startsAt } }] };
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('button', { name: 'Watch CA | TSN HD' })).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(card).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Watch CA | TSN HD' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('named-event-mobile.png') });
  response = { ...response, games: [{ ...game, group: 'startingSoon', status: 'scheduled' }],
    namedEvents: [{ ...event, group: 'startingSoon', matching: { state: 'complete', matchedAt: event.startsAt } }] };
  await page.clock.fastForward(30_000);
  await expect(card).not.toContainText('Scheduled');
  await expect(page.getByRole('region', { name: 'Starting soon' }).locator('article').first().getByRole('button', { name: event.name, exact: true })).toBeVisible();
  response = { ...response, games: [], namedEvents: [] };
  await page.clock.fastForward(30_000);
  await expect(card).toHaveCount(0);
});

test('browse Games, retain selection through status refresh, and keep Channels and Chat usable during sports failure', async ({ page }) => {
  let response = { games: [game], freshness: { stale: false, lastSuccessfulStatusAt: '2026-10-28T20:00:00.000Z', error: null }, coverage: {} };
  await mockPlayer(page, () => response);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await page.getByRole('button', { name: /Seattle.*Buffalo/ }).click();
  await expect(page.getByText('Channel matching pending')).toBeVisible();
  response = { ...response, games: [{ ...game, group: 'recentlyFinished', status: 'final', statusDetail: 'Final' }] };
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('heading', { name: 'Recently finished' })).toBeVisible();
  await expect(page.getByText('Channel matching pending')).toBeVisible();
  await expect(page.getByRole('button', { name: /Seattle.*Buffalo/ })).toHaveAttribute('aria-expanded', 'true');
  response = { ...response, games: [{ ...game, stale: true }], freshness: { ...response.freshness, stale: true, error: 'Sports data is temporarily unavailable' } };
  await page.clock.fastForward(30_000);
  await expect(page.getByText(/Sports data is temporarily unavailable/)).toBeVisible();
  await expect(page.getByText(/Last reported live.*stale/i)).toBeVisible();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await expect(page.getByText('Saved news')).toBeVisible();
  await page.getByRole('tab', { name: 'Live chat' }).click();
  await expect(page.getByRole('tab', { name: 'Live chat' })).toHaveAttribute('aria-selected', 'true');
});

test('initial sports failure and estimated status are clearly labeled', async ({ page }, testInfo) => {
  let response = { games: [], freshness: { stale: true, lastSuccessfulStatusAt: null, error: 'Sports data is temporarily unavailable' }, coverage: {} };
  await mockPlayer(page, () => response);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByText(/Sports data is temporarily unavailable/)).toBeVisible();
  response = { games: [{ ...game, statusEstimated: true }], freshness: { stale: false, lastSuccessfulStatusAt: '2026-10-28T20:00:00.000Z', error: null }, coverage: {} };
  await page.clock.fastForward(30_000);
  await expect(page.getByText('Estimated live')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('games-tab.png') });
});


test('cards show team logos with a fallback and start directly at Live', async ({ page }, testInfo) => {
  const logo = 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png';
  const darkLogo = 'https://a.espncdn.com/i/teamlogos/nfl/500-dark/sea.png';
  await page.route(darkLogo, route => route.abort());
  await page.route(logo, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#002244"/><path d="M12 26h40L30 42z" fill="#69be28"/></svg>' }));
  await mockPlayer(page, () => ({ games: [{ ...game, teams: [{ ...game.teams[0], logo, darkLogo }, { ...game.teams[1], logo: 'https://a.espncdn.com/missing.png', abbreviation: 'BUF' }] }], freshness: { stale: false, lastSuccessfulStatusAt: game.startsAt, error: null }, coverage: {} }));
  await page.route('https://a.espncdn.com/missing.png', route => route.abort());
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  const card = page.getByRole('button', { name: 'Seattle Seahawks vs Buffalo Bills', exact: true });
  await expect(card.locator('img')).toHaveCount(1);
  await expect(card.locator('img')).toHaveJSProperty('naturalWidth', 64);
  await expect(card.locator('img')).toHaveAttribute('src', logo);
  await expect(card.locator('img').locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(card.getByText('BUF', { exact: true })).toBeVisible();
  await expect(page.getByText('Find a game, then choose a feed.')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('games-cards-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('games-cards-mobile.png') });
});


test('team scores show zero, update in place, and remain available when stale', async ({ page }, testInfo) => {
  const withScores = (scores) => ({ ...game, teams: game.teams.map((team, index) => ({ ...team, score: scores[index] })) });
  let response = { games: [withScores([0, 14]), { ...game, id: 'upcoming', league: 'CFB', teams: [{ id: '52', name: 'Florida State Seminoles', shortName: 'Florida St', location: 'Florida State', abbreviation: 'FSU' }, { id: '333', name: 'Alabama Crimson Tide', shortName: 'Alabama', location: 'Alabama', abbreviation: 'ALA' }], group: 'startingSoon', status: 'scheduled', statusDetail: '10/28 - 4:00 PM EDT' }], freshness: { stale: false, lastSuccessfulStatusAt: game.startsAt, error: null }, coverage: {} };
  await mockPlayer(page, () => response);
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  const live = page.getByRole('region', { name: 'Live', exact: true });
  await expect(live.getByRole('button', { name: 'Seattle Seahawks 0 vs Buffalo Bills 14' })).toBeVisible();
  await expect(live.getByText('0', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Starting soon' }).locator('.tabular-nums')).toHaveCount(0);
  const upcoming = page.getByRole('region', { name: 'Starting soon' }).getByRole('button');
  await expect(upcoming).not.toContainText('10/28 - 4:00 PM EDT');
  await expect(upcoming.getByText('Florida State', { exact: true })).toBeVisible();
  await expect(upcoming.getByText('Alabama', { exact: true })).toBeVisible();
  await expect(upcoming).not.toContainText('Seminoles');
  await expect(upcoming).not.toContainText('Crimson Tide');
  expect((await upcoming.boundingBox()).height).toBeLessThan((await live.getByRole('button').boundingBox()).height);
  await upcoming.click();
  await expect(upcoming).toHaveAttribute('aria-expanded', 'true');
  await upcoming.click();
  await live.getByRole('button').click();
  response = { ...response, games: [withScores([7, 14]), response.games[1]] };
  await page.clock.fastForward(30_000);
  await expect(live.getByRole('button', { name: 'Seattle Seahawks 7 vs Buffalo Bills 14' })).toHaveAttribute('aria-expanded', 'true');
  response = { ...response, freshness: { ...response.freshness, stale: true, error: 'Sports data is temporarily unavailable' } };
  await page.clock.fastForward(30_000);
  await expect(live.getByText(/Last reported live.*stale/)).toBeVisible();
  await expect(live.getByText('14', { exact: true })).toBeVisible();
  await live.getByRole('button').click();
  await page.screenshot({ path: testInfo.outputPath('games-scores-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(live.getByText('14', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('games-scores-mobile.png') });
});


test('icon tabs keep all sidebar views accessible on desktop and mobile', async ({ page }, testInfo) => {
  await mockPlayer(page, () => ({ games: [game], freshness: { stale: false, lastSuccessfulStatusAt: game.startsAt, error: null }, coverage: {} }));
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Player sidebar' });
  await expect(tabs.getByRole('tab')).toHaveCount(3);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of ['Live chat', 'Games', 'Channels']) {
      const tab = tabs.getByRole('tab', { name: label, exact: true });
      await expect(tab).toBeVisible();
      await expect(tab).toHaveAttribute('title', label);
      await expect(tab).toHaveText('');
      await tab.focus();
      await page.keyboard.press('Enter');
      await expect(tab).toHaveAttribute('aria-selected', 'true');
    }
    await expect(page.getByRole('region', { name: 'Channels', exact: true })).toBeVisible();
    await expect(page.getByText('Saved news')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-icon-tabs-${width}.png`) });
  }
});

test('sidebar resizes by dragging or keyboard, remembers its width and keeps the mobile layout', async ({ page }, testInfo) => {
  await mockPlayer(page, () => ({ games: [game], freshness: { stale: false, lastSuccessfulStatusAt: game.startsAt, error: null }, coverage: {} }));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  const sidebar = page.locator('#player-sidebar');
  const handle = page.getByRole('separator', { name: 'Resize sidebar' });
  await expect(handle).toHaveAttribute('aria-valuenow', '390');
  const bounds = await handle.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + bounds.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute('aria-valuenow', '490');
  expect((await sidebar.boundingBox()).width).toBe(490);
  await expect(page.locator('html')).not.toHaveClass(/sidebar-resizing/);
  await page.reload();
  await expect(handle).toHaveAttribute('aria-valuenow', '490');
  await handle.focus();
  await page.keyboard.press('Home');
  await expect(handle).toHaveAttribute('aria-valuenow', '300');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '316');
  await page.keyboard.press('End');
  await expect(handle).toHaveAttribute('aria-valuenow', '640');
  await page.keyboard.press('ArrowLeft');
  await expect(handle).toHaveAttribute('aria-valuenow', '640');
  await page.getByRole('tab', { name: 'Games', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Live', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Games', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('sidebar-resized-desktop.png') });
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(handle).toHaveAttribute('aria-valuenow', '544');
  expect((await page.getByRole('region', { name: 'Video player' }).boundingBox()).width).toBeGreaterThanOrEqual(480);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  expect((await sidebar.boundingBox()).width).toBe(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sidebar-resized-mobile.png') });
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(handle).toHaveAttribute('aria-valuenow', '640');
  await handle.dblclick();
  await expect(handle).toHaveAttribute('aria-valuenow', '390');
});
