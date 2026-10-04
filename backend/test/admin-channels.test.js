const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-admin-channels-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "channels.db");

const controller = require("../controllers/AdminChannelController");
const channelService = require("../services/ChannelService");
const xtreamService = require("../services/XtreamService");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test.beforeEach(() => {
  channelService.clearChannels();
});

test("current lineup loads without requesting the Xtream catalog", () => {
  const originalFetchCatalog = xtreamService.fetchCatalog;
  let catalogRequested = false;
  xtreamService.fetchCatalog = async () => {
    catalogRequested = true;
    return [];
  };

  channelService.addChannel({
    name: "Local news",
    url: "https://streams.example/news.m3u8",
    avatar: "",
    mode: "proxy",
    headersJson: [{ key: "Referer", value: "https://example.com" }],
  });
  const response = createResponse();

  controller.list({}, response);

  assert.equal(catalogRequested, false);
  assert.equal(response.body.channels.length, 1);
  assert.equal(response.body.channels[0].name, "Local news");
  assert.deepEqual(response.body.channels[0].headers, [
    { key: "Referer", value: "https://example.com" },
  ]);
  xtreamService.fetchCatalog = originalFetchCatalog;
});

test("admin updates editable channel settings while preserving an Xtream URL", async () => {
  const originalUrl = "https://provider.example/live/user/pass/42.ts";
  const channel = channelService.addChannel({
    name: "Before",
    url: originalUrl,
    avatar: "before.png",
    mode: "proxy",
    headersJson: [],
    source: "xtream",
    sourceId: "42",
    tags: ["Original"],
  });
  const emitted = [];
  const response = createResponse();

  await controller.update({
    params: { channelId: String(channel.id) },
    body: {
      name: "After",
      url: "https://untrusted.example/replacement.ts",
      avatar: "after.png",
      mode: "direct",
      headers: [{ key: "User-Agent", value: "Player" }],
      tags: ["Sports", " sports ", "Featured"],
    },
    app: {
      get() {
        return { emit: (...args) => emitted.push(args) };
      },
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.channel.name, "After");
  assert.equal(response.body.channel.url, originalUrl);
  assert.equal(response.body.channel.mode, "direct");
  assert.deepEqual(response.body.channel.headers, [{ key: "User-Agent", value: "Player" }]);
  assert.deepEqual(response.body.channel.tags, ["Sports", "Featured"]);
  assert.equal(emitted[0][0], "channel-updated");
});

test.after(() => {
  channelService.clearChannels();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
