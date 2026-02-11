#!/bin/bash
# Get user profile - NOTE: JWT auth was removed, this script is deprecated
# Usage: pumpfun-profile.sh

set -euo pipefail

LOG_PREFIX="[pumpfun-profile]"
echo "$LOG_PREFIX WARNING: This script requires JWT auth which is no longer supported" >&2
echo '{"error": "pumpfun-profile.sh is deprecated - JWT auth was removed in favor of PumpPortal"}' >&2
exit 1
