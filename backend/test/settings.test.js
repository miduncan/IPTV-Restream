const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-settings-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");

const settingsStore = require("../services/settings/SettingsStore");
const controller = require("../controllers/AdminSettingsController");

test("settings are transactionally replaced and returned in key order", () => {
  const result = settingsStore.replace([
    { key: "stream.delay", value: "18" },
    { key: "playlist.schedule", value: "0 3 * * *" },
  ]);

  assert.deepEqual(
    result.map(({ key, value }) => ({ key, value })),
    [
      { key: "playlist.schedule", value: "0 3 * * *" },
      { key: "stream.delay", value: "18" },
    ]
  );

  const replaced = settingsStore.replace([{ key: "proxy.timeout", value: "30" }]);
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].key, "proxy.timeout");
});

test("settings endpoint rejects duplicate keys regardless of case", () => {
  let statusCode;
  let body;
  const response = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  controller.replace(
    {
      body: {
        settings: [
          { key: "stream.delay", value: "18" },
          { key: "STREAM.DELAY", value: "20" },
        ],
      },
    },
    response
  );

  assert.equal(statusCode, 400);
  assert.match(body.error, /Duplicate setting key/);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
