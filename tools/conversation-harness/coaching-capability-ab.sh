#!/bin/bash
# coaching-capability-ab — FULL-STACK baseline vs ONE candidate for the code-owned
# `COACHING_CONTEXT_INSTRUCTION`, using the existing hermetic conversation-harness arm.
#
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║ THIS HELPER IS DISABLED AND IS NOT CLEARED TO EXECUTE.                        ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
# Independent review of cdb2cfb3 (Codex, 2026-09-08 19:19Z) returned
# CHANGES_REQUIRED / NOT CLEARED TO EXECUTE on this file. Its three material
# findings are repaired below, but the helper STILL requires writes to the SHARED
# staging database (a seeded `scenarios` row per repeat) and still boots a local
# CEE against shared staging backends. That is a standing authority gap, not a
# credential gap, so the guard below is unconditional rather than "ready once the
# secrets work". Only a reviewer who has cleared THIS file's current bytes may set
# COACHING_AB_SOURCE_CLEARANCE, and clearing it does not by itself grant authority
# to write shared rows — that is a separate decision recorded by whoever grants it.
#
# The provider-free path that needs none of this is the preferred one:
#   pnpm exec tsx tools/conversation-harness/coaching-request-contract.ts
# It assembles the REAL candidate instruction through the production assembler and
# banks the exact request contract, with no server, no database, no PMS and no
# provider call.
#
# ── WHY THIS SCRIPT EXISTS RATHER THAN `prompt-eval.sh` ────────────────────────
# `prompt-eval.sh` A/Bs a PMS *task prompt* by swapping one row of the file store.
# The change under test is not in PMS at all: it is a code constant appended to the
# routing user message by `buildUserMessage`. Swapping a store row would compare two
# IDENTICAL arms and report a difference of zero — a vacuous green. So the swapped
# variable here is the SOURCE FILE, and both arms boot sequentially from the SAME
# tree, the same store, the same parity env and the same seeded frozen graph.
#
# ⚠ BOTH ARMS SHARE THIS TREE'S COMPOSITION. The branch is cut from the #1395
# feature base, so the baseline arm reproduces "deployed staging minus this
# instruction", NOT deployed staging itself. Reviewer noted, and it is true: the
# routing blob is identical at `dcff3c5` and at feature base `0828a530`
# (`89b3437860527c0be6dadd2a6307cb3e2a6b00ff`), so the comparison stays valid as a
# comparison — one changed variable — but must not be described as a staging replay.
#
# ⚠ AND IT PRODUCES ANSWERS, NOT A VERDICT. The delivered answer for every turn is
# written next to its question and history for a HUMAN reviewer. Never promote on a
# keyword count.
#
# Usage (once, and only once, both clearances exist):
#   ENV_FILE=<repo>/.env STAGING_ENV=<repo>/.env.staging.local \
#   PARITY_ENV=<path>/staging-parity.env OLUMI_ASSIST_KEY=<key> \
#   COACHING_AB_SOURCE_CLEARANCE=<reviewer ref> ./coaching-capability-ab.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
WT="$(cd "$DIR/../.." && pwd)"
cd "$DIR"

# ── GUARD 0: the standing refusal. FIRST, before any argument is even read. ────
if [ -z "${COACHING_AB_SOURCE_CLEARANCE:-}" ]; then
  cat >&2 <<'MSG'
REFUSED: coaching-capability-ab.sh is not cleared to execute.

  · Independent review of cdb2cfb3 returned CHANGES_REQUIRED / NOT CLEARED TO EXECUTE.
  · This helper writes rows to the SHARED staging database (one seeded scenario per
    repeat) and boots a CEE against shared staging backends. No authority to do that
    has been recorded, and a working credential would not supply one.

Use the provider-free path instead — same candidate instruction, real assembler,
zero server / database / PMS / provider:

  pnpm exec tsx tools/conversation-harness/coaching-request-contract.ts

To lift this refusal, a reviewer who is not the author must clear THIS file's
current bytes and record the clearance reference in COACHING_AB_SOURCE_CLEARANCE,
AND the shared-row authority must be granted separately and in writing.
MSG
  exit 3
fi

