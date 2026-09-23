# Model Generation & Quality — restart handover, 23 Sep 2026

Written before a machine restart. **Everything is on the remote**; `/private/tmp` is
expendable. Verified with `git ls-remote`, not local tracking refs.

## THE GOAL (active)

> Every OpenAI interaction, analysis and UI surface reads one authoritative current
> model with consistent values, provenance, freshness, versions and receipts; edits
> and reloads cannot contradict or overwrite committed state.

## STATUS: NOT MET on the served build. Measured, not assumed.

Served CEE `e4cd297a906b49bd5faf8ab3af0fdc55045d8952` (from `/healthz`), served UI
`f0d186d941294451017216053f5d202e5e70a0aa` (from `/version.json`).

| # | violation | evidence | fix | merged |
|---|---|---|---|---|
| 1 | edits can overwrite committed state | 2 of 4 Agent write sites sent no `expected_graph_hash`; route docblock: *"A caller that sends nothing is unaffected, byte for byte"* | **#1743** | ❌ |
| 2 | analysis freshness absent | `current_graph_hash` 0 in `agent-v1-turn.ts` vs **6** in `route-v2.ts` | **#1746** | ❌ |
| 3 | receipts never on the wire | computed, truthful to the model, absent from the response | **#1747** | ❌ |
| 4 | reload cannot reproduce readiness | `analysis_ready` 0 in the graph READ route vs 13 / 31 | **nothing in flight** | — |
| 5 | provenance | ✅ **SOUND** — needs no fix | — | — |

⚠ **`rpc_mode: enforce` does NOT cover violation 1.** The route passes its OWN
freshly-read base to the RPC (`:645`), closing the route's read→write window, not
the caller's read→think→write window. `requires_expected_hash: true` has exactly two
enforcing consumers, both Conventional; the Agent lane never consults it. Derive the
posture with `curl -s https://cee-staging.onrender.com/healthz | jq .graph_cas` —
`config/index.ts:366` FORBIDS stating it in prose.

## MERGED TODAY (2)

- **#1748** `aa35b53a` — budget-check the success-target guidance. Cleared an inherited red on 5 of my branches + 3 other lanes'.
- **#1756** `bb6e0112` — a failed state readback no longer fails silently. **Logs a symptom; closes no violation.**

## THE FOUR OPEN PRs — heads as at handover

| PR | head | risk | notes |
|---|---|---|---|
| #1743 | `302b7cb42ff0a6f40f92e37830b105ccda53d798` | **NOT LOW** | violation 1. Needs an independent verdict. |
| #1746 | `c5633816215662993dc7be55c97c823d67bf4834` | **NOT LOW** | violation 2. Needs an independent verdict. |
| #1747 | `a939e161314f310beeacac679020af2973a9d3be` | LOW | violation 3 wire half. **Self-mergeable** once CI is green + a published head-bound verdict. |
| #1751 | `da3a0a1973baa84a559a855379e42b3b10adbee9` | **NOT LOW** | value-change disclosure. |

⚠ `staging` moved **5 times** today. **Re-resolve every head before binding anything**; each move voids a verdict and the merge guard enforces head-binding. `staging` at handover: `2b430c1e4b28ae551076813906fdcd1ba8e37134`.

## ⛔ I FOUND A REAL DEFECT IN ALL FOUR OF MY OWN FIXES TODAY

I had told Paul all four were ready. They were not. Every one was found by
ADVERSARIALLY ATTACKING my own work — none by re-reading it.

| commit | PR | what was wrong |
|---|---|---|
| `da3a0a19` | #1751 | The rescale disclosure **could never fire**. The sole producer (`agent-capabilities.ts:1202` → emit `:1292`) emits no `option`; my collector required one, so 100% of real entries were dropped. My fixture had **invented** `option`. Also rendered the literal word "undefined" to the user. |
| `302b7cb4` | #1743 | **Partially applied an unapproved authorisation.** `baseHash` was re-read after EVERY iteration regardless of refusal, so a stale base survived one op and ops 1..N landed on a model the user never approved. The fixture had one op, so nothing saw it. |
| `a939e161` | #1747 | `_agent.receipts` was `[]` on the turn that **mints version 1** — `build_model_from_brief` reports under `model_version` (singular, and `version_number` not `version`). |
| `c5633816` | #1746 | **Made freshness WORSE than the absence it replaced.** `/orchestrate/v2/turn` already stamps `current_graph_hash`, so my never-overwrite guard preserved the PRE-write hash → `graph_hash_at_run === current_graph_hash` on a turn that moved the model → the UI reported **FRESH over changed state**. |

