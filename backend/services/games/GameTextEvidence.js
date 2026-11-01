function gameTextEvidence(game, value) {
    const text = String(value || '').toLowerCase();
    const normalized = ` ${text.replace(/[^a-z0-9]+/g, ' ').trim()} `;
    const namedProgramme = game.kind === 'named' && [game.name, ...(game.aliases || [])].some(name =>
        name && normalized.includes(` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `)) ? game.name : null;
    const programme = namedProgramme || (/\b(?:snf|sunday night football)\b/.test(text) ? 'Sunday Night Football'
        : /\b(?:mnf|monday night football)\b/.test(text) ? 'Monday Night Football'
            : /\b(?:tnf|thursday night football)\b/.test(text) ? 'Thursday Night Football' : null);
    const nfl = /\bnfl\b|\bnational football league\b/.test(text) || Boolean(programme);
    const cfb = /\bcfb\b|\bcollege football\b|\bncaa\s+football\b|\bncaaf\b/.test(text);
    const otherSport = /\b(?:volleyball|basketball|baseball|softball|soccer|hockey|tennis|golf|rugby|lacrosse|wrestling|gymnastics|swimming|cricket|motorsports)\b|\btrack and field\b/.test(text);
    const leagueConflict = game.league === 'NFL' ? cfb && !nfl : game.league === 'CFB' && nfl && !cfb;
    return {
        football: !otherSport && (nfl || cfb || /\bfootball\b/.test(text)),
        leagueMatch: game.league === 'NFL' ? nfl : game.league === 'CFB' && cfb,
        programme,
        namedEventMatch: Boolean(namedProgramme),
        nonGame: /\b(?:pre[\s-]?game|post[\s-]?game|highlights?|replays?|encore)\b/.test(text),
        conflict: otherSport || leagueConflict,
        conflictReason: otherSport ? 'Explicitly different sport' : leagueConflict ? 'Explicitly different football league' : null,
    };
}

function channelNameScore(matches, labels) {
    if (!matches.length) return 0;
    const strong = matches.filter(match => !match.ambiguous).length;
    if (matches.length === 2) {
        if (strong === 2) return labels.football ? 95 : 70;
        return strong ? 60 : 18;
    }
    if (strong) return labels.football ? 20 : 5;
    return labels.football ? 3 : 1;
}

module.exports = { gameTextEvidence, channelNameScore };
