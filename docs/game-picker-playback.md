# Transient provider playback

The Games picker can call `SocketService.setCurrentProviderChannel(streamId)`.
The `set-current-provider-channel` socket event accepts only a positive decimal
Xtream stream ID string. Its acknowledgement and `channel-switching`,
`channel-selected`, and `channel-switch-failed` events match saved-channel
selection. Authorization is checked before provider resolution. Choosing a
candidate uses the same shared-playback confirmation as saved channels, including
the shared “Don’t show this again” preference. Both pickers call the same frontend
selection handler before dispatching their respective socket events.

Resolution uses the backend's configured Xtream credentials and the current full
catalog, rather than accepting a client URL or trusting an old candidate name.
Each selection currently costs two parallel player API requests:
`get_live_streams` and `get_live_categories`. Categories are optional; a missing
stream or failed stream-list request rejects selection without changing the
current channel. The provider timeout is 15 seconds. There is no provider-wide
documented rate limit or guaranteed per-stream lookup; future optimization must
retain current-catalog validation and credential isolation. Matching should scan
the catalog once per run, rather than invoke selection resolution per candidate.

Runtime provider channels have negative IDs (`-streamId`), outside the persisted
positive channel ID space. Their stream IDs must be positive safe integers. They
always use backend restream mode, keeping credential-bearing `.ts` URLs and
headers out of serialized channel metadata and playback addresses. The existing
FFmpeg readiness, shared selection queue, stream retirement, receiver playback,
and chat broadcast lifecycle remains in use. The active transient channel is
resolvable by ID for receiver sessions, but never enters `getChannels()`, the
saved lineup, its exported playlist, or channel storage. Restarting the backend
does not restore transient selections.

Provider lookup can finish out of order. The shared socket revision guard keeps
a slow old lookup from switching after a newer choice; saved and transient
switches otherwise share the same readiness queue. Failed playback leaves the
prior channel active. Viewers choose a different candidate manually.

Fixture-backed tests live in `backend/test/provider-channel-selection.test.js`
and use isolated SQLite storage and an external playback-runtime substitute;
they require neither live provider credentials nor a running server.
