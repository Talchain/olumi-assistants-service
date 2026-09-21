/**
 * ROADMAP 2.239 (CEE half) — the degenerate goal-threshold cap.
 *
 * MEASURED DEFECT (live, 2026-08-01 walk S1). CEE persisted the goal node
 *
 *   { goal_threshold: 1, goal_threshold_raw: 6000000,
 *     goal_threshold_unit: '£', goal_threshold_cap: 6000000 }
 *
 * i.e. `goal_threshold_cap === goal_threshold_raw`, forcing
 * `goal_threshold = 1.0` — EXACTLY the state `goal-threshold-cap.ts`'s own
 * doctrine names as forbidden:
 *
 *   "3. otherwise a 25% headroom cap above the target (never `cap === target`,
 *       which would force `goal_threshold = 1.0` and kill probability spread)."
 *
 * The guard was enforced only by rule 3's arithmetic. Rule 1 returned an
 * existing cap verbatim on `existingCap >= raw` — `>=`, not `>` — and
 * `goal_threshold_cap` is an LLM-WRITABLE draft field
 * (cee/draft/anthropic-graph-schema.ts:299), with the draft prompt itself
 * telling the model "goal_threshold_cap MUST be >= goal_threshold_raw"
 * (prompts/defaults-v19.ts:183).
 *
 * COST, measured on the deployed ISL build (diagnosis §5 Finding B): at
 * `goal_threshold = 1.0` the two options returned probability_of_goal 0.02125
 * and exactly 0.0 while the leader won 95% of scenarios — "0% chance of hitting
 * your goal" on a strong decision. At a non-degenerate threshold (~0.8) the same
 * graph discriminates properly.
 *
 * TWO paths are pinned here because the cap has TWO producers, and only one of
 * them goes through the resolver:
 *   - fix A — `resolveGoalThresholdCap` (covers chat `add_constraint` and the
 *     draft factor-extraction enricher);
 *   - fix B — `normaliseDraftResponse`, the single ingress for an LLM-authored
 *     graph, which is the ONLY place a model-written quad is seen before it is
 *     persisted. Nothing else recomputes `goal_threshold` from `raw / cap` for a
 *     goal node (complete manifest in fix-2239-cee-cap.md §2).
 */

import { describe, it, expect } from 'vitest';

import { resolveGoalThresholdCap } from '../../src/utils/goal-threshold-cap.js';
import { normaliseDraftResponse } from '../../src/adapters/llm/normalisation.js';

/** The live S1 goal node, verbatim from the captured `/proxy/v5/turn` wire. */
function liveS1GoalNode() {
  return {
    id: 'goal_arr',
    kind: 'goal',
    label: 'Reach £6M ARR Within 12 Months',
    goal_threshold: 1,
    goal_threshold_raw: 6000000,
    goal_threshold_unit: '£',
    goal_threshold_cap: 6000000,
    provenance: 'ai_inferred',
  };
}

function draftWith(node: Record<string, unknown>) {
  return { nodes: [node], edges: [] };
}

function goalOf(result: unknown): Record<string, unknown> {
  const nodes = (result as { nodes: Record<string, unknown>[] }).nodes;
  const goal = nodes.find((n) => n.kind === 'goal');
  if (!goal) throw new Error('no goal node in normalised result');
  return goal;
}

