const request = require('request');
const ChannelService = require('../services/ChannelService');
const ProxyHelperService = require('../services/proxy/ProxyHelperService');
const SessionFactory = require('../services/session/SessionFactory');
const Path = require('path');
const fs = require('fs');

const STORAGE_PATH = process.env.STORAGE_PATH;
const BACKEND_URL = process.env.BACKEND_URL;

function fetchM3u8(res, targetUrl, headers) {
    console.log('Proxy playlist request to:', targetUrl);

    try {
        request(ProxyHelperService.getRequestOptions(targetUrl, headers), (error, response, body) => {
            if (error) {
                console.error('Request error:', error);
                if (!res.headersSent) {
                    return res.status(500).json({ error: 'Failed to fetch m3u8 file' });
                }
                return;
            }

            try {
                const proxyBaseUrl = '/proxy/';
                const rewrittenBody = ProxyHelperService.rewriteUrls(body, proxyBaseUrl, headers, targetUrl).join('\n');

                if(rewrittenBody.indexOf('channel?url=') !== -1) {
                    const regex = /channel\?url=([^&\s]+)/;
                    const match = rewrittenBody.match(regex);
                    const channelUrl = decodeURIComponent(match[1]);
                    return fetchM3u8(res, channelUrl, headers);
                }

                const updatedM3u8 = rewrittenBody.replace(/(#EXTINF.*)/, '#EXT-X-DISCONTINUITY\n$1');
                
                return res.send(updatedM3u8);
            } catch (e) {
                console.error('Failed to rewrite URLs:', e);
                return res.status(500).json({ error: 'Failed to parse m3uo file. Not a valid HLS stream.' });
            }

            //res.set('Content-Type', 'application/vnd.apple.mpegurl');
        }).on('error', (err) => {
            console.error('Unhandled error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Proxy request failed' });
            }
        });
    } catch (e) {
        console.error('Failed to proxy request:', e);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Proxy request failed' });
        }
    }
}


module.exports = {
    async currentChannel(req, res) {

        const channel = ChannelService.getCurrentChannel();

        res.set('Access-Control-Allow-Origin', '*');
        if (!channel) {
            return res.status(404).json({ error: 'No channel is currently selected' });
        }
        if(channel.restream()) {
            const path = Path.resolve(`${STORAGE_PATH}${channel.id}/${channel.id}.m3u8`);
            if (fs.existsSync(path)) {
                try {
                    const m3u8Data = fs.readFileSync(path, 'utf-8');

                    let discontinuityAdded = false;
                    const updatedM3u8 = m3u8Data
                        .split('\n')
                        .map((line, index, lines) => {
                            // Füge #EXT-X-DISCONTINUITY vor der ersten #EXTINF hinzu
                            if (!discontinuityAdded && line.startsWith('#EXTINF')) {
                                discontinuityAdded = true;
                                return `#EXT-X-DISCONTINUITY\n${line}`;
                            }

                            // Passe die .ts-Dateipfade an
                            if (line.endsWith('.ts')) {
                                return `${STORAGE_PATH}${channel.id}/${line}`;
                            }

                            return line;
                        })
                        .join('\n');

                    return res.send(updatedM3u8);
                } catch (err) {
                    console.error('Error loading m3u8 data from fs:', err);
                    res.status(500).json({ error: 'Failed to load m3u8 data from filesystem.' });
                }
            }
            //add platzhalter
            return res.send('No m3u8 data found.');
        } else {
            // Direct/Proxy Mode
            //  -> Fetch the m3u8 file from the channel URL
            let targetUrl = channel.url;
            
            const sessionProvider = SessionFactory.getSessionProvider(channel);
            if(sessionProvider) {
                await sessionProvider.createSession();
                targetUrl = channel.sessionUrl;
            }

            let headers = undefined;
            if(channel.headers && channel.headers.length > 0) {
                headers = Buffer.from(JSON.stringify(channel.headers)).toString('base64');
            }

            fetchM3u8(res, targetUrl, headers);
        }
    },

    playlist(req, res) {
        const backendBaseUrl = BACKEND_URL ? BACKEND_URL : `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.get('Host')}:${req.headers['x-forwarded-port'] ?? ''}`;

        let playlistStr = `#EXTM3U
#EXTINF:-1 tvg-name="CURRENT RESTREAM" tvg-logo="https://cdn-icons-png.freepik.com/512/9294/9294560.png" group-title="StreamHub",CURRENT RESTREAM
${backendBaseUrl}/proxy/current \n`;

        //TODO: dynamically add channels from ChannelService
        const channels = ChannelService.getChannels();
        for(const channel of channels) {
            let restreamMode = undefined;
            if(channel.restream()) {
                restreamMode = channel.headers && channel.headers.length > 0 ? 'proxy' : 'direct';
            }

            playlistStr += `\n#EXTINF:-1 tvg-name="${channel.name}" tvg-logo="${channel.avatar}" group-title="${channel.group ?? ''}",${channel.name} \n`;

            if(channel.mode === 'direct' || restreamMode === 'direct') {
                playlistStr += channel.url;
            } else {
                let headers = undefined;
                if(channel.headers && channel.headers.length > 0) {
                    headers = Buffer.from(JSON.stringify(channel.headers)).toString('base64');
                }
                playlistStr += `${backendBaseUrl}/proxy/channel?url=${encodeURIComponent(channel.url)}${headers ? `&headers=${headers}` : ''} \n`;
            }
        }

        res.set('Content-Type', 'text/plain');
        res.send(playlistStr);
    }
};
