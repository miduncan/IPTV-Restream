# Games discovery API

`GET /api/games` is an authenticated discovery request for visible games. It
refreshes sports observations through the ESPN adapter's shared cache, then
returns `games`, sports-source `coverage`, and `freshness` (`stale`,
`lastSuccessfulStatusAt`, `error`). Games retain the normalized source identity
and expose `group` (`live`, `startingSoon`, `recentlyFinished`), `statusEstimated`,
per-game `stale`, and `matching: {state: "pending"}` until matching is introduced.
Selecting a game only opens its details; it does not change playback. Sidebar
candidate results show only selectable channel names in the server-ranked order.
Scores, scoring evidence ("Why this feed"), and "EPG examined" remain available
in the admin matching panel.

`GamesService` accepts an injected sports `source`, `now()` clock, and `store`.
`refreshStatus()` updates observations; `getGames()` only reads the snapshot and
computes time-dependent visibility. `createGamesController(service)` is the API
test seam. The live instance is assembled in `services/games/index.js` and starts
its matching scheduler from the server bootstrap. No status request or browse action
loads the IPTV catalog or guide, or performs candidate matching.

Status refresh is demand-driven: the Games endpoint awaits `refreshStatus()`,
with a single in-flight refresh shared across triggers. There is no startup or
periodic sports-status fetch. Manual and enabled scheduled matching also request
sports data when needed. Each source request covers the
previous 24 hours and next 48 hours. Existing missing live observations remain
visible as stale rather than being assumed finished. Recent absent non-live
observations are kept for seven days; candidates can later be stored independently
of visibility. See `game-picker-source.md` for request cost and source limitations.
The sidebar polls the API every 30 seconds while open and preserves a selected
game by stable ID while it remains visible. The ESPN adapter caches successful
complete slates for two minutes, sharing cached and in-flight work across callers.
Expiry alone does no work; the next request refreshes. Cache hits retain the
original source observation timestamp. Failed fetches are not cached; the service
retains the previous snapshot with stale labeling and the next request can retry.

The atomic JSON snapshot lives beside `SETTINGS_DB_PATH` as `games.json` (by
default `/channels/games.json`). It preserves observations across process
restarts and source failures. A failed fetch or write retains the prior snapshot.
Observations older than ten minutes, missing rows, and failed refreshes are
labeled stale; an old reported live status is explicitly shown as last-reported
live rather than current confirmation.

The sidebar includes live games and games starting within the next six hours (including
the exact six-hour boundary). Finished, cancelled, and postponed games are omitted.
Confirmed live status overrides estimates, including overtime. When reliable live
status is absent, the configured league duration determines estimated live games.
Matching still covers live games and the next 48 hours independently of sidebar visibility.

Recurring named events share the manual and scheduled matching runs, scoring,
guide inspection, stored candidates, and matching history with games. Browsing
an event reads its stored result without scanning the provider. NFL RedZone uses
an exact TSN1 broadcast assignment for matching, resolving both TSN1 and TSN 1
through the same identity rules as ESPN and ESPN2. TSN 2–5 remain distinct.
Event names and aliases in provider channel names support the PPV
scorer, and overlapping guide titles can identify named events independently of
network branding. RedZone's card shows the event name and NFL shield.
Named events sort above games within both Live and Starting soon. Events of the
same kind sort by start time. Named-event cards display only their start time.
The Games response includes stored candidates for each game and named event so
expanding a card renders results immediately without another candidate request.

Verification uses isolated files and recorded/injected source data:

```sh
cd backend
node --test test/games-api.test.js
```

Focused browser tests start their own Vite process on `127.0.0.1:4184`, use a
separate dependency cache, and mock the API/socket boundary. They do not require
live credentials, a production build, or changes to existing services:

```sh
cd frontend
./node_modules/.bin/playwright test --config playwright.games.config.mjs
```

## Shared league controls and personal filters

The Games API includes `settings: {enabledLeagues, estimatedDurationHours}`.
Defaults enable NFL and CFB with four-hour fallback durations. CFB uses the
validated conference-plus-independent source, including FBS–FCS contests and
excluding FCS-only contests; stable identities deduplicate overlapping feeds.
Source completeness evidence and reproduction are in `game-picker-source.md`.

