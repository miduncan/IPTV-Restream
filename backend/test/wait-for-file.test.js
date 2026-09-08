const assert = require('node:assert/strict');
const test = require('node:test');

const waitForFile = require('../services/restream/waitForFile');
const { manifestHasSegments, waitForHlsManifest } = waitForFile;

test('waits until a restream manifest becomes available', async () => {
    let checks = 0;
    const delays = [];
    const ready = await waitForFile('/streams/7/7.m3u8', {
        timeoutMs: 1_000,
        intervalMs: 100,
        exists: () => ++checks === 3,
        delay: async milliseconds => delays.push(milliseconds),
    });

    assert.equal(ready, true);
    assert.equal(checks, 3);
    assert.deepEqual(delays, [100, 100]);
});

test('stops waiting after the readiness timeout', async () => {
    let currentTime = 1_000;
    const ready = await waitForFile('/streams/7/7.m3u8', {
        timeoutMs: 250,
        intervalMs: 100,
        exists: () => false,
        delay: async milliseconds => { currentTime += milliseconds; },
        now: () => currentTime,
    });
    assert.equal(ready, false);
    assert.equal(currentTime, 1_250);
});

test('requires multiple HLS segments before treating a manifest as playable', () => {
    const oneSegment = '#EXTM3U\n#EXTINF:6,\none.ts\n';
    const threeSegments = `${oneSegment}#EXTINF:6,\ntwo.ts\n#EXTINF:6,\nthree.ts\n`;

    assert.equal(manifestHasSegments(oneSegment), false);
    assert.equal(manifestHasSegments(threeSegments), true);
});

test('waits for a live manifest to contain enough buffered segments', async () => {
    const manifests = [
        '#EXTM3U\n',
        '#EXTM3U\n#EXTINF:6,\none.ts\n',
        '#EXTM3U\n#EXTINF:6,\none.ts\n#EXTINF:6,\ntwo.ts\n#EXTINF:6,\nthree.ts\n',
    ];
    let reads = 0;

    const ready = await waitForHlsManifest('/streams/7/7.m3u8', {
        readFile: () => manifests[Math.min(reads++, manifests.length - 1)],
        delay: async () => {},
    });

    assert.equal(ready, true);
    assert.equal(reads, 3);
});
