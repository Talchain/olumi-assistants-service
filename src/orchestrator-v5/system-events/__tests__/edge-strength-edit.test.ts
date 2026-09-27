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
  // A6 (AIQ N1 on #2096): an exact figure keeps Olumi's RELATIVE spread, never the absolute std sized for 0.4.
  it('sets the unique exact edge through the existing handler and carries Olumi’s relative spread (A6)', async () => {
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
    // A6: a mean of 0 has no relative spread (it would be 0, and std must be > 0), so the std is
    // Olumi's default spread, flagged — never the stale absolute std sized for the old mean.
    'persists an explicit %s direction at zero; the std is Olumi’s default spread (A6)',
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
    expect(confirmed.provenance?.source).toBe('user_specified');
    expect(confirmed.provenance_display).toBe('user_set');
    expect(result.handlerFacts[0]).toMatchObject({ noop: true });
    expect(result.response.assistant_text).toContain('Confirmed the current strength');
    expect(result.response.assistant_text).toContain('as your judgement');
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

    it('⭐ adopts it: mutated, strength unchanged, stamped as the user\'s, natural_effect and magnitude gone', async () => {
      const graph = sizedGraph();
      const beforeStrength = structuredClone(edgeIn(graph).strength);
      const beforeAnalysisHash = computeAnalysisAffectingGraphHash(graph);

      const result = await apply(graph, confirmSized());

      expect(result.kind === 'refused' ? result.reason : result.kind).toBe('mutated');
      if (result.kind !== 'mutated') return;
      const confirmed = edgeIn(result.graph);
      expect(confirmed.strength).toStrictEqual(beforeStrength);
      expect(confirmed.effect_direction).toBe('positive');
      expect(confirmed.provenance?.source).toBe('user_specified');
      expect(confirmed.provenance_display).toBe('user_set');
      expect(confirmed.provenance).not.toHaveProperty('natural_effect');
      expect(confirmed.provenance).not.toHaveProperty('magnitude');
      expect(result.response.assistant_text).toContain('Confirmed the current strength');
      expect(computeAnalysisAffectingGraphHash(result.graph)).toBe(beforeAnalysisHash);
      // The persisted bytes the dispatcher writes, not only the parsed view.
      const persistedEdge = (result.mutatedGraph as { edges: Array<Record<string, unknown>> }).edges.find(
        (edge) => edge.from === 'f-budget' && edge.to === 'g-revenue',
      )!;
      expect(persistedEdge.provenance).toStrictEqual({ source: 'user_specified' });
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

    describe('the pure guard admits the two removals and nothing wider', () => {
      /** The writer's projection for a confirm: source + display stamped, Olumi's sizing dropped. */
      function stamped(before: GraphV3T): GraphV3T {
        const after = structuredClone(before);
        const target = edgeIn(after);
        const {
          natural_effect: _naturalEffect,
          magnitude: _magnitude,
          ...rest
        } = (target.provenance ?? {}) as Record<string, unknown>;
        target.provenance = { ...rest, source: 'user_specified' } as typeof target.provenance;
        target.provenance_display = 'user_set';
        // A6: a figure confirm leaves Olumi's std, and says so per field.
        target.std_defaulted = true;
        return after;
      }
      const guard = (before: GraphV3T, after: GraphV3T) =>
        isProvenanceOnlyEdgeConfirmation({ before, after, from: 'f-budget', to: 'g-revenue' });

      it('⭐ natural_effect and magnitude PRESENT → ABSENT: admitted', () => {
        const before = sizedGraph();
        expect(guard(before, stamped(before))).toBe(true);
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
    const after = structuredClone(before);
    const target = edgeIn(after);
    target.provenance = { ...(target.provenance ?? {}), source: 'user_specified' };
    target.provenance_display = 'user_set';
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
