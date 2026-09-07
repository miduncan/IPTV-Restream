const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-epg-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");

const { EpgService, decodeEpgText, normalizeProgramme } = require("../services/EpgService");

const channel = { id: 7, source: "xtream", sourceId: "42" };

test("EPG text decoding accepts Base64 and leaves plain text alone", () => {
  assert.equal(decodeEpgText(Buffer.from("Evening News").toString("base64")), "Evening News");
  assert.equal(decodeEpgText("The Bear"), "The Bear");
});

test("programme normalization prefers Unix timestamps", () => {
  assert.deepEqual(
    normalizeProgramme({
      id: "11",
      title: Buffer.from("World Report").toString("base64"),
      description: Buffer.from("Headlines").toString("base64"),
      start_timestamp: "1700000000",
      stop_timestamp: 1700003600,
    }),
    {
      id: "11",
      title: "World Report",
      description: "Headlines",
      start: "2023-11-14T22:13:20.000Z",
      end: "2023-11-14T23:13:20.000Z",
      startMs: 1700000000000,
      endMs: 1700003600000,
    }
  );
});

test("programme normalization applies the Xtream server wall-clock offset", () => {
  const programme = normalizeProgramme({
    id: "12",
    title: Buffer.from("Current show").toString("base64"),
    start: "2026-09-07 23:00:00",
    end: "2026-09-08 01:00:00",
    start_timestamp: 1788822000,
    stop_timestamp: 1788829200,
  }, 2 * 60 * 60 * 1000);

  assert.equal(programme.start, "2026-09-07T21:00:00.000Z");
  assert.equal(programme.end, "2026-09-07T23:00:00.000Z");
});

test("channel EPG is cached through the current programme and includes next", async () => {
  let now = 1700001000000;
  let fetchCount = 0;
  const service = new EpgService({
    now: () => now,
    xtreamService: {
      async fetchShortEpg(streamId, limit) {
        fetchCount += 1;
        assert.equal(streamId, "42");
        assert.equal(limit, 6);
        return [
          {
            id: "current",
            title: Buffer.from("Current show").toString("base64"),
            description: "",
            start_timestamp: 1700000000,
            stop_timestamp: 1700003600,
          },
          {
            id: "next",
            title: Buffer.from("Next show").toString("base64"),
            description: "",
            start_timestamp: 1700003600,
            stop_timestamp: 1700007200,
          },
        ];
      },
    },
  });

  const first = await service.getChannelGuide(channel);
  const second = await service.getChannelGuide(channel);
  assert.equal(first.current.title, "Current show");
  assert.equal(first.next.title, "Next show");
  assert.equal(first.cacheUntil, first.current.end);
  assert.deepEqual(second, first);
  assert.equal(fetchCount, 1);

  now = 1700003601000;
  await service.getChannelGuide(channel);
  assert.equal(fetchCount, 2);
});

test("missing EPG data is negatively cached and returned as an empty guide", async () => {
  let fetchCount = 0;
  const service = new EpgService({
    now: () => 1700000000000,
    xtreamService: { async fetchShortEpg() { fetchCount += 1; return []; } },
  });

  const first = await service.getChannelGuide(channel);
  const second = await service.getChannelGuide(channel);
  assert.equal(first.current, null);
  assert.equal(first.next, null);
  assert.deepEqual(second, first);
  assert.equal(fetchCount, 1);
  assert.equal(service.clear(), 1);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
