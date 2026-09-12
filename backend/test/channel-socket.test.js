const assert = require('node:assert/strict');
const test = require('node:test');

const handlerPath = require.resolve('../socket/ChannelSocketHandler');
const channelServicePath = require.resolve('../services/ChannelService');
const authServicePath = require.resolve('../services/auth/AuthService');
const broadcastPath = require.resolve('../socket/broadcastChannelSelection');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function loadHandler(channelService, broadcasts) {
  require.cache[channelServicePath] = {
    id: channelServicePath,
    filename: channelServicePath,
    loaded: true,
    exports: channelService,
  };
  require.cache[authServicePath] = {
    id: authServicePath,
    filename: authServicePath,
    loaded: true,
    exports: {
      channelSelectionRequiresAdmin: () => false,
      hasRole: () => true,
    },
  };
  require.cache[broadcastPath] = {
    id: broadcastPath,
    filename: broadcastPath,
    loaded: true,
    exports: (_io, channel) => broadcasts.push(channel),
  };
  delete require.cache[handlerPath];
  return require(handlerPath);
}

function createSocket() {
  const listeners = new Map();
  const events = [];
  return {
    user: { role: 'admin' },
    listeners,
    events,
    on(event, listener) { listeners.set(event, listener); },
    emit(event, payload) { events.push({ event, payload }); },
  };
}

test('announces a switch immediately and publishes playback only when ready', async () => {
  const nextChannel = { id: 2, name: 'Channel 2' };
  const warmup = deferred();
  const broadcasts = [];
  const ioEvents = [];
  const handler = loadHandler({
    getChannelById: () => nextChannel,
    getCurrentChannel: () => ({ id: 1, name: 'Channel 1' }),
    setCurrentChannel: () => warmup.promise,
  }, broadcasts);
  const socket = createSocket();
  const io = { emit(event, payload) { ioEvents.push({ event, payload }); } };
  handler(io, socket);

  let acknowledgement;
  const switching = socket.listeners.get('set-current-channel')(2, response => {
    acknowledgement = response;
  });

  assert.deepEqual(ioEvents[0], {
    event: 'channel-switching',
    payload: { channel: nextChannel, revision: 1 },
  });
  assert.deepEqual(broadcasts, []);

  warmup.resolve(nextChannel);
  await switching;

  assert.deepEqual(broadcasts, [nextChannel]);
  assert.deepEqual(acknowledgement, { ok: true });
});

test('ignores a stale completion after a newer channel was requested', async () => {
  const channels = new Map([
    [2, { id: 2, name: 'Channel 2' }],
    [3, { id: 3, name: 'Channel 3' }],
  ]);
  const warmups = new Map([[2, deferred()], [3, deferred()]]);
  const broadcasts = [];
  const handler = loadHandler({
    getChannelById: id => channels.get(id),
    getCurrentChannel: () => channels.get(2),
    setCurrentChannel: id => warmups.get(id).promise,
  }, broadcasts);
  const socket = createSocket();
  const io = { emit() {} };
  handler(io, socket);

  const first = socket.listeners.get('set-current-channel')(2, () => {});
  const second = socket.listeners.get('set-current-channel')(3, () => {});
  warmups.get(2).resolve(channels.get(2));
  await first;
  assert.deepEqual(broadcasts, []);

  warmups.get(3).resolve(channels.get(3));
  await second;
  assert.deepEqual(broadcasts, [channels.get(3)]);
});

test('restores the current channel when the latest switch fails', async () => {
  const currentChannel = { id: 1, name: 'Channel 1' };
  const nextChannel = { id: 2, name: 'Channel 2' };
  const broadcasts = [];
  const ioEvents = [];
  const handler = loadHandler({
    getChannelById: () => nextChannel,
    getCurrentChannel: () => currentChannel,
    setCurrentChannel: async () => { throw new Error('upstream failed'); },
  }, broadcasts);
  const socket = createSocket();
  const io = { emit(event, payload) { ioEvents.push({ event, payload }); } };
  handler(io, socket);

  let acknowledgement;
  await socket.listeners.get('set-current-channel')(2, response => {
    acknowledgement = response;
  });

  assert.equal(ioEvents[0].event, 'channel-switching');
  assert.deepEqual(ioEvents[1], {
    event: 'channel-switch-failed',
    payload: { channel: currentChannel, revision: 1 },
  });
  assert.deepEqual(socket.events, [{ event: 'app-error', payload: { message: 'upstream failed' } }]);
  assert.deepEqual(acknowledgement, { ok: false, error: 'upstream failed' });
  assert.deepEqual(broadcasts, []);
});

test.after(() => {
  delete require.cache[handlerPath];
  delete require.cache[channelServicePath];
  delete require.cache[authServicePath];
  delete require.cache[broadcastPath];
});
