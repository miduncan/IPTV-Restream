const fs = require('node:fs');
const path = require('node:path');

class GamesStore {
    constructor({ filePath = path.join(path.dirname(process.env.SETTINGS_DB_PATH || '/channels/iptv-restream.db'), 'games.json') } = {}) {
        this.filePath = filePath;
    }

    load() {
        try {
            return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch (error) {
            if (error.code !== 'ENOENT') console.warn('Could not read the saved games snapshot');
            return {};
        }
    }

    save(snapshot) {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(snapshot));
        fs.renameSync(temporaryPath, this.filePath);
    }
}

module.exports = GamesStore;
