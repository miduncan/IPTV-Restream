const assert = require('node:assert/strict');
const test = require('node:test');

const channelServicePath = require.resolve('../services/ChannelService');
const channelStoragePath = require.resolve('../services/ChannelStorage');
const streamControllerPath = require.resolve('../services/restream/StreamController');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function channel(id) {
    return { id, name: `Channel ${id}`, sessionUrl: null, restream: () => true };
}

function loadService(channels, streamController) {
    require.cache[channelStoragePath] = {
        id: channelStoragePath,
        filename: channelStoragePath,
        loaded: true,
        exports: { load: () => channels },
    };
    require.cache[streamControllerPath] = {
        id: streamControllerPath,
        filename: streamControllerPath,
        loaded: true,
        exports: streamController,
    };
    delete require.cache[channelServicePath];
    return require(channelServicePath);
}

test('warms the next stream before publishing it and retires the old stream afterward', async () => {
    const first = channel(1);
    const second = channel(2);
    const warmup = deferred();
    const calls = [];
    const service = loadService([first, second], {
        start: async next => {
            calls.push(`start:${next.id}`);
            return warmup.promise;
        },
        ensureReady: async () => true,
        stop: async previous => calls.push(`stop:${previous.id}`),
    });

    const switching = service.setCurrentChannel(second.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(service.getCurrentChannel(), first);
    assert.deepEqual(calls, ['start:2']);

    warmup.resolve(true);
    assert.equal(await switching, second);
    assert.equal(service.getCurrentChannel(), second);
    assert.deepEqual(calls, ['start:2']);

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['start:2', 'stop:1']);
});

test('keeps the old channel current when the new stream fails to warm up', async () => {
    const first = channel(1);
    const second = channel(2);
    const calls = [];
    const service = loadService([first, second], {
        start: async next => {
            calls.push(`start:${next.id}`);
            throw new Error('upstream failed');
        },
        ensureReady: async () => true,
        stop: async previous => calls.push(`stop:${previous.id}`),
    });

    await assert.rejects(service.setCurrentChannel(second.id), /upstream failed/);
    assert.equal(service.getCurrentChannel(), first);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, ['start:2']);
});

test('waits for an in-progress current restream instead of publishing stale files', async () => {
    const first = channel(1);
    const readiness = deferred();
    let ensureCalls = 0;
    const service = loadService([first], {
        start: async () => true,
        ensureReady: async () => {
            ensureCalls += 1;
            return readiness.promise;
        },
        stop: async () => undefined,
    });

    const switching = service.setCurrentChannel(first.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ensureCalls, 1);

    readiness.resolve(true);
    assert.equal(await switching, first);
});

test('waits for the prior retirement before warming another stream', async () => {
    const first = channel(1);
    const second = channel(2);
    const third = channel(3);
    const retirement = deferred();
    const starts = [];
    const service = loadService([first, second, third], {
        start: async next => {
            starts.push(next.id);
            return true;
        },
        ensureReady: async () => true,
        stop: previous => previous.id === first.id ? retirement.promise : Promise.resolve(),
    });

    await service.setCurrentChannel(second.id);
    await new Promise(resolve => setImmediate(resolve));
    const switchAgain = service.setCurrentChannel(third.id);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(starts, [second.id]);

    retirement.resolve();
    await switchAgain;
    assert.deepEqual(starts, [second.id, third.id]);
});

test.after(() => {
    delete require.cache[channelServicePath];
    delete require.cache[channelStoragePath];
    delete require.cache[streamControllerPath];
});
