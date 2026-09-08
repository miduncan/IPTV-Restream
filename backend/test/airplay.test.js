const assert = require('node:assert/strict');
const test = require('node:test');

const { AirPlaySessionService } = require('../services/airplay/AirPlaySessionService');
const { rewriteManifest } = require('../services/airplay/AirPlayManifestService');

test('AirPlay sessions are opaque, channel-scoped, and expire', () => {
    let currentTime = 1_000;
    const service = new AirPlaySessionService({
        ttlMs: 5_000,
        now: () => currentTime,
        createId: () => 'opaque-session-id',
    });

    const session = service.create(42);
    assert.equal(session.id, 'opaque-session-id');
    assert.equal(session.channelId, 42);
    assert.equal(session.expiresAt, 6_000);
    assert.equal(service.get(session.id), session);

    currentTime = 6_000;
    assert.equal(service.get(session.id), null);
});

test('AirPlay resources can only be resolved through their session', () => {
    let nextId = 0;
    const service = new AirPlaySessionService({ createId: () => `session-${++nextId}` });
    const first = service.create(1);
    const second = service.create(2);
    const resource = { kind: 'media', url: 'https://media.example/segment.ts' };
    const resourceId = service.registerResource(first.id, resource);

    assert.deepEqual(service.getResource(first.id, resourceId), resource);
    assert.equal(service.getResource(second.id, resourceId), null);
    assert.equal(service.getResource('missing-session', resourceId), null);
});

test('AirPlay sessions can be discarded when playback fails to start', () => {
    const service = new AirPlaySessionService({ createId: () => 'failed-session' });
    const session = service.create(1);

    service.remove(session.id);

    assert.equal(service.get(session.id), null);
});

test('AirPlay manifest rewriting covers playlists, segments, keys, maps, and renditions', () => {
    const source = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"
#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=86000,URI="iframe.m3u8"
#EXT-X-KEY:METHOD=AES-128,URI="keys/current.key"
#EXT-X-MAP:URI="init.mp4"
#EXT-X-STREAM-INF:BANDWIDTH=1280000
video/index.m3u8
#EXTINF:6,
segments/one.ts`;
    const resources = [];

    const rewritten = rewriteManifest(source, (uri, kind) => {
        resources.push({ uri, kind });
        return `/airplay/resource/${resources.length}`;
    });

    assert.deepEqual(resources, [
        { uri: 'audio/index.m3u8', kind: 'manifest' },
        { uri: 'iframe.m3u8', kind: 'manifest' },
        { uri: 'keys/current.key', kind: 'media' },
        { uri: 'init.mp4', kind: 'media' },
        { uri: 'video/index.m3u8', kind: 'manifest' },
        { uri: 'segments/one.ts', kind: 'media' },
    ]);
    assert.match(rewritten, /URI="\/airplay\/resource\/1"/);
    assert.match(rewritten, /#EXT-X-STREAM-INF:BANDWIDTH=1280000\n\/airplay\/resource\/5/);
});
