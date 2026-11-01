const namedEvents = [
    { id: 'named:nfl-redzone', name: 'NFL RedZone', league: 'NFL', aliases: ['RedZone', 'Red Zone'],
        broadcasts: [{ network: 'TSN1', region: 'CA' }],
        logo: 'nfl', timezone: 'America/Los_Angeles',
        weekday: 0, startHour: 10, endHour: 17 },
];

function localParts(time, timezone) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(time).map(part => [part.type, part.value]));
}

function localHour(date, hour, timezone) {
    const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour);
    let instant = target;
    for (let attempt = 0; attempt < 3; attempt++) {
        const parts = localParts(instant, timezone);
        const wallTime = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
        instant += target - wallTime;
    }
    return instant;
}

function getNamedEvents(now, { enabledLeagues, upcomingWindow }) {
    return namedEvents.flatMap(event => {
        if (!enabledLeagues.includes(event.league)) return [];
        const parts = localParts(now, event.timezone);
        const date = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
        date.setUTCDate(date.getUTCDate() + (event.weekday - date.getUTCDay() + 7) % 7);
        const start = localHour(date, event.startHour, event.timezone);
        const end = localHour(date, event.endHour, event.timezone);
        if (now >= end || start > now + upcomingWindow) return [];
        return [{ id: `${event.id}:${date.toISOString().slice(0, 10)}`, kind: 'named', name: event.name, aliases: event.aliases,
            league: event.league, broadcasts: event.broadcasts, teams: [], logo: event.logo,
            status: now < start ? 'scheduled' : 'live', statusDetail: now < start ? 'Scheduled' : 'Live',
            startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
            group: now < start ? 'startingSoon' : 'live' }];
    });
}

module.exports = { getNamedEvents };
