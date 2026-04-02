# =============================================================================
# OpenClaw Gateway — Clawra Template Image
# =============================================================================
#
# Extends the base OpenClaw Gateway image with the Clawra selfie skill
# pre-installed and configured. Uses xAI Grok Imagine via fal.ai for
# AI-powered selfie generation across messaging platforms.
#
# Build:
#   docker build \
#     --build-arg BASE_TAG=2026.3.2-p1 \
#     -t openclaw-gateway-clawra:2026.3.2-p1 .
#
# Requires at runtime:
#   FAL_KEY — fal.ai API key (injected by platform credential system)
#
# =============================================================================

ARG BASE_IMAGE=europe-west1-docker.pkg.dev/jinko-agent/agent-docker-repo/openclaw-gateway
ARG BASE_TAG=2026.3.2-p1

# ---------------------------------------------------------------------------
# Stage 1: Clone the Clawra skill repo (needs git)
# ---------------------------------------------------------------------------
FROM alpine/git:latest AS skill-fetcher

ARG CLAWRA_VERSION=main

RUN git clone --depth 1 --branch "${CLAWRA_VERSION}" \
    https://github.com/SumeLabs/clawra.git /tmp/clawra

# ---------------------------------------------------------------------------
# Stage 2: Production image — base gateway + Clawra skill
# ---------------------------------------------------------------------------
FROM ${BASE_IMAGE}:${BASE_TAG}

LABEL org.opencontainers.image.title="openclaw-gateway-clawra"
LABEL org.opencontainers.image.description="OpenClaw Gateway with Clawra selfie skill pre-installed"

# Switch to root for package installation
USER root

# Install jq — required by Clawra's bash scripts for JSON payload construction
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      jq \
    && rm -rf /var/lib/apt/lists/*

# Copy the Clawra skill into a staging directory OUTSIDE the PVC mount.
# At runtime, /home/node/.openclaw is a PVC — files baked into that path
# at build time are hidden by the volume overlay. The entrypoint wrapper
# copies staged skills into the PVC on every boot.
COPY --from=skill-fetcher --chown=node:node \
    /tmp/clawra/skill/ /opt/clawra-skills/clawra-selfie/skill/
COPY --from=skill-fetcher --chown=node:node \
    /tmp/clawra/scripts/ /opt/clawra-skills/clawra-selfie/scripts/
COPY --from=skill-fetcher --chown=node:node \
    /tmp/clawra/SKILL.md /opt/clawra-skills/clawra-selfie/SKILL.md

# Make scripts executable
RUN find /opt/clawra-skills/clawra-selfie/scripts/ -name "*.sh" -exec chmod +x {} + 2>/dev/null || true

# Install the entrypoint wrapper that seeds skills before starting gateway
COPY --chown=root:root clawra-entrypoint.sh /usr/local/bin/clawra-entrypoint.sh
RUN chmod +x /usr/local/bin/clawra-entrypoint.sh

# Drop back to non-root
USER node

ENTRYPOINT ["clawra-entrypoint.sh"]
CMD ["gateway"]
