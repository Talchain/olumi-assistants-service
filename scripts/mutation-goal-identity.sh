#!/bin/bash
#
# ⭐⭐ MUTATION KIT — goal identity (`projector.ts` collapse · `completion.ts` ask).
#
# Landed IN THE DIFF deliberately. The first version of this change ran an
# equivalent harness out-of-tree, so its result was unverifiable by a reviewer and
# unavailable to the next lane — and it contained a defect (below) that only
# became visible because someone re-derived it. A mutation result is evidence;
# evidence that lives in a scratch directory is a claim.
#
# Run:  bash scripts/mutation-goal-identity.sh
#
# ⏱ EXPECT ~10-15 MINUTES. Guard 2 runs a full `tsc -p tsconfig.build.json` per
# mutant (12 of them), which is the dominant cost and is deliberate: typechecking
# only the mutated FILE would miss the cross-file errors that are exactly how a
# mutation stops being a legal program. Slow evidence beats fast theatre. Run it in
# the foreground and let it finish — 0% CPU is not a hang (trap 6).
#
# ⚠ Do NOT clear a runaway from this script with `pkill -f tsc` or `pkill -f vitest`:
# several lanes run concurrently in this estate and a pattern kill takes out their
# runs too, which they cannot distinguish from their own failure (trap 9e). Kill by
# the PID you own.
#
# ── THE TWO GUARDS THAT MAKE A SURVIVOR MEAN SOMETHING ─────────────────────────
# An "equivalent mutant" and a mutant that never ran are indistinguishable from
# the exit code alone (trap 22d — a FALSE SURVIVOR). This harness closes BOTH
# holes, and the second one was found by review, not by inspection:
#
#   GUARD 1 — COLLECTED-TESTS LINE. A mutation that breaks the TRANSFORM (invalid
#   syntax) collects nothing and prints no `Tests N passed/failed` line at all,
#   which reads as SURVIVED. MEASURED: the first M7 inserted unescaped double
#   quotes into a double-quoted literal and was scored SURVIVED on a suite that
#   never executed.
#
#   GUARD 2 — TYPECHECK ON THE MUTATED TREE. Guard 1 is NOT sufficient, and this
#   is the residual hole: **vitest strips types rather than checking them**, so
#   `const broken: number = "not a number"` transforms fine, RUNS fine, and reads
#   as a clean SURVIVED while being nonsense the compiler would reject. Any mutant
#   whose survival matters must therefore be shown to be TYPE-VALID first.
#   Without this, "SURVIVED" can mean "was never a legal program".
#
# ── ISOLATION ─────────────────────────────────────────────────────────────────
# The worktree is created OUTSIDE the repo root (a relative path passed to
# `git -C <repo> worktree add` resolves INSIDE it, and the test runner then globs
# the unfixed copy — trap 9c/9e). Isolation is proved by WRITING a sentinel and
# asserting the source file's hash is unchanged, never by reading paths: an APFS
# hard link makes two "separate" trees the same tree and `cp -R` preserves it
# (trap 9g). Restores are HEAD-relative with the index reset afterwards, because
# `git checkout -- <path>` restores from the INDEX and can write the mutation back
# (trap 9h).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="${MUTANT_WORKTREE:-/private/tmp/olumi-mutants-goal-identity-$$/wt}"
SPEC="src/cee/draft/records/__tests__/goal-identity-and-absence.test.ts"
PROJ="src/cee/draft/records/projector.ts"
COMP="src/cee/draft/records/completion.ts"
EXPECTED_TESTS="${EXPECTED_TESTS:-13}"

pass=0; fail=0
SHA="$(git -C "$REPO" rev-parse HEAD)"

cleanup() {
  rm -f "$WT/node_modules" 2>/dev/null
  git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1
}
trap cleanup EXIT

