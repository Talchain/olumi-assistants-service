/**
 * THE CAP'S PROVENANCE REACHES THE WIRE — and dies with the cap it describes.
 *
 * `goal_threshold_cap` reached every consumer as a bare number. `0.8` against a
 * cap of 25,000 was indistinguishable from `0.8` against a cap the user named,
 * and they are not the same claim: on `target_derived_headroom` the denominator
 * is `raw * 1.25`, so the ratio is 0.8 BY CONSTRUCTION for every target and no
 * user supplied the denominator at all.
 *
 * ⚠ THE CHAIN BETWEEN THE MINT SITE AND A CONSUMER CONTAINS PLACES THAT DELETE
 * AN UNNAMED FIELD, none of which raises an error — the same three
 * `goal_threshold_frame` had to survive:
 *
 *   1. `transformNodeToV3` rebuilds the node field-by-field.
 *   2. `NodeV3` (schemas/cee-v3.ts) is a PLAIN `z.object` — unknown fields
 *      stripped — and the run path calls `GraphV3.safeParse` on the reloaded
 *      persisted graph.
 *   3. `pickGoalThresholdTrio` is an ALLOW-LIST: the analysis_ready builders
 *      spread its result, so a field it does not name never reaches the
 *      payload at all.
 *
 * ⚠ CORRECTED BY ITS OWN POSITIVE CONTROL, and left here because the correction
 * is the useful part. This header first named `AnalysisReadyPayload` as the
 * third stripper. It is NOT: that object is `.passthrough()`
 * (`analysis-ready.ts`, "CIL Phase 0: preserve additive fields"), and the
 * control asserting it strips an undeclared sibling FAILED. The declaration
 * there is still load-bearing, for a different reason — it VALIDATES, so an
 * uninterpretable value is refused instead of riding as an untyped passenger —
 * and that is what the arm below now asserts. The real gate on this channel is
 * the allow-list at (3).
 *
 * A stamp that is silently stripped looks EXACTLY like a stamp that works. Each
 * survival assertion below therefore carries a POSITIVE CONTROL proving the
 * strip mechanism it defends against is REAL AND ACTIVE at this tip (CLAUDE.md
 * trap 13: an absence/survival claim must first prove it can see the opposite).
 */
import { describe, expect, it } from 'vitest';

import { NodeV3, GraphV3 } from '../cee-v3.js';
import { AnalysisReadyPayload } from '../analysis-ready.js';
import { transformNodeToV3 } from '../../cee/transforms/schema-v3.js';
import type { V1Node } from '../../cee/transforms/schema-v2.js';
import { pickGoalThresholdTrio } from '../../utils/goal-threshold-trio.js';
import { CEE_MINTED_GOAL_FIELDS, normaliseDraftResponse } from '../../adapters/llm/normalisation.js';
import { projectRecordsToGraph } from '../../cee/draft/records/projector.js';
import type { DraftRecordSet } from '../../cee/draft/records/grammar.js';

const goalNodeV3 = () => ({
  id: 'g1',
  kind: 'goal' as const,
  label: 'Revenue Goal',
  goal_threshold: 0.8,
  goal_threshold_raw: 800,
  goal_threshold_unit: 'customers',
  goal_threshold_cap: 1000,
  goal_threshold_cap_provenance: 'inherited' as const,
});

