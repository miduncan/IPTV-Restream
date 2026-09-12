const ffmpegService = require('./FFmpegService');
const storageService = require('./StorageService');
const SessionFactory = require('../session/SessionFactory');
const { waitForHlsManifest } = require('./waitForFile');

let startAllowed = () => true;
const channelOperationQueues = new Map();

function enqueueChannelOperation(channelId, operation) {
    const previous = channelOperationQueues.get(channelId) || Promise.resolve();
    const pending = previous.catch(() => undefined).then(operation);
    channelOperationQueues.set(channelId, pending);
    pending.finally(() => {
        if (channelOperationQueues.get(channelId) === pending) {
            channelOperationQueues.delete(channelId);
        }
    }).catch(() => undefined);
    return pending;
}

async function start(nextChannel) {
    return enqueueChannelOperation(nextChannel.id, () => startNow(nextChannel));
}

async function ensureReady(channel) {
    const pendingOperation = channelOperationQueues.get(channel.id);
    if (pendingOperation) await pendingOperation;

    if (ffmpegService.isFFmpegRunning(channel.id)) {
        const manifestPath = `${process.env.STORAGE_PATH}${channel.id}/${channel.id}.m3u8`;
        if (await waitForHlsManifest(manifestPath, { minimumSegments: 2 })) return true;
    }

    return start(channel);
}

async function startNow(nextChannel) {
    if (!startAllowed()) {
        console.log('Skipping restream start because there are no active viewers');
        return false;
    }

    console.log('Starting channel', nextChannel.id);
    if (ffmpegService.isFFmpegRunning(nextChannel.id)) {
        await ffmpegService.stopFFmpeg(nextChannel.id);
    }
    storageService.deleteChannelStorage(nextChannel.id);
    storageService.createChannelStorage(nextChannel.id);

    const sessionProvider = SessionFactory.getSessionProvider(nextChannel);
    if(sessionProvider) {
        await sessionProvider.createSession();
    }

    await ffmpegService.startFFmpeg(nextChannel);
    const manifestPath = `${process.env.STORAGE_PATH}${nextChannel.id}/${nextChannel.id}.m3u8`;
    const ready = await waitForHlsManifest(manifestPath, { minimumSegments: 2 });
    if (!ready) {
        await ffmpegService.stopFFmpeg(nextChannel.id);
        nextChannel.sessionUrl = null;
        storageService.deleteChannelStorage(nextChannel.id);
        throw new Error(`Channel ${nextChannel.id} did not produce a playable stream in time`);
    }
    console.log(`Channel ${nextChannel.id} is ready with two HLS segments`);
    return true;
}


async function stop(channel) {
    return enqueueChannelOperation(channel.id, () => stopNow(channel));
}

async function stopNow(channel) {
    console.log('Stopping channel', channel.id);
    if (ffmpegService.isFFmpegRunning(channel.id)) {
        await ffmpegService.stopFFmpeg(channel.id);
    }

    channel.sessionUrl = null;

    storageService.deleteChannelStorage(channel.id);
}

function isRunning(channelId) {
    return ffmpegService.isFFmpegRunning(channelId);
}

function setStartAllowed(predicate) {
    startAllowed = typeof predicate === 'function' ? predicate : () => true;
}

module.exports = {
    start,
    ensureReady,
    stop,
    isRunning,
    setStartAllowed
};
