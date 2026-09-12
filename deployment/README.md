# DigitalOcean deployment

Production deploys use prebuilt images from GitHub Container Registry. GitHub
Actions builds the frontend, backend, and Nginx images; the Droplet only pulls
those images and starts them. No application source or build toolchain is
needed on the server.

## One-time Droplet setup

Create an Ubuntu Droplet, point your domain at it, and install Docker Engine
with the Compose plugin. The SSH user used for deployment must be able to run
`docker` without `sudo`. The supplied manifest publishes HTTP on port 80;
allow that port through the Droplet firewall. For a public deployment,
terminate HTTPS with a DigitalOcean Load Balancer or another TLS reverse proxy
in front of the Droplet.

Create the deployment environment on the Droplet:

```bash
mkdir -p ~/iptv-restream
cd ~/iptv-restream
touch .env
chmod 600 .env
```

Put the site credentials in `~/iptv-restream/.env`:

```dotenv
AUTH_VIEWER_USERNAME=friends
AUTH_VIEWER_PASSWORD=replace-with-a-long-random-passphrase
AUTH_ADMIN_USERNAME=admin
AUTH_ADMIN_PASSWORD=replace-with-a-different-long-random-passphrase
```

The workflow never replaces this file. If the GHCR packages are private, also
log in to the registry once as the deployment user using a GitHub personal
access token with `read:packages`:

```bash
docker login ghcr.io
```

Public packages do not require a registry login.

## GitHub configuration

In the repository settings, create a `production` environment and add these
environment secrets:

- `DIGITALOCEAN_HOST`: the Droplet IP address or hostname
- `DIGITALOCEAN_USER`: the SSH deployment user
- `DIGITALOCEAN_SSH_PRIVATE_KEY`: its private SSH key
- `DIGITALOCEAN_SSH_KNOWN_HOSTS`: the Droplet's complete `known_hosts` entry

Obtain the last value from a trusted machine after verifying the Droplet's SSH
host fingerprint:

```bash
ssh-keyscan -H your-droplet.example.com
```

Push to `main` (or manually run **Build and deploy** in GitHub Actions). The
workflow publishes images tagged with the commit SHA and `latest`, copies the
small Compose manifest, pulls the exact SHA-tagged images, and recreates only
containers whose image changed. The persistent `channels` volume and the
Droplet's `.env` remain in place.

To roll back, rerun a previous successful workflow or run the Compose manifest
with a previous commit SHA as `IMAGE_TAG`.

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

## Other Docker deployment options

### Build from source
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

### Prebuilt images

Use [ghcr-docker-compose.yml](ghcr-docker-compose.yml). It has no `build`
directives and defaults to this fork's `latest` images. Pin an immutable commit
SHA for a repeatable deployment:

```bash
IMAGE_TAG=<git-commit-sha> docker compose -f ghcr-docker-compose.yml pull
IMAGE_TAG=<git-commit-sha> docker compose -f ghcr-docker-compose.yml up -d
```

Frontend configuration is compiled into its image. Change its build arguments
in the GitHub Actions workflow if a deployment needs different values.
