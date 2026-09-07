const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-channels-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "storage.db");

const Channel = require("../models/Channel");
const ChannelStorage = require("../services/ChannelStorage");

function createChannel(name, sourceId = null) {
  return new Channel(
    name,
    `https://provider.example/live/user/pass/${sourceId || name}.ts`,
    "",
    "proxy",
    [],
    "News",
    null,
    sourceId ? "Xtream" : null,
    false,
    sourceId ? "xtream" : null,
    sourceId
  );
}

test.beforeEach(() => {
  ChannelStorage.clear();
});

test("SQLite assigns unique increasing IDs and does not reuse a deleted ID", () => {
  const first = createChannel("First");
  first.id = ChannelStorage.insert(first);
  ChannelStorage.delete(first.id);

  const second = createChannel("Second");
  second.id = ChannelStorage.insert(second);

  assert.ok(second.id > first.id);
  assert.deepEqual(ChannelStorage.load().map((channel) => channel.name), ["Second"]);
});

test("SQLite rejects duplicate Xtream source identities", () => {
  const first = createChannel("First", "42");
  first.id = ChannelStorage.insert(first);

  assert.throws(
    () => ChannelStorage.insert(createChannel("Duplicate", "42")),
    /UNIQUE constraint failed/
  );
});

test("channel updates and deletions are persisted", () => {
  const channel = createChannel("Before");
  channel.id = ChannelStorage.insert(channel);
  channel.name = "After";
  ChannelStorage.update(channel);

  assert.equal(ChannelStorage.load()[0].name, "After");
  ChannelStorage.delete(channel.id);
  assert.deepEqual(ChannelStorage.load(), []);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
