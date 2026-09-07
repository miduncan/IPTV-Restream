const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-settings-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");

const settingsStore = require("../services/settings/SettingsStore");
const settingsService = require("../services/settings/SettingsService");
const controller = require("../controllers/AdminSettingsController");
const ffmpegService = require("../services/restream/FFmpegService");

const configuredSettings = {
  streamSynchronizationEnabled: true,
  transcodeAudioToAacLc: true,
  xtreamUrl: "https://provider.example.com:8080",
  xtreamUsername: "viewer",
  xtreamPassword: "secret",
};

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
  settingsStore.replace([]);
});

test("settings have typed defaults when SQLite contains no values", () => {
  assert.deepEqual(settingsService.getAll(), {
    streamSynchronizationEnabled: false,
    transcodeAudioToAacLc: false,
    xtreamUrl: "",
    xtreamUsername: "",
    xtreamPassword: "",
  });
  assert.equal(settingsService.shouldTranscodeAudioToAacLc(), false);
  assert.equal(settingsService.shouldSynchronizePlayback(), false);
});

test("settings are persisted in SQLite and exposed through typed accessors", () => {
  assert.deepEqual(settingsService.replace(configuredSettings), configuredSettings);
  assert.equal(settingsStore.list().length, 5);
  assert.equal(settingsService.shouldTranscodeAudioToAacLc(), true);
  assert.equal(settingsService.shouldSynchronizePlayback(), true);
  assert.deepEqual(settingsService.getXtreamCredentials(), {
    url: configuredSettings.xtreamUrl,
    username: configuredSettings.xtreamUsername,
    password: configuredSettings.xtreamPassword,
  });
});

test("settings endpoint accepts empty optional Xtream fields", () => {
  const response = createResponse();

  controller.replace(
    {
      body: {
        settings: {
          streamSynchronizationEnabled: false,
          transcodeAudioToAacLc: false,
          xtreamUrl: "",
          xtreamUsername: "",
          xtreamPassword: "",
        },
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.settings, settingsService.getAll());
});

test("settings endpoint rejects invalid Xtream URLs", () => {
  const response = createResponse();

  controller.replace(
    { body: { settings: { ...configuredSettings, xtreamUrl: "ftp://provider.example.com" } } },
    response
  );

  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /HTTP or HTTPS URL/);
});

test("FFmpeg only transcodes audio when the setting is enabled", () => {
  settingsService.replace({ ...configuredSettings, transcodeAudioToAacLc: false });
  assert.deepEqual(ffmpegService.getCodecArguments(), ["-c", "copy"]);

  settingsService.replace({ ...configuredSettings, transcodeAudioToAacLc: true });
  assert.deepEqual(ffmpegService.getCodecArguments(), [
    "-c:v", "copy",
    "-c:a", "aac",
    "-profile:a", "aac_low",
    "-b:a", "128k",
    "-ac", "2",
  ]);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
