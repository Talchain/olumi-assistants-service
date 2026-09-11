/**
 * OPTION_NO_OP — THE SINGLE AUTHORITY FOR "does this option change anything?".
 *
 * A non-baseline option whose interventions sit at the level every factor it
 * touches ALREADY HAS is not a genuine alternative. Paul's session, 11 Sep 2026
 * (`olumi-debug-5b41f0eb-20260911.json`): an option labelled with the user's own
 * question — *"increase the Pro plan price from £49 to £59"* — carried
 * `sets_to` 0.49 against a 0.49 baseline. It modelled changing nothing, raising
 * the price hurt in that model, so the do-nothing arm had the least downside and
 * the assistant said *"…currently leads"* at `warnings_count: 0`.
 *
 * ## WHY THIS IS ITS OWN LEAF MODULE, and not an export of `graph-validator.ts`
 *
 * Two consumers now need this predicate: the VALIDATOR, which reports it, and
 * the ENFORCEMENT REPAIR, which acts on it. A copy in the second would be the
 * estate's dominant defect class (trap 12 — a list a human must remember to
 * sync WILL drift, and the drift always reads as green): the reporter and the
 * repairer would disagree about what a no-op is, and the disagreement would
 * surface as a draft that is refused for a defect the repair believed it fixed.
 *
 * The obvious repair — import it from `graph-validator.ts` — is REFUTED BY
 * EXECUTION, exactly as `bucket-c-codes.ts` documents for `deterministic-sweep`.
 * FIVE specs replace the validator wholesale with a `vi.mock` factory returning
 * only `validateGraph`:
 *   - tests/unit/cee.unified-pipeline.graph-enforcement.test.ts
 *   - tests/unit/cee.unified-pipeline.stage-4.test.ts
 *   - tests/unit/cee.deterministic-sweep.deletions.test.ts
 *   - tests/unit/cee.deterministic-sweep.gating.test.ts
 *   - tests/integration/sweep-status-quo-integration.test.ts
 * A `vi.mock` factory REPLACES the module, so under any of them an enforcement
 * import of `findNoOpOptions` from the validator resolves to `undefined` and the
 * repair dies at the call. A leaf module with no behaviour beyond this one
 * question, no reason to be mocked, and only `baseline-identity` beneath it
 * (never mocked anywhere in the tree) makes that hazard structurally impossible
 * rather than a discipline someone must remember.
 *
 * `graph-validator.ts` re-exports {@link LEVEL_IDENTITY_EPSILON},
 * {@link levelsAreIdentical} and {@link readFactorBaselineLevel}, so every
 * existing importer is unchanged.
 */

import { readIsBaseline, type BaselineFlagSurfaces } from "../cee/baseline-identity.js";
import type { NodeT } from "../schemas/graph.js";
// The estate's ONE owner of "what frame is this factor on?" — a leaf module
// with no imports of its own. Consulted rather than re-derived so this file
// cannot hold a private opinion about the divisor (trap 12).
import { resolveScaleFrame } from "../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js";

/**
 * The resolution at which two model levels are "the same number".
 *
 * Half the 4-decimal quantum `buildInterventionSignature` canonicalises to,
 * spelled numerically because this comparison must be SIGN-SYMMETRIC and
 * `toFixed` is not: `(-0.00001).toFixed(4)` is `"-0.0000"` while
 * `(0.00001).toFixed(4)` is `"0.0000"`. An invariant written with the same
 * asymmetry as its neighbour is a guard agreeing with itself (trap 13d), and
 * the intervention map is a bare `z.record(z.string(), z.number())`
 * (`schemas/graph.ts:200`) — it admits negatives.
 *
 * ⚠ TWO DIFFERENT QUESTIONS AT ONE RESOLUTION, NOT ONE PREDICATE SHARED
 * (trap 21). `buildInterventionSignature` decides "are these two options the
 * same as each other?"; this decides "is this option the same as the status
 * quo?". They must not drift apart on what counts as the same number, so the
 * agreement is ASSERTED in `__tests__/option-no-op-invariant.test.ts` rather
 * than enforced by making one call the other.
 */
export const LEVEL_IDENTITY_EPSILON = 5e-5;

/** Whether two model levels are indistinguishable at the identity resolution. */
export function levelsAreIdentical(a: number, b: number): boolean {
  return Math.abs(a - b) <= LEVEL_IDENTITY_EPSILON;
}

/** The three fields that between them say where a factor sits, on one surface. */
type FactorLevelSurface = {
  readonly value?: unknown;
  readonly raw_value?: unknown;
  readonly baseline?: unknown;
};

