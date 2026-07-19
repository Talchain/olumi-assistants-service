#!/bin/bash
# Boot a Sonnet-5 A/B arm: same as boot-arm.sh but forces CEE_MODEL_ORCHESTRATOR=claude-sonnet-5
# AFTER staging-parity.env (which pins sonnet-4-6). Uses the s5 worktree with the local
# registry + temperature-omission patches. Usage: STORE=<arm json> PORT=3103 ./boot-s5-arm.sh <logfile>
set -u
LOG="${1:?usage: STORE=... PORT=... ./boot-s5-arm.sh <logfile>}"
WT="${WT:-/Users/paulslee/.cache/cee-s5-run}"
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
export PORT="${ARM_PORT:-3103}"   # .env presets PORT=3101, so force via ARM_PORT and unconditional assign
export CEE_MODEL_ORCHESTRATOR=claude-sonnet-5   # the model under test — overrides staging-parity
export CEE_SERVER_TS="$WT/src/server.ts"
exec ./node_modules/.bin/tsx /Users/paulslee/Documents/GitHub/orchestrator-prompt-workstream/candidates/pms-file-shim.mjs >> "$LOG" 2>&1
