const data = require('./data/nfl-affiliates.json');
const { recognizeAffiliate } = require('./NflAffiliateEvidence');
const { channelRegion } = require('./BroadcastIdentity');
const normalize = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const contains = (text, value) => value && ` ${normalize(text)} `.includes(` ${normalize(value)} `);
const marketCities = market => market.split('/').map(city => city.replace(/([a-z])([A-Z])/g, '$1 $2'));
function nearGame(station, markets, cities, state) {
    return markets.includes(station.market) || (!(state && /^[A-Z]{2}$/.test(state) && station.states?.length) || station.states.includes(state))
        && (station.cities || marketCities(station.market))
        .some(city => cities.some(expected => normalize(expected) === normalize(city)));
}

function localLocationEvidence(game, channel, network) {
    if (channelRegion(channel) && channelRegion(channel) !== 'US') return [];
    const markets = game.league === 'NFL' ? data.teams.filter(entry => game.teams.some(team => team.name.toLowerCase() === entry.name.toLowerCase())).flatMap(team => team.markets) : [];
    const cities = [...new Set([game.venue?.city, ...markets.flatMap(marketCities)].filter(Boolean))];
    const state = String(game.venue?.state || '').toUpperCase();
    const station = recognizeAffiliate(channel);
    if (station && !nearGame(station, markets, cities, state)) return [];
    const matchedCity = cities.find(city => contains(channel.name, city));
    const callsign = station?.network === network && nearGame(station, markets, cities, state);
    if (!matchedCity && !callsign) return [];
    return [{ kind: 'local-location', checkedAt: data.checkedAt,
        sourceUrls: callsign ? station.sourceUrls || [] : [],
        description: `Local market heuristic: ${[matchedCity && `city ${matchedCity}`, callsign && `callsign ${station.callsign}`].filter(Boolean).join('; ')}; carriage is unverified` }];
}

module.exports = { localLocationEvidence };
