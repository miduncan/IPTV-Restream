const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iptv-provider-selection-'));
process.env.SETTINGS_DB_PATH = path.join(directory, 'settings.db');
process.env.CHANNEL_SELECTION_REQUIRES_ADMIN = 'true';

// Replace the external playback runtime, following channel-switch.test.js.
const streamControllerPath = require.resolve('../services/restream/StreamController');
let start = async () => true;
require.cache[streamControllerPath] = {
  id: streamControllerPath, filename: streamControllerPath, loaded: true,
  exports: { start: channel => start(channel), ensureReady: async () => true, stop: async () => {} },
};

const settings = require('../services/settings/SettingsService');
const service = require('../services/ChannelService');
const storage = require('../services/ChannelStorage');
const channelController = require('../controllers/ChannelController');
const originalFetch = global.fetch;
let events;
let listeners;
let socket;

test.beforeEach(() => {
  service.clearChannels();
  settings.replace({ xtreamUrl: 'https://provider.example', xtreamUsername: 'private-user', xtreamPassword: 'private-password' });
  start = async () => true;
  global.fetch = async url => ({ ok: true, json: async () => new URL(url).searchParams.get('action') === 'get_live_streams'
    ? [{ stream_id: 42, name: 'Current provider name', category_id: '1' }] : [] });
  events = [];
  listeners = new Map();
  socket = { user: { role: 'admin' }, on: (name, listener) => listeners.set(name, listener), emit: (name, payload) => events.push({ name, payload }) };
  delete require.cache[require.resolve('../socket/ChannelSocketHandler')];
  require('../socket/ChannelSocketHandler')({ emit: (name, payload) => events.push({ name, payload: JSON.parse(JSON.stringify(payload)) }) }, socket);
});

async function select(event, value) {
  let reply;
  await listeners.get(event)(value, response => { reply = response; });
  return reply;
}

test('an unsaved provider channel plays with an empty lineup and private backend credentials', async () => {
  assert.deepEqual(await select('set-current-provider-channel', '42'), { ok: true });
  const selected = events.find(event => event.name === 'channel-selected').payload;
  assert.equal(selected.name, 'Current provider name');
  assert.equal(selected.mode, 'restream');
  assert.equal(selected.sourceId, '42');
  assert.equal(selected.id, -42);
  assert.equal(selected.url, '');
  assert.equal(JSON.stringify(events).includes('private-'), false);
  assert.equal(service.getCurrentChannel().url, 'https://provider.example/live/private-user/private-password/42.ts');
  assert.equal(service.getChannelById(-42), service.getCurrentChannel());
  assert.deepEqual(service.getChannels(), []);
  assert.deepEqual(storage.load(), []);
  let current;
  channelController.getCurrentChannel({}, { json: value => { current = JSON.parse(JSON.stringify(value)); } });
  assert.equal(current.url, '');
});

test('a viewer can react to the channel identity emitted after selecting an unsaved Games feed', async () => {
  assert.deepEqual(await select('set-current-provider-channel', '42'), { ok: true });
  const selected = events.find(event => event.name === 'channel-selected').payload;
  socket.broadcast = { emit: (name, payload) => events.push({ name, payload }) };
  require('../socket/ReactionSocketHandler')({}, socket);
  const reply = await select('send-reaction', {
    userName: 'Maya', emoji: '🏈', channelId: selected.id,
    playback: { segmentSequence: 8401, segmentOffset: 1.25 },
  });
  assert.equal(reply.ok, true);
  const reaction = events.find(event => event.name === 'video-reaction').payload;
  assert.equal(reaction.id, reply.reactionId);
  assert.equal(reaction.channelId, selected.id);
  assert.deepEqual(reaction.playback, { segmentSequence: 8401, segmentOffset: 1.25 });
});

test('provider resolution failures never expose credential-bearing request errors', async () => {
  global.fetch = async () => { throw new Error('fetch failed https://provider.example?password=private-password'); };
  const reply = await select('set-current-provider-channel', '42');
  assert.equal(reply.ok, false);
  assert.equal(JSON.stringify({ events, reply }).includes('private-password'), false);
  assert.equal(service.getCurrentChannel(), undefined);
  assert.deepEqual(storage.load(), []);
});

