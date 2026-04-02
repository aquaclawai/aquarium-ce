# =============================================================================
# OpenClaw Gateway — Kubernetes-Ready Docker Image
# =============================================================================
#
# Extends the official alpine/openclaw image with platform-specific
# customizations: platform-bridge plugin, custom entrypoint for PVC/K8s,
# workspace templates, and pre-installed skills.
#
# Build:
#   docker build -t aquaclaw/openclaw:2026.3.28 .
#
# Run:
#   docker run -d \
#     -p 18789:18789 -p 18790:18790 \
#     -v openclaw-data:/home/node/.openclaw \
#     -e OPENCLAW_GATEWAY_TOKEN=<token> \
#     aquaclaw/openclaw:2026.3.28
#
# =============================================================================

ARG OPENCLAW_VERSION=2026.3.28

FROM alpine/openclaw:${OPENCLAW_VERSION}

# Re-declare ARG after FROM so it's available in this stage
ARG OPENCLAW_VERSION=2026.3.28

USER root

LABEL maintainer="citronetic"
LABEL org.opencontainers.image.title="aquaclaw/openclaw"
LABEL org.opencontainers.image.description="OpenClaw Gateway with platform-bridge plugin, WhatsApp and Telegram channel support"
LABEL org.opencontainers.image.version="${OPENCLAW_VERSION}"
LABEL org.opencontainers.image.source="https://github.com/citronetic/aquarium"

# Additional runtime dependencies not in the base image:
#   - tini: PID 1 init for proper signal forwarding
#   - gosu: drop privileges from root to node for K8s permission fixes
#   - python3, python3-pip: Python runtime for user-installed libraries via chat
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      tini \
      gosu \
      python3 \
      python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Create the data directory structure that will be mounted as a PVC.
# In Kubernetes, /home/node/.openclaw is the PVC mount point.
# The image must not fail if this directory is empty on first boot.
RUN mkdir -p /home/node/.openclaw/credentials \
             /home/node/.openclaw/workspace \
             /home/node/.openclaw/agents \
             /home/node/.openclaw/npm-global/lib \
             /home/node/.openclaw/python-user \
             /app/docs/reference/templates && \
    chown -R node:node /home/node/.openclaw

# Copy workspace initialization templates
COPY docker/templates/*.md /app/docs/reference/templates/

# Fix template file permissions
RUN chmod -R a+r /app/docs/reference/templates/

COPY --chown=node:node plugin/ /opt/openclaw-plugins/platform-bridge/

# Pre-install openpyxl for Excel skill (available when user installs the skill at runtime)
RUN pip3 install --break-system-packages openpyxl && \
    rm -rf /root/.cache/pip

# Copy entrypoint script
COPY docker/base/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

# ---------------------------------------------------------------------------
# Runtime configuration
# ---------------------------------------------------------------------------

# Gateway networking
# OPENCLAW_GATEWAY_BIND accepts: loopback | lan | tailnet | auto | custom
# "lan" binds to 0.0.0.0 — required for Docker/Kubernetes port forwarding.
ENV OPENCLAW_GATEWAY_BIND="lan" \
    OPENCLAW_GATEWAY_PORT="18789" \
    OPENCLAW_BRIDGE_PORT="18790"

# Home directory for the node user (OpenClaw reads config from $HOME/.openclaw)
ENV HOME="/home/node"

# Node.js production mode
ENV NODE_ENV="production"

# User-installed library paths (PVC-backed for persistence across restarts).
# NPM_CONFIG_PREFIX redirects `npm install -g` away from /usr/local (image layer)
# into the PVC so user packages survive container recreation.
# PYTHONUSERBASE + PIP_USER=1 does the same for `pip install`.
# OpenClaw's own packages stay at /usr/local/lib/node_modules (immutable image layer).
ENV NPM_CONFIG_PREFIX="/home/node/.openclaw/npm-global" \
    PYTHONUSERBASE="/home/node/.openclaw/python-user" \
    PIP_USER="1"

ENV PATH="/home/node/.openclaw/npm-global/bin:/home/node/.openclaw/python-user/bin:${PATH}" \
    NODE_PATH="/home/node/.openclaw/npm-global/lib/node_modules"

# Expose gateway and bridge ports
EXPOSE 18789 18790

# Persistent data volume
VOLUME ["/home/node/.openclaw"]

# Use tini as PID 1 for proper signal handling.
# This ensures SIGTERM from Kubernetes is forwarded correctly to the gateway.
ENTRYPOINT ["tini", "--", "docker-entrypoint.sh"]

# Default command: start the gateway.
# Override with "openclaw channels login" for WhatsApp QR auth.
CMD ["gateway"]

# Run as non-root by default.
# The entrypoint handles permission fixes if running as root, then drops to node.
USER node
