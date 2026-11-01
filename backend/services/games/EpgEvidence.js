const { matchTeamNames, identifiesDifferentMatchup } = require('./TeamMatchEvidence');
const { gameTextEvidence } = require('./GameTextEvidence');
const HOUR = 3600000;

function programmeScore(matches, labels) {
    const strong = matches.filter(match => !match.ambiguous).length;
    if (matches.length === 2) {
        if (strong === 2) return labels.football ? 20 : 15;
        return strong ? 10 : 4;
    }
    if (!matches.length) return 0;
    return strong ? labels.football ? 5 : 3 : 1;
}

function epgEvidence(game, channel, games, { epgByStream, estimatedDurationHours = {}, teamContext, network } = {}) {
    const start = Date.parse(game.startsAt);
    const end = game.endsAt ? Date.parse(game.endsAt) : start + (estimatedDurationHours[game.league] || 4) * HOUR;
    const evidence = [];
    const programmes = [];
    let score = 0;
    let contradiction = false;
    let nameConflict;
    for (const programme of epgByStream?.get(String(channel.streamId)) || []) {
        if (programme.startMs >= end || programme.endMs <= start) continue;
        const text = `${programme.title} ${programme.description}`;
        const matches = matchTeamNames(game, text, teamContext);
        const labels = gameTextEvidence(game, `${text} ${(programme.categories || []).join(' ')}`);
        const differentMatchup = game.kind !== 'named' && !labels.nonGame && !labels.conflict && identifiesDifferentMatchup(game, text, games, teamContext);
        const channelContradiction = !labels.nonGame && matches.length > 0
            && (nameConflict ??= identifiesDifferentMatchup(game, channel.name, games, teamContext));
        let points = 0;
        let treatment = 'No matching teams or supported programme label; no points';
        if (labels.conflict || differentMatchup) {
            treatment = `${labels.conflictReason || 'Different matchup'}; no supporting points`;
        } else if (labels.nonGame) {
            treatment = 'Pregame, postgame, highlights, or replay label; no live-game points';
        } else if (matches.length) {
            points = programmeScore(matches, labels);
            const both = matches.length === game.teams.length;
            treatment = `${both ? 'Both teams' : 'One team'}${labels.football ? ' and football' : '; sport unverified'}; ${points} EPG ranking points`;
            evidence.push({ kind: 'epg', title: programme.title, start: programme.start, end: programme.end, teams: matches,
                description: `${treatment}: ${programme.title}` });
        } else if (labels.namedEventMatch || labels.programme && labels.leagueMatch && network) {
            points = 12;
            treatment = labels.namedEventMatch
                ? `${labels.programme}; event name and event-window overlap support this label; 12 EPG ranking points`
                : `${labels.programme}; scheduled network and game-window overlap support this label; 12 EPG ranking points`;
            evidence.push({ kind: 'epg-programme', title: programme.title, start: programme.start, end: programme.end, description: treatment });
        } else if (labels.football) {
            treatment = 'Football label only; no teams or supported programme assignment; no points';
        }
        if (labels.conflict || differentMatchup || channelContradiction) {
            contradiction = true;
            treatment += '; conflict detected (see applied candidate penalty)';
            evidence.push({ kind: 'contradiction', title: programme.title, start: programme.start, end: programme.end,
                channelName: String(channel.name), description: `${labels.conflictReason || 'Conflicting matchup evidence'}: EPG "${programme.title}"; provider channel "${channel.name}"` });
        }
        score = Math.max(score, points);
        programmes.push({ title: programme.title, description: programme.description, categories: programme.categories || [],
            start: programme.start, end: programme.end, points, treatment });
    }
    programmes.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title));
    return { score, evidence, contradiction, programmes, window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() } };
}
module.exports = { epgEvidence };
