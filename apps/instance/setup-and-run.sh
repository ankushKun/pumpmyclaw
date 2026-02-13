#!/bin/bash
set -e

export HOME="/home/openclaw"
export PATH="/home/openclaw/.local/bin:/home/openclaw/.npm-global/bin:$PATH"

OPENCLAW_DIR="$HOME/.openclaw"
WALLET_FILE="$OPENCLAW_DIR/.wallet.json"
EVM_WALLET_FILE="$OPENCLAW_DIR/.evm-wallet.json"
SKILLS_DIR="$OPENCLAW_DIR/skills"

# Add skill script directories to PATH so LLMs can call scripts by short name
# (e.g. "solana-balance.sh" instead of full path)
export PATH="$SKILLS_DIR/solana/scripts:$SKILLS_DIR/pumpfun/scripts:$SKILLS_DIR/pumpmyclaw/scripts:$SKILLS_DIR/monad/scripts:$SKILLS_DIR/nadfun/scripts:$PATH"

echo "[pmc] Validating environment..."

# LLM_PROVIDER: "openrouter" (default) or "openai-codex"
LLM_PROVIDER="${LLM_PROVIDER:-openrouter}"
echo "[pmc] LLM provider: ${LLM_PROVIDER}"

# Validate required env vars (common)
for var in TELEGRAM_BOT_TOKEN TELEGRAM_OWNER_ID; do
    if [ -z "${!var}" ]; then
        echo "[pmc] ERROR: $var is required but not set"
        exit 1
    fi
done

# Provider-specific validation
if [ "$LLM_PROVIDER" = "openai-codex" ]; then
    if [ -z "${OPENAI_ACCESS_TOKEN:-}" ]; then
        echo "[pmc] ERROR: OPENAI_ACCESS_TOKEN is required for openai-codex provider"
        exit 1
    fi
    # OpenRouter key may be empty for OpenAI-only setups
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
elif [ "$LLM_PROVIDER" = "anthropic" ]; then
    if [ -z "${ANTHROPIC_SETUP_TOKEN:-}" ]; then
        echo "[pmc] ERROR: ANTHROPIC_SETUP_TOKEN is required for anthropic provider"
        exit 1
    fi
    # OpenRouter key may be empty for Anthropic-only setups
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
else
    if [ -z "${OPENROUTER_API_KEY:-}" ]; then
        echo "[pmc] ERROR: OPENROUTER_API_KEY is required for openrouter provider"
        exit 1
    fi
fi

# Optional: Solana RPC URL (defaults to mainnet)
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.mainnet-beta.solana.com}"

# Optional: Monad testnet toggle (set MONAD_TESTNET=true to use testnet)
MONAD_TESTNET="${MONAD_TESTNET:-false}"

# Optional: Monad RPC URL (defaults based on MONAD_TESTNET)
if [ "$MONAD_TESTNET" = "true" ]; then
  MONAD_RPC_URL="${MONAD_RPC_URL:-https://monad-testnet.drpc.org}"
  echo "[pmc] Monad network: TESTNET (chain 10143)"
else
  MONAD_RPC_URL="${MONAD_RPC_URL:-https://monad-mainnet.drpc.org}"
fi

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

# --- Monad (EVM) Wallet Management ---
echo "[pmc] Checking Monad wallet..."

if [ -f "$EVM_WALLET_FILE" ]; then
    echo "[pmc] Loading existing Monad wallet..."
    MONAD_PRIVATE_KEY=$(jq -r '.privateKey' "$EVM_WALLET_FILE")
    MONAD_ADDRESS=$(jq -r '.address' "$EVM_WALLET_FILE")
    echo "[pmc] Monad wallet loaded: $MONAD_ADDRESS"