### Two lessons that cost me real defects, generalise them

1. **`typeof NaN === 'number'`** bit me in TWO files (`turn-state-facts.ts`, `turn-receipts.ts`). Any numeric guard must test **finiteness**.
2. **Three inverted assertions were pinning defects SHUT** (#1751's drop rule, #1746's "NEVER overwrites", #1726's registration claim). When a test asserts the current behaviour is correct, ask whether it was ever verified against the producer.

## NEXT PRIORITIES, in order

1. **#1747 → merge.** LOW RISK, closes violation 3's wire half, and it is the ONLY one I can land alone. Re-resolve the head, wait for `Lint, TypeCheck, Unit Tests` + 0 running, run `scripts/premerge-check.sh Talchain/olumi-assistants-service 1747`, publish a substantive head-bound self-verdict **disclosing any checks I cancelled**, then `gh pr merge 1747 -R Talchain/olumi-assistants-service --squash --delete-branch` (the guard needs literals, not shell variables).
2. **Get an independent verdict on #1743 and #1746.** They touch a user's model. **Do not self-approve them** — my own judgement was wrong on all four today.
3. **#1751** — re-verify after `da3a0a19`, then seek a verdict.
4. **Violation 4** — still unowned. ⛔ **DO NOT "just add `analysis_ready`" to the graph READ route.** I tried and reverted: `assist.v1.scenario-graph.analysis-read.test.ts:448` forbids it because that route ships **no enforceable prose** (the leader-claim wire gate is not callable from a route helper) and `analysis_ready` carries `status_reason` + `user_questions`. The two real options are a prose-free readiness subset, or the client takes a turn after a reload. Contract decision.

## UNVERIFIED CANDIDATES from the adversarial workflow — do not act on these untested

The refute pass mostly **errored on the weekly usage limit**, so its
`by_pr: {1743:0, 1747:0, 1751:0}` is a **VACUOUS ZERO** — those refuters failed, they
did not refute. Candidates I have NOT verified:

- #1743: the counting guard is a literal string split, so a register call written another way is invisible; `build-model.ts:408` construction write has no CAS (guarded by `operation_id`, probably correct); both frame writes send only `{nodes, edges}` so `goal_constraints` may be dropped.
- #1747: all three replay exits omit `receipts`; the scale-frame register mints a version that is never collected.
- #1751: card bodies are never truncated so 3+ factors may silently exceed `CARD_BODY_MAX_CHARS`; `signal_id` keyed on COUNTS may collide.

**Verify each at the source before touching code.** That discipline is what produced all four real fixes.

## ⛔ BLOCKERS

1. **Weekly usage limit hit** — 126 of 160 workflow agents errored, *resets Sep 28 at 2am (Europe/London)*. **No subagent or workflow work until then.** Verify by hand.
2. **No independent reviewer in ~6 hours** on #1743/#1746.

## RESTART BANK — verified

- Working clone `cee-model-gen-20260921`: **0 uncommitted**, and **every** local branch SHA is reachable from a remote ref (checked with `git branch -r --contains` per ref, 47 branches).
- #1748 and #1756 pre-squash commits banked to `rescue/pr1748-preSquash-*` / `rescue/pr1756-preSquash-*`.
- **12 unbanked branches belonging to OTHER lanes** found in `/private/tmp` and pushed to `rescue/tmp-<tree>-<branch>-<sha8>` on their own remotes, plus one uncommitted tree captured via `git stash create`. `/private/tmp` is wiped on restart; nothing there is now unique.
- Probe artefacts + 30 scratchpad notes copied to `~/.claude/projects/-Users-paulslee-Documents-GitHub/restart-bank-20260923/`.
- Workflow transcript survives at `~/.claude/.../subagents/workflows/wf_ee50984e-d8b/journal.jsonl`.
