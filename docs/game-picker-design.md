# Game picker design

Historical decisions captured during the design interview. The user subsequently requested implementation, now completed on the game-picker integration branch. The [final specification](game-picker-spec.md) and [API](game-picker-api.md), [matching](game-picker-matching.md), and [scheduler](game-picker-scheduler.md) documents describe the implemented behavior.

## Settled requirements

- Add a Games tab in the existing sidebar alongside Chat and Channels.
- Start with NFL and college football; make additional leagues such as NBA straightforward to add.
- Include upcoming games only when they start within the next hour.
- Prefer actual game status for determining whether a game is ongoing. A loose time window is acceptable when that status is unavailable.
- Keep completed games visible until one hour after their reported finish; keep games reported as live visible through overtime. Without live status, use an estimated finish plus a one-hour grace period.
- Produce a raw 0–100 ranking score for candidate channels, not a calibrated probability. Preserve matching evidence; decide how the number appears in the UI later.
- Search the full provider catalog, including channels that have not been saved.
- Make broadcast regions configurable in settings, initially including the US, Canada, and UK, with additional regions possible later.
- Selecting a game reveals its candidate channels. Clicking a candidate starts or replaces shared playback.
- Playing a discovered channel does not automatically add it to the saved Channels list.
- Clicking a candidate uses the shared channel-selection handler and confirmation modal, retaining existing shared-playback permissions and the shared “Don’t show this again” preference.
- Include network-only matches with lower confidence scores. Show no matching channels when there is no meaningful evidence.
- Initial CFB coverage includes every game involving an FBS team, including FCS opponents; FCS-only games are outside initial scope.
- Configured broadcast regions guide broadcast-assignment discovery, without excluding direct matchup matches from channels in other regions.
- Evaluate ESPN's undocumented public feeds before committing to a source. Verify schedule completeness and Canadian/UK broadcast coverage, keeping the sports data source replaceable.
- Explicitly conflicting channel-name and EPG evidence reduces confidence; preserve both pieces of evidence.
- Enabled leagues and broadcast regions are admin-managed shared settings. Each viewer can independently filter the Games tab by enabled league.
- Group games into Live, Starting soon, and Recently finished; order upcoming games by kickoff. Distinguish estimated status from confirmed live status.
- Retain previously fetched games during temporary sports-feed failures with a stale-data indication; keep the existing Channels tab usable.
- On candidate playback failure, leave selection of another candidate to the viewer. Do not automatically switch through candidates in the initial version.
- Prioritize sources requiring neither a paid subscription nor an API key; paid services are not a launch dependency.
- Launch may use verified US broadcast assignments plus EPG and explicit matchup-name matching across configured regions. Canadian and UK broadcast assignments remain a follow-up requirement if no suitable source is verified; make that coverage gap explicit.
- Specific network identities matter: do not equate ESPN with ESPN2 or ESPN+. Network-only evidence ranks below an explicit EPG matchup and loses confidence when multiple games could air on that network.
- Prefer local affiliate feeds relevant to the game's region when narrowing large sets of FOX/CBS/NBC candidates. The precise definition of relevant region and evidence source remain open.
- Refresh game status and category placement automatically, independently of channel matching.
- Run channel matching at a much lower cadence, initially approximately once per day. Do not recompute matches on every game-status refresh.
- The daily matching run covers games scheduled over the next 48 hours and stores candidate scores independently of game visibility.
- Trust EPG evidence available during the daily run. No near-kickoff matching pass in the initial version; revisit if daily evidence proves insufficient.
- Boost affiliates associated with either participating team's market, not just the stadium location. This is a heuristic, not proof of regional carriage.
- Both-team name matches outweigh single-team matches. Reduce weight for ambiguous team names unless league or opponent context resolves them.
- Omit a game first discovered as final from Recently finished when its completion time is unknown; do not start a new grace period just because it was discovered.
- Schedule matching for 6 a.m. America/Los_Angeles by default, with configurable time and timezone.
- Enabling the feature triggers initial matching immediately. A failed later run preserves previous results and exposes the last successful matching time.
- Apply automatic local-market boosts initially only to NFL US affiliates. CFB and Canadian/UK channels use network, team-name, and EPG evidence without a geographic boost.
- After a failed matching run, previous candidates remain available for already matched games; newly discovered games show channel matching pending. Do not borrow another game's candidates or trigger extra matching runs.
- Without live status, estimate four hours of game time for NFL and CFB, followed by the one-hour recently-finished window. Make duration configurable per league and label inferred status. Confirmed live status overrides the estimate.
- Daily matching needs broader EPG schedule access than the existing current/next guide when the provider supports it. Missing future EPG contributes no evidence, rather than negative evidence, and does not trigger extra matching runs.

## Below the cut line

- Admin-maintained channel-to-network mappings and corrections. Revisit after automatic matching has been evaluated.

## Source evaluation findings during design

- ESPN's public feeds are undocumented. NFL samples exposed schedule, status, and US broadcast evidence, but Canada/UK region parameters did not yield corresponding regional assignments in the inspected slate.
- A sampled CFB FBS-group response omitted games present in conference responses. Do not assume a high request limit establishes completeness. Conference and independent-team coverage needs further validation before selecting this source.
- Exact completion timestamps were not established. First-observed-final time is a possible fallback, pending a decision on behavior after startup or data gaps.
- Explore matching from EPG listings, game information in channel names, and scheduled broadcast networks matched to available IPTV channels.

## Validation topics identified during design

- Validate free sports-source completeness for all games involving FBS teams, including conference feeds and independents if using ESPN.
- Establish broader provider EPG schedule access for the 48-hour matching horizon; explicitly represent missing schedule coverage.
- Establish an automatic source of NFL team-market and US affiliate-location evidence; avoid guessing ambiguous affiliate locations.
- Validate transient playback of provider channels without adding them to the saved channel list.
- Tune evidence weights against representative catalog and EPG examples; retain evidence and explicit conflicts alongside numeric scores.
- Verify source refresh limits and catalog scan cost before setting exact refresh intervals and concurrency.

## Review status

Shared understanding confirmed by the user on 2026-10-28, followed by the explicit implementation request. Implementation now includes source validation, transient playback, Games browsing, full FBS coverage, matching evidence, affiliate relevance, and configurable automatic matching. These notes preserve the interview history; current source findings and remaining limitations are recorded in [source validation](game-picker-source.md), [network coverage](game-picker-network.md), and [affiliate evidence](game-picker-affiliates.md). No ADR was created during the interview.