/** The number itself, or `undefined` for anything that is not a finite one. */
function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * ⭐⭐ THE STATED CURRENT LEVEL — `baseline`, put onto the frame `value` is on.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A `from X to Y` brief is extracted as `{value: Y, baseline: X}`
 * (`factor-extraction/index.ts:2203`, measured by execution: Paul's price
 * brief yields `{value: 59, baseline: 49, unit: "£"}`). `value` therefore
 * holds the PROPOSED level and `baseline` holds the current one — the
 * interface's own comment admits it, calling `value` *"Current or proposed
 * value"*, which is two questions under one name (trap 21). The factor is born
 * at its target, so an option that raises the price to £59 changes nothing and
 * `OPTION_NO_OP` refuses a draft that is describing a real alternative. The
 * check is right; the data is wrong.
 *
 * ── WHY `baseline` IS SAFE TO BELIEVE HERE ─────────────────────────────────
 * Every writer that puts a number in `baseline` means the same thing by it —
 * derived at the bytes across CEE staging `77d11382`, not inferred from the
 * name. The regex from-to extractors write the FROM number
 * (`index.ts:1851/2203/2227/2275`); the LLM factor extractor is instructed
 * *"baseline: (optional) Starting value for from-to patterns"*
 * (`llm-extractor.ts:78`); the structural-edit tool declares it to the model as
 * *"The amount before any change, when it differs"*
 * (`propose-structural-edit.ts:1029`). The draft prompt never asks for it at
 * all — it says *"data.value is baseline (pre-intervention)"*
 * (`defaults-v187.ts:420`) — and `anthropic-graph-schema.ts` declares no such
 * property, so no LLM draft can write one.
 *
 * ── THE SCALE, WHICH IS THE WHOLE HAZARD ───────────────────────────────────
 * `baseline` is in the units of the `value` it was written BESIDE: raw for a
 * currency from-to (49 beside 59), already fractional for a percent one (0.85
 * beside 0.95). The records projector reframes `value` afterwards
 * (`projector.ts:3503` — `value: raw/frame`, `raw_value: raw`) and does not
 * touch `baseline`, which is how `{value: 0.59, raw_value: 59, baseline: 49}`
 * arises. Dividing is therefore mandatory where a frame exists and FORBIDDEN
 * where one does not, and reading `baseline` raw against framed interventions
 * would swap an inverted graph for a 100×-wrong one.
 *
 * The divisor is not re-derived here. `resolveScaleFrame` is the estate's one
 * owner of *"what frame is this factor on?"* — stored `scale_frame` first, the
 * `{value, raw_value}` pair second — and a private opinion about the frame is
 * exactly the hand-maintained mirror of trap 12.
 *
 * ── WHY A BASELINE EQUAL TO `value` IS DELIBERATELY IGNORED ────────────────
 * Goal and constraint-target writers stamp `{value: B, baseline: B}` in MODEL
 * units beside a raw `raw_value` (`add-constraint.ts:906`, `schema-v3.ts:354`,
 * `compound-goals.ts:844`) — there the two names carry one number and a frame
 * IS recoverable from the pair, so dividing would be the 100× error. Requiring
 * the two to DIFFER keeps this to the case where `baseline` states something
 * `value` does not, and the equal case falls through to today's answer, which
 * is already correct.
 *
 * ── FAILURE DIRECTION ──────────────────────────────────────────────────────
 * Where no frame resolves, the baseline is returned in its own units. Against
 * framed interventions that cannot match, so the verdict is "this option
 * changes something" — the safe direction this predicate already documents
 * ("Refusing to accuse is the safe direction here", trap 22b). It can withhold
 * a no-op finding; it cannot manufacture one.
 */
function readStatedCurrentLevel(node: NodeT): number | undefined {
  const observed = (node as { observed_state?: FactorLevelSurface }).observed_state;
  const data = node.data as FactorLevelSurface | undefined;

  // ONE SURFACE AT A TIME. `baseline` means what it means relative to the
  // `value` written beside it, so pairing `observed_state.baseline` with
  // `data.value` would compare two numbers from different writes.
  const surface: FactorLevelSurface | undefined =
    finiteOrUndefined(observed?.baseline) !== undefined
      ? observed
      : finiteOrUndefined(data?.baseline) !== undefined
        ? data
        : undefined;
  if (surface === undefined) return undefined;

  const baseline = finiteOrUndefined(surface.baseline);
  const value = finiteOrUndefined(surface.value);
  if (baseline === undefined || value === undefined) return undefined;
  if (baseline === value) return undefined;

  const frame = resolveScaleFrame({
    storedFrame: (node as { scale_frame?: unknown }).scale_frame,
    value,
    raw_value: surface.raw_value,
  });
  return frame === undefined ? baseline : baseline / frame;
}

