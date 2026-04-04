#!/bin/sh
set -e

# docker-entrypoint.sh — CE platform entrypoint for alpine/openclaw image.
# Handles first-boot setup (dirs, permissions, default config) and injects
# the platform-bridge plugin path. The gateway's native bind:lan handles
# network accessibility — no proxy injection needed.

OPENCLAW_HOME="${HOME}/.openclaw"
OPENCLAW_CONFIG="${OPENCLAW_HOME}/openclaw.json"

# -----------------------------------------------------------------------
# Permission fix: if running as root (e.g., K8s without securityContext),
# fix ownership of the data directory and re-exec as the node user.
# When K8s sets runAsUser:1000 + fsGroup:1000, this block is skipped.
# -----------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "${OPENCLAW_HOME}" 2>/dev/null || true
  exec gosu node "$0" "$@"
fi

# -----------------------------------------------------------------------
# Ensure data directory structure exists.
# On first boot with an empty PVC, these directories must be created.
# -----------------------------------------------------------------------
mkdir -p "${OPENCLAW_HOME}/credentials" \
         "${OPENCLAW_HOME}/workspace" \
         "${OPENCLAW_HOME}/agents" \
         "${OPENCLAW_HOME}/npm-global/lib" \
         "${OPENCLAW_HOME}/python-user" 2>/dev/null || true

# -----------------------------------------------------------------------
# Validate write permissions on the data directory.
# Fail fast with a clear error rather than obscure runtime failures.
# -----------------------------------------------------------------------
if ! touch "${OPENCLAW_HOME}/.write-test" 2>/dev/null; then
  echo "FATAL: Cannot write to ${OPENCLAW_HOME}" >&2
  echo "Ensure the PVC is mounted with correct permissions (uid=1000, gid=1000)." >&2
  echo "In Kubernetes, set securityContext.fsGroup: 1000" >&2
  exit 1
fi
rm -f "${OPENCLAW_HOME}/.write-test"

# -----------------------------------------------------------------------
# Generate default config if none exists.
# The gateway needs at minimum a valid JSON config to start.
# -----------------------------------------------------------------------
if [ ! -f "${OPENCLAW_CONFIG}" ]; then
  cat > "${OPENCLAW_CONFIG}" <<'DEFAULTCFG'
{
  "plugins": {
    "entries": {
      "whatsapp": { "enabled": true },
      "telegram": { "enabled": true }
    },
    "load": {
      "paths": ["/opt/openclaw-plugins/platform-bridge"]
    }
  }
}
DEFAULTCFG
  echo "INFO: Created default ${OPENCLAW_CONFIG} with WhatsApp, Telegram, and platform-bridge plugin enabled (first boot)"
fi

PLUGIN_PATH="/opt/openclaw-plugins/platform-bridge"
if ! grep -q "${PLUGIN_PATH}" "${OPENCLAW_CONFIG}" 2>/dev/null; then
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('${OPENCLAW_CONFIG}', 'utf8'));
    if (!cfg.plugins) cfg.plugins = {};
    if (!cfg.plugins.load) cfg.plugins.load = {};
    if (!Array.isArray(cfg.plugins.load.paths)) cfg.plugins.load.paths = [];
    if (!cfg.plugins.load.paths.includes('${PLUGIN_PATH}')) {
      cfg.plugins.load.paths.push('${PLUGIN_PATH}');
      fs.writeFileSync('${OPENCLAW_CONFIG}', JSON.stringify(cfg, null, 2) + '\n');
    }
  " 2>/dev/null && echo "INFO: Added platform-bridge plugin to config" || true
fi

# -----------------------------------------------------------------------
# Route to the requested command
# -----------------------------------------------------------------------
case "${1}" in
  gateway)
    shift
    echo "INFO: Starting OpenClaw Gateway (bind=${OPENCLAW_GATEWAY_BIND:-lan}, port=${OPENCLAW_GATEWAY_PORT:-18789})"
    exec openclaw gateway \
      --bind "${OPENCLAW_GATEWAY_BIND:-lan}" \
      --port "${OPENCLAW_GATEWAY_PORT:-18789}" \
      --allow-unconfigured \
      "$@"
    ;;
  login)
    shift
    # Workaround: openclaw CLI bug — `channels` lazy loader doesn't init plugin
    # registry, so normalizeAnyChannelId("whatsapp") fails on empty registry.
    # Always pass --channel explicitly. See: src/cli/program/register.subclis.ts
    CHANNEL="whatsapp"
    if [ $# -gt 0 ]; then
      case "${1}" in
        -*) ;;
        *)  CHANNEL="${1}"; shift ;;
      esac
    fi
    echo "INFO: Starting channel login (channel: ${CHANNEL})"
    exec openclaw channels login --channel "${CHANNEL}" "$@"
    ;;
  health)
    shift
    exec openclaw doctor "$@"
    ;;
  shell)
    exec /bin/sh
    ;;
  *)
    exec openclaw "$@"
    ;;
esac
