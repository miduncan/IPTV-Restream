const settingsService = require("./settings/SettingsService");

const REQUEST_TIMEOUT_MS = 15000;
const VALID_MODES = new Set(["direct", "proxy", "restream"]);

function getPlayerApiUrl(baseUrl, username, password, action) {
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/player_api.php`);
  url.searchParams.set("username", username);
  url.searchParams.set("password", password);
  if (action) url.searchParams.set("action", action);
  return url;
}

function addQueryParameters(url, parameters) {
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
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
    // Fetch failures can embed the credential-bearing player API URL.
    if (/^Xtream API returned HTTP \d+$/.test(error.message)) throw error;
    throw new Error('Could not load the Xtream API response');
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

  getGuideCacheKey() {
    const crypto = require("node:crypto");
    return crypto.createHash("sha256").update(JSON.stringify(this.getCredentials())).digest("hex");
  }

  async fetchXmlTv(context) {
    const { url, username, password } = this.getCredentials();
    const endpoint = new URL(`${url.replace(/\/+$/, "")}/xmltv.php`);
    endpoint.searchParams.set("username", username); endpoint.searchParams.set("password", password);
    const response = await context.fetch(endpoint);
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("Bulk XMLTV is unavailable"); }
    return response.body;
  }

  async fetchCatalog(context) {
    const { url, username, password } = this.getCredentials();
    const loadJson = context ? endpoint => context.fetchJson(endpoint) : fetchJson;
    const [streams, categories] = await Promise.all([
      loadJson(getPlayerApiUrl(url, username, password, "get_live_streams")),
      loadJson(getPlayerApiUrl(url, username, password, "get_live_categories")).catch((error) => {
        if (context?.signal.aborted || /budget|redirect limit/.test(error.message)) throw error;
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
        const epgId = (typeof stream.epg_channel_id === "string" || Number.isSafeInteger(stream.epg_channel_id)) ? String(stream.epg_channel_id).trim() : null;
        return [{
          streamId,
          epgChannelId: epgId && epgId.length <= 1024 ? epgId : null,
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

  async fetchShortEpg(streamId, limit = 2) {
    const normalizedId = normalizeStreamId(streamId);
    const normalizedLimit = Number.parseInt(limit, 10);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 20) {
      const error = new Error("EPG limit must be between 1 and 20");
      error.statusCode = 400;
      throw error;
    }

    const { url, username, password } = this.getCredentials();
    const response = await fetchJson(addQueryParameters(
      getPlayerApiUrl(url, username, password, "get_short_epg"),
      { stream_id: normalizedId, limit: normalizedLimit }
    ));

    return Array.isArray(response?.epg_listings) ? response.epg_listings : [];
  }

  async fetchServerInfo() {
    const { url, username, password } = this.getCredentials();
    const response = await fetchJson(getPlayerApiUrl(url, username, password));
    return response?.server_info && typeof response.server_info === "object"
      ? response.server_info
      : null;
  }

  async fetchScheduleEpg(streamId) {
    const normalizedId = normalizeStreamId(streamId);
    const { url, username, password } = this.getCredentials();
    const response = await fetchJson(addQueryParameters(
      getPlayerApiUrl(url, username, password, "get_simple_data_table"),
      { stream_id: normalizedId }
    ));
    if (!Array.isArray(response?.epg_listings)) {
      throw new Error("Schedule EPG is unavailable from this provider");
    }
    return response.epg_listings;
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
      tags: Array.isArray(overrides.tags) ? overrides.tags : [],
    };
  }
}

module.exports = new XtreamService();
module.exports.getPlayerApiUrl = getPlayerApiUrl;
module.exports.getStreamUrl = getStreamUrl;
module.exports.normalizeStreamId = normalizeStreamId;
