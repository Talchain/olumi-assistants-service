/**
 * ROADMAP 2.315(a) — the raw goal-target trio on `analysis_ready`.
 *
 * THE DEFECT: a goal target of £800,000 rendered on Inspector v2 as
 * "Success means reaching >= 0.8 count" — the NORMALISED value with a
 * placeholder unit. Nothing was malfunctioning: `goal_threshold` 0.8 is the
 * payload's perfectly normal normalised value. The raw target (800000), its
 * unit ("£") and the normalisation cap simply NEVER LEFT CEE — the
 * `analysis_ready` payload carried the normalised number alone, so no
 * consumer could recover the user's own figure.
 *
 * THE FIX under test: carry `goal_threshold_raw`, `goal_threshold_unit` and
 * `goal_threshold_cap` on `analysis_ready`, sourced VERBATIM from the values
 * the enricher already attested on the goal node.
 *
 * ⚠ WHY THE FIXTURE LOOKS "WRONG" — IT IS DELIBERATE AND LOAD-BEARING.
 * The attested trio below is intentionally NOT self-consistent:
 *
 *     goal_threshold 0.75 · raw 800000 · cap 1200000   (800000/1200000 = 0.667)
 *
 * A CARRY and a RE-DERIVATION therefore produce DIFFERENT numbers, which is
 * the only way a test can tell them apart:
 *
 *     carry     raw -> 800000        re-derive threshold*cap -> 900000
 *     carry     cap -> 1200000       re-derive raw*1.25       -> 1000000
 *
 * Were the fixture self-consistent, a re-deriving implementation would pass
 * these assertions by coincidence and the guard would be theatre. Second
 * derivation of an already-attested value is this estate's dominant defect
 * class (the same cap can be resolved several defensible ways, so a
 * re-derivation downstream silently disagrees with the number the graph was
 * actually scored against). These values are carried, never recomputed —
 * DO NOT "fix" the fixture to make the arithmetic line up.
 */

import { describe, it, expect } from 'vitest';
import { enrichGraphWithFactorsAsync } from '../../src/cee/factor-extraction/enricher.js';
import { transformGraphToV3 } from '../../src/cee/transforms/schema-v3.js';
import type { GraphT } from '../../src/schemas/graph.js';
import { buildAnalysisReadyPayload } from '../../src/cee/transforms/analysis-ready.js';
import { computeStructuralReadiness } from '../../src/orchestrator/tools/analysis-ready-helper.js';
import { extractAnalysisReady } from '../../src/orchestrator/tools/draft-graph.js';
import { AnalysisReadyPayload } from '../../src/schemas/analysis-ready.js';
import type { OptionV3T, GraphV3T, NodeV3T } from '../../src/schemas/cee-v3.js';

// The attested goal contract — one object, used by every hop below, so the
// tests compare against a single source of truth rather than restated literals.
const ATTESTED = {
  goal_threshold: 0.75,
  goal_threshold_raw: 800000,
  goal_threshold_unit: '£',
  goal_threshold_cap: 1200000,
} as const;

// Values a plausible RE-DERIVATION would produce from the same fixture.
// Asserted against explicitly so the "carried, not recomputed" claim is
// checked in both directions rather than only positively.
const REDERIVED_RAW = ATTESTED.goal_threshold * ATTESTED.goal_threshold_cap; // 900000
const REDERIVED_CAP = ATTESTED.goal_threshold_raw * 1.25; // 1000000

function goalNode(withTrio: boolean): NodeV3T {
  const node = {
    id: 'goal_1',
    kind: 'goal',
    label: 'Reach £800,000 revenue',
    goal_threshold: ATTESTED.goal_threshold,
  } as Record<string, unknown>;
  if (withTrio) {
    node.goal_threshold_raw = ATTESTED.goal_threshold_raw;
    node.goal_threshold_unit = ATTESTED.goal_threshold_unit;
    node.goal_threshold_cap = ATTESTED.goal_threshold_cap;
  }
  return node as NodeV3T;
}

function graphWithGoal(withTrio: boolean): GraphV3T {
  return {
    nodes: [
      goalNode(withTrio),
      { id: 'fac_spend', kind: 'factor', label: 'Marketing spend', category: 'controllable', observed_state: { value: 10 } },
      { id: 'opt_1', kind: 'option', label: 'Option A' },
      { id: 'opt_2', kind: 'option', label: 'Do nothing' },
    ] as unknown as NodeV3T[],
    edges: [
      { from: 'opt_1', to: 'fac_spend' },
      { from: 'opt_2', to: 'fac_spend' },
      { from: 'fac_spend', to: 'goal_1' },
    ],
  } as unknown as GraphV3T;
}

