const NETWORKS = [
    ...[1, 2, 3, 4, 5].map(number => [`TSN${number}`, new RegExp(`\\btsn\\s*${number}\\b`, 'i')]),
    ['TSN', /\btsn\b/i],
    ['ESPN+', /\bespn\s*(?:\+|plus\b)/i],
    ['ESPN2', /\bespn\s*2\b/i], ['ESPN3', /\bespn\s*3\b/i],
    ['ESPNU', /\bespn\s*u\b/i], ['ESPNEWS', /\bespn\s*news\b/i], ['ESPN Deportes', /\bespn\s*deportes\b/i],
    ['ESPN PPV', /\bespn\s*ppv\b/i],
    ['CBS Sports Network', /\b(?:cbs sports(?: network)?|cbssn)\b/i],
    ['FS1', /\b(?:fox sports\s*1|fs1)\b/i], ['FS2', /\b(?:fox sports\s*2|fs2)\b/i],
    ['FOX News', /\bfox news\b/i], ['FOX Business', /\bfox business\b/i], ['NBC Sports', /\b(?:nbc sports|nbcsn)\b/i],
    ['NFL Network', /\bnfl network\b/i], ['SEC Network', /\bsec network\b/i], ['ACC Network', /\bacc network\b/i],
    ['Big Ten Network', /\b(?:big ten network|btn)\b/i], ['Prime Video', /\b(?:amazon prime(?: video)?|prime(?: video)?)\b/i],
    ['Netflix', /\bnetflix\b/i], ['Paramount+', /\bparamount\s*(?:\+|plus\b)/i],
    ['Apple TV+', /\bapple tv\s*(?:\+|plus\b)?/i],
    ['Peacock', /\bpeacock\b/i], ['The CW', /\b(?:the cw|cw)\b/i],
    ['ESPN', /\bespn\b/i], ['ABC', /\babc\b/i], ['FOX', /\bfox\b/i], ['CBS', /\bcbs\b/i], ['NBC', /\bnbc\b/i],
];

function networkIdentity(value) {
    const text = String(value || '').replace(/[^\x00-\x7F]/g, '').replace(/\b(?:sd|hd|fhd|uhd|[48]k|\d{3,4}p|\d{2,3}\s*fps)\b/gi, '')
        .replace(/[|:()[\]./_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    for (const [identity, pattern] of NETWORKS) {
        const match = pattern.exec(text);
        if (!match) continue;
        const suffix = text.slice(match.index + match[0].length);
        if (['ABC', 'FOX', 'CBS', 'NBC', 'The CW'].includes(identity)) {
            // Local affiliate names may contain station numbers and cities.
            if (/^\s*(?:sports|news|business|ppv|plus|\+)/i.test(suffix)) return null;
        } else if (!/^[\s|:()[\].-]*$/.test(suffix)) {
            // Unknown specialty variants must not inherit the parent identity.
            return null;
        }
        return identity;
    }
    return null;
}

function hasNetworkBrand(value) {
    const text = String(value || '');
    return NETWORKS.some(([, pattern]) => pattern.test(text)) || /\bespn\d+\b/i.test(text);
}

function channelRegion(channel) {
    const value = String(channel.region || '').toUpperCase();
    if (/^[A-Z]{2,3}$/.test(value)) return ({ USA: 'US', CAN: 'CA', GB: 'UK', GBR: 'UK' })[value] || value;
    const prefix = String(channel.name || '').match(/^\s*\[?(US|USA|CA|CAN|CANADA|UK|GB|GBR|[A-Z]{2,3})\s*(?:\]|[:|])\s*/i)?.[1]?.toUpperCase();
    return ({ USA: 'US', CAN: 'CA', CANADA: 'CA', GB: 'UK', GBR: 'UK' })[prefix] || prefix || null;
}


module.exports = { networkIdentity, hasNetworkBrand, channelRegion };
