# Advanced Deployment

## Configuration Options

### Admin Mode
Admin Mode restricts channel management to authenticated administrators only.

**Configuration (in `docker-compose.yml` > iptv_restream_backend):**
- `ADMIN_ENABLED`: Enable admin mode (`true` or `false` [default]).
- `ADMIN_PASSWORD`: Set a secure password for admin login (required if admin mode is enabled).
- `CHANNEL_SELECTION_REQUIRES_ADMIN`: If set to `true`, only admins can switch the currently watched channel.

### Shared site password

Nginx can require one shared HTTP Basic Auth login before serving any frontend,
API, WebSocket, proxy, or stream URL. Create a `.env` file next to the Compose
file:

```dotenv
BASIC_AUTH_USERNAME=friends
BASIC_AUTH_PASSWORD=replace-with-a-long-random-passphrase
```

Both values must be set to enable the gate. If both are omitted or empty, it is
disabled. This is separate from Admin Mode: the shared login controls who can
reach the site, while Admin Mode controls who can change its configuration.

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
