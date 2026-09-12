const { spawn } = require('child_process');
const settingsService = require('../settings/SettingsService');
require('dotenv').config();

const runningProcesses = new Map();
const STORAGE_PATH = process.env.STORAGE_PATH;
const HLS_SEGMENT_SECONDS = 2;
const HLS_LIST_SIZE = 12;
const STOP_GRACE_MS = 1_500;
const STOP_FORCE_WAIT_MS = 1_000;

function getCodecArguments() {
    if (!settingsService.shouldTranscodeAudioToAacLc()) {
        return ['-c', 'copy'];
    }

    return [
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-profile:a', 'aac_low',
        '-b:a', '128k',
        '-ac', '2'
    ];
}

async function startFFmpeg(nextChannel) {
    console.log('Starting FFmpeg process with channel:', nextChannel.id);
    if (runningProcesses.has(nextChannel.id)) {
        await stopFFmpeg(nextChannel.id);
    }

    let channelUrl = nextChannel.sessionUrl ? nextChannel.sessionUrl : nextChannel.url;

    const headers = nextChannel.headers;

    const child = spawn('ffmpeg', [
        '-headers', headers.map(header => `${header.key}: ${header.value}`).join('\r\n'),
        '-reconnect', '1',
        '-reconnect_at_eof', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '2',
        // Some Xtream servers send an initial burst faster than real time.
        // Pace it so HLS program timestamps do not run ahead of the player.
        '-re',
        '-i', channelUrl,
        ...getCodecArguments(),
        // Repeat codec setup data so copied H.264 segments remain
        // independently decodable.
        '-bsf:v', 'dump_extra=freq=keyframe',
        '-f', 'hls',
        '-hls_time', String(HLS_SEGMENT_SECONDS),
        '-hls_list_size', String(HLS_LIST_SIZE),
        '-hls_flags', 'delete_segments+program_date_time+independent_segments',
        '-start_number', Math.floor(Date.now() / 1000),
        `${STORAGE_PATH}${nextChannel.id}/${nextChannel.id}.m3u8`
    ]);
    const handle = { channelId: nextChannel.id, child, stopPromise: null };
    runningProcesses.set(nextChannel.id, handle);

    child.stdout.on('data', (data) => {
        console.log(`stdout: ${data}`);
    });

    child.stderr.on('data', (data) => {
        console.error(`stderr: ${data}`);
    });

    child.on('close', (code) => {
        if (runningProcesses.get(nextChannel.id) === handle) {
            runningProcesses.delete(nextChannel.id);
        }
        console.log(`FFmpeg process for channel ${nextChannel.id} terminated with code: ${code}`);
    });

    child.on('error', (error) => {
        if (runningProcesses.get(nextChannel.id) === handle) {
            runningProcesses.delete(nextChannel.id);
        }
        console.error(`FFmpeg process for channel ${nextChannel.id} failed:`, error);
    });

    return handle;
}

function stopFFmpeg(channelId) {
    const handle = runningProcesses.get(channelId);
    if (!handle) {
        console.log(`No FFmpeg process is running for channel ${channelId}.`);
        return Promise.resolve();
    }
    if (handle.stopPromise) return handle.stopPromise;

    handle.stopPromise = new Promise(resolve => {
        let settled = false;
        let forceTimer;
        let giveUpTimer;
        const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(forceTimer);
            clearTimeout(giveUpTimer);
            if (runningProcesses.get(channelId) === handle) runningProcesses.delete(channelId);
            resolve();
        };

        handle.child.once('close', finish);
        handle.child.once('error', finish);
        console.log(`Gracefully terminating FFmpeg process for channel ${channelId}...`);

        if (!handle.child.kill('SIGTERM')) {
            finish();
            return;
        }

        forceTimer = setTimeout(() => {
            if (settled) return;
            console.warn(`FFmpeg process for channel ${channelId} did not stop gracefully; sending SIGKILL.`);
            handle.child.kill('SIGKILL');
        }, STOP_GRACE_MS);
        forceTimer.unref?.();

        // Never leave the channel-switch or per-channel operation queue blocked
        // solely because a child process failed to emit its terminal event.
        giveUpTimer = setTimeout(finish, STOP_GRACE_MS + STOP_FORCE_WAIT_MS);
        giveUpTimer.unref?.();
    });
    return handle.stopPromise;
}

function isFFmpegRunning(channelId) {
    return channelId === undefined
        ? runningProcesses.size > 0
        : runningProcesses.has(channelId);
}

module.exports = {
    startFFmpeg,
    stopFFmpeg,
    isFFmpegRunning,
    getCodecArguments,
    HLS_SEGMENT_SECONDS,
    HLS_LIST_SIZE,
    STOP_GRACE_MS,
};
