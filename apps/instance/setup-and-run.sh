#!/bin/bash
set -e

export HOME="/home/openclaw"
export PATH="/home/openclaw/.local/bin:/home/openclaw/.npm-global/bin:$PATH"

OPENCLAW_DIR="$HOME/.openclaw"
WALLET_FILE="$OPENCLAW_DIR/.wallet.json"
SKILLS_DIR="$OPENCLAW_DIR/skills"

echo "[pmc] Validating environment..."

# Validate required env vars
for var in OPENROUTER_API_KEY TELEGRAM_BOT_TOKEN TELEGRAM_OWNER_ID; do
    if [ -z "${!var}" ]; then
        echo "[pmc] ERROR: $var is required but not set"
        exit 1
    fi
done

# Optional: Solana RPC URL (defaults to mainnet)
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"

# Defaults
OPENCLAW_MODEL="${OPENCLAW_MODEL:-openrouter/openrouter/auto}"

# Reuse existing gateway token if present, otherwise generate a new one.
GATEWAY_TOKEN_FILE="$OPENCLAW_DIR/.gateway-token"
if [ -f "$GATEWAY_TOKEN_FILE" ]; then
    GATEWAY_TOKEN=$(cat "$GATEWAY_TOKEN_FILE")
    echo "[pmc] Reusing existing gateway token"
else
    GATEWAY_TOKEN=$(openssl rand -hex 24)
    echo "$GATEWAY_TOKEN" > "$GATEWAY_TOKEN_FILE"
    echo "[pmc] Generated new gateway token"
fi

# --- Solana Wallet Management ---
echo "[pmc] Checking Solana wallet..."

if [ -f "$WALLET_FILE" ]; then
    echo "[pmc] Loading existing Solana wallet..."
    SOLANA_PRIVATE_KEY=$(jq -r '.privateKey' "$WALLET_FILE")
    SOLANA_PUBLIC_KEY=$(jq -r '.publicKey' "$WALLET_FILE")
    echo "[pmc] Wallet loaded: $SOLANA_PUBLIC_KEY"
else
    echo "[pmc] Generating new Solana wallet..."
    
    # Use the solana-keygen.sh script to generate a new wallet
    KEYGEN_SCRIPT="$SKILLS_DIR/solana/scripts/solana-keygen.sh"
    if [ -x "$KEYGEN_SCRIPT" ]; then
        KEYGEN_RESULT=$("$KEYGEN_SCRIPT" 2>/dev/null)
        if [ -n "$KEYGEN_RESULT" ] && echo "$KEYGEN_RESULT" | jq -e '.publicKey' >/dev/null 2>&1; then
            SOLANA_PUBLIC_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.publicKey')
            SOLANA_PRIVATE_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.privateKey')
            
            # Save wallet to persistent storage
            echo "$KEYGEN_RESULT" > "$WALLET_FILE"
            chmod 600 "$WALLET_FILE"
            echo "[pmc] New wallet generated and saved: $SOLANA_PUBLIC_KEY"
        else
            echo "[pmc] ERROR: Failed to generate Solana wallet"
            exit 1
        fi
    else
        # Fallback: generate inline with Node.js
        echo "[pmc] Using inline wallet generation..."
        KEYGEN_RESULT=$(node -e "
const crypto = require('crypto');
const { Buffer } = require('buffer');

// Generate Ed25519 keypair
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

// Export raw keys
const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
const privRaw = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);

// Solana private key format: 64 bytes = private (32) + public (32)
const fullPrivate = Buffer.concat([privRaw, pubRaw]);

// Base58 encode
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function toBase58(buf) {
    let num = BigInt('0x' + buf.toString('hex'));
    let result = '';
    while (num > 0n) {
        result = ALPHABET[Number(num % 58n)] + result;
        num = num / 58n;
    }
    for (let i = 0; i < buf.length && buf[i] === 0; i++) {
        result = '1' + result;
    }
    return result || '1';
}

