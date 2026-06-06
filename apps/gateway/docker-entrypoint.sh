#!/usr/bin/env bash
set -e

# Authenticate the SpacetimeDB CLI for maincloud reducer calls. SPACETIME_TOKEN must be
# a valid maincloud token (from `spacetime login show --token` on a logged-in machine).
if [ -n "${SPACETIME_TOKEN:-}" ]; then
  spacetime login --token "${SPACETIME_TOKEN}" >/dev/null 2>&1 || echo "warn: spacetime login --token failed"
else
  echo "warn: SPACETIME_TOKEN not set; reducer calls to maincloud will fail"
fi

exec node --enable-source-maps apps/gateway/dist/index.js serve
