const settingsStore = require("./SettingsStore");

const SETTING_KEYS = Object.freeze({
  streamSynchronizationEnabled: "stream_synchronization_enabled",
  transcodeAudioToAacLc: "transcode_audio_to_aac_lc",
  xtreamUrl: "xtream_url",
  xtreamUsername: "xtream_username",
  xtreamPassword: "xtream_password",
});

const DEFAULT_SETTINGS = Object.freeze({
  streamSynchronizationEnabled: false,
  transcodeAudioToAacLc: false,
  xtreamUrl: "",
  xtreamUsername: "",
  xtreamPassword: "",
});

function readString(name) {
  return settingsStore.get(SETTING_KEYS[name]) ?? DEFAULT_SETTINGS[name];
}

const settingsService = {
  getAll() {
    return {
      streamSynchronizationEnabled:
        settingsStore.get(SETTING_KEYS.streamSynchronizationEnabled) === "true",
      transcodeAudioToAacLc:
        settingsStore.get(SETTING_KEYS.transcodeAudioToAacLc) === "true",
      xtreamUrl: readString("xtreamUrl"),
      xtreamUsername: readString("xtreamUsername"),
      xtreamPassword: readString("xtreamPassword"),
    };
  },

  replace(settings) {
    settingsStore.replace([
      {
        key: SETTING_KEYS.streamSynchronizationEnabled,
        value: String(settings.streamSynchronizationEnabled),
      },
      {
        key: SETTING_KEYS.transcodeAudioToAacLc,
        value: String(settings.transcodeAudioToAacLc),
      },
      { key: SETTING_KEYS.xtreamUrl, value: settings.xtreamUrl },
      { key: SETTING_KEYS.xtreamUsername, value: settings.xtreamUsername },
      { key: SETTING_KEYS.xtreamPassword, value: settings.xtreamPassword },
    ]);

    return this.getAll();
  },

  shouldTranscodeAudioToAacLc() {
    return settingsStore.get(SETTING_KEYS.transcodeAudioToAacLc) === "true";
  },

  shouldSynchronizePlayback() {
    return settingsStore.get(SETTING_KEYS.streamSynchronizationEnabled) === "true";
  },

  getXtreamCredentials() {
    const { xtreamUrl, xtreamUsername, xtreamPassword } = this.getAll();
    return { url: xtreamUrl, username: xtreamUsername, password: xtreamPassword };
  },
};

module.exports = settingsService;
