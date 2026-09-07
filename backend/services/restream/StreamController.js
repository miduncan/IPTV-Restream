const ffmpegService = require('./FFmpegService');
const storageService = require('./StorageService');
const SessionFactory = require('../session/SessionFactory');

let startAllowed = () => true;

async function start(nextChannel) {
    if (!startAllowed()) {
        console.log('Skipping restream start because there are no active viewers');
        return false;
    }

    console.log('Starting channel', nextChannel.id);
    storageService.createChannelStorage(nextChannel.id);

    const sessionProvider = SessionFactory.getSessionProvider(nextChannel);
    if(sessionProvider) {
        await sessionProvider.createSession();
    }

    ffmpegService.startFFmpeg(nextChannel);
    return true;
}


async function stop(channel) {
    console.log('Stopping channel', channel.id);
    if (ffmpegService.isFFmpegRunning()) {
        await ffmpegService.stopFFmpeg();
    }

    channel.sessionUrl = null;

    storageService.deleteChannelStorage(channel.id);
}

function isRunning() {
    return ffmpegService.isFFmpegRunning();
}

function setStartAllowed(predicate) {
    startAllowed = typeof predicate === 'function' ? predicate : () => true;
}

module.exports = {
    start,
    stop,
    isRunning,
    setStartAllowed
};
