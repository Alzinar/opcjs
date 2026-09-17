#!/usr/bin/env bash
# Builds everything the ref/ reference implementations need and runs their
# tests, then always cleans up afterwards (stray server processes and
# generated certificates under tmp/) — regardless of whether the tests pass.
#
# Usage: npm run test:ref   (from the repository root)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REF_SERVER_DIR="$SCRIPT_DIR/uaNet/RefServer"
REF_CLIENT_DIR="$SCRIPT_DIR/opcjs/RefClient"

cleanup() {
    echo "[test:ref] Cleaning up..."
    # RefClient's own vitest globalSetup already stops RefServer on a normal
    # exit; this catches anything left behind by an interrupted/failed run.
    pkill -9 -f "uaNet/RefServer/bin/.*/RefServer$" 2>/dev/null || true
    pkill -9 -f "RefServer\.dll" 2>/dev/null || true
    rm -rf "$REPO_ROOT/tmp"
}
trap cleanup EXIT

echo "[test:ref] Building opcjs-base / opcjs-client (skipped by Nx if already up to date)..."
(cd "$REPO_ROOT" && npx nx run-many -t build -p opcjs-base,opcjs-client) || exit 1

echo "[test:ref] Building RefServer..."
(cd "$REF_SERVER_DIR" && dotnet build) || exit 1

echo "[test:ref] Installing RefClient dependencies..."
(cd "$REF_CLIENT_DIR" && npm install) || exit 1

echo "[test:ref] Running RefClient tests..."
(cd "$REF_CLIENT_DIR" && npm test)
exit $?