BASE_SHA="${BASE_SHA:-dcff3c562a53ecda0c487dd211aa9e04f788b468}"
SRC="src/orchestrator-v5/routing/route-with-tool-use.ts"
JOURNEY="${JOURNEY:-$DIR/journeys/coaching-capability-pre-analysis.json}"
REPEATS="${REPEATS:-3}"
PORT="${PORT:-3107}"
STORE="${STORE:-$DIR/stores/staging-mirror.json}"
ARMS=2
# The AUTHORISED TOTAL. Not a default, not a suggestion, and not raisable from the
# environment: raising it means going back for authority, not editing a variable.
ANSWER_CEILING=18

# ── GUARD 1: the answer ceiling, enforced from the ACTUAL journey, before any
# network or paid work. Review P1: the previous version accepted arbitrary
# REPEATS and JOURNEY and still printed "18 answers" at the end. REPEATS=4 on the
# three-turn journey is 24 answers; a six-turn journey is 36 at REPEATS=3. Neither
# needs a provider call to detect, so neither may reach one.
case "$REPEATS" in
  ''|*[!0-9]*) echo "REFUSED: REPEATS must be a positive integer, got '$REPEATS'" >&2; exit 2;;
esac
[ "$REPEATS" -ge 1 ] || { echo "REFUSED: REPEATS must be >= 1, got '$REPEATS'" >&2; exit 2; }
[ -f "$JOURNEY" ] || { echo "MISSING PREREQUISITE: $JOURNEY" >&2; exit 1; }
TURNS="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["turns"]))' "$JOURNEY")"
TOTAL=$(( TURNS * REPEATS * ARMS ))
if [ "$TOTAL" -gt "$ANSWER_CEILING" ]; then
  echo "REFUSED: $TURNS turns x $REPEATS repeats x $ARMS arms = $TOTAL generated answers," >&2
  echo "         which exceeds the authorised ceiling of $ANSWER_CEILING. Reduce the journey or the" >&2
  echo "         repeats, or obtain a new authorised total. The ceiling is not raisable here." >&2
  exit 2
fi
echo "budget: $TURNS turns x $REPEATS repeats x $ARMS arms = $TOTAL answers (ceiling $ANSWER_CEILING)"

: "${ENV_FILE:?set ENV_FILE=<repo>/.env}"
: "${STAGING_ENV:?set STAGING_ENV=<repo>/.env.staging.local}"
: "${PARITY_ENV:?set PARITY_ENV=<path>/staging-parity.env}"
: "${OLUMI_ASSIST_KEY:?set OLUMI_ASSIST_KEY}"
for f in "$ENV_FILE" "$STAGING_ENV" "$PARITY_ENV" "$STORE"; do
  [ -f "$f" ] || { echo "MISSING PREREQUISITE: $f" >&2; exit 1; }
done

# ── GUARD 2: never overwrite work that is not committed. Review P1: the previous
# version copied the working file to an ANONYMOUS temp path, overwrote it for the
# baseline arm, and then "restored" it with `git checkout -- $SRC` — which replaces
# the user's uncommitted edit with the INDEX version and silently discards it. This
# refuses a dirty tree outright, and the restore below puts back the EXACT bytes
# from a NAMED backup whose path is printed before anything is written.
if ! git -C "$WT" diff --quiet -- "$SRC" || ! git -C "$WT" diff --cached --quiet -- "$SRC"; then
  echo "REFUSED: $SRC has uncommitted changes. This helper rewrites that file to swap arms" >&2
  echo "         and will not risk your work. Commit or set the change aside first." >&2
  exit 2
fi

OUT="$DIR/runs/coaching-capability-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
cp "$JOURNEY" "$OUT/journey.json"
BACKUP="$OUT/route-with-tool-use.ts.PRE-RUN-BACKUP"
cp "$WT/$SRC" "$BACKUP"
echo "exact pre-run bytes of $SRC saved to: $BACKUP"
shasum -a 256 "$BACKUP" | tee "$OUT/pre-run-source.sha256"

