const settingsService = require("./settings/SettingsService");

const REQUEST_TIMEOUT_MS = 15000;
const VALID_MODES = new Set(["direct", "proxy", "restream"]);

function getPlayerApiUrl(baseUrl, username, password, action) {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  url.searchParams.set("action", action);
  return url;
}

function getStreamUrl(baseUrl, username, password, streamId) {
  return `${baseUrl.replace(/\/+$/, "")}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(streamId)}.ts`;
}

function normalizeStreamId(value) {
  const streamId = String(value ?? "").trim();
  if (!/^\d+$/.test(streamId)) {
    const error = new Error("Xtream stream ID must be a positive integer");
    error.statusCode = 400;
    throw error;
  }
  return streamId;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Xtream API returned HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Xtream API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class XtreamService {
  getCredentials() {
    const credentials = settingsService.getXtreamCredentials();
    if (!credentials.url || !credentials.username || !credentials.password) {
      const error = new Error("Configure the Xtream URL, username, and password in Settings first");
      error.statusCode = 400;
      throw error;
    }
    return credentials;
  }

  async fetchCatalog() {
    const { url, username, password } = this.getCredentials();
    const [streams, categories] = await Promise.all([
      fetchJson(getPlayerApiUrl(url, username, password, "get_live_streams")),
      fetchJson(getPlayerApiUrl(url, username, password, "get_live_categories")).catch((error) => {
        console.warn("Could not load Xtream categories:", error.message);
        return [];
      }),
    ]);

    if (!Array.isArray(streams)) {
      throw new Error("Xtream API returned an invalid live-stream list");
    }

    const categoryNames = new Map(
      (Array.isArray(categories) ? categories : []).map((category) => [
        String(category.category_id),
        String(category.category_name || "Uncategorized"),
      ])
    );

    return streams.flatMap((stream) => {
      try {
        const streamId = normalizeStreamId(stream.stream_id);
        const categoryId = String(stream.category_id ?? "");
        return [{
          streamId,
          name: String(stream.name || `Stream ${streamId}`),
          avatar: String(stream.stream_icon || ""),
          categoryId,
          category: categoryNames.get(categoryId) || "Uncategorized",
        }];
      } catch {
        return [];
      }
    });
  }

  async findStream(streamId) {
    const normalizedId = normalizeStreamId(streamId);
    const catalog = await this.fetchCatalog();
    const stream = catalog.find((entry) => entry.streamId === normalizedId);
    if (!stream) {
      const error = new Error("The selected channel is no longer available from Xtream");
      error.statusCode = 404;
      throw error;
    }
    return stream;
  }

  buildChannel(stream, overrides = {}) {
    const { url, username, password } = this.getCredentials();
    const mode = overrides.mode || "proxy";
    if (!VALID_MODES.has(mode)) {
      const error = new Error("Channel mode must be direct, proxy, or restream");
      error.statusCode = 400;
      throw error;
    }

    return {
      name: String(overrides.name || stream.name).trim() || stream.name,
      url: getStreamUrl(url, username, password, stream.streamId),
      avatar: String(overrides.avatar || stream.avatar || "https://via.placeholder.com/64").trim(),
      mode,
      headersJson: Array.isArray(overrides.headers) ? overrides.headers : [],
      group: stream.category,
      playlistName: "Xtream",
      source: "xtream",
      sourceId: stream.streamId,
    };
  }
}

module.exports = new XtreamService();
module.exports.getPlayerApiUrl = getPlayerApiUrl;
module.exports.getStreamUrl = getStreamUrl;
module.exports.normalizeStreamId = normalizeStreamId;