echo "=== setup: worktree outside the repo root, at $WT ==="
mkdir -p "$(dirname "$WT")"
git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null 2>&1 || { echo "worktree add failed"; exit 1; }
[ "$(git -C "$WT" rev-parse HEAD)" = "$SHA" ] || { echo "HEAD MISMATCH — fetching a ref is not checking it out (trap 9f)"; exit 1; }

echo "=== isolation proved by WRITING, not by locating (trap 9g) ==="
echo "  src inode $(stat -f %i "$REPO/$PROJ")  wt inode $(stat -f %i "$WT/$PROJ")"
before="$(shasum -a 256 "$REPO/$PROJ" | cut -d' ' -f1)"
printf '\n// SENTINEL-ISOLATION-PROBE\n' >> "$WT/$PROJ"
after="$(shasum -a 256 "$REPO/$PROJ" | cut -d' ' -f1)"
[ "$before" = "$after" ] || { echo "  NOT ISOLATED — the worktree writes through to the source. ABORT."; exit 1; }
echo "  ISOLATED: source hash unchanged after writing into the worktree"
git -C "$WT" checkout "$SHA" -- "$PROJ"; git -C "$WT" reset -q
ln -s "$REPO/node_modules" "$WT/node_modules" 2>/dev/null

# ⚠ THE WORKTREE IS NOT A BUILD ENVIRONMENT UNTIL THE GENERATED TYPES EXIST.
# `src/generated/openapi.d.ts` is produced by `pretypecheck`, is gitignored, and is
# therefore ABSENT from a fresh worktree — so a naive typecheck guard fails on
# every mutant for a reason that has nothing to do with the mutation. Caught by the
# guard's own baseline control below, which is the point of having one: a wrong
# baseline in the instrument that verifies your instrument is the worst place for
# one (trap 12e).
echo "=== generating the openapi types the typecheck guard depends on ==="
(cd "$WT" && npx openapi-typescript openapi.yaml -o src/generated/openapi.d.ts >/dev/null 2>&1) \
  || { echo "  openapi:generate failed in the worktree — ABORT"; exit 1; }

echo "=== BASELINE CONTROL: the PRISTINE worktree must typecheck clean ==="
if ! (cd "$WT" && npx tsc -p tsconfig.build.json --noEmit >/tmp/mut-base.$$ 2>&1); then
  echo "  !! pristine worktree does not typecheck — the typecheck guard would fail every"
  echo "     mutant for an environmental reason and report 12 HARNESS ERRORs. ABORT."
  tail -5 /tmp/mut-base.$$ | sed 's/^/     /'; rm -f /tmp/mut-base.$$; exit 1
fi
rm -f /tmp/mut-base.$$
echo "  pristine typechecks clean — a later typecheck failure is attributable to the mutation"

restore() {
  git -C "$WT" checkout "$SHA" -- "$PROJ" "$COMP"
  git -C "$WT" reset -q
  local dirty; dirty="$(git -C "$WT" status --porcelain -- src/ | wc -l | tr -d ' ')"
  [ "$dirty" = "0" ] || { echo "  !! TREE NOT CLEAN AFTER RESTORE ($dirty) — ABORT"; exit 1; }
}

