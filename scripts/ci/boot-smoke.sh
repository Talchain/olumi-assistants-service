#!/usr/bin/env bash
# Boot smoke (TL 09:50Z 16 Oct; third instance: #3198, aaf70d6a): does the BUILT server load every module?
# aaf70d6a (#3276) passed every test and crashed on Render at start-up ("Cannot access 'PLACEHOLDER_PARTS_REASON'
# before initialization", an ESM import-cycle TDZ). Vitest loads modules in another order, so only a real start sees it.
# Starts dist/src/server.js with an EMPTY environment: a healthy build loads all modules and stops at config
# validation ("FATAL … not set"). Any load-time error fails this step. Run after `pnpm run build`.
set -uo pipefail
[[ -f dist/src/server.js ]] || { echo "boot-smoke: dist/src/server.js missing (run pnpm run build first)"; exit 2; }
OUT=$(env -i PATH="$PATH" HOME="${HOME:-/tmp}" NODE_ENV=production timeout 60 node dist/src/server.js 2>&1)
if grep -qE "ReferenceError|before initialization|SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|TypeError" <<<"$OUT"; then
  grep -E -m5 "ReferenceError|before initialization|SyntaxError|ERR_MODULE_NOT_FOUND|Cannot find module|TypeError|at file://" <<<"$OUT"
  echo "::error::boot-smoke: the built server crashes while loading modules (see above)"; exit 1
fi
if grep -qE '"level":"fatal".*(not set|FATAL)' <<<"$OUT"; then
  echo "boot-smoke: all modules loaded; stopped at config validation as expected"; exit 0
fi
tail -5 <<<"$OUT"; echo "::error::boot-smoke: did not reach config validation (could not measure)"; exit 1
