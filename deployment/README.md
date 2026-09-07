# Advanced Deployment

## Configuration Options

### Viewer and admin roles

The backend authenticates two shared users and assigns either the `viewer` or
`admin` role. Create a `.env` file next to the Compose file:

```dotenv
AUTH_VIEWER_USERNAME=friends
AUTH_VIEWER_PASSWORD=replace-with-a-long-random-passphrase
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace-with-a-different-long-random-passphrase
```

Both users can view streams and use chat. Only the admin user can open the
control panel, change settings, manage channels and playlists, or use other
privileged API and WebSocket operations. Set
`CHANNEL_SELECTION_REQUIRES_ADMIN=true` on the backend if switching the current
channel should also require the admin role.

Login uses an opaque server-side session stored in an HttpOnly cookie. Use
HTTPS for any public deployment so credentials and session cookies are
protected in transit.

## Docker 

### Easy Way (Preffered)
Clone the repo

```bash
git clone https://github.com/antebrl/IPTV-Restream.git
```

Make sure to have docker up & running. Start with docker compose
```bash
docker compose up -d
```
Open http://localhost

### Production Build (with SSL certificate)
If you want to expose the application to the public under your domain, [this](docker-compose.yml) could be an easy deployment to get it working with `https`. You still have to configure nginx-proxy-manager when using this solution.

### Prebuild Images
Use the [ghcr-docker-compose.yml](ghcr-docker-compose.yml).
```bash
docker compose -f ghcr-docker-compose.yml up
```

Disadvantages:
- not always up to date
- cannot set custom configuration for the frontend, as the config is parsed in the image build process
