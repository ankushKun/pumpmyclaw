#!/bin/bash
set -e

OPENCLAW_DIR="/home/openclaw/.openclaw"
BUNDLED_SKILLS="/home/openclaw/.bundled-skills"
BUNDLED_WORKSPACE="/home/openclaw/.bundled-workspace"

# ── Fix bind-mount permissions ──────────────────────────────────────
mkdir -p "$OPENCLAW_DIR/workspace" \
         "$OPENCLAW_DIR/skills" \
         "$OPENCLAW_DIR/agents" \
         "$OPENCLAW_DIR/credentials"

# ── Always sync bundled skills (overwrite with latest from image) ────
# The .openclaw dir is bind-mounted from host. We always copy the latest
# skills from the image to ensure updates are applied on restart.
if [ -d "$BUNDLED_SKILLS" ] && [ "$(ls -A "$BUNDLED_SKILLS" 2>/dev/null)" ]; then
    for skill_dir in "$BUNDLED_SKILLS"/*/; do
        [ -d "$skill_dir" ] || continue
        skill_name=$(basename "$skill_dir")
        target_dir="$OPENCLAW_DIR/skills/$skill_name"
        echo "[pmc] Syncing skill: $skill_name"
        rm -rf "$target_dir"
        cp -r "$skill_dir" "$target_dir"
    done
fi

# ── Sync bundled workspace files ─────────────────────────────────────
# Always update instruction files (HEARTBEAT, IDENTITY, SOUL).
# Preserve MY_TOKEN.md if it has real data (not just PENDING).
if [ -d "$BUNDLED_WORKSPACE" ] && [ "$(ls -A "$BUNDLED_WORKSPACE" 2>/dev/null)" ]; then
    for file in "$BUNDLED_WORKSPACE"/*; do
        [ -f "$file" ] || continue
        filename=$(basename "$file")
        target="$OPENCLAW_DIR/workspace/$filename"
        
        # Skip TRADES.json if it exists and has data (preserve trade history)
        if [ "$filename" = "TRADES.json" ] && [ -f "$target" ]; then
            TRADE_COUNT=$(jq -r '.trades | length' "$target" 2>/dev/null || echo "0")
            if [ "$TRADE_COUNT" != "0" ] && [ "$TRADE_COUNT" != "null" ]; then
                echo "[pmc] Preserving $filename ($TRADE_COUNT trades recorded)"
                continue
            fi
        fi
        
        # Skip MY_TOKEN.md if it exists and has a real token address
        if [ "$filename" = "MY_TOKEN.md" ] && [ -f "$target" ]; then
            TOKEN_ADDR=$(grep -oP 'TOKEN_ADDRESS:\s*\K\S+' "$target" 2>/dev/null || echo "PENDING")
            ADDR_LEN=${#TOKEN_ADDR}
            if [ "$TOKEN_ADDR" != "PENDING" ] && [ "$ADDR_LEN" -ge 32 ] && [ "$ADDR_LEN" -le 44 ]; then
                # Token address looks valid — preserve the file.
                # We skip on-chain verification here because RPC may not be
                # reachable during early container startup (network not ready,
                # rate limits, etc.) and a failed check would wrongly wipe the
                # token data. The bot verifies on-chain state at runtime anyway.
                echo "[pmc] Preserving $filename (token address: $TOKEN_ADDR)"
                continue
            fi
        fi
        
        echo "[pmc] Syncing workspace file: $filename"
        cp "$file" "$target"
    done
fi

# ── Symlink skill scripts into workspace ─────────────────────────────
# Weak LLMs often prepend "./" to commands, which bypasses PATH and looks
# in the cwd (workspace dir). Symlinks ensure scripts work either way.
for scripts_dir in "$OPENCLAW_DIR"/skills/*/scripts; do
    [ -d "$scripts_dir" ] || continue
    for script in "$scripts_dir"/*; do
        [ -f "$script" ] || continue
        script_name=$(basename "$script")
        ln -sf "$script" "$OPENCLAW_DIR/workspace/$script_name" 2>/dev/null || true
    done
done

chown -R openclaw:openclaw "$OPENCLAW_DIR"

# ── Run as openclaw user ────────────────────────────────────────────
exec gosu openclaw /home/openclaw/setup-and-run.sh
