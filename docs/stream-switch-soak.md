# Stream switch soak test

This Playwright test repeatedly changes the shared current channel through the
real application UI. It records channel-selection time, HLS requests, actual
video playback events, startup time, rebuffering, browser errors, and request
failures during the first 45 seconds after every switch.

The test has a hard safety check for playback synchronization. It refuses to
start when synchronization is enabled and checks the setting again before each
switch and every five seconds while monitoring a stream. If the setting changes
during a run, the test stops.

## Before running

- Use the normal development stack; no rebuild is required.
- In Admin settings, turn **Stream synchronization** off.
- Have at least two known-good channels configured in restream mode.
- Be aware that this changes the shared current channel for every connected
  viewer.
- Google Chrome must be installed. Set `SOAK_BROWSER_CHANNEL` to another
  Playwright browser channel if needed.

After the first dependency install on a machine, install Playwright's small
video-recording helper:

```sh
npx playwright install ffmpeg
```

## Run

From the `frontend` directory:

```sh
npm run test:stream-soak
```

If authentication is enabled, pass credentials through the environment. They
are used only for login and are never written to the results:

```sh
SOAK_USERNAME='admin-user' SOAK_PASSWORD='admin-password' \
  npm run test:stream-soak
```

An explicit allowlist prevents a known-bad channel from invalidating the test.
Select channel IDs and a longer run with:

```sh
SOAK_CHANNEL_IDS='12,18' \
SOAK_ITERATIONS=20 \
SOAK_OBSERVE_SECONDS=60 \
  npm run test:stream-soak
```

If `SOAK_CHANNEL_IDS` is omitted, the test uses the first two configured
restream channels. Prefer setting it for repeatable results.

Results are stored under `frontend/test-results/stream-soak/` and the HTML
report under `frontend/playwright-report/stream-soak/`. Artifacts include:

- a JSON report with every video event and media request;
- a video recording of the full run;
- a Playwright trace and screenshot when the test fails;
- aggregate median/p95 startup timings and rebuffer counts.

Channel URLs, request headers, passwords, and session cookies are deliberately
excluded from both files.

## Useful settings

- `SOAK_ITERATIONS` (default `6`)
- `SOAK_OBSERVE_SECONDS` (default `45`)
- `SOAK_STARTUP_TIMEOUT_MS` (default `45000`)
- `SOAK_BASE_URL` (default `http://localhost`)
- `SOAK_HEADED=true` to watch the run
- `SOAK_BROWSER_CHANNEL` (default `chrome`)

The test never enables or disables synchronization itself. It verifies that the
setting is off at startup, before every switch, and every five seconds during
observation. It aborts immediately if synchronization becomes enabled.
