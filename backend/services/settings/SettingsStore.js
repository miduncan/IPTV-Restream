const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
require("dotenv").config();

const databasePath = process.env.SETTINGS_DB_PATH || "/channels/iptv-restream.db";
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma("journal_mode = WAL");
database.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const listStatement = database.prepare(`
  SELECT key, value, updated_at AS updatedAt
  FROM settings
  ORDER BY key COLLATE NOCASE
`);
const getStatement = database.prepare(`
  SELECT value
  FROM settings
  WHERE key = ?
`);
const deleteStatement = database.prepare("DELETE FROM settings");
const insertStatement = database.prepare(`
  INSERT INTO settings (key, value, updated_at)
  VALUES (@key, @value, @updatedAt)
`);

const replaceTransaction = database.transaction((settings) => {
  deleteStatement.run();

  const updatedAt = new Date().toISOString();
  for (const setting of settings) {
    insertStatement.run({ ...setting, updatedAt });
  }
});

module.exports = {
  get(key) {
    return getStatement.get(key)?.value;
  },

  list() {
    return listStatement.all();
  },

  replace(settings) {
    replaceTransaction(settings);
    return this.list();
  },
};
