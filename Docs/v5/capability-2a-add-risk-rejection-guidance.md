# Capability 2A — add-risk rejection guidance (rejection-at-source enrichment)

**Flag:** `CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED` (`config.cee.addRiskRejectionGuidanceEnabled`), **default OFF**.
**Branch:** `claude/cap2a-add-risk-rejection-guidance` off `origin/staging@ed93c0ad`. **Not pushed/merged/deployed;
flag not enabled.** Placeholder copy only — final wording authored separately before any live run / flag enablement.

## What it does

When an `edit_graph` add-risk attempt fails structural validation with a **reachability-class** violation — the new
risk node is not reachable from the decision (e.g. wired only to an option, or orphaned) — the bare rejection
currently renders a generic "it would create an inconsistency in the model structure" line (the structured
violation codes are deliberately suppressed: `patch-rejection-helper.ts`). With the flag ON, that single rejection
class instead renders a deterministic, **structural-only** next step grounded only in graph reachability.

This targets the **originating** rejection (the `cdd306e0`-class turn), to make the bare rejection useful/grounded/fast
so the user is less likely to be pushed into an LLM follow-up (the `a9da06f2`-class turn). It does **not** by itself
prove the later follow-up disappears — that remains 2B / downstream evidence.

## Why this is grounded, not invented (local-validator replay)

`risk → option` (no factor inbound) is **schema-valid** but `validateGraphStructure` rejects it with exactly
**`NO_PATH_TO_GOAL`** ("not reachable from decision via directed paths"); an edge-less risk → `ORPHAN_NODE`;
`option → risk` is **valid**. There is **no** validator rule that "risks must flow through factors" — so the copy
states only the reachability fact ("the risk isn't connected, so it has no path through to your goal") and offers a
factor as an **example** host (the deterministic add-risk template connects `factor → risk`), never as a claimed
rule and never with an invented concept name.

## Conservative classifier

`classifyAddRiskToOptionRejection(candidateGraph, newViolations, operations?)` returns a match **only** when: every
new violation is reachability-class (`NO_PATH_TO_GOAL`/`ORPHAN_NODE`); a violated node is `kind:'risk'`; and that
risk has **no inbound directed edge from a factor**. It returns `null` for every other rejection (generic invalid
graph, cycles, limits, missing kinds, option-factor, orphan non-risk, properly-hosted risk, mixed codes), so it can
never broaden a generic rejection.

## Proof (this branch)

- `src/orchestrator/__tests__/add-risk-rejection-guidance.test.ts` — classifier: positive (risk→option, orphan
  risk) + negatives (NO_GOAL, cycle, limits, orphan factor, mixed codes, properly-hosted risk, empty); operations
  observability; placeholder-copy structural-only assertion. **10 tests.**
- `tests/unit/orchestrator/add-risk-rejection-render.test.ts` — envelope render: flag-OFF targeted = **byte-identical**
  generic; flag-ON non-targeted (cycle, orphan factor) = byte-identical generic; flag-ON targeted = enriched;
  chips unchanged; `budget_exceeded` unaffected; no held-science / no invented mechanism / no internal vocab. **8 tests.**
- tsc: **543 → 543, 0 introduced.** eslint: clean. Affected suites (validator, config, edit-graph route): green.
  Pre-existing env-dependent reds in `edit-graph-dispatch-add-risk-e2e` are identical with/without this change.

## Flag / rollback
Default OFF → rendering is byte-identical to today. Rollback = leave the flag unset (or
`CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED=false`). No schema / validator / PLoT / ISL / migration / generated / UI /
mutation-spine / global-classifier changes.

## Track B — source-rejection acceptance target (IDENTIFIED, to add in the Track B workstream)

Track B harness lives on `eval/post-analysis-proof` (`ce6d48ef`, worktree `eval-post-analysis-proof`) — a separate
branch, so the target is **identified here, to be added there** (not cross-committed from this branch):
- **Fixture:** a source-rejection turn = the unsupported add-risk-to-option edit (the `cdd306e0` class), captured as
  a deterministic replay observation (rejection envelope assistant_text + the structured violation = `NO_PATH_TO_GOAL`).
- **Acceptance invariant (extend A8 "no phantom/ungrounded claim", or a new `A8b — source-rejection grounded`):**
  with the flag ON, the rejection assistant_text (a) is **not** the generic suppression, (b) states only the
  reachability fact (no invented mechanism — assert absence of "couldn't resolve cleanly" / "must flow through
  factors"), (c) contains **no held-science** vocabulary, and (d) offers a structural next step. With the flag OFF,
  it equals the generic baseline.
- **A10 note:** this turn is deterministic (no LLM at the rejection render), so it should not trip A10 wrongful-escalation.
- The `f4835349` follow-up (`a9da06f2`) fixture remains **downstream / 2B evidence** — it is NOT proof that 2A alone
  fixes the later turn.
