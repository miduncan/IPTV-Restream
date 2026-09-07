const assert = require('node:assert/strict');
const test = require('node:test');

const RestreamIdleManager = require('../services/restream/RestreamIdleManager');

function createHarness() {
    const channel = { id: 7, restream: () => true };
    const calls = [];
    const timers = [];
    let running = false;

    const streamController = {
        isRunning: () => running,
        start: async selectedChannel => {
            calls.push(['start', selectedChannel.id]);
            running = true;
        },
        stop: async selectedChannel => {
            calls.push(['stop', selectedChannel.id]);
            running = false;
        },
    };

    const manager = new RestreamIdleManager({
        getCurrentChannel: () => channel,
        streamController,
        setTimer: (callback, delay) => {
            const timer = { callback, delay, cleared: false, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimer: timer => {
            timer.cleared = true;
        },
    });

    return { calls, manager, timers };
}

test('starts the current restream when the first viewer connects', async () => {
    const { calls, manager } = createHarness();

    assert.equal(manager.isStreamingAllowed(), false);
    manager.viewerConnected('viewer-1');
    await manager.waitForPendingOperations();

    assert.equal(manager.isStreamingAllowed(), true);
    assert.deepEqual(calls, [['start', 7]]);
});

test('stops the restream five minutes after the last viewer disconnects', async () => {
    const { calls, manager, timers } = createHarness();

    manager.viewerConnected('viewer-1');
    await manager.waitForPendingOperations();
    manager.viewerDisconnected('viewer-1');

    assert.equal(timers[0].delay, 5 * 60 * 1000);
    assert.deepEqual(calls, [['start', 7]]);

    timers[0].callback();
    await manager.waitForPendingOperations();

    assert.equal(manager.isStreamingAllowed(), false);
    assert.deepEqual(calls, [['start', 7], ['stop', 7]]);
});

test('cancels idle shutdown when a viewer reconnects during the grace period', async () => {
    const { calls, manager, timers } = createHarness();

    manager.viewerConnected('viewer-1');
    await manager.waitForPendingOperations();
    manager.viewerDisconnected('viewer-1');
    manager.viewerConnected('viewer-2');
    await manager.waitForPendingOperations();

    assert.equal(timers[0].cleared, true);
    assert.deepEqual(calls, [['start', 7]]);
});

test('waits until every viewer disconnects before scheduling shutdown', async () => {
    const { manager, timers } = createHarness();

    manager.viewerConnected('viewer-1');
    manager.viewerConnected('viewer-2');
    await manager.waitForPendingOperations();
    manager.viewerDisconnected('viewer-1');
    assert.equal(timers.length, 0);

    manager.viewerDisconnected('viewer-2');
    assert.equal(timers.length, 1);
});
