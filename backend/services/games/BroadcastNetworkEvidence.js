const { networkIdentity, channelRegion } = require('./BroadcastIdentity');
const { recognizeAffiliate } = require('./NflAffiliateEvidence');
const REGIONAL_NETWORKS = new Set(['ABC', 'FOX', 'CBS', 'NBC', 'The CW']);

function resolveChannelIdentity(channel) {
    const affiliate = recognizeAffiliate(channel);
    return { network: networkIdentity(channel.name) || affiliate?.network, region: channelRegion(channel) || (affiliate ? 'US' : null) };
}

function networkEvidence(game, channel, games, { regions = ['US', 'CA', 'UK'], estimatedDurationHours = {} } = {}) {
    const { network, region } = resolveChannelIdentity(channel);
    if (!network) return null;
    const assignments = (game.broadcasts || []).filter(assignment => assignment.region && regions.includes(assignment.region)
        && (!region || region === assignment.region) && networkIdentity(assignment.network) === network);
    if (!assignments.length) return null;
    const duration = entry => entry.endsAt ? Date.parse(entry.endsAt) - Date.parse(entry.startsAt) : (estimatedDurationHours[entry.league] || 4) * 3600000;
    const overlaps = other => Date.parse(other.startsAt) < Date.parse(game.startsAt) + duration(game)
        && Date.parse(game.startsAt) < Date.parse(other.startsAt) + duration(other);
    const evidence = [...new Set(assignments.map(assignment => assignment.region))].map(assignmentRegion => {
        const possibleGames = games.filter(other => overlaps(other) && (other.broadcasts || []).some(assignment => assignment.region === assignmentRegion && networkIdentity(assignment.network) === network)).length;
        const regionalUncertainty = REGIONAL_NETWORKS.has(network) || possibleGames > 1 || !region;
        return { kind: 'broadcast-network', network, region: assignmentRegion, possibleGames, regionalUncertainty,
            description: `Scheduled ${network} assignment (${assignmentRegion}); ${possibleGames > 1 ? `${possibleGames} overlapping games may use this network; ` : ''}${regionalUncertainty ? 'regional carriage is unverified' : 'network evidence does not confirm this feed carries the game'}` };
    });
    const alternatives = Math.max(...evidence.map(item => item.possibleGames));
    const score = (REGIONAL_NETWORKS.has(network) ? 24 : region ? 32 : 26) - Math.min(12, Math.max(0, alternatives - 1) * 4);
    return { score, evidence };
}

function createNetworkEvidence(games, options) {
    const identities = new WeakMap();
    const evidence = new Map();
    return (game, channel) => {
        if (!identities.has(channel)) identities.set(channel, resolveChannelIdentity(channel));
        const identity = identities.get(channel);
        if (!identity.network) return null;
        const key = `${game.id}|${identity.network}|${identity.region}`;
        if (!evidence.has(key)) evidence.set(key, networkEvidence(game, channel, games, options));
        return evidence.get(key);
    };
}

module.exports = { resolveChannelIdentity, networkEvidence, createNetworkEvidence, networkIdentity, channelRegion };
