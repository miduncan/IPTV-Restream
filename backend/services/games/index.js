const GamesService = require('./GamesService');
const GamesStore = require('./GamesStore');
const EspnSportsSource = require('./EspnSportsSource');
const catalog = require('../XtreamService');

module.exports = new GamesService({ source: new EspnSportsSource(), store: new GamesStore(), catalog,
    getFavoriteStreamIds: () => require('../ChannelService').getChannels()
        .filter(channel => channel.source === 'xtream' && channel.sourceId != null).map(channel => channel.sourceId),
});
