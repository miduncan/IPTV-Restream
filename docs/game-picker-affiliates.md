# US local station and affiliate-market evidence

`backend/services/games/data/nfl-affiliates.json` contains the offline local
station directory and the existing 32 NFL club-market associations. The filename
is retained for compatibility; station coverage also supports CFB venue matching.
The station snapshot was checked on **2026-10-30** and contains **925 network
services across 809 callsigns**, including **247 station-number mappings**:

| Network | Services |
| --- | ---: |
| ABC | 210 |
| CBS | 208 |
| FOX | 213 |
| NBC | 217 |
| CW | 77 |

A service is a callsign/network pair. Some stations carry different networks on
separate subchannels, so these counts are not counts of unique transmitters.
This is broad coverage, not a complete census of every station or subchannel.
Missing stations and unresolved source identifiers receive no guessed identity.

## Sources and numbering

The [Fubo local-channel table](https://support.fubo.tv/hc/en-us/articles/115005151127-What-Local-Channels-does-Fubo-Carry)
supplies national network/callsign/market rows, including Sacramento's KOVR.
[Nexstar's operator directory](https://www.nexstar.tv/stations/) adds station
services, primary affiliations, and virtual channel numbers. Its parallel virtual
and digital/RF columns are different: only virtual numbers are imported. Parallel
station, affiliation and number cells must align; a malformed table aborts import.

Selected station/network sources corroborate primary services and add numbers:
[CBS Sacramento](https://www.cbsnews.com/sacramento/contact-us/) for KOVR/CBS 13,
[CW's Sacramento finder](https://001media.cwtv.com/channel-finder/search/?zipcode=95814)
for KQCA/CW 58, [the West Sacramento lineup](https://www.astound.com/business/wp-content/uploads/2026/02/Astound-TV-Biz-Chnl-LineUp-West-Coast-South-WestSac-1.21.26.pdf)
for KCRA/NBC 3, and station-owned pages for KCPQ/FOX 13 and KXLY/ABC 4.
Per-service `sourceUrls`, `numberSourceUrl`, the snapshot check date and import
coverage metadata remain in the data file and relevant candidate evidence.
Provider lineup numbers and RF transmission frequencies are not station-number
aliases. See [research and source caveats](research-local-affiliate-directory.md).

## Identity and location

Entries sharing a callsign remain separate. A bare callsign resolves to a
source-backed primary service when known, or an unambiguous service. Otherwise
it requires an explicit network label in the provider channel name. This avoids
silently selecting whichever source row was imported last. For example, WSVN
retains its FOX primary, while an explicitly branded ABC WSVN feed can identify
its separate ABC service; ABC does not inherit FOX's channel 7 number.
[WSVN's own explanation](https://wsvn.com/abc-miami-18/) distinguishes its 7.1
service, ABC on 7.2, and provider-specific ABC channel positions.

Standard TV/HD suffixes and source-backed LD/CD/DT license suffixes are accepted.
Unknown suffixes, multiple callsigns, explicitly numbered subchannels, non-US
labels and conflicting service brands receive no inferred station boost. The
import skips synthetic feeds and unresolved identifiers such as KEYT-D2 and
KIFIDT2 rather than stripping their subchannel information. They are enumerated
in `stationCoverage.excludedSourceIdentifiers` for future review.

The [local scorer](game-picker-matching-refinement.md) still requires a category
identifying the game's assigned network and evidence that the feed is in a
relevant area. An unrelated or unknown area earns zero local points, including
when the EPG matches. Network/category membership alone does not qualify a local
feed. Location evidence remains a heuristic, not a carriage guarantee. It compares a known station's market/cities with the game's
venue and participating NFL clubs' documented markets. Known venue states help
distinguish same-named cities. Channel numbers are retained as directory metadata
only: matching a number earns no local points and cannot establish an area.

Market aliases retain consistent IDs for the existing NFL club associations,
while each station retains source-derived city and state names. Non-city NFL
team markets still rely on the original club sources in the JSON, including
Arizona–Phoenix, Carolina–Charlotte, Minnesota–Minneapolis/St Paul, New
England–Boston and Tennessee–Nashville. No distance calculation, full secondary
market entitlement map, or weekly NFL carriage map is inferred. Sacramento's
KOVR is recognized in its own market; adding it does not automatically associate
Sacramento with a Bay Area team's primary market.

## Refreshing the snapshot

The importer is a maintainer operation. Matching reads the checked-in snapshot;
there are no new runtime directory, guide, or per-channel provider requests.
Download these two public sources to temporary files:

- [Fubo article JSON](https://support.fubo.tv/api/v2/help_center/en-us/articles/115005151127.json), containing the article's HTML table.
- [Nexstar station-page HTML](https://www.nexstar.tv/stations/).

Then run from the repository root:

```sh
python3 backend/scripts/import-local-affiliates.py \
  --fubo /private/tmp/iptv-fubo-affiliates-api.json \
  --nexstar /private/tmp/iptv-nexstar-stations.html \
  --checked-at YYYY-MM-DD
```

`--output /private/tmp/proposed-local-affiliates.json` permits inspection before
replacing the snapshot. The importer preserves the existing NFL team data, reads
reviewed market aliases and station corroborations from
`backend/services/games/data/local-station-overrides.json`, and regenerates
station entries deterministically. Refresh overrides alongside sources, especially
after an affiliation change. Review source diffs, primary-service conflicts,
exclusions, coverage counts and number provenance before keeping the output.
No downloaded HTML, credentials, API keys or dependencies are committed.

Verification uses `backend/test/game-affiliate-api.test.js` through the public
Games API. It covers all five Sacramento networks, callsign ranking and rejection of number-only feeds,
NFL market joins, CFB multi-city venues, license suffixes, state disambiguation,
ambiguous callsigns, WSVN's multiple services, number neutrality, current
Atlanta CBS identity and existing EPG/contradiction behavior.
