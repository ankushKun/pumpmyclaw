#!/bin/bash
# Build the PumpMyClaw base image with all dependencies pre-installed
# This only needs to be run once, or when dependencies change

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_NAME="${1:-pmc-base:latest}"

echo "Building base image: $IMAGE_NAME"
docker build -t "$IMAGE_NAME" "$SCRIPT_DIR"

echo ""
echo "Base image built successfully: $IMAGE_NAME"
echo "The instance Dockerfile will now use this as its base."
