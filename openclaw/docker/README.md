# OpenClaw Gateway — Docker Images

Production Docker images for [OpenClaw](https://github.com/openclaw/openclaw) Gateway with WhatsApp and Telegram channel support, designed for Kubernetes deployments.

## Directory Structure

```
docker/
├── base/                  # Base gateway image
│   ├── Dockerfile
│   ├── docker-entrypoint.sh
│   └── Makefile
├── images/                # Template-specific images
│   └── clawra/            # Clawra selfie skill image
│       ├── Dockerfile
│       └── Makefile
├── templates/             # Shared workspace .md files
└── README.md
```

## Quick Start

```bash
# Build base image
cd base && make build

# Build template images (requires base image)
cd images/clawra && make build

# Run locally (auto-generates gateway token)
cd base && make run

# Open Control UI
open http://localhost:18789
```

## Build

### Base Image

The base image installs OpenClaw Gateway from npm and includes the entrypoint, workspace templates, and platform-bridge plugin.

```bash
cd base

# Default version (2026.2.12)
make build

# Custom version
docker build --build-arg OPENCLAW_VERSION=2026.2.10 \
  -t openclaw-gateway:2026.2.10 -f Dockerfile ../..

# Push to registry
REGISTRY=ghcr.io/citronetic make push
```

### Template Images

Template images extend the base image with pre-installed skills and dependencies.

#### Clawra (AI Selfie Skill)

Adds the [Clawra](https://github.com/SumeLabs/clawra) selfie skill with `jq` for JSON payload construction.

```bash
cd images/clawra

# Build (pulls base from GCR by default)
make build

# Push to registry
REGISTRY=europe-west1-docker.pkg.dev/jinko-agent/agent-docker-repo make push
```

### Build Args

| Arg | Default | Description |
|-----|---------|-------------|
| `OPENCLAW_VERSION` | `2026.2.12` | OpenClaw npm package version |

### Image Details

- **Base**: `node:22-bookworm-slim`
- **User**: `node` (uid 1000)
- **Ports**: 18789 (Gateway/UI), 18790 (Bridge)
- **Data**: `/home/node/.openclaw` (mount as PVC)

## Runtime Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENCLAW_GATEWAY_TOKEN` | — | **Required.** Gateway auth token |
| `OPENCLAW_GATEWAY_BIND` | `lan` | Bind mode (`loopback`, `lan`, `tailnet`, `auto`, `custom`) |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Gateway API/UI port |
| `OPENCLAW_BRIDGE_PORT` | `18790` | Bridge port |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token from @BotFather |

### Config File

Mount `openclaw.json` at `/home/node/.openclaw/openclaw.json` via ConfigMap or directly on the PVC. At least one channel (WhatsApp or Telegram) should be configured.

Telegram only:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    }
  }
}
```

WhatsApp only:

```json
{
  "channels": {
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["+15551234567"]
    }
  }
}
```

Both channels:

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "allowlist",
      "allowFrom": [123456789]
    },
    "whatsapp": {
      "dmPolicy": "allowlist",
      "allowFrom": ["+15551234567"]
    }
  }
}
```

### Volumes

| Path | Purpose | Notes |
|------|---------|-------|
| `/home/node/.openclaw` | All persistent data | PVC `ReadWriteOnce`, writable by uid 1000 |

Contents of this volume:

- `openclaw.json` — gateway configuration
- `credentials/` — channel session state (WhatsApp `creds.json`, etc.)
- `workspace/` — agent workspace data
- `agents/` — agent session history

### Entrypoint Commands

| Command | Description |
|---------|-------------|
| `gateway` *(default)* | Start OpenClaw Gateway in foreground |
| `login` | Interactive channel login (default: WhatsApp QR) |
| `health` | Run `openclaw doctor` diagnostics |
| `shell` | Drop to a shell for debugging |
| `<anything>` | Passed directly to `openclaw` CLI |

## Channel Setup

At least one channel (Telegram or WhatsApp) must be configured. Both can run simultaneously.

| | Telegram | WhatsApp |
|---|----------|----------|
| **Auth method** | Bot token (headless) | QR code scan (interactive) |
| **K8s friendly** | ✅ Fully headless | ⚠️ Needs `kubectl exec` for QR |
| **Credential** | `TELEGRAM_BOT_TOKEN` env var | Session files on PVC |
| **Horizontal scaling** | ❌ Single bot instance | ❌ Single Baileys socket |

### Telegram Setup

Telegram is the simplest channel for Kubernetes — no interactive login required.

1. Create a bot with [@BotFather](https://t.me/BotFather) on Telegram (`/newbot`)
2. Copy the bot token
3. Pass it via environment variable or config:

```bash
# Via env var (recommended for K8s — use a Secret)
TELEGRAM_BOT_TOKEN=123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Or via CLI
kubectl exec deploy/openclaw-gateway -- openclaw channels add --channel telegram --token "YOUR_TOKEN"

# Verify
kubectl exec deploy/openclaw-gateway -- openclaw channels status
```

Config file alternative (`openclaw.json`):

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
    }
  }
}
```

> **Important**: If you only set `TELEGRAM_BOT_TOKEN` without `"enabled": true` in the config, the gateway will detect the token but not auto-enable Telegram. Either add `"enabled": true` to the config, or run `openclaw doctor --fix` inside the pod to apply it.

### WhatsApp Setup in Kubernetes

WhatsApp uses QR code linking via Baileys. Since K8s pods lack interactive displays, use one of these approaches:

#### Option A: kubectl exec (Simplest)

```bash
kubectl exec -it deploy/openclaw-gateway -- openclaw channels login

