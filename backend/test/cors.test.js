const assert = require('node:assert/strict');
const test = require('node:test');

const corsMiddleware = require('../middleware/cors');

function responseRecorder() {
    const headers = {};
    return {
        headers,
        status: null,
        header(name, value) {
            headers[name] = value;
        },
        sendStatus(status) {
            this.status = status;
            return this;
        },
    };
}

test('receiver preflight permits unauthenticated HLS range requests', () => {
    const req = {
        headers: { origin: 'https://receiver.example' },
        method: 'OPTIONS',
        path: '/airplay/session-id/resource/resource-id',
    };
    const res = responseRecorder();
    let continued = false;

    corsMiddleware(req, res, () => { continued = true; });

    assert.equal(res.status, 200);
    assert.equal(continued, false);
    assert.equal(res.headers['Access-Control-Allow-Origin'], '*');
    assert.equal(res.headers['Access-Control-Allow-Headers'], 'Range');
    assert.equal(res.headers['Access-Control-Allow-Methods'], 'GET, OPTIONS');
    assert.equal(
        res.headers['Access-Control-Expose-Headers'],
        'Content-Length, Content-Range, Accept-Ranges'
    );
});

test('application CORS continues to allow only the configured credentialed origin', () => {
    const previousOrigin = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = 'https://stream.example';
    const req = {
        headers: { origin: 'https://stream.example' },
        method: 'GET',
        path: '/api/channels',
    };
    const res = responseRecorder();
    let continued = false;

    try {
        corsMiddleware(req, res, () => { continued = true; });
    } finally {
        if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
        else process.env.CORS_ORIGIN = previousOrigin;
    }

    assert.equal(continued, true);
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://stream.example');
    assert.equal(res.headers['Access-Control-Allow-Credentials'], 'true');
    assert.equal(res.headers.Vary, 'Origin');
});
