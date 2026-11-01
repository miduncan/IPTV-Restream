# Game picker matching refinement

Status: implemented. The four-scorer policy below supersedes the original
single-scorer weights.

## Matching policy

Each channel is evaluated by four independent scorers. `confidenceScore` is the
maximum of `scores.ppv`, `scores.streaming`, `scores.cable`, and `scores.local`,
never their sum. `scorer` identifies the winner (ties use that order). Zero-point
channels are excluded. Scores are relative rankings from 0 to 100, not probabilities. Each scorer is
normalized as `round(100 × rawScore / maximumScore)` before selecting the winner.
Fixed raw maxima are PPV 95, streaming 60, cable 77 (32 + 5 + 40), and local
44 (24 + 15 + 5). These maxima do not depend on the current candidates.
`rawScores` and `scoreMaximums` retain the fractions in the API and explanations.
The candidate's “Why this feed” evidence shows the complete score breakdown.

| Scorer | Eligibility | Ranking signals |
| --- | --- | --- |
| PPV | At least one team in the name, and either a matching league category or football in the channel name | Both teams outrank one; ambiguous aliases remain weaker |
| Streaming | Category identifies a streaming service assigned to the game in an enabled region | Category alone earns 45; matching service in name adds 10; EPG adds up to 5 |
| Cable | Exact assigned network identity in the channel name or supporting EPG; excludes ABC/CBS/NBC/FOX/CW categories and streaming-service names | Existing assignment score or standalone EPG, up to 5 EPG corroboration, plus 40 for a saved channel |
| Local | Category identifies the assigned ABC, CBS, NBC, FOX or CW network, and city/callsign evidence establishes a relevant area | Existing regional assignment score, 15 for a relevant city/callsign, and up to 5 EPG corroboration |

PPV's category/sport context and local's category and area requirements are mandatory
for those scorers. A local feed outside the relevant area, or with unknown
location, earns zero local points even with matching EPG. Network/category
evidence alone cannot populate local results. Other scorers may independently qualify the same channel. A
league category supplies football context: strong one-team names earn 20 and
both-team names 95; ambiguous names retain the shared name scorer's lower weights.
The sport parser recognizes NCAAF, CFB, NCAA Football and College Football;
plain NCAA does not establish football. NCAAF in guide text supplies football
context when teams are present, and does not identify a particular matchup alone.

Streaming services include Netflix, Prime Video (also Prime/Amazon Prime),
Peacock, ESPN+, Paramount+ and Apple TV+. A matching game broadcast assignment
is required; unrelated categories do not create candidates for every game.
Cable eligibility excludes categories identifying ABC, CBS, NBC, FOX, or CW,
regardless of the channel name or guide evidence. Those categories use the local
scorer. An assigned broadcast-network name outside those categories remains
eligible for cable scoring: for example, `NCAAF: CW` in `US | NCAAF` can match a
CW assignment without local-area evidence. Category membership alone does not
create cable assignment points. Guide corroboration and saved-channel boosts
still apply, and mismatched network identities do not receive assignment points.

Cable matching preserves distinct identities such as ESPN, ESPN2 and ESPNEWS,
so suffix variants cannot inherit parent-network points. A channel scheduled
on ESPN2 can still match ESPN2 exactly. Picture-quality decorations are ignored.
EPG alone can support otherwise unidentified cable/event feeds at low weight.

For the favorite boost, saved Channels tab entries count as favorites, joined
by `source === 'xtream'` and `sourceId`. Saving an unrelated feed does not create
a candidate. The IDs are read afresh during each matching run; browsing does not
recompute scores or alter saved channels.

Local relevance uses exact city names from the game's venue or participating NFL
team markets and known callsigns. Channel numbers earn no points and cannot
establish a relevant area, because the same numbers recur across markets.
Signals are alternatives, not cumulative boosts. The existing NFL affiliate
heuristic remains visible. ESPN venue city/state are retained when supplied.
The [station directory](game-picker-affiliates.md) now covers 925 network services
across 809 callsigns and 247 source-backed number mappings. Unknown stations
receive no callsign boost. Ambiguous callsigns require a verified primary
service or an explicit network label. Station-number metadata remains in the
directory for reference and is not used in scoring. Source-derived city/state names support CFB venues and distinguish
same-named cities when venue state is available.
City and callsign matches remain a market heuristic, not a carriage guarantee
or distance calculation.

EPG retains its low experimental weights: strongest programme only, at most 20
standalone points and at most 5 corroboration points for streaming, cable and
local scorers. PPV has no EPG corroboration bonus. Explicit guide contradictions
subtract at most 10 raw points within each eligible scorer; independent candidates retain
a minimum of 1 raw point. Conflicting sport/league or replay/non-game channel labels cap
each scorer at 5 raw points. These adjustments happen before normalization;
inspection bonus and penalty values show the resulting normalized score changes. Pregame, postgame, highlights and replay guide entries supply
no live-game support. Missing guides are neutral. SNF/MNF/TNF require overlapping
listings and a supported game network assignment. Generic CFB/NCAAF does not
identify teams. Region controls and overlapping-network uncertainty remain.

Keep the existing interval: kickoff through kickoff plus configured league
duration. A programme starting before kickoff qualifies if it overlaps that
interval. There are no proximity bonuses or additional timing cutoffs.

## EPG inspection

Retain all mapped programmes overlapping any eligible game window, regardless of
team mentions, within existing parsing and cache limits. Invalidate the old
team-filtered cache. Retain XMLTV categories alongside title,
subtitle/description, and normalized times so explicit sport labels can be used
and inspected.

Every candidate exposes an expandable **EPG examined** section containing the
exact game-window listings the scorer examined: full title and description,
categories when present, local start/end times, and the scoring treatment of
each entry, including zero-point entries. Include the inspected game window,
strongest EPG score, applied corroboration bonus and conflict penalty, guide retrieval
time, matching time, and cached/stale status. Scores are rankings rather than
probabilities; programme scores are alternatives, not additive.

Distinguish no overlapping listings, missing/unusable EPG mapping, guide
unavailable, and older stored results requiring another matching run for
inspection data. Persist inspection data and guide provenance with each game's
candidate snapshot so browsing, sports status refreshes, failures, and
subsequent runs for other games do not alter the displayed scorer inputs.
Browsing fetches no provider guide data. Wall-clock current/next programming is
out of scope.

## Validation

Use the existing public Games API and picker UI boundaries. Cover sport-aware ranking, exact channel identities, low EPG weight,
programme aliases and conflicts, complete game-window inspection, provenance,
missing-guide states, persistence and backward compatibility. Preserve provider
request budgets and cancellation behavior. Do not rebuild or recreate
development services.

Four-scorer eligibility, ranking, saved-channel boosts, local city/callsign
evidence, NCAAF and maximum-score behavior are covered by
`backend/test/game-scorers-api.test.js`.