function option(id: string, label: string): OptionV3T {
  return {
    id,
    label,
    status: 'ready',
    interventions: {
      fac_spend: {
        value: 20,
        source: 'brief_extraction',
        target_match: { node_id: 'fac_spend', match_type: 'exact_id', confidence: 'high' },
      },
    },
  } as unknown as OptionV3T;
}

describe('ROADMAP 2.315(a) — analysis_ready carries the attested raw goal trio', () => {
  describe('hop 1: buildAnalysisReadyPayload (src/cee/transforms/analysis-ready.ts)', () => {
    it('carries goal_threshold_raw / _unit / _cap VERBATIM from the goal node', () => {
      const payload = buildAnalysisReadyPayload(
        [option('opt_1', 'Option A'), option('opt_2', 'Do nothing')],
        'goal_1',
        graphWithGoal(true),
      );

      const p = payload as Record<string, unknown>;
      expect(p.goal_threshold_raw).toBe(ATTESTED.goal_threshold_raw);
      expect(p.goal_threshold_unit).toBe(ATTESTED.goal_threshold_unit);
      expect(p.goal_threshold_cap).toBe(ATTESTED.goal_threshold_cap);
    });

    it('carries rather than re-derives — the payload disagrees with every recomputation', () => {
      const payload = buildAnalysisReadyPayload(
        [option('opt_1', 'Option A'), option('opt_2', 'Do nothing')],
        'goal_1',
        graphWithGoal(true),
      );

      const p = payload as Record<string, unknown>;
      // If the implementation recomputed raw from threshold*cap it would be
      // 900000, and from the 25%-headroom cap doctrine the cap would be
      // 1000000. Both must be absent from the payload.
      expect(p.goal_threshold_raw).not.toBe(REDERIVED_RAW);
      expect(p.goal_threshold_cap).not.toBe(REDERIVED_CAP);
    });

    it('PRESERVES the existing normalised goal_threshold unchanged', () => {
      const payload = buildAnalysisReadyPayload(
        [option('opt_1', 'Option A'), option('opt_2', 'Do nothing')],
        'goal_1',
        graphWithGoal(true),
      );
      expect(payload.goal_threshold).toBe(ATTESTED.goal_threshold);
    });

    it('omits the trio entirely when the goal node has no attested raw target', () => {
      const payload = buildAnalysisReadyPayload(
        [option('opt_1', 'Option A'), option('opt_2', 'Do nothing')],
        'goal_1',
        graphWithGoal(false),
      );

      // Absent, not present-and-null: the fields are optional and additive, so
      // a consumer distinguishes "no raw target stated" from "raw target 0".
      expect(payload).not.toHaveProperty('goal_threshold_raw');
      expect(payload).not.toHaveProperty('goal_threshold_unit');
      expect(payload).not.toHaveProperty('goal_threshold_cap');
      // The normalised threshold still rides, exactly as before.
      expect(payload.goal_threshold).toBe(ATTESTED.goal_threshold);
    });
  });

  describe('hop 2: computeStructuralReadiness (src/orchestrator/tools/analysis-ready-helper.ts)', () => {
    it('carries the attested trio VERBATIM', () => {
      const payload = computeStructuralReadiness(graphWithGoal(true));
      expect(payload).toBeDefined();

      const p = payload as unknown as Record<string, unknown>;
      expect(p.goal_threshold_raw).toBe(ATTESTED.goal_threshold_raw);
      expect(p.goal_threshold_unit).toBe(ATTESTED.goal_threshold_unit);
      expect(p.goal_threshold_cap).toBe(ATTESTED.goal_threshold_cap);
      expect(p.goal_threshold).toBe(ATTESTED.goal_threshold);
    });

    it('omits the trio when the goal node has no attested raw target', () => {
      const payload = computeStructuralReadiness(graphWithGoal(false));
      expect(payload).toBeDefined();
      expect(payload).not.toHaveProperty('goal_threshold_raw');
      expect(payload).not.toHaveProperty('goal_threshold_unit');
      expect(payload).not.toHaveProperty('goal_threshold_cap');
    });
  });

  describe('hop 3: extractAnalysisReady (src/orchestrator/tools/draft-graph.ts)', () => {
    // This hop is a NAMED-FIELD RE-PROJECTION: it rebuilds the payload key by
    // key rather than spreading it. That is precisely the shape that silently
    // drops additive fields, so it needs its own guard — a field added at the
    // builder and not here would vanish on the draft path alone.
    const pipelineBody = () => ({
      analysis_ready: {
        goal_node_id: 'goal_1',
        status: 'ready',
        options: [
          { option_id: 'opt_1', label: 'Option A', status: 'ready', interventions: { fac_spend: 20 } },
          { option_id: 'opt_2', label: 'Do nothing', status: 'ready', interventions: { fac_spend: 10 } },
        ],
        goal_threshold: ATTESTED.goal_threshold,
        goal_threshold_raw: ATTESTED.goal_threshold_raw,
        goal_threshold_unit: ATTESTED.goal_threshold_unit,
        goal_threshold_cap: ATTESTED.goal_threshold_cap,
      },
    });

    it('re-projects the attested trio VERBATIM', () => {
      const extracted = extractAnalysisReady(pipelineBody() as Record<string, unknown>);
      expect(extracted).toBeDefined();

      const p = extracted as unknown as Record<string, unknown>;
      expect(p.goal_threshold_raw).toBe(ATTESTED.goal_threshold_raw);
      expect(p.goal_threshold_unit).toBe(ATTESTED.goal_threshold_unit);
      expect(p.goal_threshold_cap).toBe(ATTESTED.goal_threshold_cap);
      expect(p.goal_threshold).toBe(ATTESTED.goal_threshold);
    });

    it('omits the trio when upstream did not attest one', () => {
      const body = pipelineBody() as Record<string, unknown>;
      const ar = body.analysis_ready as Record<string, unknown>;
      delete ar.goal_threshold_raw;
      delete ar.goal_threshold_unit;
      delete ar.goal_threshold_cap;

      const extracted = extractAnalysisReady(body);
      expect(extracted).toBeDefined();

      // This hop's established idiom is explicit `undefined` (exactly as the
      // pre-existing `goal_threshold`, `blockers` and `model_adjustments` keys
      // beside it), so the KEY is present here while the VALUE is undefined.
      // The trio matches its neighbours rather than introducing a second
      // convention in the same object literal.
      const p = extracted as unknown as Record<string, unknown>;
      expect(p.goal_threshold_raw).toBeUndefined();
      expect(p.goal_threshold_unit).toBeUndefined();
      expect(p.goal_threshold_cap).toBeUndefined();

      // What actually matters is the WIRE: JSON serialisation drops
      // undefined-valued keys, so a consumer still sees a clean absence and
      // can distinguish "no raw target stated" from "raw target 0".
      const onTheWire = JSON.parse(JSON.stringify(extracted)) as Record<string, unknown>;
      expect(onTheWire).not.toHaveProperty('goal_threshold_raw');
      expect(onTheWire).not.toHaveProperty('goal_threshold_unit');
      expect(onTheWire).not.toHaveProperty('goal_threshold_cap');
    });
  });

  describe('hop 4: AnalysisReadyPayload schema (src/schemas/analysis-ready.ts)', () => {
    it('declares the trio and RETAINS it through a parse', () => {
      const parsed = AnalysisReadyPayload.safeParse({
        options: [],
        goal_node_id: 'goal_1',
        status: 'ready',
        bias_findings: [],
        ...ATTESTED,
      });

      expect(parsed.success).toBe(true);
      const data = (parsed as { data: Record<string, unknown> }).data;
      expect(data.goal_threshold_raw).toBe(ATTESTED.goal_threshold_raw);
      expect(data.goal_threshold_unit).toBe(ATTESTED.goal_threshold_unit);
      expect(data.goal_threshold_cap).toBe(ATTESTED.goal_threshold_cap);
    });

    it('rejects a mistyped raw target rather than passing it through untyped', () => {
      // The fields are DECLARED, not merely smuggled across `.passthrough()`.
      // A string raw target is a contract violation and must fail the parse —
      // this is what distinguishes a typed field from an undeclared one.
      const parsed = AnalysisReadyPayload.safeParse({
        options: [],
        goal_node_id: 'goal_1',
        status: 'ready',
        bias_findings: [],
        goal_threshold_raw: '800000',
      });
      expect(parsed.success).toBe(false);
    });
  });
});