# Scan the QR code displayed in your terminal
# (WhatsApp → Settings → Linked Devices → Link a Device)

kubectl exec deploy/openclaw-gateway -- openclaw channels status
```

#### Option B: Pre-authenticate locally

```bash
# 1. Install OpenClaw locally
npm install -g openclaw@2026.2.12

# 2. Run QR login on your local machine
openclaw channels login

# 3. Copy credentials to the PVC via a helper pod
kubectl run creds-copy --image=busybox --restart=Never -- sleep 3600
kubectl cp ~/.openclaw/credentials creds-copy:/tmp/credentials
# Then copy from helper pod to your PVC mount
kubectl delete pod creds-copy
```

#### Option C: Control UI via port-forward

```bash
kubectl port-forward svc/openclaw-gateway 18789:18789
# Open http://localhost:18789, authenticate with your token
```

### Credential Persistence

- **Telegram**: Bot token stored in config or env var. No file-based credentials — pod restarts are safe.
- **WhatsApp**: Credentials live at `/home/node/.openclaw/credentials/whatsapp/<accountId>/creds.json`. Baileys updates `creds.json` at runtime — the volume **must be writable**. If credentials are lost (PVC deleted), re-link via QR scan.

### Re-authentication

```bash
# Check all channel statuses
kubectl exec deploy/openclaw-gateway -- openclaw channels status

# Re-login WhatsApp if needed
kubectl exec -it deploy/openclaw-gateway -- openclaw channels login
```

## Kubernetes Deployment Reference

> Full K8s manifests are a separate task. Below is a reference spec.

### Security Context

```yaml
securityContext:
  runAsUser: 1000
  runAsGroup: 1000
  fsGroup: 1000
  runAsNonRoot: true
```

### PVC

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: openclaw-data
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 1Gi
```

### Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openclaw-gateway
spec:
  replicas: 1  # MUST be 1 — WhatsApp and Telegram sessions cannot be shared across pods
  strategy:
    type: Recreate
  template:
    spec:
      securityContext:
        runAsUser: 1000
        fsGroup: 1000
        runAsNonRoot: true
      containers:
        - name: gateway
          image: openclaw-gateway:2026.2.12
          ports:
            - containerPort: 18789
              name: gateway
            - containerPort: 18790
              name: bridge
          env:
            - name: OPENCLAW_GATEWAY_TOKEN
              valueFrom:
                secretKeyRef:
                  name: openclaw-secrets
                  key: gateway-token
            - name: TELEGRAM_BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: openclaw-secrets
                  key: telegram-bot-token
                  optional: true
          volumeMounts:
            - name: data
              mountPath: /home/node/.openclaw
          livenessProbe:
            tcpSocket:
              port: 18789
            initialDelaySeconds: 15
            periodSeconds: 30
          readinessProbe:
            tcpSocket:
              port: 18789
            initialDelaySeconds: 5
            periodSeconds: 10
          resources:
            requests:
              memory: 256Mi
              cpu: 100m
            limits:
              memory: 512Mi
              cpu: 500m
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: openclaw-data
```

### Important Constraints

- **Single replica only**: WhatsApp and Telegram sessions are tied to one process
- **PVC access mode**: `ReadWriteOnce` (not `ReadWriteMany`)
- **Strategy**: `Recreate` to prevent two pods accessing the PVC
- **No secrets in image**: All secrets via K8s Secrets + env vars
- **Network egress**: Telegram requires HTTPS to `api.telegram.org`; WhatsApp requires Baileys WebSocket connections

## Troubleshooting

### Permission denied on `/home/node/.openclaw`

Set `fsGroup: 1000` in pod security context. For Docker Compose:

```bash
sudo chown -R 1000:1000 ~/.openclaw
```

### WhatsApp not connecting

```bash
kubectl exec deploy/openclaw-gateway -- openclaw channels status
kubectl logs deploy/openclaw-gateway -f
kubectl exec -it deploy/openclaw-gateway -- openclaw channels login
```

### Telegram not responding

```bash
kubectl exec deploy/openclaw-gateway -- openclaw channels status
kubectl logs deploy/openclaw-gateway -f
# Verify the bot token is set
kubectl exec deploy/openclaw-gateway -- env | grep TELEGRAM_BOT_TOKEN
```

### Gateway not starting

```bash
kubectl logs deploy/openclaw-gateway
# Common causes:
# - "FATAL: Cannot write to /home/node/.openclaw" → PVC permission issue
# - Config parse errors → invalid openclaw.json
```

### Multi-arch build

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t openclaw-gateway:2026.2.12 .
```

## License

This Docker packaging is provided as-is. OpenClaw itself is MIT-licensed.
