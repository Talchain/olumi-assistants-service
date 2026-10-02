import { describe, expect, it } from 'vitest';

import {
  OrchestratorTurnPayloadSchema,
  type SystemEventTurnPayload,
} from '@talchain/schemas/boundary';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { DEFAULT_STRENGTH_STD } from '../../../cee/constants.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import {
  applyEdgeStrengthEdit,
  InvalidPersistedEdgeGraphError,
  isExactCommittedEdgeReadback,
  isProvenanceOnlyEdgeConfirmation,
  resolveEdgeStrengthTarget,
} from '../edge-strength-edit.js';

type EdgeStrengthEditEvent = Extract<
  SystemEventTurnPayload['event'],
  { kind: 'edge_strength_edit' }
>;

const SCENARIO_ID = '22222222-2222-4222-8222-222222222222';
const TURN_ID = '11111111-1111-4111-8111-111111111199';

function eventFor(
  overrides: Partial<EdgeStrengthEditEvent> = {},
): EdgeStrengthEditEvent {
  return {
    kind: 'edge_strength_edit',
    from: 'f-budget',
    to: 'g-revenue',
    magnitude: 0.7,
    direction_intent: 'preserve',
    expected: { mean: 0.4, effect_direction: 'positive' },
    intent: 'set',
    ...overrides,
  };
}

function payloadFor(event: EdgeStrengthEditEvent): SystemEventTurnPayload {
  return OrchestratorTurnPayloadSchema.parse({
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'analyse',
    event,
  }) as SystemEventTurnPayload;
}