/**
 * PRESERVATION — the live goal-probability train must be unchanged.
 *
 * The trio is ADDITIVE to a display payload, so nothing about the mint or the
 * ISL request should move. This block proves that behaviourally rather than by
 * inspection, using BOTH worked-brief forms recorded in
 * PHASE0-EVIDENCE-2026-07-28/witness-2258-goal-probability-THIRD.md:
 *
 *   digit-string form (witness RUN 2) and prose form (witness RUN 3)
 *
 * The witness recorded, for both, a mint of
 * `goal_threshold 0.8 · raw 6000000 · cap 7500000 · frame "level"`.
 * Those figures were measured on staging BEFORE this change; re-asserting them
 * here is therefore a genuine before/after comparison, not a restatement.
 *
 * Extraction runs `regex-only` (no LLM, no network), so this is deterministic.
 *
 * It also closes the loop the whole change exists for: the trio that reaches
 * the UI is asserted to be the SAME attested numbers the graph was scored
 * against — the anti-fabrication property. A payload that carried a plausible
 * but re-derived target would pass a presence check and fail this one.
 */
describe('ROADMAP 2.315(a) — preservation of the goal-probability train', () => {
  // Verbatim from the witness.
  const DIGIT_STRING_FORM = 'Grow revenue to a target of 6000000 this year.';
  const PROSE_FORM =
    'We want to grow our annual revenue. We are currently at £4,000,000 and our target is £6,000,000 within a year.';

  // The witness-recorded mint, shared by both forms.
  const WITNESS_MINT = { threshold: 0.8, raw: 6000000, cap: 7500000 } as const;

  function bareGraph(): GraphT {
    return {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'g1', kind: 'goal', label: 'Revenue Goal' },
        { id: 'd1', kind: 'decision', label: 'Pricing decision' },
      ],
      edges: [],
      meta: { roots: [], leaves: [], suggested_positions: {}, source: 'test' },
    } as unknown as GraphT;
  }

  async function mintFrom(brief: string) {
    const enriched = await enrichGraphWithFactorsAsync(bareGraph(), brief);
    const goal = enriched.graph.nodes.find((n) => n.kind === 'goal') as Record<string, unknown>;
    return { enriched: enriched.graph, goal };
  }

  it('digit-string form mints the witness values, unchanged', async () => {
    const { goal } = await mintFrom(DIGIT_STRING_FORM);
    expect(goal.goal_threshold).toBe(WITNESS_MINT.threshold);
    expect(goal.goal_threshold_raw).toBe(WITNESS_MINT.raw);
    expect(goal.goal_threshold_cap).toBe(WITNESS_MINT.cap);
    expect(goal.goal_threshold_frame).toBe('level');
    // The witness recorded "count" for this form — the brief states a bare
    // number with no currency marker. That placeholder unit is the SEPARATE
    // unit-vocabulary defect (ROADMAP 2.315(c)); pinned here so this change
    // is not mistaken for having fixed it.
    expect(goal.goal_threshold_unit).toBe('count');
  });

  it('prose form mints the witness values, unchanged', async () => {
    const { goal } = await mintFrom(PROSE_FORM);
    expect(goal.goal_threshold).toBe(WITNESS_MINT.threshold);
    expect(goal.goal_threshold_raw).toBe(WITNESS_MINT.raw);
    expect(goal.goal_threshold_cap).toBe(WITNESS_MINT.cap);
    expect(goal.goal_threshold_frame).toBe('level');
    expect(goal.goal_threshold_unit).toBe('£');
  });

  it('both forms produce IDENTICAL goal mints on every scored number', async () => {
    const digit = (await mintFrom(DIGIT_STRING_FORM)).goal;
    const prose = (await mintFrom(PROSE_FORM)).goal;

    // The numbers ISL is scored against are identical across both forms.
    // (The display UNIT differs — "count" vs "£" — which is exactly the
    // 2.315(c) defect and is asserted per-form above rather than here.)
    expect(digit.goal_threshold).toBe(prose.goal_threshold);
    expect(digit.goal_threshold_raw).toBe(prose.goal_threshold_raw);
    expect(digit.goal_threshold_cap).toBe(prose.goal_threshold_cap);
    expect(digit.goal_threshold_frame).toBe(prose.goal_threshold_frame);
  });

  it('the trio on analysis_ready IS the attested mint — end to end, no second derivation', async () => {
    for (const brief of [DIGIT_STRING_FORM, PROSE_FORM]) {
      const { enriched, goal } = await mintFrom(brief);

      // Real chain: enricher mint -> V3 transform -> analysis_ready builder.
      const v3 = transformGraphToV3(enriched as never).graph;
      const payload = buildAnalysisReadyPayload([], 'g1', v3) as unknown as Record<string, unknown>;

      // What the UI will see == what the graph was scored against.
      expect(payload.goal_threshold).toBe(goal.goal_threshold);
      expect(payload.goal_threshold_raw).toBe(goal.goal_threshold_raw);
      expect(payload.goal_threshold_unit).toBe(goal.goal_threshold_unit);
      expect(payload.goal_threshold_cap).toBe(goal.goal_threshold_cap);

      // And it is the witness's own number, not merely self-consistent.
      expect(payload.goal_threshold_raw).toBe(WITNESS_MINT.raw);
      expect(payload.goal_threshold_cap).toBe(WITNESS_MINT.cap);
    }
  });
});

