# Google Cast Implementation Plan

## Status

Deferred. AirPlay support and its receiver-facing HLS gateway are implemented. This document records the remaining Google Cast sender work so it can reuse that gateway rather than create a second streaming architecture.

## Product decisions

- Use Google Cast's Default Media Receiver. Do not build or publish a custom Android TV application for the first version.
- Cast the channel that is selected when the user starts casting.
- A channel change may end playback on the receiver. Automatic receiver reloads can be added later.
- Reuse the existing direct, proxy, or restream output. Starting a Cast session must not create another FFmpeg process or another audio/video transcode.
- Do not reject or hide casting based on codec inspection. Attempt playback and report a sender-visible failure when the Cast SDK provides one.
- Keep protocol, codec, HTTPS, and receiver details out of the normal player UI. The user should see a familiar Cast control and concise success/error states only.
- Use the existing toast system for actionable sender-side errors. Receiver-rendered errors may remain on the TV when the sender SDK does not expose useful detail.

## Prerequisites

### HTTPS

The production web sender must be served over HTTPS. Google Cast's Web Sender SDK relies on browser presentation capabilities that are not dependable on an insecure origin.

Local development can implement and unit-test the integration before HTTPS is available, but end-to-end device testing should use a hostname and certificate trusted by both the sender browser and receiver device. Do not add explanatory HTTPS messaging to the player UI; simply do not render an unusable Cast control when the SDK or Cast support is unavailable.

### Receiver-reachable media URL

The receiver fetches media independently of the browser. It cannot use the browser's HttpOnly StreamHub session cookie, and `localhost` from the receiver refers to the receiver itself.

The AirPlay implementation now provides a receiver-facing playback URL that:

- is absolute and uses the configured public origin;
- is reachable by the Android TV;
- authorizes access without exposing the user's normal session cookie;
- serves manifests, nested manifests, media segments, and encryption keys;
- preserves required upstream headers without embedding those headers in the public URL;
- returns correct HLS content types and CORS headers; and
- remains valid for the expected duration of a live viewing session.

Google Cast should reuse this URL so both protocols exercise the same receiver path.

## Backend design

### Cast playback session

Reuse the authenticated AirPlay endpoint that creates a short-lived playback session for the currently selected channel:

```text
POST /api/airplay/sessions
```

Before implementing Cast, consider renaming the AirPlay controller and service to protocol-neutral playback names. If they are renamed, preserve the existing AirPlay route or update the frontend in the same change. Do not add a parallel Cast proxy or session store.

The response should contain an opaque playback URL and an expiry time. The server should store only the data needed to resolve the session to its channel and mode. Do not place provider credentials, custom request headers, or the original upstream URL in the playback URL.

An example response shape:

```json
{
  "playbackUrl": "https://stream.example.com/cast/session-id/master.m3u8",
  "expiresAt": "2026-09-08T08:00:00.000Z"
}
```

The opaque session identifier acts as a scoped bearer credential. Use sufficient entropy, apply an expiry, return `Cache-Control: no-store` when creating it, and avoid logging the complete identifier. A later iteration may add explicit revocation when casting stops.

### Receiver routes

Add unauthenticated-by-cookie routes beneath the opaque session path. Every request must validate the playback session:

```text
GET /airplay/:sessionId/master.m3u8
GET /airplay/:sessionId/resource/:resourceId
```

The manifest handler should resolve the stored channel server-side and then:

- serve the existing restream manifest for `restream` mode;
- proxy the upstream manifest for `proxy` mode; or
- proxy/redirect only when doing so will not expose credentials and the destination remains receiver-accessible for `direct` mode.

Rewrite every URI in master and media manifests through the session-scoped resource route. This includes variant playlists, segments, `EXT-X-KEY` URIs, initialization maps, audio renditions, and subtitle renditions. Query parameters on a manifest URL are not automatically inherited by child segment requests, so authorization must be present in each rewritten resource URL or encoded by the session path.

Forward upstream status codes and relevant response headers. Set accurate content types rather than applying an HLS manifest content type to media segments. Permit the CORS methods and headers required by the Cast receiver, including `Range`, and expose range-related response headers.

### Restream lifetime and resource use

The current restream is a single FFmpeg process for the globally selected channel. A receiver should consume that same generated HLS output.

Creating a Cast session must not call `startFFmpeg` independently. Integrate active playback sessions or receiver request activity with `RestreamIdleManager` so the restream is not stopped merely because the sender browser disconnects while the TV continues fetching segments.

When the global channel changes, the old restream may stop and the receiver may consequently stop. That is acceptable for the first version. Do not keep the old channel's encoder alive solely for a Cast receiver.

## Frontend design

### SDK loading

Load the Google Cast Web Sender SDK lazily and only in a browser that can use it:

```text
https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1
```

