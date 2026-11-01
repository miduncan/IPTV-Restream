const AMBIGUOUS_NAMES = new Set(['tigers', 'wildcats', 'bulldogs', 'eagles', 'cardinals', 'panthers', 'bears', 'lions', 'trojans', 'miami', 'new york', 'los angeles', 'state', 'tech']);
function normalizeText(value) {
    return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function aliasesFor(team) {
    return [...new Set([team.name, team.shortName, team.abbreviation, ...(team.aliases || [])].map(normalizeText).filter(Boolean))];
}
function createTeamContext(games) {
    const aliases = new Map();
    for (const game of games) for (const team of game.teams) for (const alias of aliasesFor(team)) {
        if (!aliases.has(alias)) aliases.set(alias, new Set());
        aliases.get(alias).add(`${game.league}:${team.id}`);
    }
    return aliases;
}
function matchTeamNames(game, value, aliases) {
    const text = ` ${normalizeText(value)} `;
    const leagueContext = game.league === 'NFL' ? text.includes(' nfl ') : / (cfb|ncaaf|ncaa football|college football) /.test(text);
    return game.teams.flatMap(team => {
        const matched = aliasesFor(team).filter(alias => text.includes(` ${alias} `)).map(alias => {
            const shared = aliases.get(alias).size > 1;
            const ambiguous = shared || AMBIGUOUS_NAMES.has(alias) || alias.length <= 3;
            return { teamId: team.id, team: team.name, alias, ambiguous: ambiguous && !(leagueContext && !shared && !AMBIGUOUS_NAMES.has(alias)) };
        }).sort((left, right) => Number(left.ambiguous) - Number(right.ambiguous) || right.alias.length - left.alias.length);
        return matched.length ? [matched[0]] : [];
    });
}
function identifiesDifferentMatchup(game, value, games, context) {
    if (!/(?:\bvs?\.?\b|\bat\b|@|[-–—])/i.test(value)) return false;
    const expected = new Set(game.teams.map(team => `${game.league}:${team.id}`));
    const identified = new Set();
    for (const knownGame of games) {
        for (const match of matchTeamNames(knownGame, value, context)) {
            if (!match.ambiguous) identified.add(`${knownGame.league}:${match.teamId}`);
        }
    }
    return identified.size >= 2 && [...identified].some(team => !expected.has(team));
}
module.exports = { createTeamContext, matchTeamNames, identifiesDifferentMatchup };
