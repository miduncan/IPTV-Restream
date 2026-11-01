# Stored candidate matching

Admins start a scan with `POST /api/admin/games/matching` or **Run matching now**
in Games. The endpoint returns 202 with current `matching` progress metadata;
viewers receive 403. Overlapping triggers share one in-flight run. The Games UI
polls the retained snapshot every two seconds while a scan runs, otherwise every
30 seconds. Admins can also enable an initial run and configurable daily
matching; see [automatic matching policy](game-picker-scheduler.md). Browsing,
status refresh and near-kickoff events do not trigger additional matching.

A run refreshes sports status, then fetches the full current provider catalog
once when eligible games exist. Empty slates complete without provider scans. Xtream catalog retrieval makes two parallel requests (`get_live_streams`
and optional `get_live_categories`); the scanner does not resolve or save each
candidate. Scope is enabled-league ongoing games (including overtime and labeled
estimated-live games), plus starts from now through the next 48 hours, inclusive.
Including ongoing games makes a first manual run useful after kickoff. Old final,
cancelled, and postponed games are not newly matched. Results for future games
are stored before those games become visible.

`GET /api/games` includes global `matching` metadata (`running`,
`lastSuccessfulAt`, `lastAttemptAt`, `lastError`) and a per-game matching summary.
`GET /api/games/:gameId/candidates` returns only that game's stored candidates,
`state` (`pending` or `complete`), `matchedAt`, `stale`, and `lastError`. Completed
results can contain no candidates; this is distinct from unevaluated pending
games. Unknown game IDs return 404. Candidate results survive game visibility
changes and restarts in the same atomic snapshot as sports observations.

Candidates expose stable provider identity, current name, raw `confidenceScore`
(0–100), and supporting evidence. They contain no upstream stream URL or backend
credentials. Channel-name scoring uses full names, aliases and abbreviations
with word boundaries. Explicit both-team evidence ranks above single-team
evidence. Shared aliases, short abbreviations, and common ambiguous names carry
less weight unless league/opponent context resolves them. Unrelated feeds are
excluded. `ChannelMatcher.matchChannels(games, catalog)` keeps evidence scoring
separate from scan orchestration for subsequent guide/network enhancements.
Scores express relative ranking, not calibrated probabilities; tests assert
relationships rather than prescribing arbitrary numeric weights.

A successful run atomically replaces results for evaluated games and updates
last success. Any source, catalog, scoring, or persistence failure leaves prior
candidate results and last-success time intact. Newly discovered games remain
pending. A failed run or results older than a day are labeled stale; status
refreshing and browsing leave candidate evidence untouched.

Clicking **Watch** directly invokes
`SocketService.setCurrentProviderChannel(sourceId)`, reusing the shared selection
boundary described in `game-picker-playback.md`. Restricted viewers see disabled
candidate controls. Backend authorization remains authoritative. A playback
failure displays the error and leaves any next candidate choice to the viewer;
there is no automatic fallback or saved-lineup mutation.

Deterministic API checks are in `backend/test/game-matching-api.test.js`.
`frontend/e2e/games-matching.spec.mjs` substitutes the socket transport's public
adapter and mocks API responses to verify manual progress, immediate selection,
permissions, pending/empty/stale states, and manual choice after failure. Real
selection behavior remains covered by provider-channel-selection and existing
channel-switch/socket tests. Use the isolated browser configuration from
`game-picker-api.md`; `GAMES_TEST_PORT` selects a separate port when needed.

## Bulk XMLTV guide evidence

Matching reads the full channel catalog and downloads one XMLTV guide from
`/xmltv.php`, retaining catalog `epg_channel_id` as `epgChannelId`. Exact,
case-sensitive XMLTV programme channel IDs join to one or more provider stream
identities. HD/SD feeds may share evidence; missing or conflicting identifiers
receive no guessed guide evidence. Title, subtitle and description supply
matchup text. Offset-bearing XMLTV times are normalized directly; omitted zones
mean UTC, and unsupported/insufficient timestamps are discarded. There is no
server-clock request and no per-stream guide fallback.

A normal nonempty run makes **three provider HTTP requests**: live streams,
categories and XMLTV. A fresh cached guide reduces this to **two**. Zero eligible
games make none. A run-scoped ceiling of six attempts includes manual HTTP
redirects (at most three per endpoint); no automatic retry is performed. These
counts cover IPTV matching only: independent ESPN status requests and the
Channels tab's current/next guide remain separate. Browsing the Games API does
not fetch provider data. See [bulk retrieval research](research-bulk-provider-epg.md)
for compatible-server evidence and actual-provider validation still required.

`sax@1.6.1` parses the stream without building a whole XML document. HTTP
content encoding is decoded by fetch; application gzip payloads are detected
from bytes and gunzipped once. A normal external XMLTV DOCTYPE is accepted
without loading a DTD, while custom entities are rejected. The run is limited to
five minutes and 15 seconds of idle guide time; parsing bounds decoded data at
256 MiB, two million programme records, 16 levels, and 16 KiB fields. All mapped
programmes overlapping any eligible game interval are retained, including
generic titles and unrelated shows. XMLTV categories are retained for sport
recognition and inspection, with at most 32 categories per programme. The
retention cache key is versioned so older, team-filtered guides cannot be
reused. Retained evidence is capped at 100,000 rows and 32 MiB of serialized
programme data; exceeding a bound aborts the guide rather than publishing a
partial parse.

