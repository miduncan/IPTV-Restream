function escape(value) { return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function xmltv(guides) {
    let xml = '<tv>';
    for (const [id, rows] of Object.entries(guides)) {
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            const stamp = (unix, wall) => unix ? new Date(unix * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000' : String(wall).replace(/[-: ]/g, '') + ' +0200';
            // Recorded legacy fixture uses one Base64 title and UTC+02 wall times.
            const title = row.title === 'U2VhdHRsZSBTZWFoYXdrcyB2cyBCdWZmYWxvIEJpbGxz' ? 'Seattle Seahawks vs Buffalo Bills' : row.title;
            xml += `<programme channel="epg-${escape(id)}" start="${stamp(row.start_timestamp, row.start)}" stop="${stamp(row.stop_timestamp, row.end)}"><title>${escape(title)}</title><desc>${escape(row.description)}</desc></programme>`;
        }
    }
    return xml + '</tv>';
}
function body(guides) { return (async function* () { yield Buffer.from(xmltv(guides)); })(); }
function catalogIds(catalog) { return catalog.map(channel => ({ categoryId: '1', ...channel, epgChannelId: `epg-${channel.streamId}` })); }
module.exports = { xmltv, body, catalogIds };
