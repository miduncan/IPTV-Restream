const sax = require('sax');
const { Readable } = require('node:stream');
const { createGunzip } = require('node:zlib');
const { StringDecoder } = require('node:string_decoder');
const DEFAULT_LIMITS = Object.freeze({ decodedBytes: 256 * 1024 * 1024, records: 2000000, retainedRecords: 100000, retainedBytes: 32 * 1024 * 1024, fieldLength: 16384, depth: 16, idleMs: 15000 });
function xmlTime(value) {
    const match = String(value || '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2})(\d{2}))?$/);
    if (!match) return null;
    const [, y, m, d, h, minute, seconds = '00', sign, oh = '00', om = '00'] = match;
    const values = [y, m, d, h, minute, seconds].map(Number);
    const [year, month, day, hour, min, sec] = values;
    const utc = Date.UTC(year, month - 1, day, hour, min, sec);
    const date = new Date(utc);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || min > 59 || sec > 59 || Number(oh) > 23 || Number(om) > 59) return null;
    return utc - (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om)) * 60000;
}
async function parseXmlTv(body, { run, ids, keep = () => true, limits = {} }) {
    const bounds = { ...DEFAULT_LIMITS, ...limits };
    const reader = typeof body.getReader === 'function' ? body.getReader() : null;
    const iterator = reader ? {
        next: () => reader.read(),
        async return() { await reader.cancel(); reader.releaseLock(); return { done: true }; },
    } : body[Symbol.asyncIterator]();
    async function next() {
        let timer;
        try { return await run.wait(Promise.race([iterator.next(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Guide download idle timeout')), bounds.idleMs); })])); }
        finally { clearTimeout(timer); }
    }
    // HTTP content-encoding is already decoded by fetch. Detect an application
    // gzip payload from the delivered bytes, including magic split across chunks.
    const prefix = [];
    let prefixLength = 0;
    while (prefixLength < 2) {
        const item = await next();
        if (item.done) break;
        const buffer = Buffer.from(item.value);
        prefix.push(buffer); prefixLength += buffer.length;
    }
    async function* chunks() { for (const chunk of prefix) yield chunk; for (;;) { const item = await next(); if (item.done) break; yield Buffer.from(item.value); } }
    const start = Buffer.concat(prefix);
    const input = Readable.from(chunks());
    const gzip = start[0] === 0x1f && start[1] === 0x8b ? createGunzip() : null;
    const stream = gzip ? input.pipe(gzip) : input;
    if (gzip) input.on('error', error => gzip.destroy(error));
    const abort = () => { input.destroy(run.signal.reason); gzip?.destroy(run.signal.reason); };
    run.signal.addEventListener('abort', abort, { once: true });
    const byId = new Map();
    const dedupe = new Map();
    const declarations = new Map();
    const conflicts = new Set();
    const mapped = new Set();
    let programme = null, channel = null, field = null, depth = 0, rootSeen = false, records = 0, retainedBytes = 0, discarded = 0;
    const parser = sax.parser(true, { trim: false, normalize: false, strictEntities: true });
    parser.onerror = () => { throw new Error('Invalid XMLTV document'); };
    parser.onprocessinginstruction = instruction => {
        const encoding = instruction.body.match(/encoding\s*=\s*[\"']([^\"']+)/i)?.[1];
        if (encoding && !/^(utf-?8|us-ascii)$/i.test(encoding)) throw new Error('Unsupported XMLTV encoding');
    };
    parser.ondoctype = value => { if (/\[|\bENTITY\b/i.test(value)) throw new Error('Guide entity declarations are unsupported'); };
    parser.onopentag = node => {
        depth += 1;
        if (depth > bounds.depth || Object.keys(node.attributes).length > 32 || Object.values(node.attributes).some(value => String(value).length > bounds.fieldLength)) throw new Error('Guide XML limits exceeded');
        if (depth === 1) { if (node.name !== 'tv') throw new Error('Response is not an XMLTV guide'); rootSeen = true; }
        if (depth === 2 && node.name === 'programme') { programme = { channel: node.attributes.channel, startMs: xmlTime(node.attributes.start), endMs: xmlTime(node.attributes.stop), title: '', description: '', categories: [], category: '' }; }
        if (depth === 2 && node.name === 'channel') channel = { id: node.attributes.id, name: '' };
        field = depth === 3 && programme && ['title', 'desc', 'sub-title', 'category'].includes(node.name) ? node.name : depth === 3 && channel && node.name === 'display-name' ? 'display-name' : null;
    };
    const text = value => {
        if (!field) return;
        const target = field === 'display-name' ? channel : programme;
        const key = field === 'display-name' ? 'name' : field === 'category' ? 'category' : ['desc', 'sub-title'].includes(field) ? 'description' : 'title';
        if (target[key].length + value.length > bounds.fieldLength) throw new Error('Guide text limit exceeded');
        target[key] += value;
    };
    parser.ontext = text; parser.oncdata = text;
    parser.onclosetag = name => {
        if (depth === 3 && name === 'category' && programme) {
            if (programme.categories.length >= 32) throw new Error('Guide category limit exceeded');
            programme.categories.push(programme.category.trim()); programme.category = '';
        }
        if (depth === 2 && name === 'channel' && channel && ids.has(channel.id)) {
            mapped.add(channel.id);
            const signature = channel.name.trim();
            if (declarations.has(channel.id) && declarations.get(channel.id) !== signature) conflicts.add(channel.id);
            else declarations.set(channel.id, signature);
            channel = null;
        }
        if (depth === 2 && name === 'programme' && programme) {
            records += 1; run.progress.programmesParsed = records;
            if (records > bounds.records) throw new Error('Guide programme limit exceeded');
            const row = programme; programme = null;
            if (ids.has(row.channel)) mapped.add(row.channel);
            if (row.startMs === null || row.endMs === null || row.endMs <= row.startMs) discarded += 1;
            else if (ids.has(row.channel)) {
                const value = { id: `${row.channel}:${row.startMs}`, title: row.title.trim(), description: row.description.trim(), categories: row.categories, startMs: row.startMs, endMs: row.endMs, start: new Date(row.startMs).toISOString(), end: new Date(row.endMs).toISOString() };
                if (keep(value)) {
                    const key = JSON.stringify(value);
                    if (!dedupe.has(row.channel)) dedupe.set(row.channel, new Set());
                    if (!dedupe.get(row.channel).has(key)) {
                        retainedBytes += Buffer.byteLength(key);
                        if (retainedBytes > bounds.retainedBytes || run.progress.programmesKept >= bounds.retainedRecords) throw new Error('Retained guide limit exceeded');
                        dedupe.get(row.channel).add(key);
                        if (!byId.has(row.channel)) byId.set(row.channel, []);
                        byId.get(row.channel).push(value);
                        run.progress.programmesKept += 1;
                    }
                }
            }
        }
        if (field && programme && ['desc', 'sub-title'].includes(field)) programme.description += ' ';
        field = null; depth -= 1;
    };
    const decoder = new StringDecoder('utf8');
    try {
        run.phase('guide');
        let yieldedBytes = 0;
        for await (const chunk of stream) {
            run.signal.throwIfAborted();
            run.progress.decodedBytes += chunk.length;
            if (run.progress.decodedBytes > bounds.decodedBytes) throw new Error('Guide decoded byte limit exceeded');
            parser.write(decoder.write(chunk));
            if (run.progress.decodedBytes - yieldedBytes >= 1024 * 1024) {
                yieldedBytes = run.progress.decodedBytes;
                await new Promise(resolve => setImmediate(resolve));
            }
        }
        parser.write(decoder.end()).close();
        if (!rootSeen || depth !== 0) throw new Error('Response is not an XMLTV guide');
        for (const id of conflicts) { byId.delete(id); mapped.delete(id); }
        return { byId, discarded, conflicts: conflicts.size, mappedIds: [...mapped] };
    } finally {
        run.signal.removeEventListener('abort', abort);
        input.destroy(); gzip?.destroy();
        try { void Promise.resolve(iterator.return?.()).catch(() => {}); } catch { /* Response may already be closed. */ }
    }
}
module.exports = { parseXmlTv, DEFAULT_LIMITS };
