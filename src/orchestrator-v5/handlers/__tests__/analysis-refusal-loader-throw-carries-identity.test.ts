/**
 * THE REFUSAL THE LOADER RAISES MUST STILL BE ABLE TO NAME THE MODEL.
 *
 * ## The witnessed defect
 *
 * An authenticated user clicks "Run analysis" on a freshly drafted model. The
 * turn returns
 *
 *     analysis_ready = { options: [], goal_node_id: "",
 *                        status: "blocked",
 *                        blocked_reason: "MISSING_OPTION_VALUE", computed_at }
 *
 * — a refusal that cannot describe the model it is refusing. The persisted
 * graph holds a goal and several options, and **a goal needs no value to be
 * identified**, so an empty `goal_node_id` is not honest filtering. It is the
 * product denying the existence of the model the user is looking at.
 *
 * ## Why #1126 did not close it
 *
 * #1126 gave `buildAnalysisRefusalReadiness` the right DISCRIMINATOR (the
 * admission verdict `may_run`) and wired the chip arm to pass the turn's
 * structural projection. On this path there is no projection to pass:
 * `chip-click-dispatch.ts:904` leaves `cachedSnapshot` null when the loader
 * throws, so `:955` binds `analysisReady = undefined`, `:1081` hands that to the
 * composer, and `analysis-ready-helper.ts:1599` returns the bare carrier before
 * the discriminator is ever consulted. The rule was right and had nothing to
 * rule on.
 *
 * ## Where the identity already exists
 *
 * `build-turn-context.ts:2430` computes `resolveRunAdmission(sigmaFloor.graph)`
 * on a GraphV3-valid graph and throws on `!willProceed` two lines later.
 * `RunAdmission.assessment` is exposed precisely so a caller that also needs
 * `analysisReady` can reuse THAT assessment (`analysis-ready-core.ts:268-279`).
 * The model's identity is computed, held, and discarded — because
 * `AnalysisNotReadyError` carried exactly one field.
 *
 * Nothing here is derived a second time and nothing is invented: the carried
 * payload is byte-identical to `buildCanonicalAnalysisReadyFromGraph` for the
 * same graph, which is asserted below rather than assumed.
 *
 * ## The opposite-direction twins
 *
 * A corpus that only tests the carry is a guard watching one door
 * (CLAUDE.md trap 22b). Three cases must stay BARE and are asserted here:
 * NO_GRAPH and SCHEMA_INVALID (there is no model to name — the semantic
 * projector returns `undefined`, so the one-argument throws are correct), and
 * an ADMITTING refusal (`may_run === true`), which is exactly the class #1126
 * measured the empty carrier for and must not regress.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { AnalysisNotReadyError } from '../../tools/handlers/analysis-ready-core.js';
import {
  buildAnalysisRefusalReadiness,
  buildCanonicalAnalysisReadyFromGraph,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';

const { commitDirectAnswerMock, enrichRunAnalysisMock, buildTurnContextMock } = vi.hoisted(() => ({
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

// ⚠ ONLY `buildTurnContext` is replaced. `loadScenarioSnapshotForRunAnalysis`
// is deliberately left REAL, so the `AnalysisNotReadyError` the chip arm reads
// is the one PRODUCED BY THE CODE UNDER TEST rather than a fixture written from
// this lane's model of the producer (CLAUDE.md trap 16-inverse: a fixture you
// wrote yourself is not evidence about the wire).
vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return { ...actual, buildTurnContext: buildTurnContextMock };
});

// The REAL loader reads `getSessionStore()`. Point it at the test store so the
// production read path executes end to end against a chosen persisted graph.
const { sessionStoreRef } = vi.hoisted(() => ({ sessionStoreRef: { current: null as unknown } }));
vi.mock('../../session/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../session/index.js')>(
    '../../session/index.js',
  );
  return { ...actual, getSessionStore: () => sessionStoreRef.current };
});

import { dispatchChipClickRunAnalysis } from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The model's identity, by NAME — never a value predicate another object could satisfy. */
const GOAL_ID = 'goal_revenue';
const OPTION_IDS = ['opt_hubspot', 'opt_stay', 'opt_migrate'] as const;

