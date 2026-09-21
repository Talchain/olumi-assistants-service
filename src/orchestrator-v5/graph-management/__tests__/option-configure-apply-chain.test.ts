/**
 * ROADMAP 2.11 / P0-2 — fixture-level pin of the FULL configure-option
 * chain, in the exact shapes the SERVED edit prompt emits (PMS
 * edit_graph_default v11, verified on staging 2026-07-16: teaches
 * `update_node` at `/nodes/<opt>/data/interventions/<factor_id>`, object
 * leaf `{value, raw_value, unit, cap}` — its EXAMPLE 2 — and CEE's parser
 * also accepts a scalar leaf).
 *
 * Chain pinned here, per hop:
 *   1. parseEditGraphResponse — the served-prompt op shape survives parsing
 *      WITH factor attribution (the object-leaf regression this lane fixed:
 *      an object leaf was smeared node-level, losing `<factor_id>`, so any
 *      option with more than one factor edge became un-attributable and the
 *      whole edit deferred);
 *   2. evaluateEditGraphMutations (live) — the op is TUNABLE
 *      (update_node_field, D-S would_apply): verdict proceeds, no hold;
 *   3. applyPatchOperations + encodeOptionInterventionsForEdit — the write
 *      lands as canonical top-level `interventions` with a numeric value;
 *   4. mergeInterventionSources + computeStructuralReadiness — the reader
 *      sees it and the option flips needs_encoding → ready (the exact
 *      predicate PLoT preflight enforces on run_analysis).
 *
 * Graph mirrors the diagnosis brief's captured scenario A (add-option-2.11.md
 * §2): the chat-added option has multiple option→factor edges and zero
 * interventions — the live shape that 422-blocked every analysis after A3.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';
import {
  computeStructuralReadiness,
  mergeInterventionSources,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateEditGraphMutations } from '../../handlers/edit-graph-referee-gate.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import * as draftTool from '../../../orchestrator/tools/draft-graph.js';
import * as sessionModule from '../../session/index.js';
import { dispatchDraftGraph } from '../../handlers/draft-graph-dispatch.js';
import { commitDirectAnswer } from '../../commit.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildReadinessEffectPending, buildReadinessRecoveryChip } from '../../coaching/readiness-recovery.js';
import { deriveMissingEffectPairs, resolveRecordedOptionEffectAnswer } from '../../routing/repair-value-binding.js';
import {
  PENDING_ACTION_ASK_TURN_TTL,
  PENDING_ACTION_ASK_WALL_TTL_MS,
} from '../../session/pending-action.js';
import { buildOptionEffectRawOperation, readCommittedOptionEffect } from '../../routing/option-effect-write.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import { generateChips } from '../../compose/chip-generator.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import type { PendingAction } from '../../session/pending-action.js';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';

afterEach(() => vi.restoreAllMocks());

/** Scenario-A-shaped graph: 2 configured options + the intervention-less add. */
function buildScenarioAGraph() {
  return {
    nodes: [
      { id: 'dec_eu', kind: 'decision', label: 'EU Expansion' },
      {
        id: 'opt_berlin',
        kind: 'option',
        label: 'Open Berlin Office',
        interventions: {
          fac_setup_cost: { value: 0.6, source: 'user_specified' },
          fac_hiring: { value: 0.5, source: 'user_specified' },
        },
      },
      {
        id: 'opt_acquire',
        kind: 'option',
        label: 'Acquire Small German Competitor',
        // The live A3 shape: {id, kind, label} ONLY — zero interventions.
      },
      {
        id: 'fac_setup_cost',
        kind: 'factor',
        label: 'Setup Cost',
        observed_state: { value: 0.4, raw_value: 1000000, unit: '£', cap: 2500000 },
      },
      {
        id: 'fac_hiring',
        kind: 'factor',
        label: 'Hiring Speed',
        observed_state: { value: 0.5, raw_value: 50, unit: 'hires/yr', cap: 100 },
      },
      { id: 'goal_growth', kind: 'goal', label: 'EU Revenue Growth' },
    ],
    edges: [
      { from: 'dec_eu', to: 'opt_berlin', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_eu', to: 'opt_acquire', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      // The added option is wired to TWO factors (the attribution-ambiguity
      // shape: a node-level smear cannot pick between them).
      { from: 'opt_acquire', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_acquire', to: 'fac_hiring', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_berlin', to: 'fac_setup_cost', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_berlin', to: 'fac_hiring', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_setup_cost', to: 'goal_growth', strength: { mean: -0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'negative' },
      { from: 'fac_hiring', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

/** The served prompt's EXAMPLE-2 output, retargeted at scenario A. */
const SERVED_PROMPT_SHAPED_RESPONSE = JSON.stringify({
  operations: [
    {
      op: 'update_node',
      path: '/nodes/opt_acquire/data/interventions/fac_setup_cost',
      value: { value: 0.8, raw_value: 2000000, unit: '£', cap: 2500000 },
      old_value: null,
      impact: 'moderate',
      rationale: 'Sets the setup cost intervention on the acquisition option.',
    },
    {
      op: 'update_node',
      path: '/nodes/opt_acquire/data/interventions/fac_hiring',
      value: { value: 0.7, raw_value: 70, unit: 'hires/yr', cap: 100 },
      old_value: null,
      impact: 'moderate',
      rationale: 'Sets the hiring speed intervention on the acquisition option.',
    },
  ],
  removed_edges: [],
  warnings: [],
  coaching: { summary: 'Configured the acquisition option.', rerun_recommended: true },
});

describe('configure-option apply chain (served-prompt op shapes, scenario A)', () => {
  it('continues a recorded draft question through invalid reply, actual value writes, cold reads and the Run offer', async () => {
    const scenarioId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const rows: SessionTurnWrite[] = [];
    let graphJson: string | null = null;
    let pendingJson = '[]';
    // Reuse the complete SessionStore double. Only serialized bytes cross a
    // fresh facade: no closure-held graph or pending object can serve a read.
    // This witnesses the real commit contract, not Supabase or authentication.
    const freshStore = (): SessionStore => createMockSessionStore({
      append: async (write) => {
        const stored = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
        rows.push(stored);
        if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
        pendingJson = JSON.stringify(stored.pending_actions ?? []);
        return { id: `row-${rows.length}` };
      },
      loadGraph: async () => graphJson === null ? null : JSON.parse(graphJson),
      readMostRecentPendingActions: async () => JSON.parse(pendingJson) as PendingAction[],
    });
    let store = freshStore();
    vi.spyOn(sessionModule, 'getSessionStore').mockImplementation(() => store);
    const rawGraph = { ...GraphV3.parse(buildScenarioAGraph()), options: [] };
    const draftReadiness = buildCanonicalAnalysisReadyFromGraph(rawGraph);
    expect(draftReadiness?.status).toBe('needs_user_input');
    expect(deriveMissingEffectPairs(draftReadiness)).toHaveLength(2);
    vi.spyOn(draftTool, 'handleDraftGraph').mockResolvedValue({
      blocks: [], assistantText: 'Drafted.', latencyMs: 1, strengthenItems: [],
      coachingSummary: null, coachingWideningLog: null, coachingBiasSignals: null,
      draftWarnings: [], graphOutput: rawGraph, analysisReady: draftReadiness,
    } as Awaited<ReturnType<typeof draftTool.handleDraftGraph>>);
    const drafted = await dispatchDraftGraph({
      payload: {
        kind: 'message', scenario_id: scenarioId,
        turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', stage: 'frame',
        message: 'Should we open a Berlin office or acquire a German competitor?',
        turn_class: 'frame', source: 'composer',
      },
      requestId: 'req-recorded-chain-draft', request: {} as FastifyRequest,
    });
    expect(drafted.commitPerformed).toBe(true);
    expect(rows).toHaveLength(1);
    store = freshStore();
    const initialGraph = await store.loadGraph(scenarioId) as GraphV3T;
    expect(GraphV3.safeParse(initialGraph).success).toBe(true);
    const initialHash = computeAnalysisAffectingGraphHash(initialGraph);
    if (initialHash === null) throw new Error('fixture must hash');
    const initialPending = await store.readMostRecentPendingActions(scenarioId);
    expect(initialPending).toHaveLength(1);
    expect(initialPending[0]?.preconditions.graph_hash).toBe(initialHash);
    expect(initialHash).not.toBe(computeAnalysisAffectingGraphHash(rawGraph));
    const initialPair = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(initialGraph))[0]!;
    expect(drafted.response.assistant_text).toContain(initialPair.optionLabel);
    expect(drafted.response.assistant_text).toContain(initialPair.factorLabel);
    const siblingBefore = initialGraph.nodes.find(node => node.id === 'opt_berlin');

    // Bare 20 is not 20%. It asks again without a graph write or a new pending
    // that could reset the original identity, age or unrelated pending state.
    const invalid = resolveRecordedOptionEffectAnswer({
      message: '20', pendings: initialPending, graph: initialGraph,
      readiness: buildCanonicalAnalysisReadyFromGraph(initialGraph), scenarioId, nowMs: Date.now(),
    });
    expect(invalid).toEqual({ kind: 'ask', pair: initialPair });
    const beforeInvalid = graphJson;
    await commitDirectAnswer({
      response_version: 2, assistant_text: 'Please give the effect value as a share or percentage.',
      blocks: [], suggested_actions: [], insights: [], stage_indicator: 'analyse',
    }, {
      scenario_id: scenarioId, turn_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      turn_class: 'clarify', handler_id: null, request_hash: 'invalid-20',
      llm_calls_used: 0, duration_ms: 0, handler_facts: [],
      priorPendingActions: initialPending, graph_hash: initialHash, userMessage: '20',
    }, store);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.graph).toBeUndefined();
    expect(graphJson).toBe(beforeInvalid);
    store = freshStore();
    const afterInvalid = await store.readMostRecentPendingActions(scenarioId);
    // Exactly ONE carry-forward decrement, derived from what was actually
    // armed rather than hardcoded: the literal `1` here was the offer default
    // minus one, and it silently encoded the ask window as 2. Deriving it binds
    // this line to the mechanism it is about (a non-consuming turn decrements
    // once) instead of to a constant that is not this test's subject.
    expect(afterInvalid).toEqual([
      { ...initialPending[0], expires_at_turn_count: initialPending[0]!.expires_at_turn_count - 1 },
    ]);

    for (const [index, message] of ['20%', 'Set it to about 0.7'].entries()) {
      store = freshStore();
      const before = await store.loadGraph(scenarioId) as GraphV3T;
      expect(GraphV3.safeParse(before).success).toBe(true);
      const prior = await store.readMostRecentPendingActions(scenarioId);
      const readiness = buildCanonicalAnalysisReadyFromGraph(before);
      const resolved = resolveRecordedOptionEffectAnswer({
        message, pendings: prior, graph: before, readiness, scenarioId, nowMs: Date.now(),
      });
      expect(resolved.kind).toBe('bind');
      if (resolved.kind !== 'bind') throw new Error('recorded answer must bind');
      const { answer } = resolved;
      const value = Number(answer.valueText);
      expect(value).toBe(index === 0 ? 0.2 : 0.7);
      const operations = parseEditGraphResponse(JSON.stringify({
        operations: [buildOptionEffectRawOperation({ ...answer.pair, value })],
        removed_edges: [], warnings: [], coaching: null,
      })).operations as PatchOperation[];
      const hash = computeAnalysisAffectingGraphHash(before);
      const decision = evaluateEditGraphMutations({
        mode: 'live', operations, currentGraph: before, currentGraphHash: hash,
        baseGraphHash: hash, freshness: 'fresh', scenarioId,
        turnId: `answer-${index}`, requestId: `req-answer-${index}`,
      });
      expect(decision.governing).toBe('proceed');
      expect(decision.blockApply).toBe(false);
      const applied = applyPatchOperations(GraphV3.parse(before), operations);
      const encoded = encodeOptionInterventionsForEdit(applied, new Set([answer.pair.optionId]));
      expect(encoded.unresolvedOptionIds).toEqual([]);
      const projected = projectGraphForPersistence(encoded.graph);
      expect(readCommittedOptionEffect(projected, answer.pair.optionId, answer.pair.factorId)).toBe(value);
      expect(projected.nodes.find(node => node.id === 'opt_berlin')).toEqual(siblingBefore);
      expect(projected.nodes.filter(node => node.id !== answer.pair.optionId)).toEqual(
        before.nodes.filter(node => node.id !== answer.pair.optionId),
      );
      expect(projected.edges).toEqual(before.edges);
      const nextReady = buildCanonicalAnalysisReadyFromGraph(projected);
      const nextHash = computeAnalysisAffectingGraphHash(projected);
      if (nextHash === null) throw new Error('applied fixture must hash');
      const nextChip = buildReadinessRecoveryChip(nextReady, projected.nodes);
      const nextAsked = nextChip?.id === 'chip_prompt_repair_effect_value'
        ? buildReadinessEffectPending({
            analysisReady: nextReady, nodes: projected.nodes, scenarioId,
            graphHash: nextHash, emittedAtIso: new Date().toISOString(),
          })
        : null;
      const chips = nextChip !== null ? [nextChip] : generateChips({
        stage: 'analyse', handlerFacts: [], priorFacts: [], analysis: null,
        analysisReady: nextReady, validationRegistry: HANDLER_VALIDATION_REGISTRY,
      });
      const response: OlumiResponse = {
        response_version: 2, assistant_text: `Set ${answer.pair.factorLabel} to ${value}.`,
        blocks: [], suggested_actions: [...chips], insights: [], stage_indicator: 'analyse',
      };
      await commitDirectAnswer(response, {
        scenario_id: scenarioId,
        turn_id: index === 0 ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        turn_class: 'direct_answer', handler_id: null, request_hash: `answer-${index}`,
        llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: projected,
        graph_hash: nextHash, priorPendingActions: prior,
        consumedPendingRefs: [answer.pending.chip_id],
        ...(nextAsked !== null ? { pending_actions: [nextAsked] } : {}),
        userMessage: message,
      }, store);
      expect(rows).toHaveLength(index + 3);
      store = freshStore();
      const cold = await store.loadGraph(scenarioId);
      expect(cold).toEqual(projected);
      expect(readCommittedOptionEffect(cold, answer.pair.optionId, answer.pair.factorId)).toBe(value);
      expect(readCommittedOptionEffect(cold, 'opt_acquire', 'fac_setup_cost')).toBe(0.2);
      const coldPending = await store.readMostRecentPendingActions(scenarioId);
      expect(coldPending.some(pending => pending.id === answer.pending.id)).toBe(false);
      if (index === 0) {
        expect(nextReady?.status).toBe('needs_user_input');
        expect(nextAsked?.action).toMatchObject({
          kind: 'elicit_option_effect', option_id: 'opt_acquire', factor_id: 'fac_hiring',
        });
        // The persisted question is the one this turn asked, carrying the
        // lifetime the commit chokepoint stamps on a recorded ASK — which is
        // exactly the difference between what a caller constructs and what the
        // user can still answer. Spelled out rather than elided, so a change to
        // either half REDs here.
        expect(coldPending).toEqual([
          {
            ...nextAsked,
            expires_at_turn_count: PENDING_ACTION_ASK_TURN_TTL,
            expires_at_iso: new Date(
              Date.parse(nextAsked!.emitted_at_iso) + PENDING_ACTION_ASK_WALL_TTL_MS,
            ).toISOString(),
          },
        ]);
        expect(nextChip?.message).toContain('Hiring Speed');
      } else {
        expect(nextReady?.status).toBe('ready');
        expect(nextAsked).toBeNull();
        expect(chips.some(chip => 'action_type' in chip && chip.action_type === 'run_analysis')).toBe(true);
        expect(coldPending.some(pending => pending.action.kind === 'elicit_option_effect')).toBe(false);
      }
    }
    expect(rows.filter(row => row.graph !== undefined)).toHaveLength(3);
  });

  it('hop 1 — parse keeps factor attribution for OBJECT intervention leaves', () => {
    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    expect(parsed.operations).toHaveLength(2);
    for (const [i, fac] of (['fac_setup_cost', 'fac_hiring'] as const).entries()) {
      const op = parsed.operations[i]!;
      expect(op.op).toBe('update_node');
      expect(op.path).toBe('opt_acquire');
      // The regression this pins: the object leaf must arrive keyed by its
      // slash path (factor attribution intact), NOT smeared node-level.
      const value = op.value as Record<string, unknown>;
      expect(Object.keys(value)).toEqual([`data/interventions/${fac}`]);
      expect((value[`data/interventions/${fac}`] as Record<string, unknown>).value).toBeDefined();
    }
  });

  it('hop 2 — the referee judges the op tunable and PROCEEDS (no hold)', () => {
    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    const decision = evaluateEditGraphMutations({
      mode: 'live',
      operations: parsed.operations,
      currentGraph: buildScenarioAGraph(),
      currentGraphHash: 'hash-a',
      baseGraphHash: 'hash-a',
      freshness: 'fresh',
      scenarioId: 'scn-1',
      turnId: 'turn-1',
      requestId: 'req-1',
    });
    expect(decision.governing).toBe('proceed');
    expect(decision.blockApply).toBe(false);
  });

  it('hops 3+4 — applier + encoder land canonical interventions; readiness flips needs_encoding → ready', () => {
    const graph = GraphV3.parse(buildScenarioAGraph());

    // RED baseline: before the write, the added option blocks analysis.
    const before = computeStructuralReadiness(graph);
    expect(before?.status).toBe('needs_encoding');
    expect(before?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe(
      'needs_encoding',
    );

    const parsed = parseEditGraphResponse(SERVED_PROMPT_SHAPED_RESPONSE);
    const applied = applyPatchOperations(graph, parsed.operations as PatchOperation[]);
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set(['opt_acquire']),
    );
    // The write must LAND — a defer here is the multi-factor attribution
    // regression (node-level smear cannot be attributed).
    expect(unresolvedOptionIds).toEqual([]);

    const encodedNode = (encoded as { nodes: Array<Record<string, unknown>> }).nodes.find(
      (n) => n.id === 'opt_acquire',
    )!;
    const merged = mergeInterventionSources(encodedNode);
    expect(merged).toBeDefined();
    expect(merged!.fac_setup_cost).toBeCloseTo(0.8);
    expect(merged!.fac_hiring).toBeCloseTo(0.7);

    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe('ready');
    expect(after?.status).toBe('ready');
  });

  it('scalar leaf form also lands (parser wraps it slash-keyed; encoder derives from the factor)', () => {
    const graph = GraphV3.parse(buildScenarioAGraph());
    const parsed = parseEditGraphResponse(
      JSON.stringify({
        operations: [
          {
            op: 'update_node',
            path: '/nodes/opt_acquire/data/interventions/fac_setup_cost',
            value: 0.8,
            old_value: null,
            impact: 'moderate',
            rationale: 'Scalar leaf.',
          },
          {
            op: 'update_node',
            path: '/nodes/opt_acquire/data/interventions/fac_hiring',
            value: 0.7,
            old_value: null,
            impact: 'moderate',
            rationale: 'Scalar leaf.',
          },
        ],
        removed_edges: [],
        warnings: [],
        coaching: { summary: 's', rerun_recommended: true },
      }),
    );
    const applied = applyPatchOperations(graph, parsed.operations as PatchOperation[]);
    const { graph: encoded, unresolvedOptionIds } = encodeOptionInterventionsForEdit(
      applied,
      new Set(['opt_acquire']),
    );
    expect(unresolvedOptionIds).toEqual([]);
    const after = computeStructuralReadiness(GraphV3.parse(encoded));
    expect(after?.options.find((o) => o.option_id === 'opt_acquire')?.status).toBe('ready');
  });
});
