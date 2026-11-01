const { gameTextEvidence, channelNameScore } = require('./GameTextEvidence');
const { networkIdentity } = require('./BroadcastIdentity');
const { localLocationEvidence } = require('./LocalLocationEvidence');

// Maximum attainable raw evidence for each scorer (including all bonuses).
const SCORE_MAXIMUMS = Object.freeze({ ppv: 95, streaming: 60, cable: 77, local: 44 });
const normalizeScore = (score, scorer) => Math.round(100 * score / SCORE_MAXIMUMS[scorer]);

const LOCAL = new Set(['ABC', 'CBS', 'NBC', 'FOX', 'The CW']);
const STREAMING = new Set(['Netflix', 'Prime Video', 'Peacock', 'ESPN+', 'Paramount+', 'Apple TV+']);

function ppvScore({ game, channel, matches, labels }) {
    const category = gameTextEvidence(game, channel.category);
    if (labels.namedEventMatch && !labels.conflict && !category.conflict) return 95;
    if (!matches.length || !(category.leagueMatch && !category.conflict || labels.football && !labels.conflict)) return 0;
    return channelNameScore(matches, { ...labels, football: labels.football || category.leagueMatch });
}

function streamingScore({ channel, categoryNetwork, guide }) {
    const identity = networkIdentity(channel.category);
    if (!STREAMING.has(identity) || !categoryNetwork?.evidence.some(item => item.network === identity)) {
        // Event feeds often have only a service category and no useful name.
        return 0;
    }
    return 45 + (networkIdentity(channel.name) === identity ? 10 : 0) + Math.min(5, guide.score);
}

function cableScore({ channel, network, guide, favorite }) {
    const identity = networkIdentity(channel.name);
    const categoryIdentity = networkIdentity(channel.category);
    // Affiliate categories belong to the local scorer. Event feeds can still
    // identify an assigned broadcast network in their name (for example NCAAF: CW).
    if (LOCAL.has(categoryIdentity) || STREAMING.has(identity)
        || !identity && STREAMING.has(categoryIdentity)) return 0;
    const assignment = identity && network && !STREAMING.has(network.evidence[0].network);
    if (!assignment && !guide.score) return 0;
    return Math.min(95, Math.max(assignment ? network.score : 0, guide.score)
        + (assignment ? Math.min(5, guide.score) : 0) + (favorite ? 40 : 0));
}

function localScore({ game, channel, network, guide, affiliate }) {
    const identity = networkIdentity(channel.category);
    if (!LOCAL.has(identity) || !network?.evidence.some(item => item.network === identity)) return { score: 0, evidence: [] };
    const location = localLocationEvidence(game, channel, identity);
    if (!location.length) return { score: 0, evidence: [] };
    return { score: Math.min(95, network.score + Math.max(affiliate?.boost || 0, location.length ? 15 : 0) + Math.min(5, guide.score)), evidence: location };
}

function scoreChannel(context) {
    const local = localScore(context);
    const base = { ppv: ppvScore(context), streaming: streamingScore(context), cable: cableScore(context), local: local.score };
    const rawScores = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, value
        ? Math.min(context.labels.conflict || context.labels.nonGame ? 5 : 95, Math.max(1, value - (context.guide.contradiction ? 10 : 0))) : 0]));
    const scores = Object.fromEntries(Object.entries(rawScores).map(([key, value]) => [key, normalizeScore(value, key)]));
    const scorer = Object.keys(scores).reduce((best, key) => scores[key] > scores[best] ? key : best, 'ppv');
    const confidenceScore = scores[scorer];
    // Apply guide effects within each scorer before choosing the maximum.
    const withoutGuide = { ...context, guide: { ...context.guide, score: 0, contradiction: false } };
    const baseline = { ppv: ppvScore(withoutGuide), streaming: streamingScore(withoutGuide), cable: cableScore(withoutGuide), local: localScore(withoutGuide).score }[scorer];
    const cap = context.labels.conflict || context.labels.nonGame ? 5 : 95;
    const beforePenalty = Math.min(cap, base[scorer]);
    return { confidenceScore, scorer, scores, rawScores, scoreMaximums: SCORE_MAXIMUMS,
        bonus: baseline ? normalizeScore(beforePenalty, scorer) - normalizeScore(Math.min(cap, baseline), scorer) : 0,
        penalty: normalizeScore(beforePenalty, scorer) - confidenceScore, evidence: local.evidence };
}

module.exports = { scoreChannel };
