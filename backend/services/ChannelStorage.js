const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const Channel = require("../models/Channel");
require("dotenv").config();

const databasePath = process.env.SETTINGS_DB_PATH || "/channels/iptv-restream.db";
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS channels (
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

  CREATE UNIQUE INDEX IF NOT EXISTS channels_source_identity_unique
  ON channels(source, source_id)
  WHERE source IS NOT NULL AND source_id IS NOT NULL;

`);

const selectAllStatement = database.prepare(`
  SELECT id, name, url, avatar, mode, headers_json AS headersJson,
         group_name AS groupName, playlist, playlist_name AS playlistName,
         playlist_update AS playlistUpdate, source, source_id AS sourceId
  FROM channels
  ORDER BY id
`);
const insertStatement = database.prepare(`
  INSERT INTO channels (
    name, url, avatar, mode, headers_json, group_name, playlist,
    playlist_name, playlist_update, source, source_id, created_at, updated_at
  ) VALUES (
    @name, @url, @avatar, @mode, @headersJson, @groupName, @playlist,
    @playlistName, @playlistUpdate, @source, @sourceId, @createdAt, @updatedAt
  )
`);
const insertWithIdStatement = database.prepare(`
  INSERT INTO channels (
    id, name, url, avatar, mode, headers_json, group_name, playlist,
    playlist_name, playlist_update, source, source_id, created_at, updated_at
  ) VALUES (
    @id, @name, @url, @avatar, @mode, @headersJson, @groupName, @playlist,
    @playlistName, @playlistUpdate, @source, @sourceId, @createdAt, @updatedAt
  )
`);
const updateStatement = database.prepare(`
  UPDATE channels SET
    name = @name, url = @url, avatar = @avatar, mode = @mode,
    headers_json = @headersJson, group_name = @groupName,
    playlist = @playlist, playlist_name = @playlistName,
    playlist_update = @playlistUpdate, source = @source,
    source_id = @sourceId, updated_at = @updatedAt
  WHERE id = @id
`);
const deleteStatement = database.prepare("DELETE FROM channels WHERE id = ?");
const clearStatement = database.prepare("DELETE FROM channels");
function toRecord(channel) {
  const timestamp = new Date().toISOString();
  return {
    name: channel.name,
    url: channel.url,
    avatar: channel.avatar || "",
    mode: channel.mode,
    headersJson: JSON.stringify(Array.isArray(channel.headers) ? channel.headers : []),
    groupName: channel.group ?? null,
    playlist: channel.playlist ?? null,
    playlistName: channel.playlistName ?? null,
    playlistUpdate: channel.playlistUpdate ? 1 : 0,
    source: channel.source ?? null,
    sourceId: channel.sourceId == null ? null : String(channel.sourceId),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function fromRow(row) {
  let headers = [];
  try {
    headers = JSON.parse(row.headersJson);
  } catch {
    headers = [];
  }
  return Channel.from({
    id: Number(row.id),
    name: row.name,
    url: row.url,
    sessionUrl: null,
    avatar: row.avatar,
    mode: row.mode,
    headers,
    group: row.groupName,
    playlist: row.playlist,
    playlistName: row.playlistName,
    playlistUpdate: Boolean(row.playlistUpdate),
    source: row.source,
    sourceId: row.sourceId,
  });
}

const replaceTransaction = database.transaction((channels) => {
  clearStatement.run();
  for (const channel of channels) {
    if (channel.id == null) {
      channel.id = Number(insertStatement.run(toRecord(channel)).lastInsertRowid);
    } else {
      insertWithIdStatement.run({ id: channel.id, ...toRecord(channel) });
    }
  }
});

module.exports = {
  load() {
    return selectAllStatement.all().map(fromRow);
  },

  insert(channel) {
    return Number(insertStatement.run(toRecord(channel)).lastInsertRowid);
  },

  update(channel) {
    const result = updateStatement.run({ id: channel.id, ...toRecord(channel) });
    if (result.changes === 0) throw new Error("Channel does not exist");
  },

  delete(id) {
    deleteStatement.run(id);
  },

  save(channels) {
    replaceTransaction(channels);
  },

  clear() {
    clearStatement.run();
  },
};
