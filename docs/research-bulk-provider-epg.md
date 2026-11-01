# Bulk provider channel and EPG retrieval

Researched 2026-10-28. Research only: the development server stayed down, no user provider credentials were read or used, and no live provider probes or application changes were made.

**Recommendation: replace the per-stream schedule scan with one bulk XMLTV download.** Keep the existing bulk channel catalog and retain its EPG join key. With categories retained, the normal matching run becomes **three provider requests**, independent of channel count: streams, categories, XMLTV. If matching does not need category labels, it can use **two**. This is an achievable design supported by inspected compatible-server code, not confirmation that this user's provider exposes a working XMLTV feed.

## What the current application does

`XtreamService.fetchCatalog()` already obtains all live streams in one `get_live_streams` request and all categories in one `get_live_categories` request. The expensive part is `ScheduleGuide.loadScheduleGuide()`: one `get_simple_data_table` request per unique stream, plus one clock request, with five workers. Thus a nonempty run costs `N + 3` provider requests. Sports-source requests are separate.

The local catalog projection discards `epg_channel_id`. `PlaylistService` likewise does not retain the parsed M3U `tvg-id`. Preserve the provider EPG identifier on the transient catalog record; this does **not** require adding discovered channels to saved Channels or changing their stored lineup schema. Relevant code: [XtreamService](../backend/services/XtreamService.js), [ScheduleGuide](../backend/services/games/ScheduleGuide.js), [PlaylistService](../backend/services/PlaylistService.js).

## Verified bulk paths and compatibility

