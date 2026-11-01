const fs = require('node:fs');
const path = require('node:path');
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
class BulkGuideCache {
    constructor(filePath) { this.filePath = filePath; this.memory = null; }
    get(key) {
        if (this.memory?.key === key) return this.memory;
        if (!this.filePath) return null;
        try {
            if (fs.statSync(this.filePath).size > MAX_CACHE_BYTES) return null;
            const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
            if (value.key === key && value.version === 1 && Array.isArray(value.entries)) { this.memory = value; return value; }
        } catch { /* Cache absence/corruption never disables name matching. */ }
        return null;
    }
    put(value) {
        const data = { ...value, version: 1 };
        const json = JSON.stringify(data);
        if (Buffer.byteLength(json) > MAX_CACHE_BYTES) return;
        if (this.filePath) {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const temporary = `${this.filePath}.tmp`;
            try { fs.writeFileSync(temporary, json); fs.renameSync(temporary, this.filePath); }
            catch { try { fs.unlinkSync(temporary); } catch { /* No staged cache. */ } }
        }
        this.memory = data;
    }
}
module.exports = BulkGuideCache;