Wrap the global SDK API in a small TypeScript service rather than accessing `window.chrome.cast` throughout React components. The wrapper should own:

- SDK script loading and initialization;
- `CastContext` configuration;
- Cast availability and session-state subscriptions;
- media loading;
- remote player state; and
- cleanup.

Use `chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID` for the first version.

### Starting playback

On an explicit user gesture:

1. Ask the backend to create a playback session for the selected channel.
2. Open the native Cast device picker.
3. Create a `MediaInfo` using the returned playback URL and the HLS content type.
4. Attach channel name and artwork as generic media metadata.
5. Load it through the current `CastSession`.
6. Once remote playback succeeds, pause local video loading so casting does not unnecessarily consume the HLS output twice.

Do not preflight or block the request based on reported codecs. Let the Default Media Receiver attempt playback.

### UI behavior

Add the standard Cast control near the video player. Follow Google's Cast icon and state conventions rather than inventing protocol-specific instructions.

The control should be absent when the Cast SDK reports no support or has not initialized successfully. Normal UI states are:

- available;
- connecting;
- connected; and
- disconnected.

Do not show users implementation details such as CORS, HTTPS, HLS manifests, codecs, sender/receiver terminology, or authentication tokens.

Map actionable failures to short messages through `ToastContext`, for example:

- `Could not start casting.`
- `The TV could not play this stream.`
- `Casting was disconnected.`

Log the detailed SDK error and error code to the developer console. Do not promise a codec-specific message unless the SDK actually identifies the codec as the cause.

### Channel changes

For the first version, do not automatically call `loadMedia` when StreamHub's current channel changes. Stop or disconnect the Cast session, or allow the old media request to fail when its restream is stopped, and require the user to cast again.

A later enhancement can reload the new channel into the existing Cast session. It must still use the single globally selected restream and must not retain the previous channel's FFmpeg process.

## Suggested code organization

```text
frontend/src/services/CastService.ts
frontend/src/hooks/useCastSession.ts
frontend/src/components/CastButton.tsx
backend/controllers/AirPlayController.js (reuse or rename protocol-neutrally)
backend/services/airplay/AirPlaySessionService.js (reuse or rename protocol-neutrally)
backend/services/airplay/AirPlayManifestService.js (reuse or rename protocol-neutrally)
```

The receiver-safe HLS routing and manifest rewriting should be protocol-neutral even if the initial names contain `cast`. AirPlay should be able to request the same playback URL.

## Testing

### Automated backend tests

- Creating a playback session requires an authenticated viewer.
- Session identifiers are opaque, expire, and cannot select arbitrary channels.
- Invalid and expired sessions return an appropriate authorization response.
- Manifests rewrite relative and absolute nested playlists, segments, keys, maps, audio, and subtitle URIs.
- Rewritten resources preserve the upstream query string and required headers.
- Provider credentials and custom headers never appear in the generated URL or response body.
- Content types and byte-range behavior are correct for manifests and media.
- One Cast session does not create an additional FFmpeg process.
- Active receiver requests prevent an in-use restream from being stopped as idle.
- Changing the global channel does not keep two restream encoders running.

### Automated frontend tests

- The SDK is loaded once.
- The Cast control appears only when the framework reports availability.
- Starting a session requests a playback URL and loads it into the selected receiver.
- Successful remote playback pauses local loading.
- Load rejection produces a toast and restores local playback.
- Channel changes follow the chosen stop-and-recast behavior.
- SDK absence does not affect normal playback.

### Manual device matrix

- Chrome on macOS to the available Hisense Android TV.
- HLS from `direct`, `proxy`, and `restream` channel modes.
- Compatible and incompatible codecs, verifying that playback is attempted in both cases.
- Receiver access through the eventual public HTTPS domain.
- Browser refresh, tab close, receiver disconnect, session expiry, and global channel change.
- Encrypted HLS if any configured channels use `EXT-X-KEY`.

## Delivery sequence

1. Establish public HTTPS and verify receiver reachability.
2. Reuse, or protocol-neutrally rename, the existing AirPlay playback-session gateway.
3. Add the Cast sender service and standard control.
4. Load the current channel in the Default Media Receiver.
5. Add remote-state handling, local-load suspension, toasts, and cleanup.
6. Test against the Hisense Android TV before enabling the feature generally.

## References

- [Google Cast Web Sender integration](https://developers.google.com/cast/docs/web_sender/integrate)
- [Google Cast Web Sender setup and HTTPS requirement](https://developers.google.com/cast/docs/web_sender)
- [Google Cast supported media](https://developers.google.com/cast/docs/media)
- [Google Cast HLS streaming protocols](https://developers.google.com/cast/docs/media/streaming_protocols)
- [Google Cast Web Receiver overview](https://developers.google.com/cast/docs/web_receiver)
