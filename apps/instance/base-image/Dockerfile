FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git jq openssl gosu \
    bc python3 \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash openclaw

# Install as openclaw user
USER openclaw
WORKDIR /home/openclaw

# Install openclaw
RUN curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard

# Create required directories
RUN mkdir -p /home/openclaw/.openclaw/workspace \
    /home/openclaw/.openclaw/skills

ENV HOME=/home/openclaw
ENV PATH="/home/openclaw/.local/bin:/home/openclaw/.npm-global/bin:$PATH"

USER root
