import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const iterations = positiveInteger(process.env.SOAK_ITERATIONS, 6, 'SOAK_ITERATIONS');
const observeSeconds = positiveNumber(process.env.SOAK_OBSERVE_SECONDS, 45, 'SOAK_OBSERVE_SECONDS');
const startupTimeoutMs = positiveNumber(process.env.SOAK_STARTUP_TIMEOUT_MS, 45_000, 'SOAK_STARTUP_TIMEOUT_MS');
const requestedChannelIds = parseChannelIds(process.env.SOAK_CHANNEL_IDS);

function positiveNumber(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number.`);
  return parsed;
}

function positiveInteger(value, fallback, name) {
  const parsed = positiveNumber(value, fallback, name);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

function parseChannelIds(value) {
  if (!value) return null;
  const ids = value.split(',').map(part => Number(part.trim()));
  if (ids.length < 2 || ids.some(id => !Number.isInteger(id) || id <= 0) || new Set(ids).size < 2) {
    throw new Error('SOAK_CHANNEL_IDS must contain at least two distinct positive channel IDs.');
  }
  return ids;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.ceil(sorted.length * fraction) - 1]);
}

function aggregate(cycles) {
  const passed = cycles.filter(cycle => cycle.ok);
  const metric = name => cycles.map(cycle => cycle[name]).filter(Number.isFinite);
  return {
    cycles: cycles.length,
    passed: passed.length,
    failed: cycles.length - passed.length,
    successRatePercent: cycles.length ? Math.round(passed.length / cycles.length * 10_000) / 100 : 0,
    switchMs: { median: percentile(metric('switchMs'), 0.5), p95: percentile(metric('switchMs'), 0.95) },
    firstManifestMs: { median: percentile(metric('firstManifestMs'), 0.5), p95: percentile(metric('firstManifestMs'), 0.95) },
    firstSegmentMs: { median: percentile(metric('firstSegmentMs'), 0.5), p95: percentile(metric('firstSegmentMs'), 0.95) },
    firstPlayingMs: { median: percentile(metric('firstPlayingMs'), 0.5), p95: percentile(metric('firstPlayingMs'), 0.95) },
    totalRebuffers: cycles.reduce((sum, cycle) => sum + cycle.rebufferCount, 0),
    totalRebufferMs: cycles.reduce((sum, cycle) => sum + cycle.rebufferMs, 0),
    startupManifest404s: cycles.reduce((sum, cycle) => sum + cycle.startupManifest404s, 0),
    requestFailures: cycles.reduce((sum, cycle) => sum + cycle.requestFailures.length, 0),
  };
}

async function signInIfRequired(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    Boolean(document.querySelector('input[name="username"]'))
    || Boolean(document.querySelector('[role="tab"][aria-controls="channels-panel"]'))
  ));
  const usernameInput = page.getByRole('textbox', { name: 'Username' });
  if (!await usernameInput.isVisible().catch(() => false)) return;

  const username = process.env.SOAK_USERNAME || process.env.AUTH_ADMIN_USERNAME;
  const password = process.env.SOAK_PASSWORD || process.env.AUTH_ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Authentication is enabled. Set SOAK_USERNAME and SOAK_PASSWORD (or AUTH_ADMIN_USERNAME and AUTH_ADMIN_PASSWORD).');
  }
  await usernameInput.fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('tab', { name: /Channels/ })).toBeVisible();
}

async function jsonResponse(response, description) {
  if (!response.ok()) throw new Error(`${description} returned HTTP ${response.status()}.`);
  return response.json();
}

async function assertSyncDisabled(page, phase) {
  const status = await jsonResponse(await page.request.get('/api/auth/admin-status'), 'Admin status');
  if (status.streamSynchronizationEnabled !== false) {
    const error = new Error(`SYNC_ENABLED: stream synchronization became enabled during ${phase}; the soak test stopped.`);
    error.code = 'SYNC_ENABLED';
    throw error;
  }
}

async function installVideoProbe(page) {
  await page.addInitScript(() => {
    const state = window.__streamSoak = {
      anchor: performance.now(),
      events: [],
      attached: new WeakSet(),
    };

    const snapshot = (video, type) => {
      const ranges = [];
      for (let index = 0; index < video.buffered.length; index += 1) {
        ranges.push([video.buffered.start(index), video.buffered.end(index)]);
      }
      const currentRange = ranges.find(([start, end]) => video.currentTime >= start && video.currentTime <= end);
      state.events.push({
        atMs: Math.round(performance.now() - state.anchor),
        type,
        currentTime: video.currentTime,
        readyState: video.readyState,
        networkState: video.networkState,
        paused: video.paused,
        playbackRate: video.playbackRate,
        bufferAhead: currentRange ? Math.max(0, currentRange[1] - video.currentTime) : 0,
        errorCode: video.error?.code || null,
      });
    };

    const attach = video => {
      if (state.attached.has(video)) return;
      state.attached.add(video);
      for (const type of [
        'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'play', 'playing',
        'waiting', 'stalled', 'seeking', 'seeked', 'pause', 'emptied', 'error',
      ]) video.addEventListener(type, () => snapshot(video, type));
    };

    const scan = () => document.querySelectorAll('video').forEach(attach);
    new MutationObserver(scan).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', scan);
  });
}

async function resetVideoProbe(page) {
  await page.evaluate(() => {
    window.__streamSoak.anchor = performance.now();
    window.__streamSoak.events = [];
  });
}

async function videoEvents(page) {
  return page.evaluate(() => window.__streamSoak?.events || []);
}

function playbackSummary(events) {
  const loadStartIndex = events.findIndex(event => event.type === 'loadstart');
  const firstPlaying = loadStartIndex < 0
    ? undefined
    : events.slice(loadStartIndex + 1).find(event => event.type === 'playing');
  let waitingAt = null;
  let rebufferCount = 0;
  let rebufferMs = 0;
  for (const event of events) {
    if (event.type === 'waiting' && firstPlaying && event.atMs > firstPlaying.atMs && waitingAt === null) {
      waitingAt = event.atMs;
      rebufferCount += 1;
    } else if (event.type === 'playing' && waitingAt !== null) {
      rebufferMs += event.atMs - waitingAt;
      waitingAt = null;
    }
  }
  const lastEventAt = events.at(-1)?.atMs || 0;
  if (waitingAt !== null) rebufferMs += Math.max(0, lastEventAt - waitingAt);
  return { firstPlayingMs: firstPlaying?.atMs ?? null, rebufferCount, rebufferMs };
}

test('channel switches remain playable with synchronization disabled', async ({ page }, testInfo) => {
  test.slow();
  await installVideoProbe(page);

  const networkEvents = [];
  const requestStartedAt = new WeakMap();
  const consoleErrors = [];
  let cycleAnchor = performance.now();

  const isMediaRequest = url => {
    const pathname = new URL(url).pathname;
    return pathname.includes('/streams/') || pathname.startsWith('/proxy/');
  };
  const safePath = url => {
    const parsed = new URL(url);
    return parsed.pathname;
  };

  page.on('request', request => {
    if (isMediaRequest(request.url())) requestStartedAt.set(request, performance.now());
  });
  page.on('response', response => {
    const request = response.request();
    const startedAt = requestStartedAt.get(request);
    if (startedAt === undefined) return;
    networkEvents.push({
      atMs: Math.round(performance.now() - cycleAnchor),
      durationMs: Math.round(performance.now() - startedAt),
      method: request.method(),
      path: safePath(request.url()),
      status: response.status(),
      resourceType: request.resourceType(),
    });
  });
  page.on('requestfailed', request => {
    if (!isMediaRequest(request.url())) return;
    networkEvents.push({
      atMs: Math.round(performance.now() - cycleAnchor),
      method: request.method(),
      path: safePath(request.url()),
      failure: request.failure()?.errorText || 'request failed',
      resourceType: request.resourceType(),
    });
  });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push({ at: new Date().toISOString(), text: message.text().slice(0, 1_000) });
  });
  page.on('pageerror', error => consoleErrors.push({ at: new Date().toISOString(), text: error.message.slice(0, 1_000) }));

  await signInIfRequired(page);
  await page.evaluate(() => localStorage.setItem('streamhub:skip-channel-change-confirmation', 'true'));
  await page.reload();
  await assertSyncDisabled(page, 'startup');

  const channels = await jsonResponse(await page.request.get('/api/channels/'), 'Channel list');
  const selectedChannels = requestedChannelIds
    ? requestedChannelIds.map(id => channels.find(channel => channel.id === id))
    : channels.filter(channel => channel.mode === 'restream').slice(0, 2);

  if (selectedChannels.some(channel => !channel)) throw new Error('SOAK_CHANNEL_IDS contains an unknown channel ID.');
  if (selectedChannels.length < 2) throw new Error('At least two known-good restream channels are required.');
  if (selectedChannels.some(channel => channel.mode !== 'restream')) {
    throw new Error('This diagnostic currently accepts only restream channels so results remain comparable.');
  }

  const current = await jsonResponse(await page.request.get('/api/channels/current'), 'Current channel');
  const orderedChannels = current
    ? [...selectedChannels.filter(channel => channel.id !== current.id), ...selectedChannels.filter(channel => channel.id === current.id)]
    : selectedChannels;
  const publicChannels = orderedChannels.map(({ id, name, mode }) => ({ id, name, mode }));
  testInfo.annotations.push({
    type: 'channels',
    description: publicChannels.map(channel => `${channel.id}: ${channel.name}`).join(', '),
  });

  await page.getByRole('tab', { name: /Channels/ }).click();
  const cycles = [];
  for (let index = 0; index < iterations; index += 1) {
    await assertSyncDisabled(page, `before cycle ${index + 1}`);
    const channel = orderedChannels[index % orderedChannels.length];
    const cycle = {
      iteration: index + 1,
      channel: { id: channel.id, name: channel.name, mode: channel.mode },
      ok: false,
      switchMs: null,
      firstManifestMs: null,
      firstSegmentMs: null,
      firstPlayingMs: null,
      rebufferCount: 0,
      rebufferMs: 0,
      requestFailures: [],
      startupManifest404s: 0,
      consoleErrors: [],
      videoEvents: [],
      networkEvents: [],
    };
    cycles.push(cycle);

    cycleAnchor = performance.now();
    const eventStart = networkEvents.length;
    const consoleStart = consoleErrors.length;
    await resetVideoProbe(page);

    try {
      const search = page.getByPlaceholder('Search channels');
      await search.fill(channel.name);
      const row = page.locator('#channels-panel button.channel-row').filter({ hasText: channel.name }).first();
      await expect(row).toBeVisible();
      await row.click();
      await expect(row).toHaveClass(/channel-row-active/, { timeout: startupTimeoutMs });
      cycle.switchMs = Math.round(performance.now() - cycleAnchor);

      const playbackDeadline = performance.now() + startupTimeoutMs;
      let playbackStarted = false;
      while (performance.now() < playbackDeadline) {
        const events = await videoEvents(page);
        const loadStartIndex = events.findIndex(event => event.type === 'loadstart');
        playbackStarted = loadStartIndex >= 0
          && events.slice(loadStartIndex + 1).some(event => event.type === 'playing');
        if (playbackStarted) break;
        await page.waitForTimeout(Math.min(1_000, playbackDeadline - performance.now()));
        await assertSyncDisabled(page, `startup for cycle ${index + 1}`);
      }
      if (!playbackStarted) throw new Error(`new channel did not start playing within ${startupTimeoutMs}ms`);

      const observationDeadline = performance.now() + observeSeconds * 1000;
      while (performance.now() < observationDeadline) {
        await page.waitForTimeout(Math.min(5_000, observationDeadline - performance.now()));
        await assertSyncDisabled(page, `cycle ${index + 1}`);
      }

      cycle.videoEvents = await videoEvents(page);
      Object.assign(cycle, playbackSummary(cycle.videoEvents));
      cycle.networkEvents = networkEvents.slice(eventStart);
      cycle.consoleErrors = consoleErrors.slice(consoleStart);
      const manifest = cycle.networkEvents.find(event => event.status >= 200 && event.status < 300 && event.path.endsWith('.m3u8'));
      const segment = cycle.networkEvents.find(event => event.status >= 200 && event.status < 300 && /\.(ts|m4s|mp4|aac)$/.test(event.path));
      cycle.firstManifestMs = manifest?.atMs ?? null;
      cycle.firstSegmentMs = segment?.atMs ?? null;
      cycle.startupManifest404s = cycle.networkEvents.filter(event => (
        event.atMs < (cycle.firstManifestMs ?? Number.POSITIVE_INFINITY)
        && event.status === 404
        && event.path.endsWith('.m3u8')
      )).length;
      cycle.requestFailures = cycle.networkEvents.filter(event => (
        event.failure
        || (event.status && event.status >= 400 && !(
          event.atMs < (cycle.firstManifestMs ?? Number.POSITIVE_INFINITY)
          && event.status === 404
          && event.path.endsWith('.m3u8')
        ))
      ));
      cycle.ok = cycle.firstPlayingMs !== null && cycle.rebufferCount === 0 && cycle.requestFailures.length === 0;
      if (!cycle.ok) {
        cycle.failure = `playing=${cycle.firstPlayingMs !== null}, rebuffers=${cycle.rebufferCount}, requestFailures=${cycle.requestFailures.length}`;
      }
    } catch (error) {
      if (error.code === 'SYNC_ENABLED' || error.message?.startsWith('SYNC_ENABLED:')) throw error;
      cycle.failure = String(error.message || error).slice(0, 1_000);
      cycle.videoEvents = await videoEvents(page);
      Object.assign(cycle, playbackSummary(cycle.videoEvents));
      cycle.networkEvents = networkEvents.slice(eventStart);
      cycle.consoleErrors = consoleErrors.slice(consoleStart);
      const manifest = cycle.networkEvents.find(event => event.status >= 200 && event.status < 300 && event.path.endsWith('.m3u8'));
      cycle.firstManifestMs = manifest?.atMs ?? null;
      cycle.startupManifest404s = cycle.networkEvents.filter(event => (
        event.atMs < (cycle.firstManifestMs ?? Number.POSITIVE_INFINITY)
        && event.status === 404
        && event.path.endsWith('.m3u8')
      )).length;
      cycle.requestFailures = cycle.networkEvents.filter(event => (
        event.failure
        || (event.status && event.status >= 400 && !(
          event.atMs < (cycle.firstManifestMs ?? Number.POSITIVE_INFINITY)
          && event.status === 404
          && event.path.endsWith('.m3u8')
        ))
      ));
    } finally {
      cycle.totalMs = Math.round(performance.now() - cycleAnchor);
      console.log(
        `[${cycle.iteration}/${iterations}] channel ${channel.id}: ${cycle.ok ? 'PASS' : 'FAIL'} `
        + `switch=${cycle.switchMs ?? '-'}ms playing=${cycle.firstPlayingMs ?? '-'}ms `
        + `rebuffers=${cycle.rebufferCount} requestFailures=${cycle.requestFailures.length}`
      );
    }
  }

  const report = {
    startedWithSynchronizationEnabled: false,
    configuration: { iterations, observeSeconds, startupTimeoutMs },
    channels: publicChannels,
    aggregate: aggregate(cycles),
    cycles,
  };
  const reportPath = testInfo.outputPath('stream-switch-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await testInfo.attach('stream-switch-report', { path: reportPath, contentType: 'application/json' });
  console.log(JSON.stringify(report.aggregate, null, 2));

  expect(report.aggregate.failed, 'Every channel-switch cycle should play without rebuffering or media request failures.').toBe(0);
});
