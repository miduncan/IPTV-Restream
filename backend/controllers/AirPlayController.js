const fs = require('fs');
const path = require('path');
const request = require('request');
const ChannelService = require('../services/ChannelService');
const SessionFactory = require('../services/session/SessionFactory');
const airPlaySessionService = require('../services/airplay/AirPlaySessionService');
const { rewriteManifest } = require('../services/airplay/AirPlayManifestService');
const { waitForHlsManifest } = require('../services/restream/waitForFile');

const STORAGE_PATH = process.env.STORAGE_PATH;
const PUBLIC_BACKEND_URL = process.env.BACKEND_URL;
const HLS_CONTENT_TYPE = 'application/vnd.apple.mpegurl';
const FORWARDED_HEADERS = ['content-length', 'content-range', 'accept-ranges', 'content-type'];

let trackReceiverActivity = () => {};

function publicOrigin(req) {
    if (PUBLIC_BACKEND_URL) return PUBLIC_BACKEND_URL.replace(/\/+$/, '');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    return `${protocol}://${req.get('host')}`;
}

function customHeaders(channel) {
    return (channel.headers || []).reduce((headers, header) => {
        headers[header.key] = header.value;
        return headers;
    }, {});
}

function sessionAndChannel(req, res) {
    const session = airPlaySessionService.get(req.params.sessionId);
    if (!session) {
        res.status(404).json({ message: 'AirPlay session expired or not found.' });
        return null;
    }

    const channel = ChannelService.getChannelById(session.channelId);
    if (!channel || ChannelService.getCurrentChannel()?.id !== channel.id) {
        res.status(410).json({ message: 'The channel changed. Start AirPlay again.' });
        return null;
    }

    trackReceiverActivity(`airplay:${session.id}`);
    return { session, channel };
}

function resourceUrl(req, sessionId, resource) {
    const resourceId = airPlaySessionService.registerResource(sessionId, resource);
    if (!resourceId) throw new Error('AirPlay session expired while rewriting its manifest');
    return `${publicOrigin(req)}/airplay/${encodeURIComponent(sessionId)}/resource/${encodeURIComponent(resourceId)}`;
}

function rewriteRemoteManifest(req, session, body, sourceUrl, headers) {
    return rewriteManifest(body, (uri, kind) => resourceUrl(req, session.id, {
        kind,
        url: new URL(uri, sourceUrl).toString(),
        headers,
    }));
}

function fetchRemoteManifest(req, res, session, targetUrl, headers) {
    request({ url: targetUrl, headers, encoding: 'utf8' }, (error, response, body) => {
        if (error) {
            console.error('AirPlay manifest request failed:', error.message);
            return res.status(502).json({ message: 'Could not load the stream for AirPlay.' });
        }
        if (response.statusCode >= 400) {
            return res.status(response.statusCode).send(body);
        }

        try {
            const finalUrl = response.request?.href || targetUrl;
            const rewritten = rewriteRemoteManifest(req, session, body, finalUrl, headers);
            res.setHeader('Content-Type', HLS_CONTENT_TYPE);
            res.setHeader('Cache-Control', 'no-cache');
            return res.send(rewritten);
        } catch (rewriteError) {
            console.error('AirPlay manifest rewrite failed:', rewriteError.message);
            return res.status(502).json({ message: 'Could not prepare the stream for AirPlay.' });
        }
    });
}

function sendLocalResource(res, filePath) {
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: 'Stream resource not found.' });
    }
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(filePath);
}

module.exports = {
    setActivityTracker(tracker) {
        trackReceiverActivity = typeof tracker === 'function' ? tracker : () => {};
    },

    async createSession(req, res) {
        const channel = ChannelService.getCurrentChannel();
        if (!channel) return res.status(404).json({ message: 'No channel is currently selected.' });

        const session = airPlaySessionService.create(channel.id);
        try {
            await trackReceiverActivity(`airplay:${session.id}`);
        } catch (error) {
            console.error('Could not start the restream for playback:', error.message);
            airPlaySessionService.remove(session.id);
            return res.status(503).json({ message: 'The stream could not be started.' });
        }

        if (channel.restream()) {
            const manifestPath = path.resolve(STORAGE_PATH, String(channel.id), `${channel.id}.m3u8`);
            const ready = await waitForHlsManifest(manifestPath);
            if (!ready) {
                airPlaySessionService.remove(session.id);
                return res.status(503).json({ message: 'The stream is still starting.' });
            }
        }

        if (ChannelService.getCurrentChannel()?.id !== channel.id) {
            airPlaySessionService.remove(session.id);
            return res.status(409).json({ message: 'The channel changed while the stream was starting.' });
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({
            playbackUrl: `${publicOrigin(req)}/airplay/${encodeURIComponent(session.id)}/master.m3u8`,
            expiresAt: new Date(session.expiresAt).toISOString(),
        });
    },

    async manifest(req, res) {
        const resolved = sessionAndChannel(req, res);
        if (!resolved) return;
        const { session, channel } = resolved;

        if (channel.restream()) {
            const channelDirectory = path.resolve(STORAGE_PATH, String(channel.id));
            const manifestPath = path.join(channelDirectory, `${channel.id}.m3u8`);
            if (!await waitForHlsManifest(manifestPath)) {
                return res.status(503).json({ message: 'The stream is still starting.' });
            }

            try {
                const manifest = fs.readFileSync(manifestPath, 'utf8');
                const rewritten = rewriteManifest(manifest, (uri, kind) => {
                    const filePath = path.resolve(channelDirectory, uri);
                    if (filePath !== channelDirectory && !filePath.startsWith(`${channelDirectory}${path.sep}`)) {
                        throw new Error('Manifest resource escaped the stream directory');
                    }
                    return resourceUrl(req, session.id, { kind, path: filePath });
                });
                res.setHeader('Content-Type', HLS_CONTENT_TYPE);
                res.setHeader('Cache-Control', 'no-cache');
                return res.send(rewritten);
            } catch (error) {
                console.error('AirPlay restream manifest failed:', error.message);
                return res.status(502).json({ message: 'Could not prepare the stream for AirPlay.' });
            }
        }

        let targetUrl = channel.url;
        const sessionProvider = SessionFactory.getSessionProvider(channel);
        if (sessionProvider) {
            await sessionProvider.createSession();
            targetUrl = channel.sessionUrl;
        }
        return fetchRemoteManifest(req, res, session, targetUrl, customHeaders(channel));
    },

    resource(req, res) {
        const resolved = sessionAndChannel(req, res);
        if (!resolved) return;
        const { session } = resolved;
        const resource = airPlaySessionService.getResource(session.id, req.params.resourceId);
        if (!resource) return res.status(404).json({ message: 'Stream resource not found.' });

        if (resource.path) return sendLocalResource(res, resource.path);
        if (resource.kind === 'manifest') {
            return fetchRemoteManifest(req, res, session, resource.url, resource.headers);
        }

        const headers = { ...(resource.headers || {}) };
        if (req.headers.range) headers.Range = req.headers.range;
        const upstream = request({ url: resource.url, headers });
        upstream.on('response', response => {
            res.status(response.statusCode);
            for (const header of FORWARDED_HEADERS) {
                if (response.headers[header]) res.setHeader(header, response.headers[header]);
            }
            res.setHeader('Cache-Control', 'no-cache');
        });
        upstream.on('error', error => {
            console.error('AirPlay media request failed:', error.message);
            if (!res.headersSent) res.status(502).json({ message: 'Could not load the stream for AirPlay.' });
        });
        return upstream.pipe(res);
    },
};
