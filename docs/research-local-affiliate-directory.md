# Expanding the local affiliate directory

Researched 2026-10-30. These sources describe station identity, affiliation and
channel numbering. They do not determine which regional station carries a
particular NFL game in a particular week.

## National affiliation coverage

[Fubo's local-channel table](https://support.fubo.tv/hc/en-us/articles/115005151127-What-Local-Channels-does-Fubo-Carry)
is a first-party carriage directory with structured rows for network, callsign,
market and plan availability. It covers ABC, CBS, FOX, NBC and CW in markets
across the United States, including Sacramento. It does not supply channel
numbers. Its Zendesk article API exposes the article HTML when the normal page
presents a browser challenge.

Use the table to expand the checked-in station snapshot. Preserve the source's
market text and source URL rather than inferring geography from a callsign.
Retain explicit subchannel/low-power identifiers. Regional placeholder feeds are
not stations. A callsign can occur under multiple networks: a bare-callsign Map
must not silently choose the final row. Ambiguous services need an explicit
network label or separately verified primary affiliation.

The [CBS network directory](https://www.cbsnews.com/news/cbs-tv-stations-affiliates/)
confirms KOVR in Sacramento and WUPA in Atlanta. It lacks channel numbers.

## Broad virtual-channel corroboration

[Nexstar's station directory](https://www.nexstar.tv/stations/) contains a large
HTML table with market, station, affiliation, website, virtual channel and digital
channel columns. It is published by the station operator and includes ABC, CBS,
FOX, NBC and CW properties. This is a stronger source for virtual channel
numbers than a distributor's lineup number.

Parse table cells structurally, preserving line breaks and nested paragraph
groups. Rows can contain multiple stations and multiple subchannels, with
parallel affiliation and number lists. Import only associations whose alignment
is clear. A virtual number such as 5.1 and a digital/RF number such as 31.1
are different facts; only the former belongs in a viewer-facing station-number
match. The [2025 annual report](https://www.nexstar.tv/wp-content/uploads/2026/05/NXST-2025-Annual-Report.pdf)
also separates primary affiliations from multicast affiliations and can resolve
cases where a callsign is present under more than one network.

## Distributor channel-number tables

DIRECTV publishes national tables for
[ABC](https://www.directv.com/insider/local-abc-channels/),
[CBS](https://www.directv.com/insider/local-cbs-channels/),
[NBC](https://www.directv.com/insider/local-nbc-channels/) and
[FOX](https://www.directv.com/insider/local-fox-channels/).
Their tables contain city/region, station and DIRECTV channel. They are useful
for provider-number aliases, but should not automatically populate a virtual
broadcast channel field. The pages were published in 2024; cross-check current
network assignments before importing older rows. Normalize a standard TV suffix
only when doing so does not collapse distinct services. Reject comma-separated
or conflicting numeric mappings rather than guessing one.

Store distributor numbers separately, with source and provider, so their scope
remains visible and a later update cannot confuse them with OTA numbers.

## CW's own station finder

The [CW station finder](https://001media.cwtv.com/channel-finder/) submits a public
GET request to `/channel-finder/search/?zipcode=<five-digit ZIP>`. The returned
HTML separates over-the-air station/channel/local-area data from provider
lineups. Its [Sacramento response](https://001media.cwtv.com/channel-finder/search/?zipcode=95814)
identifies KQCA at 58.1 over the air. Separate provider entries include numbers
58, 1058, 4 and 704, illustrating why provider and virtual numbers must remain
separate. No national data dump was found in the frontend; this endpoint is best
used for targeted verification, not a runtime lookup during matching.

## Affiliation changes requiring explicit treatment

**WSVN:** A blanket FOX-to-ABC reassignment would be incorrect. The station's
[ABC Miami information page](https://wsvn.com/abc-miami-18/) distinguishes WSVN's
7.1 service from ABC on 7.2. ABC Miami's distributor branding is channel 18 on
several providers and channel 3 on others. The
[station's Disney/Sunbeam announcement](https://wsvn.com/news/local/miami-dade/disney-entertainment-and-sunbeam-television-corporation-announce-new-home-for-the-abc-television-network-in-the-south-florida-market/)
says ABC programming moved from WPLG to the new 7.2 service on August 4, 2025.
Keep bare primary-station inference separate from explicitly labeled ABC service
recognition.

**WUPA:** Paramount's
[August 2025 station announcement](https://www.paramountpressexpress.com/cbs-news-and-stations/shows/stations/releases/?view=111660-cbs-atlanta-senior-leadership-team-announced-as-network-programming-moves-to-wupa-channel-69-on-aug-16)
confirms CBS programming moved to WUPA channel 69 on August 16, 2025. Older
CBS/WANF or CW/WUPA data cannot override this newer primary evidence.

## Suggested refresh procedure

1. Download source pages once during a deliberate directory refresh; preserve
   check date, source URLs and excluded/ambiguous rows for review.
2. Import explicit services, keeping callsign, network and source market separate.
   Resolve primary affiliations only with unambiguous or additional evidence.
3. Add virtual numbers from aligned operator data; keep provider-number aliases
   in a separate field. Preserve decimal subchannels when a source names one.
4. Compare conflicting newer sources, including effective dates. Exclude unresolved
   service identity from bare-callsign inference.
5. Verify representative stations through the public Games API, including KOVR,
   all five local networks, old affiliations, multiple-network callsigns,
   unrelated markets and subchannels. Matching should continue to read the
   checked-in snapshot without additional provider or directory requests.