/**
 * ATOMICITY — the trio is emitted as a UNIT, or not at all.
 *
 * Found by adversarial review of this PR, and it is a defect THIS PR would
 * otherwise make live. The three fields were emitted independently, so a goal
 * node carrying `goal_threshold` + `goal_threshold_cap` but NO
 * `goal_threshold_raw` would put a cap on the wire without a raw value.
 *
 * That shape is reachable, not theoretical:
 *   - all four fields are independently `.optional()` on the LLM-writable
 *     draft node (src/adapters/llm/shared-schemas.ts:64-67), and
 *   - normalisation.ts:370-375 clears an ORPHAN CAP only when it is EXACTLY 0,
 *     so a non-zero cap with no raw survives to the graph.
 *
 * The consumer harm, at the bytes (UI store.ts:4006-4008, tip cb957c8c):
 *
 *     if (ceeRaw != null)            -> use raw            (representation 'raw')
 *     else if (ceeNorm && hasCap)    -> ceeNorm * ceeCap   (representation 'raw')
 *
 * A cap without a raw drives the SECOND branch: the UI multiplies the
 * normalised value by the cap and tags the product `'raw'` — a consumer-side
 * RE-DERIVATION of an attested value, presented as authoritative. That is
 * exactly what this payload's own contract note forbids, and it can disagree
 * with the real attested raw (the fixture above: 0.75 x 1200000 = 900000, not
 * 800000). Before this PR the branch was unreachable dead code, because CEE
 * never sent a cap at all.
 *
 * A partial trio is therefore never emitted. Emitting nothing is strictly no
 * worse than the pre-PR baseline (which emitted nothing always), whereas
 * emitting a partial trio is worse than both.
 */
