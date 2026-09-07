const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

require("dotenv").config();

const databasePath = process.env.SETTINGS_DB_PATH || "/channels/iptv-restream.db";
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('viewer', 'admin')),
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS auth_sessions_expiry
  ON auth_sessions(expires_at);
`);

const insertStatement = database.prepare(`
  INSERT INTO auth_sessions (token_hash, username, role, expires_at)
  VALUES (@tokenHash, @username, @role, @expiresAt)
`);
const getStatement = database.prepare(`
  SELECT username, role, expires_at AS expiresAt
  FROM auth_sessions
  WHERE token_hash = ?
`);
const deleteStatement = database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?");
const deleteExpiredStatement = database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?");

module.exports = {
  create(session) {
    insertStatement.run(session);
  },

  get(tokenHash) {
    return getStatement.get(tokenHash) || null;
  },

  delete(tokenHash) {
    deleteStatement.run(tokenHash);
  },

  deleteExpired(now = Date.now()) {
    deleteExpiredStatement.run(now);
  },
};