function edgeIn(graph: GraphV3T) {
  return graph.edges.find(
    (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
  )!;
}

async function apply(graph: unknown, event: EdgeStrengthEditEvent) {
  return await applyEdgeStrengthEdit({
    payload: payloadFor(event),
    event,
    requestId: 'req-edge-strength-edit',
    persistedGraph: graph,
  });
}

describe('resolveEdgeStrengthTarget', () => {
  it.each([
    ['preserves positive', 'preserve', 'positive', 0.6, 0.6, 'positive'],
    ['preserves negative', 'preserve', 'negative', 0.6, -0.6, 'negative'],
    ['sets positive', 'positive', 'negative', 0.6, 0.6, 'positive'],
    ['sets negative', 'negative', 'positive', 0.6, -0.6, 'negative'],
  ] as const)(
    '%s',
    (_label, directionIntent, persistedDirection, magnitude, mean, effectDirection) => {
      expect(
        resolveEdgeStrengthTarget({
          magnitude,
          directionIntent,
          persistedDirection,
        }),
      ).toEqual({ mean, effectDirection });
    },
  );

  it.each(['positive', 'negative'] as const)(
    'keeps %s direction explicit at zero',
    (directionIntent) => {
      const resolved = resolveEdgeStrengthTarget({
        magnitude: 0,
        directionIntent,
        persistedDirection: directionIntent === 'positive' ? 'negative' : 'positive',
      });
      expect(resolved.mean).toBe(0);
      expect(resolved.effectDirection).toBe(directionIntent);
    },
  );

  it.each(['positive', 'negative'] as const)(
    'preserves persisted %s direction explicitly at zero',
    (persistedDirection) => {
      expect(resolveEdgeStrengthTarget({
        magnitude: 0,
        directionIntent: 'preserve',
        persistedDirection,
      })).toEqual({ mean: 0, effectDirection: persistedDirection });
    },
  );
});

describe('applyEdgeStrengthEdit — canonical adapter', () => {
  // A6f (AIQ N1 on #2096): an exact figure keeps Olumi's RELATIVE spread, never the absolute std sized for 0.4.
  it('sets the unique exact edge through the existing handler and carries Olumi’s relative spread (A6f)', async () => {
    const graph = buildD1Fixture();
    const before = edgeIn(graph).strength;
    const result = await apply(graph, eventFor());

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const edge = edgeIn(result.graph);
    expect(edge.strength.mean).toBe(0.7);
    expect(edge.strength.std).toBeCloseTo((before.std / Math.abs(before.mean)) * 0.7, 15);
    expect(edge.strength.std).not.toBe(before.std);
    expect(edge.std_defaulted).toBe(true);
    expect(edge.effect_direction).toBe('positive');
    expect(edge.provenance?.source).toBe('user_specified');
    expect(edge.provenance_display).toBe('user_set');
    expect(result.handlerFacts[0]).toMatchObject({
      fact_type: 'adjust_edge_strength',
      noop: false,
      result: { status: 'applied' },
    });
  });

  it('preserves a persisted negative direction while changing magnitude', async () => {
    const graph = buildD1Fixture();
    const edge = edgeIn(graph);
    edge.strength.mean = -0.4;
    edge.effect_direction = 'negative';

    const result = await apply(
      graph,
      eventFor({
        magnitude: 0.8,
        expected: { mean: -0.4, effect_direction: 'negative' },
      }),
    );

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(edgeIn(result.graph)).toMatchObject({
      strength: { mean: -0.8 },
      effect_direction: 'negative',
    });
  });

  it.each(['positive', 'negative'] as const)(
    // A6f: a mean of 0 has no relative spread (it would be 0, and std must be > 0), so the std is
    // Olumi's default spread, flagged — never the stale absolute std sized for the old mean.
    'persists an explicit %s direction at zero; the std is Olumi’s default spread (A6f)',
    async (direction) => {
      const graph = buildD1Fixture();
      const result = await apply(
        graph,
        eventFor({ magnitude: 0, direction_intent: direction }),
      );

      expect(result.kind).toBe('mutated');
      if (result.kind !== 'mutated') return;
      expect(edgeIn(result.graph)).toMatchObject({
        strength: { mean: 0, std: DEFAULT_STRENGTH_STD },
        effect_direction: direction,
        std_defaulted: true,
      });
    },
  );

  it.each(['positive', 'negative'] as const)(
    'refuses an unchanged zero-%s set rather than treating it as confirmation',
    async (persistedDirection) => {
      const graph = buildD1Fixture();
      const edge = edgeIn(graph);
      edge.strength.mean = 0;
      edge.effect_direction = persistedDirection;
      const before = structuredClone(graph);
      const result = await apply(
        graph,
        eventFor({
          magnitude: 0,
          direction_intent: 'preserve',
          expected: { mean: 0, effect_direction: persistedDirection },
        }),
      );

      expect(result).toMatchObject({
        kind: 'refused',
        reason: 'set_target_unchanged',
        response: {
          assistant_text: expect.stringContaining(
            'Confirm the current strength explicitly',
          ),
        },
      });
      expect(result.response.assistant_text).not.toContain('confirm_current');
      expect(graph).toStrictEqual(before);
    },
  );

  it('refuses an unchanged nonzero set without stamping provenance', async () => {
    const graph = buildD1Fixture();
    const before = structuredClone(graph);

    const result = await apply(
      graph,
      eventFor({ magnitude: 0.4, direction_intent: 'preserve' }),
    );

    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'set_target_unchanged',
    });
    expect(result.response.assistant_text).not.toContain('confirm_current');
    expect(graph).toStrictEqual(before);
  });

  it.each([
    ['positive', 0.6],
    ['negative', -0.6],
  ] as const)(
    'uses persisted zero-%s direction when preserve moves away from zero',
    async (persistedDirection, expectedMean) => {
      const graph = buildD1Fixture();
      const edge = edgeIn(graph);
      edge.strength.mean = 0;
      edge.effect_direction = persistedDirection;
      const result = await apply(
        graph,
        eventFor({
          magnitude: 0.6,
          direction_intent: 'preserve',
          expected: { mean: 0, effect_direction: persistedDirection },
        }),
      );

      expect(result.kind).toBe('mutated');
      if (result.kind !== 'mutated') return;
      expect(edgeIn(result.graph)).toMatchObject({
        strength: { mean: expectedMean },
        effect_direction: persistedDirection,
      });
      expect(result.response.assistant_text).not.toContain('Direction reversed');
    },
  );

  it('confirm_current is provenance-only and leaves the analysis hash unchanged', async () => {
    const graph = buildD1Fixture();
    const edge = edgeIn(graph);
    edge.strength.mean = 0;
    edge.effect_direction = 'negative';
    edge.provenance = { source: 'cee_hypothesis' };
    edge.provenance_display = 'ai_inferred';

    const beforeAnalysisHash = computeAnalysisAffectingGraphHash(graph);
    const beforeIdentityHash = computeGraphIdentityHash(graph)?.value;
    const result = await apply(
      graph,
      eventFor({
        magnitude: 0,
        direction_intent: 'preserve',
        expected: { mean: 0, effect_direction: 'negative' },
        intent: 'confirm_current',
      }),
    );

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    const confirmed = edgeIn(result.graph);
    expect(confirmed.strength).toEqual(edge.strength);
    expect(confirmed.effect_direction).toBe('negative');
    // R11 (AIQ #72 5872082179): a confirm is REVIEW, not authorship — the source and display are KEPT and the review
    // is recorded. (Before R11 this row pinned the `user_specified` / `user_set` stamp.)
    expect(confirmed.provenance?.source).toBe('cee_hypothesis');
    expect(confirmed.provenance_display).toBe('ai_inferred');
    expect((confirmed.provenance as Record<string, unknown>).reviewed_by_user).toMatchObject({ intent: 'confirm' });
    expect(result.handlerFacts[0]).toMatchObject({ noop: true });
    // R3 5942069984: the stored link stays Olumi's (cee_hypothesis, no sizing marker) — the receipt claims no authorship.
    expect(result.response.assistant_text).toContain('Confirmed the current strength');
    expect(result.response.assistant_text).not.toContain('your judgement');
    expect(result.response.assistant_text).not.toMatch(/positive|negative|0\./i);
    expect(result.response.assistant_text).not.toContain('Adjusted');
    expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(beforeAnalysisHash);
    expect(computeGraphIdentityHash(result.graph)?.value).not.toBe(beforeIdentityHash);
    expect(isProvenanceOnlyEdgeConfirmation({
      before: graph,
      after: result.mutatedGraph,
      from: 'f-budget',
      to: 'g-revenue',
    })).toBe(true);
  });

  /**
   * ⭐ Served on CEE `1226b3e` (Canvas #70 5848798561): the user approved a confirm of an Olumi-sized link and read
   * "Not saved: none of it was applied." The writer drops `provenance.natural_effect` and `provenance.magnitude` on
   * every user write (magnitude contract, R&C 5845818897), so the confirmation allowlist must admit exactly those two
   * removals — or every confirm on a sized link refuses. Provenance below is the served edge's, verbatim.
   */
  describe('confirm_current on an Olumi-sized edge (magnitude contract)', () => {
    const SERVED_MEAN = 0.19999999999999998;
    function sizedGraph() {
      const graph = buildD1Fixture();
      const edge = edgeIn(graph);
      edge.strength = { mean: SERVED_MEAN, std: 0.09999999999999999 };
      edge.effect_direction = 'positive';
      edge.provenance = {
        source: 'cee_hypothesis',
        magnitude: 'olumi_estimate',
        natural_effect: {
          amount: 1,
          amount_unit: 'percentage points',
          strength_mean: SERVED_MEAN,
          per_source_change: 10,
          strength_mean_frame: 'edge_strength',
          per_source_change_unit: 'GBP/month',
        },
      };
      return graph;
    }
    const confirmSized = () =>
      eventFor({
        magnitude: SERVED_MEAN,
        direction_intent: 'preserve',
        expected: { mean: SERVED_MEAN, effect_direction: 'positive' },
        intent: 'confirm_current',
      });

    // R11 (AIQ #72 5872082179): a confirm is REVIEW, not authorship. Before R11 this row pinned the adoption stamp
    // (`user_specified` / `user_set`, Olumi's sizing dropped); now every byte of who-sized-it is KEPT and the review added.
    it('⭐ R11: confirms it: mutated, strength unchanged, source + Olumi\'s sizing KEPT, review recorded', async () => {
      const graph = sizedGraph();
      const beforeStrength = structuredClone(edgeIn(graph).strength);
      const beforeAnalysisHash = computeAnalysisAffectingGraphHash(graph);

      const result = await apply(graph, confirmSized());

      expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
      if (result.kind !== 'mutated') return;
      const confirmed = edgeIn(result.graph);
      expect(confirmed.strength).toStrictEqual(beforeStrength);
      expect(confirmed.effect_direction).toBe('positive');
      expect(confirmed.provenance?.source).toBe('cee_hypothesis');
      expect(confirmed.provenance_display).toBeUndefined();
      expect(confirmed.provenance?.natural_effect).toStrictEqual(edgeIn(graph).provenance!.natural_effect);
      expect(confirmed.provenance?.magnitude).toBe('olumi_estimate');
      expect(result.response.assistant_text).toBe("You accepted Olumi's estimate for how much Marketing budget changes Revenue.");
      expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(beforeAnalysisHash);
      // The persisted bytes the dispatcher writes, not only the parsed view.
      const persistedEdge = (result.mutatedGraph as { edges: Array<Record<string, unknown>> }).edges.find(
        (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
      )!;
      const { reviewed_by_user: review, ...kept } = persistedEdge.provenance as Record<string, unknown>;
      expect(kept).toStrictEqual(edgeIn(graph).provenance);
      expect(review).toMatchObject({ intent: 'confirm' });
    });

    it('CONTRAST: the same confirm still refuses when it would also drop an additive target-edge field', async () => {
      const graph = sizedGraph() as GraphV3T & Record<string, unknown>;
      const edge = edgeIn(graph) as GraphV3T['edges'][number] & Record<string, unknown>;
      edge.display_note = 'keep this non-analysis metadata';

      const result = await apply(graph, confirmSized());

      expect(result).toMatchObject({
        kind: 'refused',
        reason: 'confirmation_would_change_non_provenance_state',
      });
    });

    // R11 (AIQ #72 5872082179): the guard now admits the review record and NOTHING about who sized the link. Before
    // R11 it admitted exactly the removal of `natural_effect` / `magnitude` alongside the `user_specified` stamp.
    describe('the pure guard admits the review record and nothing wider', () => {
      /** The writer's projection for a confirm (R11): everything kept, the review recorded. */
      function stamped(before: GraphV3T): GraphV3T {
        const after = structuredClone(before);
        const target = edgeIn(after);
        target.provenance = {
          ...target.provenance!,
          reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' },
        } as typeof target.provenance;
        return after;
      }
      const guard = (before: GraphV3T, after: GraphV3T) =>
        isProvenanceOnlyEdgeConfirmation({ before, after, from: 'f-budget', to: 'g-revenue' });

      it('⭐ R11: natural_effect and magnitude KEPT, review added: admitted; PRESENT → ABSENT (the old adoption): refused', () => {
        const before = sizedGraph();
        expect(guard(before, stamped(before))).toBe(true);
        const dropped = stamped(before);
        const { natural_effect: _n, magnitude: _m, ...rest } = edgeIn(dropped).provenance!;
        edgeIn(dropped).provenance = rest as GraphV3T['edges'][number]['provenance'];
        expect(guard(before, dropped)).toBe(false);
      });

      it('natural_effect ADDED (absent before, present after): refused', () => {
        const before = buildD1Fixture();
        const after = stamped(before);
        edgeIn(after).provenance = {
          ...edgeIn(after).provenance!,
          natural_effect: edgeIn(sizedGraph()).provenance!.natural_effect!,
        };
        expect(guard(before, after)).toBe(false);
      });

      it('magnitude REWRITTEN: refused', () => {
        const before = sizedGraph();
        const after = stamped(before);
        edgeIn(after).provenance = { ...edgeIn(after).provenance!, magnitude: 'user_stated' };
        expect(guard(before, after)).toBe(false);
      });

      it('CONTRAST: both removed AND provenance.reasoning rewritten: refused', () => {
        const before = sizedGraph();
        edgeIn(before).provenance = { ...edgeIn(before).provenance!, reasoning: 'Olumi estimate' };
        const after = stamped(before);
        edgeIn(after).provenance = { ...edgeIn(after).provenance!, reasoning: 'rewritten' };
        expect(guard(before, after)).toBe(false);
      });
    });
  });

  it('refuses confirm_current when canonical persistence would change analysis inputs', async () => {
    const graph = {
      ...buildD1Fixture(),
      // The stored graph has an existing top-level option surface but is
      // missing the option-node mirror. The canonical persist projection would
      // repair it, moving the analysis hash. Confirmation must not use its
      // provenance permission to smuggle that analysis-affecting repair in.
      options: [],
    };
    const before = structuredClone(graph);
    const result = await apply(
      graph,
      eventFor({ intent: 'confirm_current', magnitude: 0.4 }),
    );

    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'confirmation_would_change_non_provenance_state',
    });
    expect(graph).toStrictEqual(before);
  });

  it('refuses confirmation when a cosmetic/additive target-edge field would be dropped even though analysis hash is unchanged', async () => {
    const graph = buildD1Fixture() as GraphV3T & Record<string, unknown>;
    const edge = edgeIn(graph) as GraphV3T['edges'][number] &
      Record<string, unknown>;
    edge.display_note = 'keep this non-analysis metadata';
    const beforeHash = computeAnalysisAffectingGraphHash(graph);

    const result = await apply(
      graph,
      eventFor({ intent: 'confirm_current', magnitude: 0.4 }),
    );

    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'confirmation_would_change_non_provenance_state',
    });
    expect(computeAnalysisAffectingGraphHash(graph)).toBe(beforeHash);
    expect(edge.display_note).toBe('keep this non-analysis metadata');
  });

  it('the full-graph allowlist rejects an unrelated cosmetic change', () => {
    const before = buildD1Fixture();
    edgeIn(before).provenance = { source: 'cee_hypothesis' };
    const after = structuredClone(before);
    const target = edgeIn(after);
    // R11: the confirm's own record, so the cosmetic change is the ONLY other difference.
    target.provenance = {
      ...target.provenance!,
      reviewed_by_user: { intent: 'confirm', at: '2026-09-28T15:00:00.000Z' },
    } as typeof target.provenance;
    expect(isProvenanceOnlyEdgeConfirmation({ before, after: structuredClone(after), from: 'f-budget', to: 'g-revenue' })).toBe(true);
    after.nodes[0]!.label = `${after.nodes[0]!.label} changed`;

    expect(isProvenanceOnlyEdgeConfirmation({
      before,
      after,
      from: 'f-budget',
      to: 'g-revenue',
    })).toBe(false);
  });

  it('an analysis-affecting set changes the canonical freshness hash', async () => {
    const graph = buildD1Fixture();
    const beforeHash = computeAnalysisAffectingGraphHash(graph);
    const result = await apply(graph, eventFor({ magnitude: 0.9 }));

    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;
    expect(computeAnalysisAffectingGraphHash(result.graph)).not.toBe(beforeHash);
  });

  it('refuses a stale expected mean without mutating input', async () => {
    const graph = buildD1Fixture();
    const before = structuredClone(graph);
    const result = await apply(
      graph,
      eventFor({ expected: { mean: 0.3, effect_direction: 'positive' } }),
    );

    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'expected_mismatch',
      authorityConflict: {
        conflict_category: 'edge_expected_tuple_mismatch',
        edge: {
          from: 'f-budget',
          to: 'g-revenue',
          expected: { mean: 0.3, effect_direction: 'positive' },
          current: { mean: 0.4, effect_direction: 'positive' },
          match_count: 1,
        },
      },
    });
    expect(graph).toStrictEqual(before);
  });

  it('refuses a stale expected direction at zero without mutating input', async () => {
    const graph = buildD1Fixture();
    const edge = edgeIn(graph);
    edge.strength.mean = 0;
    edge.effect_direction = 'positive';
    const before = structuredClone(graph);
    const result = await apply(
      graph,
      eventFor({ expected: { mean: 0, effect_direction: 'negative' } }),
    );

    expect(result).toMatchObject({ kind: 'refused', reason: 'expected_mismatch' });
    expect(graph).toStrictEqual(before);
  });

  it('refuses a missing exact endpoint pair without retargeting', async () => {
    const graph = buildD1Fixture();
    const result = await apply(
      graph,
      eventFor({ from: 'f-missing', to: 'g-revenue' }),
    );
    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'target_not_found',
      authorityConflict: {
        conflict_category: 'edge_target_not_found',
        edge: { match_count: 0 },
      },
    });
  });

  it('refuses duplicate exact endpoint pairs instead of letting the handler choose one', async () => {
    const graph = buildD1Fixture();
    graph.edges.push(structuredClone(edgeIn(graph)));
    const before = structuredClone(graph);
    const result = await apply(graph, eventFor());

    expect(result).toMatchObject({
      kind: 'refused',
      reason: 'target_ambiguous',
      authorityConflict: {
        conflict_category: 'edge_target_ambiguous',
        edge: { match_count: 2 },
      },
    });
    expect(graph).toStrictEqual(before);
  });

  it('throws on a non-null malformed persisted graph rather than calling it absent', async () => {
    await expect(apply({ nodes: [], edges: [{ from: 'broken' }] }, eventFor()))
      .rejects.toBeInstanceOf(InvalidPersistedEdgeGraphError);
  });
});

