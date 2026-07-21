#!/usr/bin/env bash
set -euo pipefail

# V5 finaliser contract — defence-in-depth grep gate.
#
# This is mechanism D of four. The other three are:
#
#   A. Type brand + status-keyed Reply  — src/orchestrator-v5/response-finaliser.ts
#                                         + src/orchestrator/route-v2.ts (V5RouteReply).
#                                         Catches every Fastify send shape at compile time.
#   B. Runtime WeakSet hook              — preSerialization in route-v2.ts.
#                                         Catches casts that evaded the type system.
#   C. Compile-time @ts-expect-error     — src/orchestrator-v5/__tests__/
#                                         response-finaliser-types.ts.
#                                         Catches brand regression (the brand silently
#                                         becoming structurally compatible with raw).
#
# Mechanism D (this gate) catches two narrow contract violations the other
# three don't address:
#
#   D1. Direct `analysis_ready` writes anywhere outside the finaliser.
#       Composers, handlers, system-events, TurnExecutor — none may set
#       the field. This rule existed before mechanism A; kept because it
#       prevents an entire class of "by accident, in a comment-driven
#       refactor someone copy-pasted a stamp" mistake.
#
#   D2. References to the `FinalisedV5Response` type identifier outside
#       the sanctioned files. The brand is produced ONLY by the finaliser
#       via the cast `as FinalisedV5Response`. Any other file that
#       mentions the identifier — `as FinalisedV5Response`,
#       `as unknown as FinalisedV5Response`, `type X = FinalisedV5Response`,
#       `satisfies FinalisedV5Response` — is producing a brand outside
#       the helper. This is the cast-bypass shape that mechanism A cannot
#       catch (a cast IS the type-system escape hatch by design); the gate
#       narrows the legitimate surface to a known small list of files.
#
# Note: this gate no longer enumerates Fastify send shapes
# (`reply.code(200).send`, `reply.send`, `reply.status(200).send`, chained
# methods, implicit return). Mechanism A handles all of them at compile
# time — the regex enumeration approach was the failure mode that two
# external reviews flagged. The final defence here is far narrower and
# does not attempt to be the primary contract.

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# Comment handling: all scans below match against the COMMENT-STRIPPED view of
# each file via scripts/ci/strip-source-comments.mjs (literal-aware tokeniser),
# so a comment that accurately documents this contract — including a trailing
# comment or an unstarred block-comment body, which the old per-line filters
# could not see — can never fail the gate, while string literals and real code
# still can. Emitted lines are the ORIGINAL source lines, so the
# `// finaliser-exempt:` same-line marker still works.
STRIPPER="scripts/ci/strip-source-comments.mjs"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required (matching runs via $STRIPPER)"; exit 1; }

# ─── D1: direct analysis_ready writes ─────────────────────────────────────

PATTERN='analysis_ready\s*:|\.analysis_ready\s*=|\["analysis_ready"\]\s*=|\['"'"'analysis_ready'"'"'\]\s*='

matches=$(node "$STRIPPER" --scan "$PATTERN" \
  src/orchestrator-v5/compose \
  src/orchestrator-v5/handlers \
  src/orchestrator-v5/system-events \
  src/orchestrator-v5/turn-executor.ts \
  2>/dev/null \
  | grep -v "__tests__" \
  | grep -v "\.test\.ts:" \
  | grep -v "response-finaliser" \
  | grep -v "analysis-ready-emit" \
  | grep -v "// finaliser-exempt:" \
  | grep -v "analysisReady\?:" \
  | grep -v "readonly analysisReady" \
  | grep -v "analysis_ready_emitted" \
  | grep -v "analysis_ready_status" \
  | grep -v "analysis_ready_present" \
  || true)

if [ -n "$matches" ]; then
  echo "FAIL (D1): analysis_ready may only be set by the response finaliser."
  echo "          The following lines violate the V5 finaliser contract."
  echo "          If a write is intentional, add // finaliser-exempt: <reason>"
  echo "          on the same line and re-run."
  echo ""
  echo "$matches" | sed 's/^/            /'
  echo ""
  echo "          See src/orchestrator-v5/response-finaliser.ts and"
  echo "          Docs/v5/v5-response-exit-audit.md for the contract."
  exit 1
fi

# Also check route-v2.ts for direct response.analysis_ready assignment outside
# the finaliser invocation. The finaliser is the only sanctioned writer; the
# route-v2 logger reads `response.analysis_ready` (which is fine — read-only
# access doesn't violate the contract, only writes do).
route_matches=$(node "$STRIPPER" --scan "$PATTERN" src/orchestrator/route-v2.ts 2>/dev/null \
  | grep -v "// finaliser-exempt:" \
  | grep -v "analysis_ready_emitted" \
  | grep -v "analysis_ready_status" \
  || true)

if [ -n "$route_matches" ]; then
  echo "FAIL (D1): route-v2.ts must not write analysis_ready directly."
  echo "          Use finaliseV5Response(response, { analysisReady }) instead."
  echo ""
  echo "$route_matches" | sed 's/^/            /'
  exit 1
fi

# ─── D2: FinalisedV5Response references outside sanctioned files ─────────

# The brand is produced ONLY by the finaliser, consumed ONLY by:
#   - response-finaliser.ts                (the producer)
#   - route-v2.ts                           (V5RouteReply type + sendFinalised200)
#   - response-finaliser-types.ts           (compile-time fixture; mechanism C)
#   - response-finaliser.test.ts            (runtime tests use the brand value)
#
# Any other file mentioning the identifier is producing or consuming a brand
# outside its sanctioned surface — that's a cast-shape bypass.
# Anchor each exclusion with the trailing `:` that grep -n always emits
# between path and line number, so a file like `route-v2.ts.bak` cannot
# match the `route-v2.ts` exclusion by substring.
brand_refs=$(node "$STRIPPER" --scan 'FinalisedV5Response' src 2>/dev/null \
  | grep -v "^src/orchestrator-v5/response-finaliser\.ts:" \
  | grep -v "^src/orchestrator-v5/__tests__/response-finaliser" \
  | grep -v "^src/orchestrator/route-v2\.ts:" \
  | grep -v "// finaliser-exempt:" \
  || true)

if [ -n "$brand_refs" ]; then
  echo "FAIL (D2): FinalisedV5Response is referenced outside the sanctioned"
  echo "          surface (response-finaliser.ts, route-v2.ts, and the"
  echo "          response-finaliser tests). Mentioning this identifier"
  echo "          elsewhere implies producing the brand outside the helper —"
  echo "          a cast-shape bypass of mechanism A."
  echo ""
  echo "          Offending lines:"
  echo "$brand_refs" | sed 's/^/            /'
  echo ""
  echo "          If the reference is intentional (new sanctioned file),"
  echo "          add // finaliser-exempt: <reason> on the same line, OR"
  echo "          extend the exclusion list in this script."
  exit 1
fi

exit 0
