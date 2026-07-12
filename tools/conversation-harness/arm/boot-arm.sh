#!/bin/bash
# Boot one hermetic CEE arm: local server, FILE prompt store, staging-parity env.
# Re-homed from orchestrator-prompt-workstream/candidates/boot-arm.sh (proven 2026-07).
#
# "Hermetic" = prompt serving is local (file store via pms-file-shim.mjs — ZERO
# PMS writes) and the CEE code is a local tree; sessions/PLoT/ISL still point at
# staging per the sourced env files. The shim hides SUPABASE_* during config
# import (store factory picks `file`) and restores them before listen()
# (sessions keep using staging Supabase).
#
# Usage: STORE=<prompt store json> PORT=3103 ./boot-arm.sh <logfile>
#   WT=           server source tree (default: this repo checkout)
#   ENV_FILE=     base env             (default: <repo>/.env)
#   STAGING_ENV=  staging creds        (default: <repo>/.env.staging.local)
#   PARITY_ENV=   staging-parity flags (default: ../staging-parity.env — build it
#                 locally from staging-parity.env.example; see README "Staging parity")
set -u
LOG="${1:?usage: STORE=<prompt store json> PORT=<port> ./boot-arm.sh <logfile>}"
# Capture the caller's PORT BEFORE sourcing env files — .env sets its own PORT
# and `set -a` sourcing would silently win over the caller (bitten 2026-07-12:
# arm asked for 3103, booted on .env's 3101).
REQ_PORT="${PORT:-3103}"
DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$DIR/../../.." && pwd)"
WT="${WT:-$REPO}"
ENV_FILE="${ENV_FILE:-$REPO/.env}"
STAGING_ENV="${STAGING_ENV:-$REPO/.env.staging.local}"
PARITY_ENV="${PARITY_ENV:-$DIR/../staging-parity.env}"
for f in "$ENV_FILE" "$STAGING_ENV" "$PARITY_ENV"; do
  [ -f "$f" ] || { echo "missing env file: $f (see README env-file table)" >&2; exit 1; }
done
cd "$WT"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
# shellcheck disable=SC1090
source "$STAGING_ENV"
# shellcheck disable=SC1090
source "$PARITY_ENV"
set +a
export ENABLE_V5_ORCHESTRATOR=true
export PROMPTS_STORE_TYPE=file
export PROMPTS_STORE_PATH="${STORE:?set STORE=<arm store json>}"
export PROMPTS_BACKUP_ENABLED=false
# The hermetic arm may enable trace freely (v0 rule) — trace.json capture depends on it.
export CEE_DIAGNOSTIC_TRACE_ENABLED=true
export LOG_LEVEL=debug
export PORT="$REQ_PORT"
export CEE_SERVER_TS="$WT/src/server.ts"
exec "$WT/node_modules/.bin/tsx" "$DIR/pms-file-shim.mjs" >> "$LOG" 2>&1