else
    echo "[pmc] Generating new Monad wallet..."

    # Use the monad-keygen.js script to generate a new EVM wallet
    KEYGEN_SCRIPT="$SKILLS_DIR/monad/scripts/monad-keygen.js"
    if [ -x "$KEYGEN_SCRIPT" ]; then
        KEYGEN_RESULT=$("$KEYGEN_SCRIPT" 2>/dev/null)
        if [ -n "$KEYGEN_RESULT" ] && echo "$KEYGEN_RESULT" | jq -e '.address' >/dev/null 2>&1; then
            MONAD_ADDRESS=$(echo "$KEYGEN_RESULT" | jq -r '.address')
            MONAD_PRIVATE_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.privateKey')

            # Save wallet to persistent storage
            echo "$KEYGEN_RESULT" > "$EVM_WALLET_FILE"
            chmod 600 "$EVM_WALLET_FILE"
            echo "[pmc] New Monad wallet generated and saved: $MONAD_ADDRESS"
        else
            echo "[pmc] ERROR: Failed to generate Monad wallet via keygen script"
            exit 1
        fi
    else
        # Fallback: generate inline with Node.js using viem bundle
        echo "[pmc] Using inline Monad wallet generation..."
        VIEM_BUNDLE="$SKILLS_DIR/monad/scripts/viem-bundle.js"
        if [ -f "$VIEM_BUNDLE" ]; then
            KEYGEN_RESULT=$(node -e "
const v = require('$VIEM_BUNDLE');
const key = v.generatePrivateKey();
const acc = v.privateKeyToAccount(key);
console.log(JSON.stringify({ address: acc.address, privateKey: key }));
" 2>/dev/null)
        else
            # Ultra-fallback: use Node.js crypto for secp256k1
            KEYGEN_RESULT=$(node -e "
const crypto = require('crypto');
const privKey = '0x' + crypto.randomBytes(32).toString('hex');
// Cannot derive address without keccak256 — just store the key
// Address will be derived on first use by viem
console.log(JSON.stringify({ address: 'PENDING_DERIVATION', privateKey: privKey }));
" 2>/dev/null)
        fi

        if [ -n "$KEYGEN_RESULT" ]; then
            MONAD_ADDRESS=$(echo "$KEYGEN_RESULT" | jq -r '.address')
            MONAD_PRIVATE_KEY=$(echo "$KEYGEN_RESULT" | jq -r '.privateKey')
            echo "$KEYGEN_RESULT" > "$EVM_WALLET_FILE"
            chmod 600 "$EVM_WALLET_FILE"
            echo "[pmc] New Monad wallet generated: $MONAD_ADDRESS"
        else
            echo "[pmc] ERROR: Failed to generate Monad wallet"
            exit 1
        fi
    fi
fi

# Export Monad env vars for skills
export MONAD_PRIVATE_KEY
export MONAD_ADDRESS
export MONAD_RPC_URL
export MONAD_TESTNET

# Load nad.fun API key if previously generated
NADFUN_CONFIG="$OPENCLAW_DIR/.nadfun-config.json"
if [ -f "$NADFUN_CONFIG" ]; then
    NAD_API_KEY=$(jq -r '.apiKey // empty' "$NADFUN_CONFIG" 2>/dev/null || echo "")
    if [ -n "$NAD_API_KEY" ]; then
        export NAD_API_KEY
        echo "[pmc] Loaded nad.fun API key"
    fi
fi

echo "[pmc] Writing openclaw.json config..."
echo "[pmc] Model: ${OPENCLAW_MODEL}"
echo "[pmc] Telegram owner: ${TELEGRAM_OWNER_ID}"
echo "[pmc] Solana wallet: ${SOLANA_PUBLIC_KEY}"
echo "[pmc] Monad wallet: ${MONAD_ADDRESS}"

# Build auth profiles + env section based on provider
# For openai-codex and anthropic, auth is handled via auth-profiles.json (written below).
# No auth.profiles metadata needed in openclaw.json — OpenClaw discovers
# profiles from auth-profiles.json automatically.
if [ "$LLM_PROVIDER" = "openai-codex" ]; then
    AUTH_PROFILES='{}'
    ENV_EXTRAS='{}'
elif [ "$LLM_PROVIDER" = "anthropic" ]; then
    AUTH_PROFILES='{}'
    ENV_EXTRAS='{}'
else
    AUTH_PROFILES='{ "openrouter:default": { "provider": "openrouter", "mode": "api_key" } }'
    ENV_EXTRAS="{\"OPENROUTER_API_KEY\": \"$OPENROUTER_API_KEY\"}"
fi

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
  --arg monad_privkey "$MONAD_PRIVATE_KEY" \
  --arg monad_addr "$MONAD_ADDRESS" \
  --arg monad_rpc "$MONAD_RPC_URL" \
  --arg monad_testnet "$MONAD_TESTNET" \
  --arg nad_api_key "${NAD_API_KEY:-}" \
  --arg skills_path "$SKILLS_DIR/solana/scripts:$SKILLS_DIR/pumpfun/scripts:$SKILLS_DIR/pumpmyclaw/scripts:$SKILLS_DIR/monad/scripts:$SKILLS_DIR/nadfun/scripts" \
  --argjson auth_profiles "$AUTH_PROFILES" \
  '{
    env: {
      OPENROUTER_API_KEY: $openrouter_key,
      SOLANA_PRIVATE_KEY: $solana_privkey,
      SOLANA_PUBLIC_KEY: $solana_pubkey,
      SOLANA_RPC_URL: $solana_rpc,
      MONAD_PRIVATE_KEY: $monad_privkey,
      MONAD_ADDRESS: $monad_addr,
      MONAD_RPC_URL: $monad_rpc,
      MONAD_TESTNET: $monad_testnet,
      NAD_API_KEY: $nad_api_key,
      PATH: ($skills_path + ":/home/openclaw/.local/bin:/home/openclaw/.npm-global/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
    },
    auth: {
      profiles: $auth_profiles
    },
    agents: {
      defaults: {
        model: { primary: $model },
        models: { ($model): {} },
        workspace: $workspace,
        skipBootstrap: true,
        compaction: { mode: "safeguard" },
        maxConcurrent: 4,
        timeoutSeconds: 240,
        typingMode: "instant",
        typingIntervalSeconds: 4,
        heartbeat: {
          every: "120s",
          session: "heartbeat",
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
    hooks: {
      internal: { enabled: true }
    },
    commands: {
      native: true
    },
    messages: {
      ackReaction: "👀",
      ackReactionScope: "all",
      removeAckAfterReply: true,
      queue: {
        mode: "collect",
        debounceMs: 2000
      },
      inbound: {
        debounceMs: 3000
      }
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
        },
        pumpmyclaw: {
          enabled: true
        },
        monad: {
          enabled: true,
          env: {
            MONAD_PRIVATE_KEY: $monad_privkey,
            MONAD_ADDRESS: $monad_addr,
            MONAD_RPC_URL: $monad_rpc,
            MONAD_TESTNET: $monad_testnet
          }
        },
        nadfun: {
          enabled: true,
          env: {
            MONAD_PRIVATE_KEY: $monad_privkey,
            MONAD_ADDRESS: $monad_addr,
            MONAD_RPC_URL: $monad_rpc,
            MONAD_TESTNET: $monad_testnet,
            NAD_API_KEY: $nad_api_key
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
MONAD_PRIVATE_KEY=${MONAD_PRIVATE_KEY}
MONAD_ADDRESS=${MONAD_ADDRESS}
MONAD_RPC_URL=${MONAD_RPC_URL}
MONAD_TESTNET=${MONAD_TESTNET}
NAD_API_KEY=${NAD_API_KEY:-}
EOF

# --- OpenAI Codex auth setup ---
# If using OpenAI Codex provider, write auth-profiles.json so OpenClaw can use
# the Codex subscription for LLM calls (no API key billing needed).
# Auth profiles live at: ~/.openclaw/agents/<agentId>/agent/auth-profiles.json
if [ "$LLM_PROVIDER" = "openai-codex" ] && [ -n "${OPENAI_ACCESS_TOKEN:-}" ]; then
    AUTH_PROFILES_DIR="$OPENCLAW_DIR/agents/main/agent"
    mkdir -p "$AUTH_PROFILES_DIR"

    # Calculate expires timestamp (ms) — use OPENAI_TOKEN_EXPIRES if set,
    # otherwise default to 30 days from now
    if [ -n "${OPENAI_TOKEN_EXPIRES:-}" ]; then
        EXPIRES_MS="$OPENAI_TOKEN_EXPIRES"
    else
        EXPIRES_MS=$(node -e "console.log(Date.now() + 30*24*60*60*1000)")
    fi

    jq -n \
      --arg access "$OPENAI_ACCESS_TOKEN" \
      --arg refresh "${OPENAI_REFRESH_TOKEN:-}" \
      --argjson expires "$EXPIRES_MS" \
      '{
        profiles: {
          "openai-codex:default": {
            type: "oauth",
            provider: "openai-codex",
            access: $access,
            refresh: (if $refresh != "" then $refresh else null end),
            expires: $expires
          }
        }
      }' > "$AUTH_PROFILES_DIR/auth-profiles.json"

    chmod 600 "$AUTH_PROFILES_DIR/auth-profiles.json"
    echo "[pmc] Wrote auth-profiles.json for OpenAI Codex subscription auth"
fi

# --- Anthropic (Claude) auth setup ---
# If using Anthropic provider, write the setup-token to auth-profiles.json.
# The setup-token is obtained by running `claude setup-token` on the user's machine.
# Format: type "oauth" with "access" field (same as OpenAI Codex format).
if [ "$LLM_PROVIDER" = "anthropic" ] && [ -n "${ANTHROPIC_SETUP_TOKEN:-}" ]; then
    echo "[pmc] Configuring Anthropic Claude subscription auth..."
    AUTH_PROFILES_DIR="$OPENCLAW_DIR/agents/main/agent"
    mkdir -p "$AUTH_PROFILES_DIR"
    
    # Write auth-profiles.json with OAuth format (access token)
    # Note: Anthropic setup-tokens use the same OAuth format as other providers
    jq -n \
      --arg access "$ANTHROPIC_SETUP_TOKEN" \
      '{
        profiles: {
          "anthropic:default": {
            type: "oauth",
            provider: "anthropic",
            access: $access
          }
        }
      }' > "$AUTH_PROFILES_DIR/auth-profiles.json"
    chmod 600 "$AUTH_PROFILES_DIR/auth-profiles.json"
    echo "[pmc] Wrote auth-profiles.json for Anthropic Claude subscription"
fi

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

# Create Monad/nadfun skill config files
for skill in monad nadfun; do
    SKILL_DIR="$SKILLS_DIR/$skill"
    if [ -d "$SKILL_DIR" ]; then
        echo "[pmc] Configuring $skill skill..."
        jq -n \
          --arg privkey "$MONAD_PRIVATE_KEY" \
          --arg addr "$MONAD_ADDRESS" \
          --arg rpc "$MONAD_RPC_URL" \
          --arg testnet "$MONAD_TESTNET" \
          --arg apikey "${NAD_API_KEY:-}" \
          '{
            privateKey: $privkey,
            address: $addr,
            rpcUrl: $rpc,
            testnet: ($testnet == "true"),
            nadApiKey: $apikey
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

# Inject wallet addresses and bot username into IDENTITY.md
IDENTITY_FILE="$OPENCLAW_DIR/workspace/IDENTITY.md"
if [ -f "$IDENTITY_FILE" ] && ! grep -q "WALLET_INJECTED" "$IDENTITY_FILE"; then
    TOKEN_NAME=$(echo "$BOT_USERNAME" | sed 's/_bot$//' | sed 's/^@//' | tr '[:lower:]' '[:upper:]')
    cat >> "$IDENTITY_FILE" << WALLET_EOF

<!-- WALLET_INJECTED -->
## My Wallets

I have TWO wallets on TWO chains. I trade on whichever chain has funds.

**My Solana wallet address: \`${SOLANA_PUBLIC_KEY}\`**
Fund this to trade on pump.fun (Solana). Native token: SOL.

**My Monad wallet address: \`${MONAD_ADDRESS}\`**
Fund this to trade on nad.fun (Monad). Native token: MON.

Both are MY wallets. I control the private keys. The owner can fund either or both.

## My Bot Identity

**My Telegram bot username: @${BOT_USERNAME}**

When creating my token on pump.fun, I'll use the name: **${TOKEN_NAME}**
When creating my token on nad.fun, I'll use the name: **${TOKEN_NAME}**
WALLET_EOF
    echo "[pmc] Wallet addresses added to IDENTITY.md"
fi

# Auto-generate nad.fun API key if not yet created
if [ -z "${NAD_API_KEY:-}" ] && [ -f "$SKILLS_DIR/nadfun/scripts/nadfun-auth.js" ]; then
    echo "[pmc] Attempting to generate nad.fun API key..."
    AUTH_RESULT=$(node "$SKILLS_DIR/nadfun/scripts/nadfun-auth.js" 2>/dev/null || echo '{"error":"auth failed"}')
    NEW_KEY=$(echo "$AUTH_RESULT" | jq -r '.apiKey // empty' 2>/dev/null)
    if [ -n "$NEW_KEY" ]; then
        export NAD_API_KEY="$NEW_KEY"
        echo "[pmc] nad.fun API key generated successfully"
    else
        echo "[pmc] nad.fun API key generation skipped (will use unauthenticated rate limits)"
    fi
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