ARM_PID=""
SCENARIOS=""
cleanup() {
  # Review P2: on a failing seed/runner under `set -e` the old trap ran with no PID
  # in scope and left the CEE child alive. ARM_PID is module-scope and cleared only
  # after a successful stop, so every exit path — success, failure, interrupt —
  # reaches this.
  if [ -n "$ARM_PID" ]; then
    kill "$ARM_PID" 2>/dev/null || true
    wait "$ARM_PID" 2>/dev/null || true
    ARM_PID=""
  fi
  # Restore the EXACT saved bytes. Never `git checkout --`.
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$WT/$SRC"
    echo "restored $SRC from $BACKUP"
  fi
  # Review P2: the header used to claim seeded scenarios were "deleted at the end".
  # They were not, and this helper does NOT delete shared database rows — deleting
  # rows it did not receive authority for is exactly the inference the reviewer
  # warned against. It emits an exact owned-id receipt and names the owner instead.
  if [ -n "$SCENARIOS" ]; then
    printf '%s\n' $SCENARIOS > "$OUT/seeded-scenarios.owned-ids.txt"
    echo "SHARED ROWS LEFT BEHIND — this helper deletes nothing." >&2
    echo "  owned ids: $OUT/seeded-scenarios.owned-ids.txt" >&2
    echo "  removal is a separately authorised action for the environment operator," >&2
    echo "  exact-target only (staging/delete-scenarios.py --execute <id> ...)." >&2
  fi
}
trap cleanup EXIT INT TERM

extract_instruction() {
  python3 - "$WT/$SRC" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf-8').read()
i = s.index('export const COACHING_CONTEXT_INSTRUCTION = [')
j = s.index("].join('\\n');", i)
sys.stdout.write(s[i:j])
PY
}

run_arm() {
  local arm="$1"
  # Pin what this arm actually serves. Two identical hashes means the run measured
  # NOTHING — that is why it is recorded rather than assumed.
  extract_instruction > "$OUT/$arm.instruction.txt"
  shasum -a 256 "$OUT/$arm.instruction.txt" | tee -a "$OUT/arm-hashes.txt"

  STORE="$STORE" PORT="$PORT" WT="$WT" ENV_FILE="$ENV_FILE" \
    STAGING_ENV="$STAGING_ENV" PARITY_ENV="$PARITY_ENV" \
    ./arm/boot-arm.sh "$OUT/$arm.arm.log" &
  ARM_PID=$!
  local waited=0
  until grep -qm1 'file-PMS boot complete' "$OUT/$arm.arm.log" 2>/dev/null; do
    sleep 2; waited=$((waited + 2))
    [ "$waited" -gt 120 ] && { echo "arm $arm failed to boot; see $OUT/$arm.arm.log" >&2; exit 1; }
  done

  for i in $(seq 1 "$REPEATS"); do
    # One FRESH scenario per repeat: a conversation mutates its own history, so
    # reusing one scenario would make repeat 3 a different question from repeat 1.
    local scen
    scen="$(STAGING_ENV_FILE="$STAGING_ENV" python3 staging/seed-frozen-scenario.py --title-prefix coachcap_)"
    SCENARIOS="$SCENARIOS $scen"
    printf '%s\n' "$scen" >> "$OUT/seeded-scenarios.owned-ids.txt"
    OLUMI_ASSIST_KEY="$OLUMI_ASSIST_KEY" node runner.mjs \
      --journey "$JOURNEY" --arm "$arm-r$i" --base "http://localhost:$PORT" \
      --scenario "$scen" --out "$OUT" --flags-env "$PARITY_ENV"
  done
  kill "$ARM_PID" 2>/dev/null || true
  wait "$ARM_PID" 2>/dev/null || true
  ARM_PID=""
}

echo "== BASELINE arm: $SRC set to $BASE_SHA (backup held at $BACKUP) =="
git -C "$WT" show "$BASE_SHA:$SRC" > "$WT/$SRC"
run_arm baseline

echo "== CANDIDATE arm: $SRC restored to this branch's authored bytes =="
cp "$BACKUP" "$WT/$SRC"
run_arm candidate

echo
echo "$TOTAL answers ($TURNS questions x $REPEATS repeats x $ARMS arms) under $OUT"
echo "Reviewer: read each turn's QUESTION + HISTORY + FINAL DELIVERED ANSWER."
echo "First check arm-hashes.txt: two identical hashes means the run measured NOTHING."
