const Channel = require('./Channel');

// A provider selection is runtime-only. Its upstream address never crosses
// the JSON/socket boundary; clients play the normal backend restream instead.
class ProviderChannel extends Channel {
    toJSON() {
        return {
            ...this,
            url: '',
            sessionUrl: null,
            headers: [],
        };
    }
}

module.exports = ProviderChannel;
