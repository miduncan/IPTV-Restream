# Broadcast-network discovery

Games settings include `broadcastRegions`, initially `US`, `CA`, and `UK`.
Admins can replace this with a unique list of uppercase two- or three-letter
country codes; an empty list disables broadcast-assignment evidence while direct
matchup discovery remains available. Regions guide sports-source assignment
discovery and network evidence, rather than excluding channel-name or EPG matchup
evidence from other countries. Old stored settings inherit new default fields
without losing prior league or duration choices.

Only normalized assignments with a region contribute network evidence. The
validated launch source supplies US assignments; Canadian/UK assignment coverage
remains unverified as documented in `game-picker-source.md`. Configuring another
region does not establish coverage: unsupported/unknown configured regions are
disclosed in the Games view. It also exposes the matching run's guide limitations
without claiming complete future coverage or triggering additional matching.

`BroadcastNetworkEvidence` recognizes specific network identities before generic
names. ESPN, ESPN2, ESPN+, ESPNU, and ESPNEWS are distinct; so are CBS Sports
Network versus CBS and FS1/FS2 versus FOX. Unrecognized identities contribute no
network evidence. ESPN PPV is distinct, and unfamiliar suffixes such as ESPN 4
or ESPN Mystery cannot fall back to ESPN. CBS Sports is an alias for CBS Sports
Network, separate from CBS. Specialty identities require a recognized name after
picture-quality decorations are removed; local ABC/CBS/FOX/NBC names can retain
station numbers and cities. An unresolved branded variant cannot gain a parent
network through affiliate callsign inference. Provider country prefixes such as
`US:`, `CA|`, or `[UK]` are used when explicit; geography is not guessed from
arbitrary text. An explicitly Canadian feed does not inherit a US network
assignment. A feed with unknown region can remain a weaker network candidate,
with uncertainty preserved.

Network-only evidence ranks below explicit both-team matchup names and above
one-team-only names. EPG evidence has a deliberately low experimental weight.
Overlapping games assigned to the same network and region lower its score.
Generic ABC/CBS/FOX/NBC affiliates carry regional uncertainty even when only one
relevant game is known. Assignment evidence is never represented as confirmed
carriage. It includes network, region, count of possible overlapping games, and
a readable explanation. Network evidence composes with matchup and guide
evidence; explicit contradictions still reduce the final score.

`createNetworkEvidence(games, options)` prepares the helper once per matching
batch. It caches provider channel classification and game/network/region evidence
so thousands of affiliate feeds do not repeatedly recompute all overlapping
assignments. The matching cadence remains manual in this slice; settings changes,
status polling, missing guide information, and browsing never invoke scans.

Public-boundary tests in `backend/test/game-network-api.test.js` cover specific
network identities, overlap uncertainty, settings authorization and migration,
region isolation, and direct foreign matchup evidence. Browser checks in
`frontend/e2e/games-network.spec.mjs` cover persisted region controls and visible
assignment/guide gaps through the existing Games path.
