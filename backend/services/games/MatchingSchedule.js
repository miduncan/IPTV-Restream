function scheduledOccurrence(settings, now) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: settings.matchingTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date(now)).map(part => [part.type, part.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    return {
        key: `${settings.matchingTimezone}|${settings.matchingTime}|${date}`,
        due: `${parts.hour}:${parts.minute}` >= settings.matchingTime,
    };
}
module.exports = { scheduledOccurrence };