Primary compatible-server source was inspected at XC_VM commit [`dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187`](https://github.com/Vateron-Media/XC_VM/tree/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187). This is implementation evidence for XC_VM; it is not a universal Xtream standard or a guarantee about another panel.

| Path | Requests for N channels | Finding |
|---|---:|---|
| Existing catalog + per-stream EPG | `N + 3` | Current behavior; retire as the automatic full-catalog path. |
| Catalog + bulk XMLTV | **3** | Preferred: two current catalog requests and one XMLTV request; no server-clock request needed for unambiguous XMLTV times. |
| Streams + bulk XMLTV, no categories | **2** | Category names are unnecessary for matching; retain categories elsewhere if admin browsing needs them. |
| M3U Plus + XMLTV | **2** | Possible when playlist provides stable IDs and guide linkage. Adds URL/playlist normalization work compared with the existing catalog. |
| Verified multi-stream JSON EPG | `ceil(N / B) + 3` | Provider-specific alternative with an explicit batch size and total request budget. Not a portable default. |
| Legacy `panel_api.php` + XMLTV | **2** | Can combine catalog/categories, but may be disabled and include a large VOD catalog. Not recommended as the primary path. |

Counts exclude explicit capability probes, redirects, retries, playback and ESPN. Those must also be counted against a visible request budget; a `304` validation request is still a request.

### XMLTV is the preferred EPG batch

XC_VM exposes `/xmltv.php?username=<backend-held>&password=<backend-held>`, serving a prebuilt bouquet guide, with a whole-guide fallback. Its generator writes channel IDs and programme references; the controller streams the file. The same code can disable the legacy URL or EPG access, and reports errors including missing files and download limits. Provider horizon and completeness are not implied by a successful HTTP response. See [EpgApiController, lines 27–144](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/src/Public/Controllers/Api/EpgApiController.php#L27) and [XMLTV generation](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/src/Cli/CronJobs/EpgCronJob.php#L254).

XMLTV contains schedules and optional channel descriptions, not a replacement for provider playback identity. A separate catalog remains necessary. The XMLTV project's [DTD](https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd) defines programme-to-channel ID references, permits channel declarations to be absent, and permits a programme without `stop`. It also permits partial date precision and assumes UTC when a timezone is omitted. Consequently, the importer must distinguish usable schedule evidence from syntactically valid but insufficient timestamps. Interpret explicit numeric offsets; do not apply the JSON server-wall-clock correction again. For ambiguous named zones or insufficient precision, disclose unusable coverage rather than guessing. A missing stop may be inferred from the next same-channel start only when reliable; otherwise omit that programme from overlap evidence.

### The join must be explicit

XC_VM's live-stream response exposes `epg_channel_id` separately from numeric `stream_id`; its [live catalog implementation](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/src/Public/Controllers/Api/PlayerApiController.php#L884) and [schema](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/docs/_media/player-api.openapi.yaml#L606) establish the intended XMLTV linkage. Build:

`XMLTV programme.channel → provider epg_channel_id → one or more provider streamId values`.

Do not assume the XMLTV ID is the numeric stream ID. Exact, case-sensitive ID comparison should be the default; report normalization needs rather than silently lowercasing distinct identifiers. HD/SD or alternate feeds sharing one EPG ID can intentionally share schedule evidence: keep all provider identities. Null, blank, unmatched or conflicting IDs get no guide evidence, while channel-name/network matching remains available. Duplicate XMLTV channel declarations must not cause first-name-wins mapping; consistent duplicates can be deduplicated, conflicts must be reported. Deduplicate repeated programme records by identity/time/content without erasing contradictory records.

If the catalog lacks EPG IDs, a provider M3U Plus can supply `tvg-id` and sometimes `x-tvg-url`; use this only as a bounded, configured alternate. Joining M3U entries back to the catalog requires a reliable provider ID or unambiguous backend-resolved stream identity. Display-name similarity alone is too risky for automatic confidence evidence. Kodi's primary [IPTV Simple documentation](https://github.com/kodi-pvr/pvr.iptvsimple#supported-m3u-and-xmltv-elements) describes the ID linkage and its own progressively weaker name fallbacks; this application should avoid automatically adopting those ambiguous fallbacks.

Measure mapping coverage before trusting a download: streams with EPG IDs, IDs found in the guide, intentional many-to-one joins, unmatched streams, conflicted IDs, programmes overlapping target game windows, and observed earliest/latest useful times. A nonempty feed does not prove all eligible channels or 48 hours are covered.

### Multi-stream JSON is real, but vendor-specific

The inspected [XC_VM request parser](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/src/Public/Controllers/Api/PlayerApiController.php#L64) accepts:

```text
player_api.php?...&action=get_simple_data_table&stream_id=1043,1044&multi=1
```

Comma-separated IDs select multi mode; `multi` merely being present forces it, even `multi=0`. A scalar single ID without `multi` preserves the legacy flat array. PHP array syntax `stream_id[]=1043&stream_id[]=1044` is rejected by this parser. The [full-guide handler](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/src/Public/Controllers/Api/PlayerApiController.php#L659) returns:

```json
{"epg_listings":{"1043":[{"title":"...","start_timestamp":123,"stop_timestamp":456}],"1044":[{"title":"...","start_timestamp":567,"stop_timestamp":890}]}}
```

The example shows response structure, not valid fixture data. Streams with no rows can be omitted; an entirely empty result can remain `[]`. `get_short_epg` uses the same grouping but a **per-stream listing limit**, not a promised 48-hour window. `get_epg` has another raw keyed response shape. No universal maximum batch size was established. A legacy server could parse only the first number of a comma-separated value, so HTTP 200 is insufficient capability proof: validate the keyed shape and results for both requested identities. Probe at most one small pair after permission to test the actual provider, and cache the result. Do not use `get_short_epg&limit=1000` as an unverified all-guide substitute.

## Compression, caching, and bounded ingestion

XC_VM's `gzip=1` selects a `.xml.gz` payload served as `application/octet-stream`; the inspected controller does **not** set HTTP `Content-Encoding: gzip`. Its path aliases also include a gzip form. This does not establish that arbitrary providers support appending `.gz` to `xmltv.php`, or that `Accept-Encoding` alone selects their precompressed guide. The examined controller does not implement `ETag`, `Last-Modified`, or conditional-request handling. Upstream proxies may add those, but support remains unverified. [Endpoint contract](https://github.com/Vateron-Media/XC_VM/blob/dfae324bf88f0ccf2de9ebf5234e9a8a24dcc187/docs/_media/player-api.openapi.yaml#L2033).

Node's fetch uses Undici. Its [fetch implementation](https://github.com/nodejs/undici/blob/main/lib/web/fetch/index.js) decodes HTTP content encodings before exposing body chunks. An application gzip file without that header needs an explicit gunzip stage. Avoid double decompression: choose based on the bytes delivered by the HTTP client and verified transport behavior, not `.gz` or retained headers alone. Be aware that HTTP `Content-Length` may describe compressed bytes while fetch delivers decoded bytes.

Recommended ingestion design, rather than a claim about the provider:

- Consume chunks with backpressure and a strict SAX-style parser, not `response.text()`, a full DOM, or regex-based XML parsing. SAX [documents streaming and predefined-entity behavior](https://github.com/isaacs/sax-js#readme); [Node streams](https://nodejs.org/api/stream.html#stream_pipeline_source_transforms_destination_options) support cancellation/error propagation, and [zlib](https://nodejs.org/api/zlib.html) supports streaming decompression. Select and pin a parser compatible with the project's Node 20 runtime; no XML parser is currently declared in backend dependencies.
- Permit a normal XMLTV external DOCTYPE declaration without fetching its DTD. Never load external resources or resolve custom entities; reject entity declarations and unknown entity references, while accepting predefined/numeric XML entities. Bound nesting, attributes, field lengths and record counts in addition to bytes.
- Enforce whole-download time, idle time, redirect/attempt counts, decoded bytes, and normalized-record/storage limits. If both wire and decoded byte limits are needed, use an HTTP transport that exposes raw compressed bytes before decompression. A Node-fetch body counter alone cannot honestly report compressed bytes.
- Stream only useful fields, filter locally to relevant game intervals within the matching horizon (including ongoing games), and avoid retaining the entire raw guide. Large feeds may still produce substantial retained data: use bounded staged storage, such as the existing SQLite dependency, rather than an unbounded replacement Map. Finalize only after a complete valid parse; cancellation/truncation must not publish a partial guide as current.
- Cache the completed normalized guide across runs. Store retrieval time, observed coverage, parser version, source/account fingerprint, and HTTP validators if actually supplied. Follow HTTP [`If-None-Match` / `If-Modified-Since` and 304 semantics](https://www.rfc-editor.org/rfc/rfc9110.html#section-13) when supported. Otherwise use local freshness policy and a complete replacement download when due. Do not claim an HTTP cache exists just because fetch has a cache option.

One request can still transfer hundreds of megabytes. Bulk retrieval removes the request explosion; it does not guarantee instant completion, small bandwidth, or complete future coverage.

## Minimal change plan and safe failure behavior

1. Retain `epgChannelId` in the transient full-catalog model; add recorded fixtures for exact joins, shared IDs, missing IDs and conflicts.
2. Add a bulk-guide boundary returning normalized guide evidence plus coverage, replacing the automatic `N`-request loop. Preserve the matcher evidence/score contract and saved-lineup behavior. Offset-bearing XMLTV eliminates the clock request on this path.
3. Add a provider request budget enforced below all catalog/guide calls, including retries and redirects. The normal configured path has three requests. Capability discovery must have a small separate explicit allowance; choose a concrete limit before implementation and test exhaustion. Do not leave the old loop as a silent fallback.
4. If XMLTV is absent, malformed, over budget, too large or unavailable, use a sufficiently fresh cached guide with stale labeling or complete matching with name/network/affiliate evidence and an explicit guide limitation. Preserve prior candidate results and last-success metadata when the matching run itself fails. An optional verified JSON-batch mode requires explicit configuration and a hard overall cap; never automatically fan out into per-stream requests.
5. Expose run phases, requests used/budget, downloaded/decoded bytes with accurate labels, programmes parsed/kept, mapping coverage and elapsed time. A true Cancel action should abort network/parsing, stop new requests, discard staging and retain published results. Cancellation must not require bringing down the server.
6. Validate with fixtures: XML and gzip, encoding/chunk boundaries, offset times, incomplete horizons, duplicate/missing IDs, HTML/auth errors, HTTP 304, oversized/truncated/malformed feeds, cancellation, budget exhaustion and failed-run retention. Assert that failed bulk retrieval never starts an `N`-request fallback.

Actual-provider validation remains necessary: one explicitly bounded catalog/guide check, supported URL/auth form, usable EPG join rate, guide horizon, payload size, gzip behavior, validators, download/rate limits and any JSON batching support. Do not infer these from compatible-server code. No such check was performed here.

## Separate ESPN follow-up

Provider XMLTV does not reduce ESPN schedule/status fanout. The current adapter repeats conference/independent slate requests and membership discovery. Caching season directories and separating broad schedule discovery from live-status updates are reasonable follow-up designs, but must retain the established FBS completeness proof.

Two bounded public endpoint probes on 2026-10-28 returned HTTP 400 with `Failed to get events endpoint.` for `dates=20261028-20261030`: [NFL scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261028-20261030&limit=1000) and [CFB conference scoreboard](https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20261028-20261030&groups=8&limit=1000). Thus this research does not establish a working ESPN date-range replacement. A response from the default FBS group, even with a large limit, remains insufficient completeness evidence; see [source validation](game-picker-source.md). This secondary investigation should not delay replacing the provider's per-channel EPG scan.
