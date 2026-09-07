const settingsStore = require("../services/settings/SettingsStore");

const KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;
const MAX_SETTINGS = 100;
const MAX_VALUE_LENGTH = 4096;

function validateSettings(value) {
  if (!Array.isArray(value)) {
    return "Settings must be an array";
  }

  if (value.length > MAX_SETTINGS) {
    return `Settings cannot contain more than ${MAX_SETTINGS} entries`;
  }

  const keys = new Set();
  for (const setting of value) {
    if (!setting || typeof setting.key !== "string" || typeof setting.value !== "string") {
      return "Every setting must contain a string key and value";
    }

    if (!KEY_PATTERN.test(setting.key)) {
      return `Invalid setting key: ${setting.key || "(empty)"}`;
    }

    if (setting.value.length > MAX_VALUE_LENGTH) {
      return `The value for ${setting.key} is too long`;
    }

    const normalizedKey = setting.key.toLowerCase();
    if (keys.has(normalizedKey)) {
      return `Duplicate setting key: ${setting.key}`;
    }
    keys.add(normalizedKey);
  }

  return null;
}

module.exports = {
  list(req, res) {
    try {
      res.json({ settings: settingsStore.list() });
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

    const normalizedSettings = settings.map(({ key, value }) => ({
      key: key.trim(),
      value,
    }));

    try {
      return res.json({ settings: settingsStore.replace(normalizedSettings) });
    } catch (error) {
      console.error("Could not save admin settings:", error);
      return res.status(500).json({ error: "Could not save settings" });
    }
  },
};
