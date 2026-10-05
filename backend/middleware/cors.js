function corsMiddleware(req, res, next) {
    const requestPath = req.path || req.originalUrl || '';
    const isReceiverRequest = requestPath === '/airplay' || requestPath.startsWith('/airplay/');

    if (isReceiverRequest) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Headers', 'Range');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    } else {
        const allowedOrigin = process.env.CORS_ORIGIN;
        if (allowedOrigin && req.headers.origin === allowedOrigin) {
            res.header('Access-Control-Allow-Origin', allowedOrigin);
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Vary', 'Origin');
        }
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }

    if (req.method === 'OPTIONS') return res.sendStatus(200);
    return next();
}

module.exports = corsMiddleware;