console.log(JSON.stringify({
    publicKey: toBase58(pubRaw),
    privateKey: toBase58(fullPrivate)
}));
" 2>/dev/null)
        
        if [ -n "$KEYGEN_RESULT" ]; then
            SOLANA_PUBLIC_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.publicKey')
            SOLANA_PRIVATE_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.privateKey')
            echo "$KEYGEN_RESULT" > "$WALLET_FILE"
            chmod 600 "$WALLET_FILE"
            echo "[pmc] New wallet generated: $SOLANA_PUBLIC_KEY"
        else
            echo "[pmc] ERROR: Failed to generate wallet"
            exit 1
        fi
    fi
fi

# Export for skills to use
export SOLANA_PRIVATE_KEY
export SOLANA_PUBLIC_KEY
export SOLANA_RPC_URL

echo "[pmc] Writing openclaw.json config..."
echo "[pmc] Model: ${OPENCLAW_MODEL}"
echo "[pmc] Telegram owner: ${TELEGRAM_OWNER_ID}"
echo "[pmc] Solana wallet: ${SOLANA_PUBLIC_KEY}"

# Use jq to safely construct JSON (prevents injection attacks via env vars)
# Note: dmPolicy "allowlist" + allowFrom allows immediate DM access without pairing
jq -n \
  --arg openrouter_key "$OPENROUTER_API_KEY" \
  --arg model "$OPENCLAW_MODEL" \
  --arg workspace "$OPENCLAW_DIR/workspace" \
  --arg bot_token "$TELEGRAM_BOT_TOKEN" \
  --arg owner_id "$TELEGRAM_OWNER_ID" \
  --arg gateway_token "$GATEWAY_TOKEN" \
  --arg solana_privkey "$SOLANA_PRIVATE_KEY" \
  --arg solana_pubkey "$SOLANA_PUBLIC_KEY" \
  --arg solana_rpc "$SOLANA_RPC_URL" \
  '{
    env: {
      OPENROUTER_API_KEY: $openrouter_key,
      SOLANA_PRIVATE_KEY: $solana_privkey,
      SOLANA_PUBLIC_KEY: $solana_pubkey,
      SOLANA_RPC_URL: $solana_rpc
    },
    auth: {
      profiles: {
        "openrouter:default": {
          provider: "openrouter",
          mode: "api_key"
        }
      }
    },
    agents: {
      defaults: {
        model: { primary: $model },
        models: { ($model): {} },
        workspace: $workspace,
        compaction: { mode: "safeguard" },
        maxConcurrent: 4,
        typingMode: "instant",
        typingIntervalSeconds: 4,
        heartbeat: {
          every: "30s",
          target: "telegram",
          activeHours: { start: "00:00", end: "24:00" }
        }
      }
    },
    channels: {
      telegram: {
        enabled: true,
        botToken: $bot_token,
        dmPolicy: "allowlist",
        allowFrom: [$owner_id],
        groupPolicy: "disabled",
        streamMode: "partial",
        reactionLevel: "minimal"
      }
    },
    commands: {
      native: true
    },
    messages: {
      ackReaction: "👀",
      ackReactionScope: "all",
      removeAckAfterReply: true
    },
    gateway: {
      port: 18789,
      mode: "local",
      bind: "loopback",
      auth: { mode: "token", token: $gateway_token }
    },
    skills: {
      install: { nodeManager: "npm" },
      entries: {
        solana: {
          enabled: true,
          env: {
            SOLANA_PRIVATE_KEY: $solana_privkey,
            SOLANA_PUBLIC_KEY: $solana_pubkey,
            SOLANA_RPC_URL: $solana_rpc
          }
        },
        pumpfun: {
          enabled: true,
          env: {
            SOLANA_PRIVATE_KEY: $solana_privkey,
            SOLANA_PUBLIC_KEY: $solana_pubkey,
            SOLANA_RPC_URL: $solana_rpc
          }
        }
      }
    },
    plugins: {
      entries: {
        telegram: { enabled: true }
      }
    }
  }' > "$OPENCLAW_DIR/openclaw.json"

