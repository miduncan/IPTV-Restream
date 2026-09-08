const fs = require('node:fs');

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 250;

async function waitForFile(
    filePath,
    {
        timeoutMs = DEFAULT_TIMEOUT_MS,
        intervalMs = DEFAULT_INTERVAL_MS,
        exists = fs.existsSync,
        isReady = exists,
        delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
        now = Date.now,
    } = {}
) {
    const deadline = now() + timeoutMs;
    while (!isReady(filePath)) {
        const remaining = deadline - now();
        if (remaining <= 0) return false;
        await delay(Math.min(intervalMs, remaining));
    }
    return true;
}

function manifestHasSegments(manifest, minimumSegments = 3) {
    return (String(manifest).match(/^#EXTINF:/gm) || []).length >= minimumSegments;
}

function waitForHlsManifest(filePath, options = {}) {
    const { minimumSegments = 3, readFile = fs.readFileSync, ...waitOptions } = options;
    return waitForFile(filePath, {
        ...waitOptions,
        isReady: path => {
            try {
                return manifestHasSegments(readFile(path, 'utf8'), minimumSegments);
            } catch {
                return false;
            }
        },
    });
}

module.exports = waitForFile;
module.exports.DEFAULT_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
module.exports.manifestHasSegments = manifestHasSegments;
module.exports.waitForHlsManifest = waitForHlsManifest;
