function defaultGamesSettings() {
    return { enabledLeagues: ['NFL', 'CFB'], estimatedDurationHours: { NFL: 4, CFB: 4 }, broadcastRegions: ['US', 'CA', 'UK'],
        matchingEnabled: false, matchingTime: '06:00', matchingTimezone: 'America/Los_Angeles' };
}

function validateGamesSettings(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'Games settings must be an object';
    if (typeof settings.matchingEnabled !== 'boolean') return 'Automatic matching must be true or false';
    if (typeof settings.matchingTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(settings.matchingTime)) return 'Matching time must use HH:mm (00:00 through 23:59)';
    if (typeof settings.matchingTimezone !== 'string' || !settings.matchingTimezone || settings.matchingTimezone.length > 100) return 'Matching timezone must be a valid timezone name';
    try { new Intl.DateTimeFormat('en-US', { timeZone: settings.matchingTimezone }); }
    catch { return 'Matching timezone must be a valid timezone name'; }
    if (!Array.isArray(settings.enabledLeagues) || settings.enabledLeagues.some(league => !['NFL', 'CFB'].includes(league))
        || new Set(settings.enabledLeagues).size !== settings.enabledLeagues.length) return 'Enabled leagues must be a unique list of NFL and CFB';
    if (!Array.isArray(settings.broadcastRegions) || settings.broadcastRegions.some(region => typeof region !== 'string' || !/^[A-Z]{2,3}$/.test(region))
        || new Set(settings.broadcastRegions).size !== settings.broadcastRegions.length) return 'Broadcast regions must be unique uppercase country codes (for example US, CA, UK)';
    for (const league of ['NFL', 'CFB']) {
        const duration = settings.estimatedDurationHours?.[league];
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 24) {
            return `${league} estimated duration must be greater than zero and at most 24 hours`;
        }
    }
    return null;
}

module.exports = { defaultGamesSettings, validateGamesSettings };
