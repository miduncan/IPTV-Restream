const data = require('./data/nfl-affiliates.json');
const { networkIdentity, hasNetworkBrand, channelRegion } = require('./BroadcastIdentity');
const stations = new Map();
for (const station of data.stations) {
    if (!stations.has(station.callsign)) stations.set(station.callsign, []);
    stations.get(station.callsign).push(station);
}
const teamMarkets = new Map(data.teams.map(team => [team.name.toLowerCase(), team]));

function recognizeAffiliate(channel) {
    const name = String(channel.name || '').toUpperCase();
    const region = channelRegion(channel);
    const nameRegion = channelRegion({ name });
    if ((region && region !== 'US') || (nameRegion && nameRegion !== 'US')) return null;
    if (channel.region && channelRegion({ region: channel.region }) !== 'US') return null;
    const callsigns = [...name.matchAll(/\b[KW][A-Z]{2,3}\b/g)].map(match => match[0]);
    if (callsigns.length !== 1) return null;
    const candidates = stations.get(callsigns[0]) || [];
    // A primary callsign does not establish a subchannel's affiliation.
    if (/\b\d{1,2}[.-]\d+\b/.test(name) || /\b(?:SUBCHANNEL|DT\d+)\b/.test(name)) return null;
    if (/\b(?:TELEMUNDO|UNIVISION|UNIMAS|PBS|CNN|MSNBC|CNBC|ION|ME ?TV|MY ?TV|MYNETWORKTV|COZI|ANTENNA|DABL|BOUNCE|COMET|GRIT)\b/.test(name)) return null;
    const branded = name.replace(/\b(FOX|CBS|NBC|ABC|CW)(?=\d)/g, '$1 ');
    const network = networkIdentity(branded);
    if (!network && hasNetworkBrand(branded)) return null;
    const station = network ? candidates.find(entry => entry.network === network)
        : candidates.find(entry => entry.primary) || (candidates.length === 1 && !candidates[0].requiresNetworkLabel ? candidates[0] : null);
    if (!station) return null;
    const suffix = name.match(new RegExp(`\\b${station.callsign}-([A-Z0-9]+)`))?.[1];
    if (suffix && !['TV', 'HD', ...(station.licenseSuffixes || [])].includes(suffix)) return null;
    if (network && network !== station.network) return null;
    const brand = station.network === 'The CW' ? '(?:THE\\s+)?CW' : station.network;
    const remaining = branded.replace(new RegExp(`\\b${brand}\\b`, 'g'), '');
    if (networkIdentity(remaining)) return null;
    return station;
}

function createAffiliateEvidence(games) {
    const recognized = new WeakMap();
    const relevant = new Map(games.filter(game => game.league === 'NFL').map(game => [game.id,
        game.teams.flatMap(team => {
            const evidence = teamMarkets.get(String(team.name || '').toLowerCase());
            return evidence ? [{ team, evidence }] : [];
        })]));
    return (game, channel, network) => {
        if (game.league !== 'NFL' || !network) return null;
        if (!recognized.has(channel)) recognized.set(channel, recognizeAffiliate(channel));
        const station = recognized.get(channel);
        if (!station || !network.evidence.some(item => item.region === 'US' && item.network === station.network)) return null;
        const teams = relevant.get(game.id).filter(entry => entry.evidence.markets.includes(station.market));
        if (!teams.length) return null;
        return { boost: 6, evidence: [{ kind: 'affiliate-market', callsign: station.callsign, network: station.network,
            region: 'US', market: station.market, heuristic: true, checkedAt: data.checkedAt,
            teams: teams.map(({ team }) => ({ id: team.id, name: team.name })),
            sourceUrl: station.sourceUrls?.[0] || data.sources.stations,
            stationSourceUrls: station.sourceUrls || [data.sources.stations],
            teamSourceUrls: [...new Set([data.sources.clubs, ...teams.map(entry => data.sources[entry.evidence.support]).filter(Boolean)])],
            description: `NFL US market heuristic: ${station.callsign} (${station.market}) is associated with ${teams.map(entry => entry.team.name).join(' and ')}; carriage is unverified` }] };
    };
}

module.exports = { recognizeAffiliate, createAffiliateEvidence };