run_mutant() {
  local name="$1" file="$2" expect="$3" subst="$4"
  perl -0777 -i -pe "$subst" "$WT/$file"

  # Applied-check scoped to `src/` — an untracked `node_modules` symlink is not
  # matched by a `node_modules/` gitignore entry and would otherwise offset the
  # count (trap 12e). The control asserts EXACTLY zero, never "a small constant".
  local applied; applied="$(git -C "$WT" status --porcelain -- src/ | wc -l | tr -d ' ')"
  if [ "$applied" != "1" ]; then
    echo "MUTANT $name: NOT APPLIED (src/ changes = $applied) — an unapplied mutation is indistinguishable from an equivalent one"
    fail=$((fail+1)); restore; return
  fi

  # GUARD 2 — the mutated tree must be a LEGAL PROGRAM before its survival can
  # mean anything. vitest strips types, so a type-invalid mutant runs and reads as
  # SURVIVED.
  if ! (cd "$WT" && npx tsc -p tsconfig.build.json --noEmit >/tmp/mut-tsc.$$ 2>&1); then
    echo "MUTANT $name: HARNESS ERROR — mutated tree does not typecheck; 'survival' would be meaningless"
    tail -3 /tmp/mut-tsc.$$ | sed 's/^/      /'; rm -f /tmp/mut-tsc.$$
    fail=$((fail+1)); restore; return
  fi
  rm -f /tmp/mut-tsc.$$

  local out; out="$(cd "$WT" && npx vitest run "$SPEC" 2>&1 | grep -vE '^\{"level"')"

  # GUARD 1 — the suite must actually have run.
  if ! echo "$out" | grep -qE "Tests +[0-9]+ (passed|failed)"; then
    echo "MUTANT $name: HARNESS ERROR — suite did not run (no collected-test line)"
    echo "$out" | tail -4 | sed 's/^/      /'
    fail=$((fail+1)); restore; return
  fi

  if echo "$out" | grep -q "Tests .*failed"; then
    if echo "$out" | grep -qF "$expect"; then
      echo "MUTANT $name: BITTEN ✓  (\"$expect\")"
      pass=$((pass+1))
    else
      echo "MUTANT $name: RED on the WRONG assertion — expected \"$expect\""
      echo "$out" | grep -oE "> [a-z].*$" | head -8 | sed 's/^/      /'
      fail=$((fail+1))
    fi
  else
    echo "MUTANT $name: SURVIVED ✗ — the suite cannot see this change"
    fail=$((fail+1))
  fi
  restore
}

echo
echo "=== control: pristine suite GREEN and collecting exactly $EXPECTED_TESTS ==="
ctl="$(cd "$WT" && npx vitest run "$SPEC" 2>&1 | grep -vE '^\{"level"')"
echo "$ctl" | grep -E "Tests +[0-9]+ passed" | sed 's/^/  /'
# Asserted BY NAME and BY COUNT: a suite total, a green exit code and a zero
# failure line are all consistent with this spec contributing nothing (trap 2b).
echo "$ctl" | grep -qE "Tests +${EXPECTED_TESTS} passed \(${EXPECTED_TESTS}\)" \
  || { echo "  !! did not collect exactly $EXPECTED_TESTS tests — every number below would be void"; exit 1; }
echo

# ── Fix A: duplicate stated-goal collapse ────────────────────────────────────
# ⚠ A1 AND A5 ARE DELIBERATELY FORMULATED WITHOUT `&& false`, and the reason is a
# POSITIVE CONTROL FOR GUARD 2 rather than a style note. Both were first written
# that way; TypeScript then treats the block as unreachable and STOPS NARROWING
# inside it, so `survivor !== undefined && ... survivor.goal_threshold_unit` no
# longer compiled and BOTH mutants were rejected by the typecheck guard with
# `TS18048: 'survivor' is possibly 'undefined'`. That is the guard doing exactly its
# job, and it is evidence the guard has teeth rather than being decoration.
# Reformulated to be type-IDENTICAL and false only at RUNTIME.
run_mutant "A1 collapse-never-fires" "$PROJ" \
  "single, connected node" \
  's/kind === "goal" && usedIds\.has\(statedBaseId\)/kind === "goal" \&\& usedIds.has(statedBaseId + "-never-matches")/'

run_mutant "A2 collapse-ignores-the-quote" "$PROJ" \
  "keeps TWO goal nodes when the user stated two DIFFERENT objectives" \
  's/const statedBaseId = sha8\(item\.kind, quote\);/const statedBaseId = sha8(item.kind);/'

run_mutant "A3 collapse-drops-the-stated-ref" "$PROJ" \
  "loses no stated content" \
  's/        statedIdByIndex\.set\(index, statedBaseId\);\n        return;/        return;/'