# Write .env file for skills
cat > "$OPENCLAW_DIR/.env" << EOF
OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
SOLANA_PRIVATE_KEY=${SOLANA_PRIVATE_KEY}
SOLANA_PUBLIC_KEY=${SOLANA_PUBLIC_KEY}
SOLANA_RPC_URL=${SOLANA_RPC_URL}
EOF

echo "[pmc] Configuration written to $OPENCLAW_DIR/openclaw.json"

# Create skill config files with wallet credentials
for skill in solana pumpfun; do
    SKILL_DIR="$SKILLS_DIR/$skill"
    if [ -d "$SKILL_DIR" ]; then
        echo "[pmc] Configuring $skill skill..."
        jq -n \
          --arg privkey "$SOLANA_PRIVATE_KEY" \
          --arg pubkey "$SOLANA_PUBLIC_KEY" \
          --arg rpc "$SOLANA_RPC_URL" \
          '{
            privateKey: $privkey,
            publicKey: $pubkey,
            rpcUrl: $rpc
          }' > "$SKILL_DIR/config.json"
    fi
done

# Fetch bot username from Telegram API and inject into IDENTITY.md
echo "[pmc] Fetching bot username from Telegram..."
BOT_USERNAME=""
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
    BOT_INFO=$(curl -sf "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" 2>/dev/null || echo "")
    if [ -n "$BOT_INFO" ]; then
        BOT_USERNAME=$(echo "$BOT_INFO" | jq -r '.result.username // empty')
        if [ -n "$BOT_USERNAME" ]; then
            echo "[pmc] Bot username: @$BOT_USERNAME"
        fi
    fi
fi

# Inject wallet address and bot username into IDENTITY.md
IDENTITY_FILE="$OPENCLAW_DIR/workspace/IDENTITY.md"
if [ -f "$IDENTITY_FILE" ] && ! grep -q "WALLET_INJECTED" "$IDENTITY_FILE"; then
    TOKEN_NAME=$(echo "$BOT_USERNAME" | sed 's/_bot$//' | sed 's/^@//' | tr '[:lower:]' '[:upper:]')
    cat >> "$IDENTITY_FILE" << WALLET_EOF

<!-- WALLET_INJECTED -->
## My Wallet