describe('isExactCommittedEdgeReadback', () => {
  it('requires one exact target and every target-edge field to match', () => {
    const projected = buildD1Fixture();
    const committed = structuredClone(projected);
    expect(isExactCommittedEdgeReadback({
      projected,
      committed,
      from: 'f-budget',
      to: 'g-revenue',
    })).toBe(true);

    edgeIn(committed).strength.mean = 0.9;
    expect(isExactCommittedEdgeReadback({
      projected,
      committed,
      from: 'f-budget',
      to: 'g-revenue',
    })).toBe(false);
  });

  it('fails closed for null, malformed, missing, or duplicate readback', () => {
    const projected = buildD1Fixture();
    const missing = structuredClone(projected);
    missing.edges = missing.edges.filter(
      (edge) => edge.from !== 'f-budget' || edge.to !== 'g-revenue',
    );
    const duplicate = structuredClone(projected);
    duplicate.edges.push(structuredClone(edgeIn(duplicate)));

    for (const committed of [null, { malformed: true }, missing, duplicate]) {
      expect(isExactCommittedEdgeReadback({
        projected,
        committed,
        from: 'f-budget',
        to: 'g-revenue',
      })).toBe(false);
    }
  });
});

describe('R3-9 — the canvas edit of a DEFINITIONAL link is refused, in words (AIQ 5866734772, DL 5866746362)', () => {
  const withProduct = (): GraphV3T => {
    const graph = buildD1Fixture();
    const goal = graph.nodes.find((n) => n.id === 'g-revenue')!;
    (goal as Record<string, unknown>).nonlinear_identity = { operation: 'product', factor_ids: ['f-budget', 'f-quality'], stated_in_brief: true };
    return graph;
  };

  it('RED at base: refused as definitional_link, nothing written, and the reply names the definition and what to change', async () => {
    const graph = withProduct();
    const before = JSON.stringify(graph);
    const result = await apply(graph, eventFor());
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') return;
    expect(result.reason).toBe('definitional_link');
    expect(result.response.assistant_text).toMatch(/is defined by .* = .* × .*/);
    expect(result.response.assistant_text).toMatch(/instead/);
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('refused even when the edit is also stale — a definition is never editable, whatever the expected tuple', async () => {
    const result = await apply(withProduct(), eventFor({ expected: { mean: 0.123, effect_direction: 'positive' } }));
    expect(result.kind === 'refused' && result.reason).toBe('definitional_link');
  });

  it('a confirm_current on a definitional link is refused too (no provenance-only stamp on a definition)', async () => {
    const result = await apply(withProduct(), eventFor({ intent: 'confirm_current', magnitude: 0.4 }));
    expect(result.kind === 'refused' && result.reason).toBe('definitional_link');
  });

  it('control: with no declared identity the same event mutates exactly as before', async () => {
    const result = await apply(buildD1Fixture(), eventFor());
    expect(result.kind).toBe('mutated');
  });
});

describe('R3-9 × AIQ 5867435409 (1): the canvas edit is refused only while the last Run kept the identity in use', () => {
  const withProduct = (): GraphV3T => {
    const graph = buildD1Fixture();
    const goal = graph.nodes.find((n) => n.id === 'g-revenue')!;
    (goal as Record<string, unknown>).nonlinear_identity = { operation: 'product', factor_ids: ['f-budget', 'f-quality'], stated_in_brief: true };
    return graph;
  };
  const applyWith = async (lastRunIdentityUse: { withdrawn: ReadonlySet<string> } | null) => {
    const event = eventFor();
    return await applyEdgeStrengthEdit({ payload: payloadFor(event), event, requestId: 'req-r39-use', persistedGraph: withProduct(), lastRunIdentityUse });
  };

  it('⭐ RED: the last Run WITHDREW the identity → the edit is an ordinary belief: stored (the adapter AND the handler agree)', async () => {
    const result = await applyWith({ withdrawn: new Set(['g-revenue']) });
    expect(result.kind, JSON.stringify((result as { reason?: unknown }).reason ?? null)).toBe('mutated');
  });

  it('the last Run kept it in use → refused', async () => {
    const result = await applyWith({ withdrawn: new Set() });
    expect(result.kind === 'refused' && result.reason).toBe('definitional_link');
  });

  it('no Run yet (null) → refused; the next Run decides', async () => {
    const result = await applyWith(null);
    expect(result.kind === 'refused' && result.reason).toBe('definitional_link');
  });
});