run_mutant "A4 collapse-drops-the-stated-TARGET" "$PROJ" \
  "carries the target onto the survivor" \
  's/        if \(survivorTarget === undefined && duplicateStatesATarget\) \{\n          applyStatedGoalTarget\(survivor, item\.value as number, item\.unit\);\n        \}//'

run_mutant "A5 disagreement-check-disabled" "$PROJ" \
  "refuses to collapse when the two copies state DIFFERENT targets" \
  's/        && \(survivorTarget !== item\.value/        \&\& (survivorTarget === item.value/'

# ── Fix B: the no_goal ask, raised but not put to the model ──────────────────
run_mutant "B1 ask-never-fires" "$COMP" \
  "raises a \`no_goal\` ask item" \
  's/if \(goalIds\.length === 0\) \{\n    push\(\{\n      kind: "no_goal"/if (false) {\n    push({\n      kind: "no_goal"/'

run_mutant "B2 ask-always-fires" "$COMP" \
  "does NOT raise it when the user" \
  's/if \(goalIds\.length === 0\) \{\n    push\(\{\n      kind: "no_goal"/if (true) {\n    push({\n      kind: "no_goal"/'

run_mutant "B3 ask-not-routed-as-blocking" "$COMP" \
  "raises a \`no_goal\` ask item" \
  's/      validatorCode: "MISSING_GOAL",\n    \}\);/      validatorCode: null,\n    });/'

run_mutant "B4 ask-proposes-a-goal-FABRICATION" "$COMP" \
  "asks for the objective without proposing one" \
  's/ and link what you already emitted to it with `to_stated`/ — it is probably Monthly Recurring Revenue, worth 250000/'

run_mutant "B5 unanswerable-item-IS-put-to-the-model" "$COMP" \
  "omits it from the prompt the model is shown" \
  's/  const problems = modelAnswerableAskItems\(ask\)/  const problems = ask.items/'

# ⚠ B6's FIRST FORMULATION WAS AN EQUIVALENT MUTANT, AND THAT IS DEMONSTRATED
# RATHER THAN ASSERTED (trap 13c — a survivor is a claim either way). It replaced the
# derived `return` at the END of `isModelAnswerableAskItem` with `return false`; but
# that line is reached ONLY for kinds in `ASK_KINDS_NEEDING_A_STATED_ITEM`, i.e.
# `no_goal`, which already evaluated to false. Every other kind returns `true` at the
# guard clause above it, so the mutation changed nothing observable and SURVIVED for a
# legitimate reason. The property it was meant to test — that BLANKING the list REDs,
# so the B5 pair discriminates in BOTH directions — needs the filter itself mutated.
run_mutant "B6 ALL-items-withheld-from-the-prompt" "$COMP" \
  "omits it from the prompt the model is shown" \
  's/  return ask\.items\.filter\(isModelAnswerableAskItem\);/  return [];/'

run_mutant "B7 answerability-hardcoded-instead-of-derived" "$COMP" \
  "classifies \`no_goal\` as not model-answerable" \
  's/const ASK_KINDS_NEEDING_A_STATED_ITEM: ReadonlySet<CompletionAskItem\["kind"\]> = new Set\(\[\n  "no_goal",\n\]\);/const ASK_KINDS_NEEDING_A_STATED_ITEM: ReadonlySet<CompletionAskItem["kind"]> = new Set([]);/'

echo
echo "=== trailing control: tree pristine, suite GREEN again ==="
echo "  dirty in src/: [$(git -C "$WT" status --porcelain -- src/ | tr '\n' ' ')]"
(cd "$WT" && npx vitest run "$SPEC" 2>&1 | grep -vE '^\{"level"' | grep -E "Tests +[0-9]+ (passed|failed)" | sed 's/^/  /')
echo
echo "BITTEN: $pass   PROBLEM: $fail"
[ "$fail" = "0" ] || exit 1