Admin-only `GET` and `PUT /api/admin/games/settings` read and replace these Games
settings. PUT accepts `{settings: {...}}`; enabled leagues must be a unique subset
of NFL/CFB (an empty subset is allowed), and both league durations must be finite
numbers greater than zero and at most 24 hours. The admin Game matching screen saves
these controls separately from Xtream settings. They are retained in the atomic
Games snapshot, so the general settings table's replacement operation cannot
erase them. Saving during an in-flight sports refresh preserves the latest Games
settings. Settings reads/writes and browsing do not trigger channel matching.

League changes immediately govern the retained visible snapshot and the next
sports-source refresh scope. Fallback durations change estimated visibility;
confirmed live observations still override estimates, including overtime. Each
viewer has independent NFL/CFB checkboxes among the enabled leagues. Personal
filters live in the mounted Games panel and survive status refreshes and sidebar
tab changes without writing shared settings. A selected game remains open while
it stays available. Shared league removal clears selection on the next snapshot
refresh when the game is no longer available.

Additional focused checks:

```sh
cd backend
node --test test/games-settings.test.js test/games-api.test.js test/sports-source.test.js
```

```sh
cd frontend
GAMES_TEST_PORT=4185 ./node_modules/.bin/playwright test --config playwright.games.config.mjs
```

`GAMES_TEST_PORT` selects an isolated browser-test port; the default remains 4184.

## Automatic matching controls

Shared Games settings additionally expose `matchingEnabled`, `matchingTime`, and
`matchingTimezone`, defaulting to false, `06:00`, and `America/Los_Angeles`. The
admin settings PUT validates all fields; existing stored settings receive merged
defaults. Initial/daily runs use the same stored matching path and preserve the
manual button. See [scheduler policy](game-picker-scheduler.md) for durable
claims, daylight-saving behavior, overlap and failure handling.

Bulk matching now uses a single XMLTV guide and a separate bounded cache; see
[matching retrieval and progress](game-picker-matching.md). `matching.progress`
provides phase, provider request counts, decoded bytes, parsed/retained programme
counts and elapsed time. Admin-only `POST /api/admin/games/matching/cancel`
cooperatively aborts the active matching run and returns HTTP 202. It retains
published results, last-success metadata and the existing matching guard. A
cancelled initial/daily attempt still consumes its already claimed occurrence;
a new manual attempt remains available. The server can remain running.

Candidate `scores` and `confidenceScore` are normalized to 0–100 per scorer.
The stored `rawScores` and `scoreMaximums` expose the underlying fractions
(PPV /95, streaming /60, cable /77, local /44). Existing stored results retain
their previous scores until matching runs again.

## Matching admin panel and category allow-list

Admin → Game matching shows the last successful run, last attempt, run progress,
errors, coverage, and a **Run matching now** button (plus cancellation while running).
The searchable history includes each game's latest stored result matched in the
past 48 hours, including finished and future games and completed results with no
candidate channels. Expand a game to inspect every candidate's score, scoring
reasons, and game-window guide listings. This is retained game-level history,
not an audit log of every run. Older stored results expire from this view; successful
runs prune expired candidate results. Stored game metadata preserves history when
a game leaves the sports-source snapshot.

- `GET /api/admin/games/matching` returns `{matches: [{game, matching}], matching, coverage, settings}`.
- `GET /api/admin/games/matching/categories` loads provider category IDs, names, channel counts, and `allowedCategoryIds`.
- `PUT /api/admin/games/matching/categories` accepts `{allowedCategoryIds: ["123"]}` and saves the selection atomically.
- `POST /api/admin/games/matching` starts or joins a matching run.

All these endpoints require admin access. The allow-list starts empty, is scoped
to the provider account, and persists separately from Games settings. Only channels
in explicitly selected category IDs enter guide inspection and ranking; missing
category IDs are ineligible. Removing a category immediately hides its stored
candidates from the player; historical evidence remains available in admin.
Save the selection, then run matching to refresh results. Changing the selection
during a run prevents that run from publishing under its old selection. Existing
results without category IDs remain visible in admin history but require a new
run to become eligible in the player.
