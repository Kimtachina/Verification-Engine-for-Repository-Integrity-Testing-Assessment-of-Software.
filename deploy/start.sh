#!/usr/bin/env bash
# Starts the dashboard (internal, 127.0.0.1:3000) and the API gateway (public, $PORT).
# If either stops, the container stops too, so the platform restarts it.
set -euo pipefail

bun run --cwd frontend start &
bun backend/src/server.ts &

wait -n
exit $?