**My Solana wallet address: \`${SOLANA_PUBLIC_KEY}\`**

This is MY wallet. I control the private key. Fund this address to enable trading.

## My Bot Identity

**My Telegram bot username: @${BOT_USERNAME}**

When creating my token, I'll use the name: **${TOKEN_NAME}**
WALLET_EOF
    echo "[pmc] Wallet address added to IDENTITY.md"
fi

# No JWT authentication needed - using PumpPortal Local Transaction API
echo "[pmc] Using PumpPortal for pump.fun operations (no JWT needed)"

# Run doctor --fix to apply any needed changes (creates session dirs, fixes permissions)
echo "[pmc] Running openclaw doctor --fix..."
openclaw doctor --fix --yes 2>&1 || true

# --- Connection Recovery Watchdog ---
# Instead of `exec openclaw gateway`, we run the gateway in the background
# and monitor both the process and Telegram API connectivity.
# If the gateway dies or Telegram becomes unreachable for too long, we restart it.

WATCHDOG_CHECK_INTERVAL=30   # seconds between health checks
WATCHDOG_FAIL_THRESHOLD=5    # consecutive failures before restart
WATCHDOG_STARTUP_GRACE=60    # seconds to wait before first health check
GATEWAY_PID=0
FAIL_COUNT=0

cleanup() {
    echo "[watchdog] Received shutdown signal, stopping gateway..."
    if [ $GATEWAY_PID -ne 0 ] && kill -0 $GATEWAY_PID 2>/dev/null; then
        kill -TERM $GATEWAY_PID
        wait $GATEWAY_PID 2>/dev/null
    fi
    exit 0
}

trap cleanup SIGTERM SIGINT

start_gateway() {
    echo "[watchdog] Starting openclaw gateway..."
    openclaw gateway &
    GATEWAY_PID=$!
    FAIL_COUNT=0
    echo "[watchdog] Gateway started (PID: $GATEWAY_PID)"
}

check_health() {
    # Check 1: Is the gateway process alive?
    if ! kill -0 $GATEWAY_PID 2>/dev/null; then
        echo "[watchdog] Gateway process (PID: $GATEWAY_PID) is dead"
        return 1
    fi

    # Check 2: Can we reach the gateway's local health endpoint?
    if ! curl -sf --max-time 5 http://localhost:18789/health >/dev/null 2>&1; then
        if ! curl -sf --max-time 5 http://localhost:18789/ >/dev/null 2>&1; then
            echo "[watchdog] Gateway health endpoint unreachable"
            return 1
        fi
    fi

    # Check 3: Can we reach the Telegram API? (verifies outbound internet)
    if ! curl -sf --max-time 10 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" >/dev/null 2>&1; then
        echo "[watchdog] Telegram API unreachable"
        return 1
    fi

    return 0
}

restart_gateway() {
    echo "[watchdog] Restarting gateway (fail count was: $FAIL_COUNT)..."
    
    # Kill the old process if it's still running
    if kill -0 $GATEWAY_PID 2>/dev/null; then
        echo "[watchdog] Killing old gateway (PID: $GATEWAY_PID)..."
        kill -TERM $GATEWAY_PID 2>/dev/null
        # Give it a few seconds to shut down gracefully
        for i in $(seq 1 5); do
            if ! kill -0 $GATEWAY_PID 2>/dev/null; then
                break
            fi
            sleep 1
        done
        # Force kill if still alive
        if kill -0 $GATEWAY_PID 2>/dev/null; then
            echo "[watchdog] Force killing gateway..."
            kill -9 $GATEWAY_PID 2>/dev/null
        fi
        wait $GATEWAY_PID 2>/dev/null
    fi

    # Brief pause before restart
    sleep 2
    start_gateway
}

# Start the gateway for the first time
echo "[pmc] Starting openclaw gateway with connection recovery watchdog..."
start_gateway

# Wait for the startup grace period before monitoring
echo "[watchdog] Waiting ${WATCHDOG_STARTUP_GRACE}s startup grace period..."
sleep $WATCHDOG_STARTUP_GRACE

# Main watchdog loop
echo "[watchdog] Health monitoring active (check every ${WATCHDOG_CHECK_INTERVAL}s, restart after ${WATCHDOG_FAIL_THRESHOLD} failures)"
while true; do
    # Check if gateway exited on its own (crash)
    if ! kill -0 $GATEWAY_PID 2>/dev/null; then
        WAIT_STATUS=0
        wait $GATEWAY_PID 2>/dev/null || WAIT_STATUS=$?
        echo "[watchdog] Gateway exited unexpectedly (exit code: $WAIT_STATUS)"
        sleep 5
        start_gateway
        echo "[watchdog] Waiting ${WATCHDOG_STARTUP_GRACE}s for gateway to initialize..."
        sleep $WATCHDOG_STARTUP_GRACE
        continue
    fi

    if check_health; then
        if [ $FAIL_COUNT -gt 0 ]; then
            echo "[watchdog] Health restored after $FAIL_COUNT failure(s)"
        fi
        FAIL_COUNT=0
    else
        FAIL_COUNT=$((FAIL_COUNT + 1))
        echo "[watchdog] Health check failed ($FAIL_COUNT/$WATCHDOG_FAIL_THRESHOLD)"
        
        if [ $FAIL_COUNT -ge $WATCHDOG_FAIL_THRESHOLD ]; then
            restart_gateway
            echo "[watchdog] Waiting ${WATCHDOG_STARTUP_GRACE}s for gateway to initialize..."
            sleep $WATCHDOG_STARTUP_GRACE
            continue
        fi
    fi

    sleep $WATCHDOG_CHECK_INTERVAL
done