// ---------------------------------------------------------------------------
// Fix A — the resolver. Covers chat add_constraint (both sites) and the draft
// factor-extraction enricher, which are the three call sites of this function.
// ---------------------------------------------------------------------------
describe('2.239 fix A — resolveGoalThresholdCap never returns a cap equal to the target', () => {
  it('THE MEASURED DEFECT: an existing cap EQUAL to the raw target is refused, not returned verbatim', () => {
    // Before the fix this returned 6000000, giving goal_threshold = 1.0 exactly.
    const cap = resolveGoalThresholdCap(6000000, 6000000, '£', '£');
    expect(cap).not.toBe(6000000);
    expect(cap).toBe(7500000); // raw * 1.25 — rule 3
  });

  it('and the resulting threshold leaves real probability spread (0.8, not 1.0)', () => {
    const raw = 6000000;
    const cap = resolveGoalThresholdCap(raw, raw, '£', '£');
    expect(cap).not.toBeNull();
    const threshold = raw / (cap as number);
    expect(threshold).toBeCloseTo(0.8, 10);
    // The property that actually matters — it is strictly inside the model
    // range, so P(sample >= threshold) is not asking for the ceiling of the
    // normalisation scale.
    expect(threshold).toBeLessThan(1);
    expect(threshold).toBeGreaterThan(0);
  });

  it('ADVERSARIAL: a model-supplied cap BELOW the raw target is refused and re-derived (threshold stays in range)', () => {
    // An LLM that undercuts its own target would otherwise mint a
    // goal_threshold > 1.0 — outside the model range entirely.
    const raw = 6000000;
    const cap = resolveGoalThresholdCap(5000000, raw, '£', '£');
    expect(cap).toBe(7500000);
    expect(raw / (cap as number)).toBeCloseTo(0.8, 10);
  });

  it('a genuinely LARGER existing cap is still reused verbatim (rule 1 survives)', () => {
    expect(resolveGoalThresholdCap(1000, 150, undefined, undefined)).toBe(1000);
    // One unit above the target is still strictly greater, and still honoured —
    // the fix narrows the boundary by exactly one point, it does not disable
    // cap reuse.
    expect(resolveGoalThresholdCap(151, 150, undefined, undefined)).toBe(151);
  });

  it('THE ONE SANCTIONED cap === raw: a 100% target still normalises against 100', () => {
    // Deliberate exemption, not an oversight. "Achieve 100% retention" is a
    // genuine ask-for-the-ceiling, so goal_threshold = 1.0 is the HONEST
    // question here, not a normalisation artefact. Applying 25% headroom would
    // silently rescale the user's stated 100% target to 0.8 of the scale and
    // would break rule 2 (percentages must not be distorted by absolute caps).
    // Pinned so a later lane reading only rule 3 cannot "fix" it.
    expect(resolveGoalThresholdCap(100, 100, '%', '%')).toBe(100);
    expect(resolveGoalThresholdCap(undefined, 100, '%', undefined)).toBe(100);
    // Below the ceiling the '%' branch is unaffected either way.
    expect(resolveGoalThresholdCap(96, 96, '%', '%')).toBe(100);
  });

  it('a non-positive target still returns null (no sound denominator exists)', () => {
    expect(resolveGoalThresholdCap(0, 0, undefined, undefined)).toBeNull();
    expect(resolveGoalThresholdCap(-5, -5, undefined, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix B — the LLM-authored quad. This path never touched the resolver at all,
// so fix A alone leaves the measured wire value untouched on a drafted graph.
// ---------------------------------------------------------------------------
describe('2.239 fix B — an LLM-authored degenerate quad is repaired at draft ingress', () => {
  it('THE MEASURED WIRE VALUE: the live S1 goal node no longer normalises to goal_threshold 1.0', () => {
    const goal = goalOf(normaliseDraftResponse(draftWith(liveS1GoalNode())));

    expect(goal.goal_threshold).not.toBe(1);
    expect(goal.goal_threshold_cap).toBe(7500000);
    expect(goal.goal_threshold).toBeCloseTo(0.8, 10);
    // The user-facing target is NEVER rewritten — only the denominator is.
    expect(goal.goal_threshold_raw).toBe(6000000);
    expect(goal.goal_threshold_unit).toBe('£');
  });

  it('ADVERSARIAL: a model-supplied cap BELOW its own raw target cannot ship a threshold above 1.0', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_arr',
          kind: 'goal',
          label: 'Reach £6M ARR',
          goal_threshold: 1.2, // what raw/cap would give — outside the model range
          goal_threshold_raw: 6000000,
          goal_threshold_unit: '£',
          goal_threshold_cap: 5000000,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(7500000);
    expect(goal.goal_threshold).toBeCloseTo(0.8, 10);
    expect(goal.goal_threshold as number).toBeLessThanOrEqual(1);
  });

  // ── F1 (review): the repair must NOT touch a sound PERCENTAGE cap ──────
  // `resolveGoalThresholdCap` evaluates its '%' rule (raw 0-100 → cap 100)
  // BEFORE the existing-cap rule. Calling it unconditionally therefore
  // rewrote strictly-greater, entirely sound percentage caps — silently, on
  // NON-degenerate graphs, in the over-optimistic direction, and about to
  // become user-visible via PLoT #299. That is the same class of defect this
  // whole PR exists to fix, reintroduced by the fix. The `cap <= raw` gate
  // confines the repair to denominators that cannot be sound.
  // Nothing pinned this before: the only sound-passthrough case used '£', and
  // every '%' fixture in the repo happens to use cap 100.
  it('F1: a SOUND percentage cap (cap 20 > raw 5) is NOT rewritten to 100 — 5x error', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_conv',
          kind: 'goal',
          label: 'Reach 5% Conversion',
          goal_threshold: 0.25,
          goal_threshold_raw: 5,
          goal_threshold_unit: '%',
          goal_threshold_cap: 20,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(20);
    expect(goal.goal_threshold).toBe(0.25);
  });

  it('F1: a SOUND percentage cap (cap 1000 > raw 80) is NOT rewritten to 100 — 10x error', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_nps',
          kind: 'goal',
          label: 'Reach 80% Adoption',
          goal_threshold: 0.08,
          goal_threshold_raw: 80,
          goal_threshold_unit: '%',
          goal_threshold_cap: 1000,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(1000);
    expect(goal.goal_threshold).toBe(0.08);
  });

  // ── F2 (review): thresholds the LIVE prompt instructs must survive ─────
  // v187's MODEL UNIT TYPES table (defaults-v187.ts:296-303) declares that
  // `goal_threshold` is NOT `raw / cap` for two of its four rows. A model
  // following the prompt exactly, and choosing the minimum cap the prompt
  // permits (`cap = raw`, which :294 explicitly allows), would otherwise have
  // a CORRECT, prompt-instructed threshold overwritten with 0.8. The
  // convention gate — the drafted threshold must actually equal raw/cap —
  // keeps the repair to quads that use the normalisation this fix is about.
  it('F2: v187 "Ratio that can exceed 100%" (NRR 110% → 1.10, raw 110) is left alone', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_nrr',
          kind: 'goal',
          label: 'Reach 110% Net Revenue Retention',
          goal_threshold: 1.1,
          goal_threshold_raw: 110,
          goal_threshold_unit: '%',
          goal_threshold_cap: 110,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(110);
    expect(goal.goal_threshold).toBe(1.1);
  });

  it('F2: v187 "Small count (0-10)" (3 hires → 3, raw 3) is left alone', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_hires',
          kind: 'goal',
          label: 'Make 3 Senior Hires',
          goal_threshold: 3,
          goal_threshold_raw: 3,
          goal_threshold_unit: 'count',
          goal_threshold_cap: 3,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(3);
    expect(goal.goal_threshold).toBe(3);
  });

  // ── F3 (review): never MINT a threshold that did not exist ─────────────
  // Writing one here would also close the factor-extraction enricher's
  // redirect branch, which is gated on `goal_threshold === undefined`
  // (enricher.ts:649) — a behaviour change well outside this fix's claim.
  it('F3: a raw+cap pair with NO drafted threshold is left alone (never mints one)', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_cust',
          kind: 'goal',
          label: 'Reach 800 Customers',
          goal_threshold_raw: 800,
          goal_threshold_unit: 'customers',
          goal_threshold_cap: 800,
        }),
      ),
    );

    expect(goal.goal_threshold).toBeUndefined();
    expect(goal.goal_threshold_cap).toBe(800);
  });

  it('a threshold that merely DISAGREES with a sound raw/cap pair is left alone (declared out of scope)', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_odd',
          kind: 'goal',
          label: 'Reach £20k MRR',
          goal_threshold: 0.5, // != 20000/25000
          goal_threshold_raw: 20000,
          goal_threshold_unit: '£',
          goal_threshold_cap: 25000,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(25000);
    expect(goal.goal_threshold).toBe(0.5);
  });

  it('a SOUND model-supplied quad is passed through byte-identically (no gratuitous rewrite)', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_rev',
          kind: 'goal',
          label: 'Reach £20k MRR',
          goal_threshold: 0.8,
          goal_threshold_raw: 20000,
          goal_threshold_unit: '£',
          goal_threshold_cap: 25000,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(25000);
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_raw).toBe(20000);
  });

  it('a 100% percentage target keeps cap 100 / threshold 1.0 through ingress too', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_ret',
          kind: 'goal',
          label: 'Achieve 100% Retention',
          goal_threshold: 1,
          goal_threshold_raw: 100,
          goal_threshold_unit: '%',
          goal_threshold_cap: 100,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(100);
    expect(goal.goal_threshold).toBe(1);
  });

  it('a degenerate PERCENTAGE quad is repaired against 100, not against 25% headroom', () => {
    // cap === raw === 96 would give threshold 1.0; rule 2 (not rule 3) is the
    // correct repair for a percentage, so the cap becomes 100 and the threshold
    // becomes the user's actual 96%.
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_ret',
          kind: 'goal',
          label: 'Achieve Retention Above 96%',
          goal_threshold: 1,
          goal_threshold_raw: 96,
          goal_threshold_unit: '%',
          goal_threshold_cap: 96,
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBe(100);
    expect(goal.goal_threshold).toBeCloseTo(0.96, 10);
  });

  it('leaves a goal node with no cap alone (minting one is the enricher/sweep’s job, not ingress’s)', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_x',
          kind: 'goal',
          label: 'Grow revenue by 500k',
          goal_threshold: 0.5,
          goal_threshold_raw: 500000,
          goal_threshold_unit: '£',
        }),
      ),
    );

    expect(goal.goal_threshold_cap).toBeUndefined();
    expect(goal.goal_threshold).toBe(0.5);
    expect(goal.goal_threshold_raw).toBe(500000);
  });

  it('leaves a goal node with no raw target alone (nothing to normalise against)', () => {
    const goal = goalOf(
      normaliseDraftResponse(
        draftWith({
          id: 'goal_q',
          kind: 'goal',
          label: 'Improve team morale',
          goal_threshold: 1,
          goal_threshold_cap: 1,
        }),
      ),
    );

    // Untouched here — Stage 4b (threshold-sweep) is what strips a
    // raw-less threshold, and it must keep seeing exactly what it sees today.
    expect(goal.goal_threshold).toBe(1);
    expect(goal.goal_threshold_cap).toBe(1);
  });

  it('does not touch a NON-goal node carrying the same field names', () => {
    // Kind-aware stripping already blanks these on non-goal nodes; this pins
    // that the new repair does not resurrect them.
    const result = normaliseDraftResponse(
      draftWith({
        id: 'fac_1',
        kind: 'factor',
        label: 'Some factor',
        goal_threshold: 1,
        goal_threshold_raw: 6000000,
        goal_threshold_cap: 6000000,
      }),
    );
    const node = (result as { nodes: Record<string, unknown>[] }).nodes[0];
    expect(node.goal_threshold).toBeUndefined();
    expect(node.goal_threshold_cap).toBeUndefined();
    expect(node.goal_threshold_raw).toBeUndefined();
  });

  it('a non-finite / non-positive raw or cap is left untouched (no NaN can be minted)', () => {
    for (const bad of [
      { goal_threshold_raw: 0, goal_threshold_cap: 0 },
      { goal_threshold_raw: -100, goal_threshold_cap: -100 },
      { goal_threshold_raw: 100, goal_threshold_cap: 0 },
    ]) {
      const goal = goalOf(
        normaliseDraftResponse(
          draftWith({ id: 'g', kind: 'goal', label: 'Edge case 1', goal_threshold: 1, ...bad }),
        ),
      );
      expect(Number.isNaN(goal.goal_threshold as number)).toBe(false);
      expect(goal.goal_threshold).toBe(1);
    }
  });
});
