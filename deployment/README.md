# Advanced Deployment

## Configuration Options

### Viewer and admin roles

Nginx authenticates two shared users and passes their identity to the backend,
which assigns either the `viewer` or `admin` role. Create a `.env` file next to
the Compose file:

```dotenv
BASIC_AUTH_FRIENDS_USERNAME=friends
BASIC_AUTH_FRIENDS_PASSWORD=replace-with-a-long-random-passphrase
BASIC_AUTH_ADMIN_USERNAME=admin
BASIC_AUTH_ADMIN_PASSWORD=replace-with-a-different-long-random-passphrase
```

Both users can view streams and use chat. Only the admin user can open the
control panel, change settings, manage channels and playlists, or use other
privileged API and WebSocket operations. Set
`CHANNEL_SELECTION_REQUIRES_ADMIN=true` on the backend if switching the current
channel should also require the admin role.

Use HTTPS for any public deployment because Basic Auth credentials are only
protected in transit when TLS is enabled.

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
