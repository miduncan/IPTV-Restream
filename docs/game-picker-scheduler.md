# Automatic game matching

Admins configure `matchingEnabled`, `matchingTime` (`HH:mm`, 00:00–23:59), and
`matchingTimezone` through the Games section of Game matching or the existing admin
Games settings API. Defaults are automatic matching **off**, `06:00`, and
`America/Los_Angeles`. Existing snapshots receive these defaults when read.
Timezones are validated with the runtime's Intl timezone database. The manual
**Run matching now** button remains available to admins while automatic matching
is off. League, region, and fallback-duration controls retain their existing
behavior.

Enabling persists a pending initial run and starts it immediately when matching
is idle. That initial run **consumes today's scheduled occurrence**, even when
enabled before the daily time, so enabling and the daily check cannot produce
two scans that day. Explicitly disabling and re-enabling requests a fresh initial
run. Disabling cancels a deferred initial request and prevents future automatic
runs; an already started scan finishes normally.

The scheduler checks once per minute, independently of the five-minute sports
status refresh. `tickMatchingSchedule()` is the deterministic scheduler boundary:
it reads the service's injected `now()` clock, derives local date/time using
Intl, and considers the configured occurrence. Manual, initial, and scheduled
runs all enter the same `runMatching()` concurrency guard and use the same live
plus next-48-hour game scope. When a manual or automatic run is already active,
a new automatic occurrence is deferred without being claimed; the next minute
reconsiders it. No overlapping provider scans run. When there are no eligible
games, the occurrence succeeds without catalog, guide, or server-clock requests
and leaves previous candidates intact.

## Occurrence, restart, and daylight-saving policy

An occurrence key is `timezone|HH:mm|local-calendar-date`. Before any external
sports/catalog/guide I/O, the atomic Games snapshot records the claim and clears
the pending-initial flag. A bounded ledger keeps the latest 512 claims from the
last eight days, covering recent schedule configuration changes as well as
restarts. Changing time/timezone A→B→A cannot replay a retained A occurrence.
A newly configured due time/timezone can run once for its own occurrence;
league, region, and duration edits do not themselves trigger matching.

- A spring-forward nonexistent time runs at the first observed valid minute
  after that time on the same local date (02:30 becomes 03:00 in Los Angeles).
- A repeated fall-back hour runs once per local date, even when its configured
  minute occurs twice.
- Startup after today's configured time catches up today's occurrence once.
  Missed earlier dates are not replayed. Startup before the configured time waits,
  unless a pending initial run was persisted before shutdown.
- A crash after a persisted claim, including before scanning starts, consumes
  that occurrence. This chooses at-most-once attempts over an automatic replay
  that could duplicate a costly catalog/guide scan. A failed automatic attempt
  also consumes its occurrence; admins retain the manual retry button.
- If the claim itself cannot be persisted, no external scan starts. The existing
  public matching error state discloses the failure and a later tick may retry
  the unclaimed occurrence. A successful matching run clears the obsolete error.

Failed matching preserves previous candidates, guide coverage and last-success
metadata; newly discovered games remain pending. Browsing, status refresh,
near-kickoff events and missing guide evidence never invoke the scheduler or
start an extra matching run. The timer is installed/removed with the existing
Games service lifecycle and does not restart development services.

## Verification

`backend/test/game-scheduler-api.test.js` exercises the approved Games
settings/API and injected-clock scheduler boundaries with isolated files and
fixture sports/provider inputs. It covers initial/daily scope, authorization,
invalid settings, migration, DST transitions, restart catch-up, durable claims,
timezone changes, manual overlap, disabling/re-enabling, failures and empty
slates. The focused admin browser flow in `games-settings.spec.mjs` verifies
persisted schedule controls and retained manual matching. See
[the API workflow](game-picker-api.md) for the grouped browser command.
