const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-stream-storage-"));
process.env.STORAGE_PATH = `${storageRoot}/`;

const storageService = require("../services/restream/StorageService");

test("creating storage is safe when a channel directory already exists", () => {
  storageService.createChannelStorage(42);
  storageService.createChannelStorage(42);
  assert.equal(fs.statSync(path.join(storageRoot, "42")).isDirectory(), true);
});

test.after(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});