describe('ROADMAP 2.315(a) — the trio is atomic (all three, or none)', () => {
  function goalWith(fields: Record<string, unknown>): GraphV3T {
    return {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'Goal', ...fields },
        { id: 'fac_spend', kind: 'factor', label: 'Spend', category: 'controllable', observed_state: { value: 10 } },
        { id: 'opt_1', kind: 'option', label: 'Option A' },
        { id: 'opt_2', kind: 'option', label: 'Do nothing' },
      ] as unknown as NodeV3T[],
      edges: [
        { from: 'opt_1', to: 'fac_spend' },
        { from: 'opt_2', to: 'fac_spend' },
        { from: 'fac_spend', to: 'goal_1' },
      ],
    } as unknown as GraphV3T;
  }

  const build = (graph: GraphV3T) =>
    buildAnalysisReadyPayload(
      [option('opt_1', 'Option A'), option('opt_2', 'Do nothing')],
      'goal_1',
      graph,
    ) as unknown as Record<string, unknown>;

  it('THE DEFECT: cap without raw must NOT reach the wire (builder)', () => {
    const payload = build(goalWith({
      goal_threshold: ATTESTED.goal_threshold,
      goal_threshold_cap: ATTESTED.goal_threshold_cap,
      goal_threshold_unit: ATTESTED.goal_threshold_unit,
      // goal_threshold_raw deliberately absent — the reachable shape
    }));

    // The cap is what arms the UI's `ceeNorm * ceeCap` re-derivation.
    expect(payload.goal_threshold_cap).toBeUndefined();
    expect(payload.goal_threshold_raw).toBeUndefined();
    expect(payload.goal_threshold_unit).toBeUndefined();

    // The normalised threshold still rides — it is honest on its own, and is
    // what PLoT needs. Suppressing the trio must not suppress this.
    expect(payload.goal_threshold).toBe(ATTESTED.goal_threshold);
  });

  it('the UI re-derivation branch cannot be armed by any payload we emit', () => {
    // Restates the consumer condition directly: `ceeRaw == null && ceeNorm && hasCap`.
    for (const partial of [
      { goal_threshold: 0.75, goal_threshold_cap: 1200000, goal_threshold_unit: '£' },
      { goal_threshold: 0.75, goal_threshold_cap: 1200000 },
    ]) {
      const p = build(goalWith(partial));
      const armed =
        p.goal_threshold_raw == null &&
        typeof p.goal_threshold === 'number' &&
        typeof p.goal_threshold_cap === 'number' &&
        Number.isFinite(p.goal_threshold_cap as number) &&
        (p.goal_threshold_cap as number) > 0;
      expect(armed).toBe(false);
    }
  });

  it('raw without cap is also suppressed — all three, or none', () => {
    const payload = build(goalWith({
      goal_threshold: ATTESTED.goal_threshold,
      goal_threshold_raw: ATTESTED.goal_threshold_raw,
      goal_threshold_unit: ATTESTED.goal_threshold_unit,
    }));
    expect(payload.goal_threshold_raw).toBeUndefined();
    expect(payload.goal_threshold_cap).toBeUndefined();
    expect(payload.goal_threshold_unit).toBeUndefined();
    expect(payload.goal_threshold).toBe(ATTESTED.goal_threshold);
  });

  it('missing unit suppresses the trio too', () => {
    const payload = build(goalWith({
      goal_threshold: ATTESTED.goal_threshold,
      goal_threshold_raw: ATTESTED.goal_threshold_raw,
      goal_threshold_cap: ATTESTED.goal_threshold_cap,
    }));
    expect(payload.goal_threshold_raw).toBeUndefined();
    expect(payload.goal_threshold_cap).toBeUndefined();
  });

  it('the complete trio is still emitted in full (atomicity must not suppress the good path)', () => {
    const payload = build(goalWith({
      goal_threshold: ATTESTED.goal_threshold,
      goal_threshold_raw: ATTESTED.goal_threshold_raw,
      goal_threshold_unit: ATTESTED.goal_threshold_unit,
      goal_threshold_cap: ATTESTED.goal_threshold_cap,
    }));
    expect(payload.goal_threshold_raw).toBe(ATTESTED.goal_threshold_raw);
    expect(payload.goal_threshold_unit).toBe(ATTESTED.goal_threshold_unit);
    expect(payload.goal_threshold_cap).toBe(ATTESTED.goal_threshold_cap);
  });

  it('helper (hop 2) is atomic on the same shape', () => {
    const p = computeStructuralReadiness(goalWith({
      goal_threshold: ATTESTED.goal_threshold,
      goal_threshold_cap: ATTESTED.goal_threshold_cap,
      goal_threshold_unit: ATTESTED.goal_threshold_unit,
    })) as unknown as Record<string, unknown>;
    expect(p.goal_threshold_cap).toBeUndefined();
    expect(p.goal_threshold_raw).toBeUndefined();
    expect(p.goal_threshold).toBe(ATTESTED.goal_threshold);
  });

  it('draft-graph re-projection (hop 3) is atomic on the same shape', () => {
    const extracted = extractAnalysisReady({
      analysis_ready: {
        goal_node_id: 'goal_1',
        status: 'ready',
        options: [
          { option_id: 'opt_1', label: 'Option A', status: 'ready', interventions: { fac_spend: 20 } },
          { option_id: 'opt_2', label: 'Do nothing', status: 'ready', interventions: { fac_spend: 10 } },
        ],
        goal_threshold: ATTESTED.goal_threshold,
        goal_threshold_cap: ATTESTED.goal_threshold_cap,
        goal_threshold_unit: ATTESTED.goal_threshold_unit,
      },
    } as Record<string, unknown>) as unknown as Record<string, unknown>;

    expect(extracted.goal_threshold_cap).toBeUndefined();
    expect(extracted.goal_threshold_raw).toBeUndefined();
    expect(extracted.goal_threshold).toBe(ATTESTED.goal_threshold);
  });
});
