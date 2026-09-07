const settingsService = require("../services/settings/SettingsService");

const MAX_VALUE_LENGTH = 4096;
const STRING_FIELDS = ["xtreamUrl", "xtreamUsername", "xtreamPassword"];

function validateSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return "Settings must be an object";
  }

  if (typeof settings.transcodeAudioToAacLc !== "boolean") {
    return "Transcode audio to AAC-LC must be true or false";
  }

  for (const field of STRING_FIELDS) {
    if (typeof settings[field] !== "string") {
      return `${field} must be a string`;
    }
    if (settings[field].length > MAX_VALUE_LENGTH) {
      return `${field} is too long`;
    }
  }

  if (settings.xtreamUrl) {
    try {
      const url = new URL(settings.xtreamUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      return "Xtream URL must be a valid HTTP or HTTPS URL";
    }
  }

  return null;
}

module.exports = {
  list(req, res) {
    try {
      res.json({ settings: settingsService.getAll() });
    } catch (error) {
      console.error("Could not load admin settings:", error);
      res.status(500).json({ error: "Could not load settings" });
    }
  },

  replace(req, res) {
    const settings = req.body?.settings;
    const validationError = validateSettings(settings);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const normalizedSettings = {
      ...settings,
      xtreamUrl: settings.xtreamUrl.trim().replace(/\/$/, ""),
      xtreamUsername: settings.xtreamUsername.trim(),
    };

    try {
      return res.json({ settings: settingsService.replace(normalizedSettings) });
    } catch (error) {
      console.error("Could not save admin settings:", error);
      return res.status(500).json({ error: "Could not save settings" });
    }
  },
};
