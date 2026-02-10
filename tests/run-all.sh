#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
API_URL="${API_URL:-http://localhost:8787}"
SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo ""
    echo "Stopping API server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │   Pump My Claw — Test Runner         │"
echo "  └──────────────────────────────────────┘"
echo ""

# Check if server is already running
if curl -s "$API_URL/health" > /dev/null 2>&1; then
  echo "  API server already running at $API_URL"
else
  echo "  Starting API server..."
  cd "$PROJECT_ROOT/apps/api"
  npx wrangler dev --port 8787 > /tmp/pumpmyclaw-test-server.log 2>&1 &
  SERVER_PID=$!
  echo "  Server PID: $SERVER_PID"
  echo "  Waiting for server to be ready..."

  for i in $(seq 1 30); do
    if curl -s "$API_URL/health" > /dev/null 2>&1; then
      echo "  Server ready!"
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "  ERROR: Server failed to start. Logs:"
      cat /tmp/pumpmyclaw-test-server.log
      exit 1
    fi
    sleep 1
  done
fi

echo ""

# Run tests
cd "$PROJECT_ROOT"
API_URL="$API_URL" npx tsx tests/run-all.ts
EXIT_CODE=$?

exit $EXIT_CODE
