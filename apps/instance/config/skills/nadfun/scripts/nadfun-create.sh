#!/bin/bash
# Create a new token on nad.fun
# Usage: nadfun-create.sh [name] [symbol] [description] [image_path] [initial_buy_mon]
# Example: nadfun-create.sh "MoonCat" "MCAT" "A moon cat token" "" 0.05
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/nadfun-create.js" "$@"
