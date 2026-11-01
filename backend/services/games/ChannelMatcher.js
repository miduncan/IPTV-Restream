const { createTeamContext, matchTeamNames } = require('./TeamMatchEvidence');
const { epgEvidence } = require('./EpgEvidence');
const { createNetworkEvidence, resolveChannelIdentity } = require('./BroadcastNetworkEvidence');
const { createAffiliateEvidence } = require('./NflAffiliateEvidence');
const { gameTextEvidence } = require('./GameTextEvidence');
const { scoreChannel } = require('./ChannelScorers');
const { networkIdentity, channelRegion, hasNetworkBrand } = require('./BroadcastIdentity');

function matchChannels(games, catalog, options = {}) {
    const teamContext = createTeamContext(games);
    const matchNetwork = createNetworkEvidence(games, options);
    const matchAffiliate = createAffiliateEvidence(games);
    const channels = [...new Map(catalog.map(channel => [String(channel.streamId), channel])).values()]
        .filter(channel => /^[1-9]\d*$/.test(String(channel.streamId)) && Number.isSafeInteger(Number(channel.streamId)));
    const results = {};
    for (const game of games) {
        results[game.id] = channels.flatMap(channel => {
            const matches = matchTeamNames(game, channel.name, teamContext);
            const channelNetwork = matchNetwork(game, channel);
            const categoryNetwork = matchNetwork(game, { name: channel.category, region: channelRegion(channel) });
            const network = channelNetwork || (!resolveChannelIdentity(channel).network && !hasNetworkBrand(channel.name) ? categoryNetwork : null);
            const guide = epgEvidence(game, channel, games, { ...options, teamContext, network });
            const affiliate = matchAffiliate(game, channel, network);
            const labels = gameTextEvidence(game, channel.name);
            if (!matches.length && !labels.namedEventMatch && !guide?.score && !network && !categoryNetwork) return [];
            const strong = matches.filter(match => !match.ambiguous).length;
            const both = matches.length === game.teams.length;
            const ranking = scoreChannel({ game, channel, matches, labels, network, categoryNetwork, guide, affiliate,
                favorite: options.favoriteStreamIds?.has(String(channel.streamId)) });
            if (!ranking.confidenceScore) return [];
            const { confidenceScore } = ranking;
            return [{
                id: `xtream:${channel.streamId}`, source: 'xtream', sourceId: String(channel.streamId),
                categoryId: String(channel.categoryId || ''), category: String(channel.category || 'Uncategorized'),
                name: String(channel.name), avatar: String(channel.avatar || ''), confidenceScore,
                scorer: ranking.scorer, scores: ranking.scores, rawScores: ranking.rawScores, scoreMaximums: ranking.scoreMaximums,
                epgInspection: { status: guideStatus(channel, guide, options), window: guide.window, programmes: guide.programmes,
                    score: guide.score, bonus: ranking.bonus, penalty: ranking.penalty },
                evidence: [...(labels.namedEventMatch ? [{ kind: 'event-name', description: `${game.name} appears in the current provider channel name` }] : []),
                    ...(matches.length ? [{ kind: 'channel-name', teams: matches, contextualResolution: both && strong > 0,
                    description: both ? 'Both teams appear in the current provider channel name' : 'One team appears in the current provider channel name' }] : []),
                    ...(labels.conflict || labels.nonGame ? [{ kind: 'channel-label', description: `${labels.conflictReason || 'Non-game programme label'} in channel name; raw scorer points capped at 5` }]
                        : matches.length && labels.football ? [{ kind: 'sport', description: 'Football is identified in the provider channel name' }] : []),
                    ...(guide?.evidence || []), ...(network?.evidence || []), ...(ranking.scores.local ? affiliate?.evidence || [] : []), ...ranking.evidence,
                    ...(ranking.scores.cable && options.favoriteStreamIds?.has(String(channel.streamId)) ? [{ kind: 'favorite', description: 'Saved channel; large cable scorer boost' }] : []),
                    { kind: 'scorer', description: `${ranking.scorer} scorer selected; ${Object.keys(ranking.scores).map(key => `${key}: ${ranking.rawScores[key]}/${ranking.scoreMaximums[key]} → ${ranking.scores[key]}/100`).join('; ')}` }],
            }];
        }).sort((left, right) => right.confidenceScore - left.confidenceScore || left.name.localeCompare(right.name) || left.sourceId.localeCompare(right.sourceId));
    }
    return results;
}

function guideStatus(channel, guide, options) {
    if (!channel.epgChannelId) return 'unmapped';
    if (options.guideCoverage?.failedStreams || options.guideCoverage?.unsupportedStreams) return 'unavailable';
    if (options.guideMappedIds && !options.guideMappedIds.has(channel.epgChannelId)) return 'unmapped';
    return guide.programmes.length ? 'available' : 'empty';
}

module.exports = { matchChannels };
