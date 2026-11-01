# Game-first IPTV channel picker

Product design and test seams confirmed on 2026-10-28. Published as [GitHub issue #1](https://github.com/miduncan/IPTV-Restream/issues/1) with the `ready-for-agent` label.

## Problem Statement

Viewers currently have to identify a game and then search through IPTV channels themselves. A provider can expose many similarly named national and local feeds, with inconsistent evidence about which feed carries a particular matchup. Sometimes the EPG identifies the game, sometimes the provider channel name does, and sometimes the only useful clue is its scheduled broadcast network.

The existing Channels tab lists saved channels rather than offering a game-first path through the provider's full catalog. Viewers need a short, timely list of relevant games and ranked candidate channels that can start shared playback without cluttering the saved lineup.

## Solution

Add a Games tab beside Chat and Channels in the sidebar. Initially support NFL and every college-football game involving an FBS team, including games against FCS opponents. Group eligible games into Live, Starting soon, and Recently finished. Show upcoming games only within one hour of kickoff and completed games only within one hour of their known finish. Use clearly labeled time estimates when live status is unavailable.

Selecting a game reveals candidate channels ranked by a raw 0–100 confidence score. Clicking a candidate uses the same shared-playback confirmation flow as the Channels picker, including existing selection permissions and the shared “Don’t show this again” preference. Confirming starts or replaces shared playback. Discovered channels do not become saved channels merely because they were played.

A daily matching run searches the full provider catalog for games in the next 48 hours, combining EPG, channel-name, broadcast-network, and initially NFL US affiliate-market evidence. Game status updates independently; browsing and status refreshes do not trigger fresh matching. Admins configure enabled leagues, broadcast regions, matching schedule, and fallback durations. Viewers independently filter the enabled leagues.

## User Stories

1. As a viewer, I want a Games tab alongside Chat and Channels, so that I can find something to watch by matchup.
2. As a viewer, I want NFL games included, so that I can find professional football broadcasts.
3. As a viewer, I want games involving any FBS team included, even against an FCS opponent, so that college coverage does not omit relevant matchups.
4. As a viewer, I want live games grouped together, so that ongoing action is easy to find.
5. As a viewer, I want upcoming games limited to the next hour and ordered by kickoff, so that the list stays relevant.
6. As a viewer, I want recently finished games visible for one hour after their known finish, so that I can still find their feeds shortly afterward.
7. As a viewer, I want confirmed live games to remain visible through overtime, so that an estimated duration does not hide them.
8. As a viewer, I want inferred status distinguished from confirmed live status, so that I understand the certainty of the list.
9. As a viewer, I want to filter NFL, CFB, or both independently of other viewers, so that my browsing does not change their filters.
10. As a viewer, I want selecting a game to reveal its candidate channels, so that I can choose a feed before changing playback.
11. As a viewer, I want candidates ranked by confidence, so that the strongest matches appear first.
12. As a viewer, I want channels discovered in the full provider catalog, so that unsaved feeds are available too.
13. As a viewer, I want a channel whose EPG identifies the matchup considered, so that guide evidence helps me find it.
14. As a viewer, I want matchup-specific channel names considered, so that temporary sports feeds can be discovered.
15. As a viewer, I want both-team name matches favored over single-team matches, so that unrelated games are less prominent.
16. As a viewer, I want ambiguous team names treated cautiously, so that abbreviations do not produce misleading confidence.
17. As a viewer, I want scheduled broadcast networks considered, so that games can have candidates even without explicit matchup text.
18. As a viewer, I want ESPN, ESPN2, and ESPN+ treated as distinct networks, so that similar names do not imply equivalent coverage.
19. As a viewer, I want network-only candidates ranked below explicit EPG matchup evidence, so that weaker evidence is not overstated.
20. As a viewer, I want regional uncertainty reflected when a network carries several games, so that generic affiliate matches do not appear certain.
21. As a viewer, I want NFL US affiliates associated with either team's market favored, so that hundreds of local feeds can be narrowed.
22. As a viewer, I want conflicting EPG and channel-name evidence to reduce confidence, so that contradictions affect ranking.
23. As a viewer, I want direct matchup matches allowed regardless of channel region, so that a useful international feed is not excluded.
24. As a viewer, I want an explicit no-matching-channels state when matching completes without useful evidence, so that unrelated channels do not fill the results.
25. As a viewer, I want matching-pending distinguished from no matches, so that an unevaluated game is not presented as unwatchable.
26. As an authorized viewer, I want clicking a candidate to immediately replace shared playback, so that I can start watching without another dialog.
27. As an administrator, I want existing channel-selection restrictions respected, so that the Games tab does not bypass shared-playback permissions.
28. As a viewer, I want playing a discovered channel to leave the saved lineup unchanged, so that one-off choices do not clutter Channels.
29. As a viewer, I want to choose another candidate myself after playback fails, so that the application does not cycle through feeds unexpectedly.
30. As a viewer, I want game categories to update automatically while my selected game is preserved, so that I can browse without repeatedly reopening it.
31. As an administrator, I want channel matching performed daily rather than on each status refresh, so that catalog and guide scans stay infrequent.
32. As an administrator, I want daily matching to cover the next 48 hours, so that candidates exist before games enter the visible window.
33. As an administrator, I want the first matching run triggered when the feature is enabled, so that viewers need not wait until the next morning.
34. As an administrator, I want a configurable matching time and timezone, defaulting to 6 a.m. America/Los_Angeles, so that discovery runs at an appropriate local time.
35. As an administrator, I want shared enabled-league settings, so that the available sports scope is controlled centrally.
36. As an administrator, I want configurable broadcast regions initially including the US, Canada, and UK, so that regional discovery can expand later.
37. As an administrator, I want configurable estimated duration per league, initially four hours for NFL and CFB, so that status fallback can be adjusted.
38. As a viewer, I want previously fetched games retained with a stale-data indication during feed failures, so that useful context remains available without appearing current.
39. As a viewer, I want prior candidate results retained after a failed daily run and the last successful matching time available, so that I can judge their freshness.
40. As a viewer, I want newly discovered games left pending after a matching failure, so that another game's candidates are never substituted.
41. As a viewer, I want the existing Channels tab to remain usable during sports-data failures, so that I can still choose channels normally.
42. As a viewer, I want missing Canadian or UK broadcast-assignment coverage disclosed, so that configured regions do not imply verified coverage.
43. As the project owner, I want a first version without a required paid subscription or API key, so that live-game discovery has a low setup burden.
44. As a future maintainer, I want additional leagues such as NBA to fit the same game and matching model, so that expansion does not require redesigning the picker.

## Implementation Decisions

- Extend the existing sidebar with a Games view. Keep personal league filtering separate from shared admin settings. Preserve selection during background updates while the game remains available.
- Introduce a cohesive game-discovery backend boundary for visible games, game-specific stored candidates, matching freshness, and coverage state. Keep schedule/status updates separate from expensive matching runs. Exact endpoint names and storage layout are implementation choices, not established contracts.
- Normalize sports-source data into stable game identity, league, participating teams, scheduled start, reported status, observed completion information, and broadcast assignments with region where known. Keep the sports-source adapter replaceable and leagues extensible.
- Return candidate identity, raw numeric confidence score, and underlying matching evidence, including contradictions. Scores range from 0 to 100 and are rankings, not calibrated probabilities. UI mapping of the score remains undecided.
- Use reported live status when available, including overtime. Include starts within one hour; exclude later starts. Keep confirmed completed games for one hour after a known finish. When no reliable completion timestamp exists, an observed transition to final may supply a fallback; do not create a fresh completion time for games first discovered already final.
- When live status is unavailable, estimate a four-hour game duration followed by a one-hour recently-finished period. The duration is configurable by league, and inferred status must be labeled. Distinguish stale observations from current status rather than silently claiming an old live observation is fresh.
- Run matching daily at configurable local time and timezone, defaulting to 6 a.m. America/Los_Angeles. Cover games scheduled over the next 48 hours. Run initial matching when enabled. Do not add near-kickoff passes or implicitly rematch on browsing, status polling, or missing EPG.
- Search the full provider catalog rather than only saved channels. Use current provider channel names rather than relying solely on saved names that may have diverged. Store results per game independently of the visible-games window.
- Match explicit matchup evidence from EPG and names, then scheduled network evidence. Both-team names outweigh one-team names; ambiguous aliases require contextual resolution or lower weight. Explicitly contradictory evidence reduces confidence. Missing EPG is absence of evidence, not a penalty.
- Keep specific network identities distinct. Network-only matches rank below explicit EPG matchup evidence and lose confidence where regional carriage leaves multiple possible games.
- Initially apply geographic boosts only to NFL US affiliates associated with either participating team's market. Treat this as a heuristic, not proof of carriage. Do not guess geography for unrecognized affiliates. CFB and Canadian/UK feeds receive other matching evidence without this boost.
- Shared broadcast-region settings initially include US, Canada, and UK, with room for more. These settings guide broadcast-assignment discovery and do not exclude direct matchup evidence from other regions. Shared league settings enable initial NFL and CFB coverage.
- Prioritize sources requiring no paid subscription or API key. Evaluate ESPN's undocumented feeds, but do not commit to them until complete games involving FBS teams can be obtained and validated. Default scoreboard responses are not proof of completeness.
- Launch may use verified US broadcast assignments with EPG and explicit matchup-name evidence across configured regions. If Canadian/UK assignments cannot be verified, disclose the gap and retain those assignments as follow-up work.
- Broaden schedule-oriented EPG retrieval where supported: the existing six-listing/current-next interface is insufficient to guarantee a 48-hour schedule. Trust evidence available at the daily run; represent missing future guide coverage without extra matching runs.
- Reuse shared playback coordination and existing authorization when selecting candidates. Support provider channels without adding them to the saved lineup. Keep provider credentials and stream resolution on the backend. Clicking initiates the normal playback-switch lifecycle immediately; it does not promise instantaneous stream readiness.
- Retain old games during temporary sports-feed failures with stale-data labeling. Failed matching preserves prior results for already matched games and the last successful run time. Newly discovered games without results remain pending. Completed matching with no meaningful evidence produces a separate no-matches state.
- Keep manual choice after playback failure; no automatic fallback through candidates. Sports failures must not break Channels or Chat.

## Testing Decisions

- Approved primary seam: backend Games API behavior with deterministic time and fixture-backed sports, provider-catalog, and EPG inputs. Exercise discovery, stored results, ranking, visibility, failure states, and settings through the public boundary rather than asserting internal helper calls or a specific module decomposition.
- Complement this with the existing shared channel-selection boundary for authorization, transient provider-channel resolution, broadcast coordination, and saved-lineup preservation. Reuse channel-switch and socket-handler test patterns instead of creating a parallel playback system.
- Add a small browser-level flow for the Games tab: filter, select game, view ranked candidates, click to confirm or cancel a shared-playback switch, and preserve selection through a status refresh. Verify denied selection and pending/no-matches/stale states as externally visible behavior. Use existing Playwright conventions; do not require a production build or replacement of running services.
- Use the existing Node test runner, EPG fake-clock/injected-provider patterns, controller response assertions, temporary isolated storage, settings tests, and deferred playback-switch tests as prior art. Tests must not use live provider credentials or depend on a live sports feed.
- Verify the one-hour start boundary, completion grace boundary, overtime, unknown final time, four-hour fallback, stale status, and configured timezone scheduling, including daylight-saving transitions. Status refresh must leave stored candidate results unchanged until the next matching run.
- Verify full catalog discovery includes unsaved channels, both-team matches outrank single-team matches, explicit EPG outranks network-only evidence, contradictions lower scores, missing guide data is neutral, ambiguous names are treated cautiously, and ESPN variants remain distinct. Avoid locking arbitrary numeric weights before representative evidence has been evaluated.
- Verify NFL affiliate boosts use either team market and are absent for unsupported geography and other leagues. Direct matchup evidence remains eligible outside configured broadcast regions.
- Verify initial matching, 48-hour coverage, failed-run retention, last-success metadata, matching-pending versus completed-empty results, sports-feed failure, and independence of the existing Channels view.
- Validate source adapters separately with recorded representative fixtures and a documented completeness check. Include FBS–FCS games, independents, duplicate games across conference feeds, and partial regional broadcast coverage. Treat live-source probes as validation work, not stable automated tests.
- The user approved these test seams on 2026-10-28.

## Out of Scope

- NBA and other leagues at launch, FCS-only college games, and additional sports UIs beyond the extensible model.
- Admin-maintained channel-to-network mappings or manual matching corrections; these are below the cut line.
- Guaranteed Canadian/UK broadcast assignments when no suitable source is verified, and geographic boosts for CFB or international channels.
- Paid sports subscriptions or API keys as required launch dependencies.
- Near-kickoff matching, matching on every status refresh, or automatic rematching because evidence is missing.
- Automatic channel switching after playback failure, automatic saving of discovered channels, and bypassing shared-playback permissions.
- A finalized visual mapping for numeric confidence scores or a claim that scores represent calibrated probabilities.
- Production builds, deployments, or restarting/recreating the user's development services as part of specification work or routine validation.

## Further Notes

- The product behavior was confirmed through the design interview. Source choice, score weights, exact API routes, storage schema, and UI score treatment have not been independently approved as fixed architecture.
- Before implementation, validate free schedule completeness, especially all games involving FBS teams; broader provider EPG access; automatic NFL team-market/affiliate-location evidence; transient unsaved-channel playback; and provider request cost/refresh constraints.
- ESPN probes found incomplete FBS-group results compared with conference responses. Canada/UK query parameters in sampled NFL feeds returned US assignments. These observations constrain source selection but do not establish that every ESPN feed has the same limitations.
- A missing future EPG schedule must not block the whole feature: use other available matching evidence and expose coverage honestly. Revisit the daily cadence only after observing its real limitations.
- Publish to the configured GitHub issue tracker in miduncan/IPTV-Restream with the `ready-for-agent` label. Target the user's fork explicitly rather than its upstream repository.
