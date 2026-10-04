const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const Database = require("better-sqlite3");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-channel-migration-"));
const databasePath = path.join(testDirectory, "legacy.db");
const database = new Database(databasePath);

database.exec(`
  CREATE TABLE channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    avatar TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('direct', 'proxy', 'restream')),
    headers_json TEXT NOT NULL DEFAULT '[]',
    group_name TEXT,
    playlist TEXT,
    playlist_name TEXT,
    playlist_update INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    source_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  INSERT INTO channels (
    name, url, avatar, mode, created_at, updated_at
  ) VALUES (
    'Legacy', 'https://streams.example/legacy.m3u8', '', 'proxy',
    '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
  );
`);
database.close();

process.env.SETTINGS_DB_PATH = databasePath;
const channelStorage = require("../services/ChannelStorage");

test("existing channel databases gain an empty tags column", () => {
  const channels = channelStorage.load();
  assert.equal(channels.length, 1);
  assert.equal(channels[0].name, "Legacy");
  assert.deepEqual(channels[0].tags, []);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