/**
 * The level the ANALYSIS treats as "where this factor is today".
 *
 * ⚠ TWO SENSES OF ONE WORD MEET IN THIS FUNCTION, AND THEY ARE NAMED APART
 * (trap 21). This function's own "baseline" is *the level an intervention is
 * compared against*; the FIELD `baseline` it now consults is *the level the
 * user stated the factor is at today*. They are the same quantity only when the
 * graph is not inverted, which is precisely the bug — so the stated level wins
 * where it exists and says something the value does not.
 *
 * ⭐ PRECEDENCE, STATED: a stated current level
 * (`readStatedCurrentLevel` — `baseline`, on `value`'s frame) first, then
 * `FactorObservedState.value`, documented at `schemas/graph.ts:263` as *"The
 * factor's current position on the model 0-1 scale (PLoT normalises)"* and
 * carried by the run payload, then `data.value`.
 *
 * `data.value` is the FALLBACK, not a rival: the projector's scale pass writes
 * both (`projector.ts:3505-3506`) and `schema-v3.ts` rebuilds `observed_state`
 * FROM `data`, so on a fully-projected graph they agree by construction. A
 * graph that carries only one is still readable, and the precedence is pinned
 * by a test rather than left to whichever happens to be present.
 *
 * Returns `undefined` when no surface carries a finite number. That is
 * NOT a no-op verdict: a factor the brief states no value for cannot prove an
 * option changes nothing.
 */
export function readFactorBaselineLevel(node: NodeT): number | undefined {
  const stated = readStatedCurrentLevel(node);
  if (stated !== undefined) return stated;
  const observed = (node as { observed_state?: { value?: unknown } }).observed_state;
  if (typeof observed?.value === "number" && Number.isFinite(observed.value)) {
    return observed.value;
  }
  const data = node.data as { value?: unknown } | undefined;
  if (typeof data?.value === "number" && Number.isFinite(data.value)) {
    return data.value;
  }
  return undefined;
}

/** One option that changes nothing, and the factors that proved it. */
export interface NoOpOptionFinding {
  readonly optionId: string;
  /** Ids only — no magnitudes, per the rule `schema-v3.ts:1095` states. */
  readonly factorIds: string[];
}

/**
 * Every non-baseline option whose stated interventions leave every factor it
 * touches exactly where it already is, in graph node order.
 *
 * ## WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE (trap 13d)
 *
 * The phrasing that produced Paul's defect is where we came in, not the
 * property. Nothing here reads a label, a verb or a number in a sentence: a
 * predicate over the wording would have to be right about natural language in
 * both directions, and four consecutive rounds on one such predicate have
 * already proved this estate cannot bound one (trap 22f). What an option DOES
 * is decidable, so that is what is decided.
 *
 * ## EVERY AMBIGUOUS DIRECTION FAILS SAFE — DO NOT "TIDY" THESE
 *
 * A false positive WITHDRAWS a real alternative, which is the worse of the two
 * harms this one predicate stands between (trap 22b). So an absent or empty
 * map, a dangling or non-factor reference, a non-finite level, and a factor
 * with no readable baseline each mean NOT A NO-OP — never a no-op verdict.
 * Absent/empty maps belong to different owners with different remedies
 * (`NO_EFFECT_PATH`, `OPTIONS_IDENTICAL`, and the analysable-option gate's
 * `no_interventions` exclusion); a dangling reference is
 * `INVALID_INTERVENTION_REF`'s question.
 *
 * @param options Option nodes, in graph order.
 * @param nodeById Every node by id — the lookup for intervention targets.
 */
export function findNoOpOptions(
  options: readonly NodeT[],
  nodeById: ReadonlyMap<string, NodeT>,
): NoOpOptionFinding[] {
  const findings: NoOpOptionFinding[] = [];

  for (const option of options) {
    const data = option.data as { interventions?: Record<string, unknown> } | undefined;
    const interventions = data?.interventions;
    // No stated magnitude is a DIFFERENT question, with different owners.
    // An absent map is not a no-op.
    if (!interventions) continue;
    const entries = Object.entries(interventions);
    if (entries.length === 0) continue;

    // The status quo is ALLOWED to equal the status quo. Read through the one
    // authority for the two surfaces this flag can arrive on — the draft model
    // emits them disagreeing in 5 of 30 measured samples, and a second copy of
    // the reconciliation rule here is how the same option becomes a baseline on
    // one code path and not on another (`cee/baseline-identity.ts`).
    if (readIsBaseline(option as BaselineFlagSurfaces) === true) continue;

    const factorIds: string[] = [];
    let changesNothing = true;
    for (const [factorId, level] of entries) {
      const target = nodeById.get(factorId);
      if (!target || target.kind !== "factor") { changesNothing = false; break; }
      if (typeof level !== "number" || !Number.isFinite(level)) { changesNothing = false; break; }
      const baseline = readFactorBaselineLevel(target);
      if (baseline === undefined) { changesNothing = false; break; }
      if (!levelsAreIdentical(level, baseline)) { changesNothing = false; break; }
      factorIds.push(factorId);
    }

    if (changesNothing) findings.push({ optionId: option.id, factorIds });
  }

  return findings;
}