describe('the provenance survives NodeV3 (the unknown-field strip)', () => {
  it('POSITIVE CONTROL — NodeV3 really does strip an undeclared field', () => {
    const parsed = NodeV3.parse({
      ...goalNodeV3(),
      a_field_no_schema_declares: 'must not survive',
    });
    expect(parsed).not.toHaveProperty('a_field_no_schema_declares');
  });

  it('goal_threshold_cap_provenance SURVIVES NodeV3.parse (it is declared)', () => {
    expect(NodeV3.parse(goalNodeV3()).goal_threshold_cap_provenance).toBe('inherited');
  });

  it('it survives GraphV3.safeParse — the run path`s own reload gate', () => {
    const result = GraphV3.safeParse({ nodes: [goalNodeV3()], edges: [] });
    expect(result.success).toBe(true);
    const goal = result.success
      ? result.data.nodes.find((n) => n.kind === 'goal')
      : undefined;
    expect(goal?.goal_threshold_cap_provenance).toBe('inherited');
    // The claim must never arrive without the denominator it describes.
    expect(goal?.goal_threshold_cap).toBe(1000);
  });

  it('an INVALID provenance is refused rather than silently carried', () => {
    const result = GraphV3.safeParse({
      nodes: [{ ...goalNodeV3(), goal_threshold_cap_provenance: 'vibes' }],
      edges: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('the provenance survives the V1→V3 transform', () => {
  const v1GoalNode = (extra: Record<string, unknown> = {}): V1Node =>
    ({
      id: 'g1',
      kind: 'goal',
      label: 'Revenue Goal',
      goal_threshold: 0.8,
      goal_threshold_raw: 800,
      goal_threshold_unit: 'customers',
      goal_threshold_cap: 1000,
      ...extra,
    }) as unknown as V1Node;

  it('POSITIVE CONTROL — the transform really does drop an unnamed V1 field', () => {
    const out = transformNodeToV3(
      v1GoalNode({ a_field_the_transform_never_names: 'must not survive' }),
    ) as Record<string, unknown>;
    expect(out).not.toHaveProperty('a_field_the_transform_never_names');
  });

  it('a provenance minted on the V1 draft graph reaches the V3 node', () => {
    const out = transformNodeToV3(
      v1GoalNode({ goal_threshold_cap_provenance: 'target_derived_headroom' }),
    ) as Record<string, unknown>;
    expect(out.goal_threshold_cap_provenance).toBe('target_derived_headroom');
  });

  it('it is NOT carried when there is no cap for it to describe', () => {
    // Fail-closed, and NOT symmetric with the cap: a provenance without a
    // denominator would leave a consumer unable to tell "no cap" from "a cap
    // this rule produced", which is precisely the confusion it exists to end.
    const out = transformNodeToV3({
      id: 'g1',
      kind: 'goal',
      label: 'Qualitative goal',
      goal_threshold_cap_provenance: 'target_derived_headroom',
    } as unknown as V1Node) as Record<string, unknown>;
    expect(out).not.toHaveProperty('goal_threshold_cap_provenance');
  });
});

describe('the analysis_ready channel — where a consumer actually reads it', () => {
  it('the DECLARATION is what validates — an uninterpretable value is REFUSED', () => {
    expect(() =>
      AnalysisReadyPayload.parse({
        options: [],
        goal_node_id: 'g1',
        status: 'ready',
        goal_threshold_cap_provenance: 'vibes',
      }),
    ).toThrow();
  });

  it('DISCRIMINATING CONTROL — an UNdeclared sibling rides unvalidated', () => {
    // This is what the declaration buys, stated as a contrast rather than
    // asserted: the payload is `.passthrough()`, so an undeclared field would
    // have reached consumers carrying any value at all, unchecked. Without
    // this arm the assertion above would be consistent with "the payload
    // rejects everything unexpected", which is false.
    const parsed = AnalysisReadyPayload.parse({
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      goal_threshold_cap_provenance_v2: 'vibes',
    }) as Record<string, unknown>;
    expect(parsed.goal_threshold_cap_provenance_v2).toBe('vibes');
  });

  it('goal_threshold_cap_provenance SURVIVES the payload parse', () => {
    const parsed = AnalysisReadyPayload.parse({
      options: [],
      goal_node_id: 'g1',
      status: 'ready',
      goal_threshold_cap_provenance: 'target_derived_headroom',
    });
    expect(parsed.goal_threshold_cap_provenance).toBe('target_derived_headroom');
  });

  it('the trio picker carries it BESIDE the cap', () => {
    expect(pickGoalThresholdTrio(goalNodeV3())).toEqual({
      goal_threshold_raw: 800,
      goal_threshold_unit: 'customers',
      goal_threshold_cap: 1000,
      goal_threshold_cap_provenance: 'inherited',
    });
  });

  it('and NEVER without it — the cap is the provenance`s anchor', () => {
    const out = pickGoalThresholdTrio({
      goal_threshold_raw: 800,
      goal_threshold_unit: 'customers',
      goal_threshold_cap_provenance: 'inherited',
    });
    expect(out).not.toHaveProperty('goal_threshold_cap_provenance');
    // DISCRIMINATING: the raw value still rides, so this is the anchor working
    // and not the picker having returned nothing at all.
    expect(out).toHaveProperty('goal_threshold_raw', 800);
  });

  it('an unrecognised provenance is treated as ABSENT, never forwarded', () => {
    // Validated against the resolver`s own enum. Forwarding a value we cannot
    // interpret would put an uninterpretable attestation on the wire, which is
    // the fabrication class this field exists to refuse.
    const out = pickGoalThresholdTrio({
      goal_threshold_raw: 800,
      goal_threshold_cap: 1000,
      goal_threshold_cap_provenance: 'whatever_the_model_said',
    });
    expect(out).not.toHaveProperty('goal_threshold_cap_provenance');
    expect(out).toHaveProperty('goal_threshold_cap', 1000);
  });
});

describe('no model may author it', () => {
  it('it is in CEE_MINTED_GOAL_FIELDS — the ingress strip removes it', () => {
    expect(CEE_MINTED_GOAL_FIELDS).toContain('goal_threshold_cap_provenance');
  });
});

describe('⭐ THE MINT — the live £20k case, end to end through the projector', () => {
  /**
   * Verbatim from the 2026-09-14 staging measurement recorded in
   * `records/__tests__/goal-target-from-stated-span.test.ts`, and the same
   * shape as the 2026-09-18 capture that opened this lane
   * (`goal_threshold: 0.8, raw: 20000, unit: '£', cap: 25000`).
   */
  const BRIEF =
    'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 4%, should we increase the Pro plan price from £49 to £59 per month with the next Pro feature release?';
  const GOAL_QUOTE = 'reaching £20k MRR within 12 months';

  const goalOf = (records: DraftRecordSet, brief = BRIEF) =>
    projectRecordsToGraph(records, brief).graph.nodes.find((n) => n.kind === 'goal') as
      | Record<string, unknown>
      | undefined;

  it('£20,000 mints cap 25,000 — and DISCLOSES that the target produced it', () => {
    const goal = goalOf({
      stated_items: [
        { kind: 'goal', source_quote: GOAL_QUOTE, role: 'target' },
        { kind: 'option', source_quote: 'increase the Pro plan price from £49 to £59' },
        { kind: 'option', source_quote: 'hold the Pro plan price' },
      ],
      claims: [],
    } as never);

    // Bound by IDENTITY to the goal node carrying the user's own quote.
    expect(goal).toBeDefined();
    expect(goal!.goal_threshold_raw).toBe(20_000);
    expect(goal!.goal_threshold_unit).toBe('£');
    expect(goal!.goal_threshold_cap).toBe(25_000);
    // ⭐ 20000 / 25000 === 0.8, and 25000 IS 20000 * 1.25 — the denominator is
    //   the target. The number below would be 0.8 for ANY £ figure.
    expect(goal!.goal_threshold).toBeCloseTo(0.8, 12);
    expect(goal!.goal_threshold_cap_provenance).toBe('target_derived_headroom');
  });

  it('DISCRIMINATING TWIN — no target means no cap AND no claim about one', () => {
    const goal = goalOf({
      stated_items: [
        { kind: 'goal', source_quote: GOAL_QUOTE },
        { kind: 'option', source_quote: 'increase the Pro plan price from £49 to £59' },
        { kind: 'option', source_quote: 'hold the Pro plan price' },
      ],
      claims: [],
    } as never);
    expect(goal).toBeDefined();
    expect(goal!.goal_threshold_cap).toBeUndefined();
    expect(goal!.goal_threshold_cap_provenance).toBeUndefined();
  });
});

describe('⛔ A PROVENANCE MUST NEVER OUTLIVE THE CAP IT DESCRIBES', () => {
  /**
   * The ROADMAP 2.239 repair in `normaliseDraftResponse` REWRITES a degenerate
   * `goal_threshold_cap`. Before this change there was no provenance for it to
   * leave behind; now there is, and a stamp minted for the OLD denominator
   * sitting beside the NEW one would be a declaration outliving its subject —
   * strictly worse than no provenance, because it reads as attested.
   */
  const degenerate = () => ({
    nodes: [
      {
        id: 'g1',
        kind: 'goal',
        label: 'Reach 800 customers',
        goal_threshold: 1.0,
        goal_threshold_raw: 800,
        goal_threshold_unit: 'customers',
        goal_threshold_cap: 800, // cap === raw: the degenerate state
        goal_threshold_cap_provenance: 'inherited', // a claim about THAT cap
      },
    ],
    edges: [],
  });

  it('the repair moves the cap AND the claim about it, in step', () => {
    const out = normaliseDraftResponse(degenerate()) as {
      nodes: Array<Record<string, unknown>>;
    };
    const goal = out.nodes.find((n) => n.id === 'g1');
    // PRECONDITION, pinned in-test: the repair actually fired. Without this the
    // assertion below could pass on a payload the repair never touched.
    expect(goal!.goal_threshold_cap).toBe(1000);
    expect(goal!.goal_threshold).toBeCloseTo(0.8, 12);
    // ⭐ THE POINT: the stale `inherited` is gone, replaced by the rule that
    //   actually produced the cap now on the node.
    expect(goal!.goal_threshold_cap_provenance).toBe('target_derived_headroom');
  });

  it('a non-goal node keeps neither the cap nor a claim about it', () => {
    const out = normaliseDraftResponse({
      nodes: [
        {
          id: 'f1',
          kind: 'factor',
          label: 'Not a goal',
          goal_threshold_cap: 1000,
          goal_threshold_cap_provenance: 'inherited',
        },
      ],
      edges: [],
    }) as { nodes: Array<Record<string, unknown>> };
    const factor = out.nodes.find((n) => n.id === 'f1');
    expect(factor!.goal_threshold_cap).toBeUndefined();
    expect(factor!.goal_threshold_cap_provenance).toBeUndefined();
  });
});
