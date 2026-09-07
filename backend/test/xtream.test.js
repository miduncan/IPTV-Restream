const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-xtream-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");

const settingsService = require("../services/settings/SettingsService");
const xtreamService = require("../services/XtreamService");

const credentials = {
  transcodeAudioToAacLc: false,
  xtreamUrl: "https://provider.example.com:8080/portal",
  xtreamUsername: "viewer name",
  xtreamPassword: "secret/value",
};

test.beforeEach(() => {
  settingsService.replace(credentials);
});

test("player API requests use actions rather than an M3U endpoint", () => {
  const url = xtreamService.getPlayerApiUrl(
    credentials.xtreamUrl,
    credentials.xtreamUsername,
    credentials.xtreamPassword,
    "get_live_streams"
  );
  assert.equal(url.pathname, "/portal/player_api.php");
  assert.equal(url.searchParams.get("username"), credentials.xtreamUsername);
  assert.equal(url.searchParams.get("password"), credentials.xtreamPassword);
  assert.equal(url.searchParams.get("action"), "get_live_streams");
});

test("stream URLs use the Xtream live path and encode path segments", () => {
  assert.equal(
    xtreamService.getStreamUrl(
      credentials.xtreamUrl,
      credentials.xtreamUsername,
      credentials.xtreamPassword,
      "1234"
    ),
    "https://provider.example.com:8080/portal/live/viewer%20name/secret%2Fvalue/1234.ts"
  );
});

test("catalog combines live streams with live categories", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url) => {
    const action = new URL(url).searchParams.get("action");
    const body = action === "get_live_categories"
      ? [{ category_id: "7", category_name: "News" }]
      : [
          { stream_id: 42, name: "World News", stream_icon: "https://img.example/news.png", category_id: "7" },
          { stream_id: "invalid", name: "Broken entry", category_id: "7" },
        ];
    return { ok: true, json: async () => body };
  };

  assert.deepEqual(await xtreamService.fetchCatalog(), [{
    streamId: "42",
    name: "World News",
    avatar: "https://img.example/news.png",
    categoryId: "7",
    category: "News",
  }]);
});

test("channel construction ignores client URLs and uses saved credentials", () => {
  const channel = xtreamService.buildChannel(
    { streamId: "42", name: "World News", avatar: "", category: "News" },
    { name: "News HD", mode: "restream", url: "https://attacker.example/stream" }
  );
  assert.equal(channel.name, "News HD");
  assert.equal(channel.mode, "restream");
  assert.equal(channel.source, "xtream");
  assert.equal(channel.sourceId, "42");
  assert.equal(
    channel.url,
    "https://provider.example.com:8080/portal/live/viewer%20name/secret%2Fvalue/42.ts"
  );
});

test("short EPG requests include the stream ID and requested limit", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ epg_listings: [{ id: "1" }] }) };
  };

  assert.deepEqual(await xtreamService.fetchShortEpg("42", 6), [{ id: "1" }]);
  assert.equal(requestedUrl.searchParams.get("action"), "get_short_epg");
  assert.equal(requestedUrl.searchParams.get("stream_id"), "42");
  assert.equal(requestedUrl.searchParams.get("limit"), "6");
});

test("server info requests use the player API without an action", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let requestedUrl;
  global.fetch = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => ({ server_info: { timezone: "Europe/Amsterdam" } }) };
  };

  assert.deepEqual(await xtreamService.fetchServerInfo(), { timezone: "Europe/Amsterdam" });
  assert.equal(requestedUrl.pathname, "/portal/player_api.php");
  assert.equal(requestedUrl.searchParams.has("action"), false);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
