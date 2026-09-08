const MANIFEST_URI_TAGS = new Set([
    '#EXT-X-I-FRAME-STREAM-INF',
    '#EXT-X-MEDIA',
]);

function resourceKindForTag(line) {
    const tagName = line.split(':', 1)[0];
    return MANIFEST_URI_TAGS.has(tagName) ? 'manifest' : 'media';
}

function looksLikeManifest(uri) {
    try {
        return new URL(uri, 'http://streamhub.invalid').pathname.toLowerCase().endsWith('.m3u8');
    } catch {
        return uri.toLowerCase().includes('.m3u8');
    }
}

function rewriteManifest(body, resolveUri) {
    let nextUriIsManifest = false;

    return String(body).split('\n').map(rawLine => {
        const line = rawLine.trim();
        if (!line) return line;

        if (line.startsWith('#')) {
            nextUriIsManifest = line.startsWith('#EXT-X-STREAM-INF');
            return line.replace(/URI="([^"]+)"/g, (_match, uri) =>
                `URI="${resolveUri(uri, resourceKindForTag(line))}"`
            );
        }

        const kind = nextUriIsManifest || looksLikeManifest(line) ? 'manifest' : 'media';
        nextUriIsManifest = false;
        return resolveUri(line, kind);
    }).join('\n');
}

module.exports = { rewriteManifest };
