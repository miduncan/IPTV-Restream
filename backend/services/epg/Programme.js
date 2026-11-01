function decodeEpgText(value) {
  const text = String(value ?? "").trim();
  if (!text || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return text;

  try {
    const decoded = Buffer.from(text, "base64");
    const roundTrip = decoded.toString("base64").replace(/=+$/, "");
    if (roundTrip !== text.replace(/=+$/, "")) return text;
    const decodedText = new TextDecoder("utf-8", { fatal: true }).decode(decoded).trim();
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(decodedText) ? text : decodedText;
  } catch {
    return text;
  }
}

function timestampMilliseconds(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return timestamp > 1e12 ? timestamp : timestamp * 1000;
}

function wallClockMilliseconds(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second);
}

function programmeTimestamp(timestamp, wallClock, serverOffsetMs) {
  const wallClockMs = wallClockMilliseconds(wallClock);
  if (wallClockMs !== null && Number.isFinite(serverOffsetMs)) return wallClockMs - serverOffsetMs;
  return timestampMilliseconds(timestamp ?? wallClock);
}

function normalizeProgramme(listing, serverOffsetMs = null) {
  const startMs = programmeTimestamp(listing?.start_timestamp, listing?.start, serverOffsetMs);
  const endMs = programmeTimestamp(
    listing?.stop_timestamp ?? listing?.end_timestamp,
    listing?.end,
    serverOffsetMs
  );
  if (startMs === null || endMs === null || endMs <= startMs) return null;

  return {
    id: String(listing.id ?? `${startMs}-${endMs}`),
    title: decodeEpgText(listing.title) || "No info available",
    description: decodeEpgText(listing.description),
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    startMs,
    endMs,
  };
}

module.exports = { decodeEpgText, timestampMilliseconds, wallClockMilliseconds, normalizeProgramme };