test('selection restrictions deny provider playback before resolving the catalog', async () => {
  socket.user = { role: 'viewer' };
  let requested = false;
  global.fetch = async () => { requested = true; throw new Error('must not resolve'); };
  assert.deepEqual(await select('set-current-provider-channel', '42'), { ok: false, error: 'Admin access required to switch channel' });
  assert.equal(requested, false);
  assert.equal(service.getCurrentChannel(), undefined);
  assert.equal(events.some(event => event.name === 'channel-switching'), false);
});

test('unavailable identities and arbitrary client stream URLs cannot start playback', async () => {
  for (const value of ['43', 'https://attacker.example/stream', { streamId: '42', url: 'https://attacker.example/stream' }, '0', '9007199254740993']) {
    assert.equal((await select('set-current-provider-channel', value)).ok, false);
  }
  assert.equal(service.getCurrentChannel(), undefined);
  assert.equal(events.some(event => event.name === 'channel-switching'), false);
});

test('a failed transient playback restores the saved channel and leaves the lineup unchanged', async () => {
  const saved = service.addChannel({ name: 'Saved', url: 'https://saved.example/stream', mode: 'direct' });
  await select('set-current-channel', saved.id);
  const lineup = storage.load();
  start = async () => { throw new Error('upstream failed'); };
  assert.deepEqual(await select('set-current-provider-channel', '42'), { ok: false, error: 'upstream failed' });
  assert.equal(service.getCurrentChannel(), saved);
  assert.deepEqual(storage.load(), lineup);
  assert.deepEqual(service.getChannels(), [saved]);
  assert.equal(events.at(-2).name, 'channel-switch-failed');
  assert.equal(events.at(-2).payload.channel.id, saved.id);
});

test('a viewer can return from a transient provider stream to the unchanged saved lineup', async () => {
  const saved = service.addChannel({ name: 'Saved', url: 'https://saved.example/stream', mode: 'direct' });
  const lineup = storage.load();
  assert.equal((await select('set-current-provider-channel', '42')).ok, true);
  assert.equal((await select('set-current-channel', saved.id)).ok, true);
  assert.equal(service.getCurrentChannel(), saved);
  assert.deepEqual(service.getChannels(), [saved]);
  assert.deepEqual(storage.load(), lineup);
  await new Promise(resolve => setImmediate(resolve));
});

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

test('a slow provider lookup cannot replace a newer saved-channel choice', async () => {
  const lookup = deferred();
  const saved = service.addChannel({ name: 'Saved', url: 'https://saved.example/stream', mode: 'direct' });
  global.fetch = async url => ({ ok: true, json: () => new URL(url).searchParams.get('action') === 'get_live_streams' ? lookup.promise : [] });
  const pending = select('set-current-provider-channel', '42');
  assert.equal((await select('set-current-channel', saved.id)).ok, true);
  lookup.resolve([{ stream_id: 42, name: 'Provider' }]);
  assert.equal((await pending).ok, false);
  assert.equal(service.getCurrentChannel(), saved);
  assert.deepEqual(events.filter(event => event.name === 'channel-selected').map(event => event.payload.id), [saved.id]);
});

test('saved and provider switches share the readiness queue and publish the latest choice', async () => {
  const readiness = deferred();
  const started = deferred();
  const saved = service.addChannel({ name: 'Saved', url: 'https://saved.example/stream', mode: 'direct' });
  start = async () => { started.resolve(); return readiness.promise; };
  const provider = select('set-current-provider-channel', '42');
  await started.promise;
  const next = select('set-current-channel', saved.id);
  assert.equal(service.getCurrentChannel(), undefined);
  readiness.resolve(true);
  assert.equal((await provider).ok, true);
  assert.equal((await next).ok, true);
  assert.equal(service.getCurrentChannel(), saved);
  assert.deepEqual(events.filter(event => event.name === 'channel-selected').map(event => event.payload.id), [saved.id]);
  await new Promise(resolve => setImmediate(resolve));
});

test('concurrent requests for the same provider feed reuse the ready stream', async () => {
  const readiness = deferred();
  const started = deferred();
  let starts = 0;
  start = async () => { starts += 1; started.resolve(); return readiness.promise; };
  const first = select('set-current-provider-channel', '42');
  await started.promise;
  const second = select('set-current-provider-channel', '42');
  await new Promise(resolve => setImmediate(resolve));
  readiness.resolve(true);
  await Promise.all([first, second]);
  assert.equal(service.getCurrentChannel().id, -42);
  assert.equal(starts, 1);
});

test.after(() => { global.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); });