/** Every option valued: the run ADMITS. */
const CONFIGURED_GRAPH: GraphV3T = {
  nodes: [
    { id: 'dec_crm', kind: 'decision', label: 'CRM decision' },
    { id: GOAL_ID, kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
    { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost' },
    { id: 'opt_hubspot', kind: 'option', label: 'Move to HubSpot', interventions: { fac_licence: 0.7 } },
    { id: 'opt_stay', kind: 'option', label: 'Stay as we are', interventions: { fac_licence: 0.3 } },
    { id: 'opt_migrate', kind: 'option', label: 'Migrate to Salesforce', interventions: { fac_licence: 0.5 } },
  ],
  edges: [
    { from: 'dec_crm', to: 'opt_hubspot', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_crm', to: 'opt_stay', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_crm', to: 'opt_migrate', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_hubspot', to: 'fac_licence', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_stay', to: 'fac_licence', strength: { mean: 0.3, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'opt_migrate', to: 'fac_licence', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    { from: 'fac_licence', to: GOAL_ID, strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
} as unknown as GraphV3T;

/**
 * THE FRESH DRAFT — the same graph with NO option carrying a value. It differs
 * from `CONFIGURED_GRAPH` in EXACTLY one respect, and that one difference is
 * what flips run admission from true to false. The goal and all three options
 * are still present and still identifiable.
 */
const FRESH_DRAFT_GRAPH: GraphV3T = {
  nodes: CONFIGURED_GRAPH.nodes.map((n) => {
    const node = n as { kind?: string; interventions?: unknown };
    if (node.kind !== 'option') return n;
    const stripped = { ...node } as Record<string, unknown>;
    delete stripped.interventions;
    return stripped;
  }),
  edges: CONFIGURED_GRAPH.edges,
} as unknown as GraphV3T;

/** Exactly one option left unvalued: the run ADMITS by excluding it (#1126 class A). */
const ONE_UNVALUED_GRAPH: GraphV3T = {
  nodes: CONFIGURED_GRAPH.nodes.map((n) => {
    const node = n as { id?: string; kind?: string };
    if (node.kind !== 'option' || node.id !== 'opt_migrate') return n;
    const stripped = { ...node } as Record<string, unknown>;
    delete stripped.interventions;
    return stripped;
  }),
  edges: CONFIGURED_GRAPH.edges,
} as unknown as GraphV3T;

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run the analysis.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

function useGraph(graph: unknown): void {
  sessionStoreRef.current = createNoopSessionStore({ loadGraphResult: graph });
}

/** Run the REAL loader and return the error it raises, asserting it raised one. */
async function loaderThrow(graph: unknown): Promise<AnalysisNotReadyError> {
  const store = createNoopSessionStore({ loadGraphResult: graph });
  let caught: unknown;
  try {
    await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-loader-probe', store);
  } catch (err) {
    caught = err;
  }
  // Precondition PINNED IN-TEST: without this the assertions below could pass
  // vacuously on a loader that never refused (CLAUDE.md trap 13b).
  expect(caught).toBeInstanceOf(AnalysisNotReadyError);
  return caught as AnalysisNotReadyError;
}

function optionIdsOf(payloadIn: { options?: ReadonlyArray<{ option_id?: string }> }): string[] {
  return [...(payloadIn.options ?? [])].map((o) => o.option_id ?? '').sort();
}

describe('the loader refusal carries the identity the admission assessor already computed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStoreRef.current = null;
    enrichRunAnalysisMock.mockImplementation(
      async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
    );
    commitDirectAnswerMock.mockResolvedValue({
      response: {},
      performed: true,
      persisted_row_id: 'row-1',
      graphPersisted: true,
    });
    buildTurnContextMock.mockImplementation(async () => ({
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {
        can_run_analysis: false,
        can_edit_graph: false,
        can_run_decision_review: false,
        can_generate_coaching: false,
        can_invoke_tools: false,
        can_commit_session_state: false,
      },
      messages: [{ role: 'user', content: 'Run the analysis' }],
      session_id: SCENARIO_ID,
      request_id: 'req-test',
      budgets: { turn_ms: 30000, handler_ms: 20000, plot_ms: 15000, anthropic_ms: 15000, openai_ms: 15000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    }));
  });

  // ── RED-A — the producer ────────────────────────────────────────────────
  it('RED-A: the admission refusal the loader raises CARRIES the model identity (goal + options), byte-identical to the canonical projection', async () => {
    const err = await loaderThrow(FRESH_DRAFT_GRAPH);

    // The premise of the whole fix, asserted rather than inherited: this
    // refusal IS the MISSING_OPTION_VALUE one the user witnessed.
    expect(err.verdict.reasonCodes).toEqual(['MISSING_OPTION_VALUE']);

    // THE DEFECT: at the pre-fix head this is `undefined`.
    expect(err.structuralReadiness).toBeDefined();
    // Bound by IDENTITY, not by "some goal" / "some options".
    expect(err.structuralReadiness?.goal_node_id).toBe(GOAL_ID);
    expect(optionIdsOf(err.structuralReadiness!)).toEqual([...OPTION_IDS].sort());
    // Nothing new is derived: the carried payload is the canonical projection
    // of the same graph, byte for byte.
    expect(JSON.stringify(err.structuralReadiness)).toBe(
      JSON.stringify(buildCanonicalAnalysisReadyFromGraph(FRESH_DRAFT_GRAPH)),
    );
    // The admission answer travels with it, and it is the refusing one.
    expect((err.structuralReadiness as { may_run?: boolean }).may_run).toBe(false);
  });

  // ── RED-B — the consumer, end to end on the deployed chip arm ───────────
  it('RED-B: the chip arm refusal on a loader throw names the model the user must fix', async () => {
    useGraph(FRESH_DRAFT_GRAPH);

    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-chip-fresh-draft',
    });

    expect(out.outcome).toBe('handler_recovered');
    const ready = out.analysisReady;
    expect(ready).toBeDefined();
    // The witnessed payload, and the two fields that made it useless.
    expect(ready?.blocked_reason).toBe('MISSING_OPTION_VALUE');
    expect(ready?.status).toBe('blocked');
    expect(ready?.goal_node_id).toBe(GOAL_ID);
    expect(optionIdsOf(ready!)).toEqual([...OPTION_IDS].sort());
    // The consumer's own accept predicate (`normaliseV5AnalysisReady`): a
    // payload failing this is silently discarded by the UI, so a "fix" that
    // shipped a degenerate carrier would have shipped nothing.
    expect(typeof ready?.goal_node_id === 'string' && ready.goal_node_id.length > 0).toBe(true);
    expect(Array.isArray(ready?.options) && ready.options.length > 0).toBe(true);
  });

  // ── The consumer must be able to tell a refusal from a result ───────────
  it('CONSUMER-DISAMBIGUATION: the carrier states `status: blocked`, and the model\'s own `needs_user_input` never leaks through it', async () => {
    // ⚠ BLAST RADIUS, PINNED IN-TEST. `normaliseV5AnalysisReady`
    // (DecisionGuideAI `v5/applyV5State.ts:229`) accepts on a non-empty
    // `goal_node_id` + `options` and NEVER READS `status`. Until now a blocked
    // refusal was discarded there by accident — a degeneracy guard doing duty
    // as an implicit status check. Carrying the identity makes the payload
    // ADMISSIBLE, so `status` becomes the only thing a consumer can key on to
    // tell "we refused" from "here is your analysis".
    //
    // The fix for that belongs in the consumer, not here: withholding the
    // identity IS the defect being closed, and a CEE-side guard against a
    // consumer's missing check would re-open it. What this seam owes is a
    // payload that CAN be disambiguated — asserted here so it cannot silently
    // stop being true.
    const err = await loaderThrow(FRESH_DRAFT_GRAPH);

    // The assessment's own status on this graph is NOT `blocked` — so the
    // assertion below is a real discrimination, not a tautology.
    expect(err.structuralReadiness?.status).toBe('needs_user_input');

    const carrier = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', err.structuralReadiness);
    expect(carrier.status).toBe('blocked');
    expect(carrier.blocked_reason).toBe('MISSING_OPTION_VALUE');
    // Identity carried, everything else this turn declined to produce dropped.
    expect(Object.keys(carrier).sort()).toEqual(
      ['blocked_reason', 'goal_node_id', 'options', 'status'],
    );

    // …and the same on the wire-facing chip arm, not just at the unit.
    useGraph(FRESH_DRAFT_GRAPH);
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-chip-disambiguation',
    });
    expect(out.analysisReady?.status).toBe('blocked');
  });

  // ── TWIN 1/2 — no model to name, so nothing is named ────────────────────
  it('TWIN-1: a NO_GRAPH refusal carries NO identity — there is no model, and one is not invented', async () => {
    const err = await loaderThrow(null);
    expect(err.verdict.reasonCodes).toEqual(['NO_GRAPH']);
    expect(err.structuralReadiness).toBeUndefined();
    expect(buildAnalysisRefusalReadiness('NO_GRAPH', err.structuralReadiness).goal_node_id).toBe('');
  });

  it('TWIN-2: a SCHEMA_INVALID refusal carries NO identity — the semantic projector has none to give', async () => {
    const err = await loaderThrow('this is not a graph');
    expect(err.verdict.reasonCodes).toEqual(['SCHEMA_INVALID']);
    expect(err.structuralReadiness).toBeUndefined();
  });

  // ── TWIN 3 — #1126's own class must not regress ─────────────────────────
  it('TWIN-3 (#1126 unchanged): a graph the run ADMITS never reaches the throw, and its refusal carrier stays BARE', async () => {
    // The admitting classes do not refuse at all — the loader resolves.
    const store = createNoopSessionStore({ loadGraphResult: ONE_UNVALUED_GRAPH });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-admit', store);
    expect(snapshot.goal_node_id).toBe(GOAL_ID);

    // And should such a payload reach the composer by any route, #1126's
    // `may_run === true` discriminator still holds it bare.
    const admitting = buildCanonicalAnalysisReadyFromGraph(ONE_UNVALUED_GRAPH);
    expect((admitting as { may_run?: boolean } | undefined)?.may_run).toBe(true);
    const bare = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', admitting);
    expect(bare.goal_node_id).toBe('');
    expect(bare.options).toEqual([]);
  });

  it('TWIN-4: a fully configured model does not refuse at all (the corpus discriminates)', async () => {
    const store = createNoopSessionStore({ loadGraphResult: CONFIGURED_GRAPH });
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO_ID, 'req-ok', store);
    expect(snapshot.goal_node_id).toBe(GOAL_ID);
    expect(snapshot.options.length).toBe(OPTION_IDS.length);
  });
});
