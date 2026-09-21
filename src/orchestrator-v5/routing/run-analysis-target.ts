/**
 * ONE RULE FOR "WHICH ENTITY DOES `run_analysis` ADDRESS?", READ FROM TWO
 * PLACES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES. `run_analysis` has no meaningful target: the
 * validation registry says so in its own words — *"The target of run_analysis
 * is the scenario as a whole … the handler is intrinsic to the scenario so
 * either is a valid addressable target"* — and accepts `['option','goal']`
 * purely so the proposal can cite `graph.options`.
 *
 * But `entity` is REQUIRED on every proposal
 * (`routing/types.ts` — `ProposalActionSchema.entity`), so on an LLM-elected
 * analysis the router must fill a field that carries no information. It
 * therefore INVENTS one, and on the measured builds it picked the DECISION
 * node roughly half the time. `toEntityKind` maps `decision` (and `factor`,
 * `outcome`, `risk`, `action`) to the entity kind `'node'`, which
 * `['option','goal']` does not accept, so `validator.ts` returns
 * `ENTITY_KIND_MISMATCH` and the user is told *"I found <Decision>, but I
 * can't make that change to it."* — about a request to run an analysis.
 *
 * Deployed staging, no-edit arm: `"Rerun."` produced 5 kind-mismatch refusals
 * against 5 successful runs, and `"Run analysis."` — the product's OWN chip
 * label — failed 1 of 2. A required field with no meaningful value, validated
 * strictly.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY THIS IS NOT A WIDENING OF WHAT RUNS. Same message, same build, the
 * analysis ALREADY runs on the other side of the coin flip. The entity is
 * chosen nondeterministically by the model; the DECISION to run was made
 * upstream, by the analysis-election gate on an LLM election, or by
 * construction on a deterministic pre-route. Repairing an unaddressable
 * target makes an already-made decision executable — it does not create one,
 * and it makes NOTHING reachable that was not already reachable. A kind
 * mismatch that fires on a coin flip was never a safety mechanism; the gate
 * is (`routing/analysis-election-gate.ts`, which fails CLOSED).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHY A SHARED MODULE AND NOT A SECOND IMPLEMENTATION. The ROADMAP 2.229
 * imperative-re-run pre-route in `turn-executor.ts` ALREADY answers this exact
 * question — it picks any option node and stamps a `context_inference`
 * resolution — and it gets the answer right by construction, which is why its
 * proposals never hit the mismatch. Writing the same rule a second time for
 * the repair site would put two implementations of one rule in one file, which
 * is this estate's signature defect (the two `generateGraphHash` twins). Both
 * call sites now read this function, so they cannot drift apart.
 *
 * ⚠ AND WHY AN OPTION RATHER THAN THE GOAL, even though the registry accepts
 * both: `runAnalysisPrecondition` tests for OPTION PRESENCE. Picking an option
 * makes the proposal and the precondition agree by construction, so a repair
 * can never trade `ENTITY_KIND_MISMATCH` for `PRECONDITION_UNMET` — which
 * would be a different refusal, not a fix.
 */

import type { ProposalEntity } from './types.js';

/**
 * The addressable proxy target for a `run_analysis` proposal, or `null` when
 * the graph carries no option node.
 *
 * `null` is a DECLINE, never a guess: with no option present the
 * `run_analysis` precondition cannot hold either, so the caller must leave the
 * turn exactly as it is rather than substitute a target that would only move
 * the refusal to a different code.
 *
 * `resolution_method` is `context_inference`, not `label_match`: the target
 * was not named by the user and was not compared against their text — it was
 * inferred from the scenario, which is what that method means. Declaring
 * `label_match` would invite the validator's Dice label-suspicion check to
 * reason about a comparison that never happened.
 */
export function resolveRunAnalysisTargetEntity(
  nodes: readonly unknown[] | undefined,
): ProposalEntity | null {
  const optionNode = (nodes ?? []).find(
    (n): n is { id: string; label?: unknown } =>
      typeof n === 'object' &&
      n !== null &&
      (n as { kind?: unknown }).kind === 'option' &&
      typeof (n as { id?: unknown }).id === 'string' &&
      (n as { id: string }).id.length > 0,
  );
  if (optionNode === undefined) return null;
  const label = optionNode.label;
  return {
    id: optionNode.id,
    kind: 'option',
    ...(typeof label === 'string' && label.length > 0 ? { label } : {}),
    resolution_status: 'resolved',
    resolution_method: 'context_inference',
  };
}
