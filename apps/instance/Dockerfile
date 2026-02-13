# Use pre-built base image with Node, OpenClaw, and utilities installed
# Build base image: docker build -t pmc-base:latest ./base-image
ARG BASE_IMAGE=pmc-base:latest
FROM ${BASE_IMAGE}

# --- Build viem bundle for Monad/nad.fun skills ---
# This bundles the viem library into a single JS file that monad/nadfun scripts can require()
USER root
COPY viem-build/package.json viem-build/build.js viem-build/entry.js /tmp/viem-build/
RUN cd /tmp/viem-build && npm install --no-audit --no-fund && node build.js && rm -rf node_modules

# Copy the viem bundle into monad skill scripts directory
RUN mkdir -p /home/openclaw/.bundled-skills/monad/scripts \
    /home/openclaw/.bundled-skills/nadfun/scripts && \
    cp /tmp/viem-build/dist/viem-bundle.js /home/openclaw/.bundled-skills/monad/scripts/viem-bundle.js && \
    rm -rf /tmp/viem-build

# Copy bundled skills to a backup location (the main .openclaw dir gets bind-mounted)
# The entrypoint will copy these to the bind-mount if skills dir is empty
COPY --chown=openclaw:openclaw config/skills/ /home/openclaw/.bundled-skills/

# Copy bundled workspace files (AGENTS.md, SOUL.md, IDENTITY.md, TOOLS.md, HEARTBEAT.md, etc.)
COPY --chown=openclaw:openclaw config/workspace/ /home/openclaw/.bundled-workspace/

# Copy scripts — entrypoint runs as root, setup-and-run as openclaw
COPY entrypoint.sh /home/openclaw/entrypoint.sh
COPY setup-and-run.sh /home/openclaw/setup-and-run.sh
RUN chmod +x /home/openclaw/entrypoint.sh /home/openclaw/setup-and-run.sh

USER openclaw

# Healthcheck - verify the gateway AND Telegram API are reachable
# The gateway listens on port 18789 (loopback only)
# Check 1: Gateway is alive (local). Check 2: Telegram API is reachable (outbound internet).
# Both must pass. start-period is generous to allow gateway startup + watchdog grace period.
HEALTHCHECK --interval=30s --timeout=15s --start-period=120s --retries=3 \
  CMD (curl -sf http://localhost:18789/health || curl -sf http://localhost:18789/) && \
      curl -sf --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" > /dev/null || exit 1

ENTRYPOINT ["/home/openclaw/entrypoint.sh"]
