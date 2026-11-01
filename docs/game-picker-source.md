# Sports source validation

Validated on 2026-10-28 for ticket #2. Use ESPN's public, undocumented JSON feeds behind the replaceable `EspnSportsSource` adapter. Access requires no subscription or API key. This is a validated launch choice, not a completeness guarantee or availability SLA from ESPN.

## Completeness evidence

For the 2025-08-30 America/New_York slate, independently fetched the regular-season schedules of all **136 real FBS teams**. Those schedules contain **60 unique games** on that slate. The union of all FBS conference and independent scoreboard feeds contains every one: **zero missing games**. Its raw union has 62 games; live FBS membership correctly removes two FCS-only games (Sacramento State–South Dakota State and North Dakota State–The Citadel). The default FBS scoreboard returns only 25 games, omitting 35 relevant games. Increasing its request limit does not establish completeness.

`backend/test/fixtures/sports/completeness-check.json` records the independently collected expected game IDs. The adapter test compares exact output IDs against that independent evidence. Representative projected source responses preserve the game, competition, status, team and broadcast fields used by the adapter; unrelated logos, leaders and links were removed. Fixtures include conference overlap, UConn–Central Connecticut and Duquesne–Pitt FBS–FCS games, FCS-only exclusion, NFL, and independent Notre Dame's separate Sunday game. Duplicate source appearances share ESPN event IDs and are deduplicated.

Core FBS membership contains 146 references in the sampled season, including ten placeholder identities absent from the real team directory. Intersecting membership with the site team directory yielded the 136 real teams used for independent schedule validation. Placeholder IDs never qualify an actual game by themselves. Re-run completeness validation after conference realignment or source schema changes and before each football season.

## Reproduction

Use these public endpoint examples with `curl -L --fail --silent`. Save responses outside live application storage; never use live IPTV credentials.

- FBS child conferences and independents: `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/types/2/groups/80/children?limit=1000`
- FBS membership: `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2025/types/2/groups/80/teams?limit=1000`
- Real-team directory: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000` (the `groups=80` parameter does **not** reliably filter this endpoint).
- Each child group's slate: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20250830&groups=18&limit=1000` (substitute every child ID; include independents).
- Each real FBS team's independent schedule: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams/41/schedule?season=2025&seasontype=2` (substitute every member ID).
- NFL: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20250907&limit=1000`

Intersect FBS membership IDs with the real-team directory, fetch each team's schedule with at most two concurrent requests, and filter event kickoffs to the requested **America/New_York calendar date**. Deduplicate those event IDs. Independently union the child-group scoreboard event IDs, retain games with at least one member of the FBS membership set, and compare the two ID sets. For the recorded slate both sets contain the same 60 IDs. Also check a Sunday independent slate (`dates=20250831`, group `18`), and compare with the default group `80` to detect its omissions. This procedure, rather than a single scoreboard response, is the completeness check. Fixtures remain offline deterministic evidence; live probes are validation only.

Run recorded checks without network access:

```sh
cd backend
node --test test/sports-source.test.js
```

## Source contract

`new EspnSportsSource({ fetchJson? }).fetchGames({ from, to, leagues, regions })` returns `{ games, coverage }`; dates accept ISO strings, the maximum requested window is seven days, and defaults are NFL/CFB and US/CA/UK. Inject `fetchJson(url)` for deterministic source fixtures. Downstream game discovery can replace the adapter without changing its model.

Each game has stable `id: espn:<league>:<event-id>`, `league`, `teams` (`id`, `name`, `shortName`, `abbreviation`, `aliases`), ISO `startsAt`, `status` (`scheduled`, `live`, `final`, `unknown`, `postponed`, `cancelled`), `statusDetail`, `completedAt`, and `broadcasts` (`network`, `region`). Live status, including overtime, comes from the reported state. Actual completion timestamps were not established; `completedAt` remains null. The game-discovery service must supply any observed-live-to-final fallback, without inventing a finish for games first discovered final.

Only region-qualified `geoBroadcasts` establishes assignment geography. Sampled US, Canadian and UK NFL query variants returned US assignments; they do not verify Canadian/UK coverage. `coverage.broadcastRegions` therefore reports US available and CA/UK unverified, with visible limitations. Network strings remain distinct, including ESPN, ESPN2 and ESPN+. Assignment presence is evidence of a scheduled network, not proof of an affiliate's carriage.

## Request cost and refresh constraints

The adapter discovers child groups and membership dynamically, rejects incomplete directory pages, unions conference/independent feeds, filters by FBS membership and deduplicates stable IDs. Single-day requests were validated; date-range probes were rejected in this environment, so the adapter uses individual slate days. ESPN slates follow US dates: an extra preceding UTC day protects late-evening games from a calendar-boundary omission, and exact requested kickoff bounds filter the result.

For `D` fetched slate days, NFL costs `D` scoreboard requests; CFB costs `11 × D + 2` directory requests per season represented. A 48-hour window can touch four slates with the safety day: approximately 4 NFL plus 46 CFB requests. Requests have 15-second timeouts and at most two scoreboard requests run concurrently. There is no documented rate allowance or stability guarantee. The adapter caches successful complete slates for two minutes by calendar-day range, leagues, and broadcast regions; changing the moving query window within those days reuses the slate and reapplies the requested time bounds. Concurrent callers share one fetch. `cacheTtlMs` and `now()` are injectable constructor options. Expired entries are discarded on demand, and failures are not cached. Cached results expose their original `fetchedAt` timestamp so the service does not relabel old observations as fresh. There is no periodic sports-status fetch: opening/polling Games or requesting matching drives discovery through this cache. Scheduled matching remains independent of sidebar visibility. Source fetching must remain independent of full IPTV catalog/EPG matching; browsing never scans the IPTV provider.

Any constituent request failure rejects a refresh so the caller can retain its prior snapshot with stale labeling. No sports failure should disable Channels or Chat. The source does not match channels, resolve streams, schedule matching, or write application settings.