A complete normalized guide is cached separately in `games.json.guide.json`
beside the Games snapshot (maximum 40 MiB), avoiding large rewrites on status
refresh. The key includes account/source fingerprint, EPG IDs, game identities,
starts, teams and configured durations. A changed account, game scope or mapping
requires a new download. A connection change during a run prevents mixed-account
cache or candidate publication. Freshness is 30 minutes; on download failure a matching
cache up to six hours old may supply explicitly stale evidence. No partial or
cancelled download replaces the cache. No HTTP validator support is assumed.

An initial guide failure can still produce name/network/affiliate candidates,
with an explicit limitation. A later failed guide with no usable cache preserves
previously published candidates and last-success time. Cancellation always
preserves published results. Neither failure path starts per-channel requests.

Only programmes overlapping `[kickoff, kickoff + configured league duration)`
contribute to a game's candidates. A matchup in today's programme is not
evidence for tomorrow's game. Both-team EPG evidence ranks above single-team EPG
evidence. Channels now use four independent PPV, streaming, cable and local
scorers; the maximum becomes the candidate's confidence score. Each scorer has
its own eligibility gates and bonuses, including league/sport context for PPV,
service category for streaming, saved-channel boosts for cable, and mandatory
network category and relevant-area evidence for local TV. See the
[four-scorer policy](game-picker-matching-refinement.md) for weights, category
requirements, NCAAF recognition and station-directory limits. EPG stays low
weight: at most 20 standalone, 5 corroboration and 10 conflict penalty. Missing
guides are neutral. Contradictions and non-game labels remain visible.

Each candidate's `epgInspection` retains the examined game window, all
overlapping programme titles, full descriptions, categories, normalized
start/end times, programme points and scoring treatment, plus the strongest EPG
score, applied corroboration bonus and conflict penalty after caps and floors.
Listings that earn no points
remain visible. Its status distinguishes `available`, `empty`, `unmapped`, and
`unavailable`. The per-game `guideSnapshot` preserves retrieval time and
cached/stale provenance alongside `matchedAt`, including across later runs and
restarts. The picker shows these inputs under **EPG examined**, using local
times with timezone labels. Older stored candidates remain selectable and
explain that another matching run is needed to capture inspection data. Browsing
does not fetch guide data.

`ChannelMatcher.matchChannels(games, catalog, options)` accepts optional
`epgByStream` (a Map keyed by stream ID of normalized programme arrays) and
`estimatedDurationHours`. `TeamMatchEvidence.js` shares the existing team-name
rules between names and guide text; `EpgEvidence.js` keeps guide evaluation
separate from catalog retrieval and orchestration. Scores remain tunable rankings;
tests assert relationships rather than freezing particular score weights.

Successful matching metadata exposes `guideCoverage`: requested streams, streams
with usable listings, empty/failed/unsupported streams, programme count, discarded
listings, observed earliest start/latest end, and human-readable `limitations`.
Observed bounds do not establish continuous guide coverage. Partial, unsupported,
or unavailable bulk guide evidence is disclosed and never triggers a per-channel
scan. A failed overall run retains prior candidate evidence, guide coverage,
and last-success metadata. The coverage disclosure explicitly avoids claiming
complete future coverage, even when some future listings are available.

Deterministic public Games API checks are in
`backend/test/game-epg-matching-api.test.js`; existing EPG and Xtream adapter
tests verify normalization compatibility and the uncapped schedule action.
Picker browser checks in `frontend/e2e/games-matching.spec.mjs` also cover
zero-point listings, full descriptions, snapshot provenance, missing-guide
states, and older stored results. See [matching refinement
policy](game-picker-matching-refinement.md) for the complete scoring and
inspection decisions.

## Progress and cancellation

The Games response's `matching.progress` exposes phase, provider requests used
and budget, decoded guide bytes, programmes parsed/retained, and elapsed time.
While matching is active the sidebar polls this retained API every two seconds;
these are local API requests, not new provider scans. Byte counts are decoded
XMLTV bytes, not wire/compressed totals. Admins can `POST
/api/admin/games/matching/cancel` or use **Cancel matching**. Cancellation aborts
provider transfer/parsing, stops further provider requests, and discards partial
evidence while leaving previous results available. Independent shared sports
status refresh may continue after cancelling matching.

Verification includes `bulk-epg-api.test.js` and `bulk-provider-http-api.test.js`:
2,000-channel fixtures require one XMLTV download and three actual mocked HTTP
attempts; redirects consume the same budget; malformed, gzip, subtitle, cache,
exact ID mapping, contradiction and cancellation paths exercise the public API.
The browser flow verifies visible counts and cancellation without a server stop.

## Development dependency refresh

Bulk XMLTV adds the pinned `sax` parser to backend dependencies. The development
stack mounts a persistent `backend_node_modules` volume, so rebuilding an image
alone may leave that volume hiding the new dependency. Before starting an
existing stack, refresh its backend dependency volume with:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --no-deps iptv_restream_backend npm ci --omit=dev
```

This changes the development dependency volume and requires explicit approval
under AGENTS.md. Do not execute it automatically while another development
process owns the stack. Image rebuilding with `make dev-build`, if chosen, also
requires approval; then use the normal `make dev` workflow. Neither operation was
performed as part of the fixture-based implementation checks.
