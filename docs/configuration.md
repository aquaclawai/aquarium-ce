# Configuration

This document covers all configuration options for Aquarium CE.

## CLI Flags

When running Aquarium via `npx @aquaclawai/aquarium` or the `aquarium` command:

| Flag | Description | Default |
|------|-------------|---------|
| `--port <number>` | HTTP server port | `3001` |
| `--host <address>` | Bind address | `localhost` |
| `--data-dir <path>` | Data directory path | `~/.aquarium/` |
| `--open` | Open browser after startup | disabled |

Examples:

```bash
# Run on a different port
npx @aquaclawai/aquarium --port 8080

# Store data in a custom location
npx @aquaclawai/aquarium --data-dir /opt/aquarium/data

# Bind to all interfaces (for remote access)
npx @aquaclawai/aquarium --host 0.0.0.0

# Open browser automatically
npx @aquaclawai/aquarium --open
```

## Environment Variables

Environment variables can be set in a `.env` file in the working directory or exported in your shell. Copy `.env.example` as a starting point.

### Core Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `3001` |
| `HOST` | Bind address | `localhost` |
| `NODE_ENV` | Environment (`development`, `production`) | `development` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |

### Security

| Variable | Description | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secret for signing JWT tokens | auto-generated dev key |
| `ENCRYPTION_KEY` | Key for encrypting stored credentials (32 chars) | dev key |

**Important**: In production, always set `JWT_SECRET` and `ENCRYPTION_KEY` to strong random values. The default development keys are not secure.

### Database

| Variable | Description | Default |
|----------|-------------|---------|
| `AQUARIUM_DB_PATH` | SQLite database file path | `~/.aquarium/aquarium.db` |
| `AQUARIUM_DATA_DIR` | Data directory | `~/.aquarium/` |

### Docker

| Variable | Description | Default |
|----------|-------------|---------|
| `DOCKER_SOCKET` | Docker socket path | `/var/run/docker.sock` |
| `OPENCLAW_NETWORK` | Docker network name for instances | `openclaw-net` |
| `OPENCLAW_PORT_RANGE_START` | Start of host port range for instances | `19000` |
| `OPENCLAW_PORT_RANGE_END` | End of host port range for instances | `19999` |
| `OPENCLAW_IMAGE` | Docker image for gateway instances | auto-detected |
| `PLATFORM_CONTAINER_ID` | Container ID when platform runs in Docker | empty (host mode) |

### Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_REDACTION_ENABLED` | Redact sensitive data from logs | `true` in production |

## Data Directory Structure

Aquarium stores all persistent data in a single directory:

```
~/.aquarium/
  aquarium.db        SQLite database (users, instances, credentials, etc.)
```

The data directory is created automatically on first run. To back up Aquarium, copy this directory. To reset, delete it.

### Custom Data Directory

Set the data directory using any of these methods (in priority order):

1. CLI flag: `--data-dir /path/to/data`
2. Environment variable: `AQUARIUM_DATA_DIR=/path/to/data`
3. Default: `~/.aquarium/`

## Docker Requirements

Aquarium CE requires Docker to run agent instances. The platform communicates with Docker via the Docker socket.

### Permissions

The user running Aquarium must have permission to access the Docker socket. On Linux, this typically means being in the `docker` group:

```bash
sudo usermod -aG docker $USER
# Log out and back in for the change to take effect
```

### Running Aquarium Inside Docker

When running Aquarium itself as a Docker container, you need to:

1. Mount the Docker socket: `-v /var/run/docker.sock:/var/run/docker.sock`
2. Set `PLATFORM_CONTAINER_ID` to the container's own ID (so it can join instance networks)

### Port Range

Agent instances are assigned host ports from a configurable range (default 19000-19999). Ensure these ports are available and not blocked by firewalls.

## Production Deployment

For production use:

1. Set strong `JWT_SECRET` and `ENCRYPTION_KEY` values
2. Use a persistent volume for the data directory
3. Consider running behind a reverse proxy (nginx, Caddy) for TLS
4. Set `NODE_ENV=production` to enable log redaction and security hardening
5. Set `CORS_ORIGIN` to your actual domain

Example with Docker Compose:

```yaml
version: '3.8'
services:
  aquarium:
    image: ghcr.io/aquaclawai/aquarium:latest
    ports:
      - "3001:3001"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - aquarium-data:/app/data
    environment:
      - NODE_ENV=production
      - JWT_SECRET=your-strong-random-secret
      - ENCRYPTION_KEY=your-32-char-encryption-key!!
      - CORS_ORIGIN=https://your-domain.com

volumes:
  aquarium-data:
```
