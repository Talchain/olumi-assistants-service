#!/bin/bash
# Boot one A/B arm of the local CEE server. Usage: STORE=<armX.json> PORT=3101 ./boot-arm.sh <logfile>
set -u
LOG="${1:?usage: STORE=... PORT=... ./boot-arm.sh <logfile>}"
WT="${WT:-/tmp/cee-ab-run}"
cd "$WT"
set -a
source /Users/paulslee/Documents/GitHub/olumi-assistants-service/.env
source /Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local
source /Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/candidates/staging-parity.env
set +a
export ENABLE_V5_ORCHESTRATOR=true
export PROMPTS_STORE_TYPE=file
export PROMPTS_STORE_PATH="${STORE:?set STORE=<arm store json>}"
export PROMPTS_BACKUP_ENABLED=false
export LOG_LEVEL=debug
export PORT="${PORT:-3101}"
export CEE_SERVER_TS="$WT/src/server.ts"
exec ./node_modules/.bin/tsx /Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/candidates/pms-file-shim.mjs >> "$LOG" 2>&1
