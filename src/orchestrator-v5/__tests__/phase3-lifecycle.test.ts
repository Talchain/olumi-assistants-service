/**
 * V5 Phase 3A PR 3 — lifecycle composer tests.
 *
 * Covers the decision tree in `compose.ts:buildBlocksFromFacts` for the
 * NO-current-turn-run_analysis-fact branch, plus the
 * `v5.phase3.block_lifecycle` telemetry emission shape.
 *
 * Spec items covered:
 *   2. fresh reuse from prior run_analysis fact on a later non-analysis turn;
 *   3. stale graph emits exactly one rerun CoachingBlock with priority_rank:1;
 *   4. unknown freshness suppresses blocks;
 *   5. rerun refresh switches to newest run_analysis fact;
 *   9. no fresh ReviewCardBlock or EvidenceBlock after graph divergence.
 *
 * Items 1, 6, 7, 8 live in the dedicated UUID helper tests + the
 * chip-click integration suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../compose.js';
import type { FreshnessDerivation } from '../context/freshness.js';
import { log } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Fixtures — staging-shaped run_analysis fact with a populated
// `decision_review` enrichment. Mirrors the canonical PLoT V2 shape so
// the real Phase 3 builders fire all the way through to non-zero blocks.
// ---------------------------------------------------------------------------

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SOURCE_GRAPH_HASH = 'gh_source_a1b2c3d4';
const DIVERGED_GRAPH_HASH = 'gh_diverged_e5f6g7h8';

const FACTOR_DELIVERY = { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' };
const FACTOR_COST = { id: 'fac_cost_overrun', label: 'Cost overrun', kind: 'factor' };

const CANNED_DECISION_REVIEW: Record<string, unknown> = {
  narrative_summary: 'Plan A leads with a comfortable margin.',
  story_headlines: {},
  robustness_explanation: { summary: 'Stable.', primary_risk: null },
  readiness_rationale: 'Ready.',
  evidence_enhancements: {
    fac_delivery_risk: {
      specific_action: 'pull on-time delivery rate from the last two releases',
      rationale: 'delivery rate is the highest-leverage variance driver',
      evidence_type: 'internal_data',
      decision_hygiene: 'estimate first',
    },
  },
  scenario_contexts: {},
  flip_thresholds: [],
  bias_findings: [],
  key_assumptions: ['Market conditions persist for the next two quarters.'],
  decision_quality_prompts: [],
};

function makeRunAnalysisFact(
  graphHash: string,
  decisionReview: Record<string, unknown> = CANNED_DECISION_REVIEW,
): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis.',
      win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
      graph_hash_at_run: graphHash,
      computed_at: '2026-05-17T00:00:00.000Z',
      enrichment: {
        graph: { nodes: [FACTOR_DELIVERY, FACTOR_COST] },
        factor_sensitivity: [
          { factor_id: 'fac_delivery_risk', confidence: 0.2 },
          { factor_id: 'fac_cost_overrun', confidence: 0.5 },
        ],
        option_comparison: [
          { id: 'opt_a', option_id: 'opt_a', label: 'Plan A', option_label: 'Plan A', win_probability: 0.7 },
          { id: 'opt_b', option_id: 'opt_b', label: 'Plan B', option_label: 'Plan B', win_probability: 0.3 },
        ],
        decision_review: decisionReview,
      },
    },
  } as unknown as RunAnalysisHandlerFact;
}

function freshDerivation(opts: {
  sourceHash: string;
  selectedIndex: number;
}): FreshnessDerivation {
  return {
    freshness: 'fresh',
    reason: 'graph_hash_matches',
    selected_fact_index: opts.selectedIndex,
    graph_hash_at_run: opts.sourceHash,
    current_graph_hash: opts.sourceHash,
    computed_at: '2026-05-17T00:00:00.000Z',
  };
}

function staleDerivation(opts: {
  sourceHash: string;
  currentHash: string;
  selectedIndex: number;
}): FreshnessDerivation {
  return {
    freshness: 'stale',
    reason: 'graph_hash_mismatch',
    selected_fact_index: opts.selectedIndex,
    graph_hash_at_run: opts.sourceHash,
    current_graph_hash: opts.currentHash,
    computed_at: '2026-05-17T00:00:00.000Z',
  };
}

function unknownDerivation(): FreshnessDerivation {
  return {
    freshness: 'unknown',
    reason: 'legacy_fact_missing_hash',
    selected_fact_index: 0,
    graph_hash_at_run: null,
    current_graph_hash: 'gh_current_unknown',
    computed_at: null,
  };
}

function noneDerivation(): FreshnessDerivation {
  return {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: 'gh_current_none',
    computed_at: null,
  };
}

const UUID_VALIDATOR = z.string().uuid();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase 3 lifecycle composer — branch 2 (no current-turn run_analysis fact)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => log);
    infoSpy = vi.spyOn(log, 'info').mockImplementation(() => log);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  // Test 2 — fresh reuse from prior run_analysis fact on a later non-analysis turn.
  it('FRESH: rebuilds Phase 3 blocks from prior run_analysis fact when current turn has none', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Explained.',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],  // no current-turn fact
      lifecycle: {
        priorFacts: [priorFact],
        freshness: freshDerivation({ sourceHash: SOURCE_GRAPH_HASH, selectedIndex: 0 }),
        requestId: 'req-fresh',
        scenarioId: SCENARIO_ID,
      },
    });
    // V5 P0-B: the FRESH prior-fact branch now ALSO emits the result-summary
    // `analysis_result` block (so the UI has a non-empty, structured answer
    // even without decision_review). Emitted on FRESH only — the STALE test
    // below still asserts it is absent on a diverged graph.
    expect(response.blocks.find((b) => b.type === 'analysis_result')).toBeDefined();
    // Phase 3 blocks rebuilt from prior fact and tagged fresh.
    const reviewCards = response.blocks.filter((b) => b.type === 'review_card');
    const coaching = response.blocks.filter((b) => b.type === 'coaching');
    const evidence = response.blocks.filter((b) => b.type === 'evidence');
    const phase3Blocks = [...reviewCards, ...coaching, ...evidence];
    expect(reviewCards.length).toBeGreaterThan(0);
    expect(coaching.length).toBeGreaterThan(0);
    expect(evidence.length).toBeGreaterThan(0);
    for (const b of phase3Blocks) {
      expect(b.freshness).toBe('fresh');
      expect(b.graph_hash_at_generation).toBe(SOURCE_GRAPH_HASH);
      expect(UUID_VALIDATOR.safeParse(b.block_id).success).toBe(true);
    }
    // Lifecycle telemetry: emitted_fresh with reason=prior_fact_fresh.
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(1);
    const payload = lifecycleCalls[0]![0] as Record<string, unknown>;
    expect(payload.lifecycle_state).toBe('emitted_fresh');
    expect(payload.reason).toBe('prior_fact_fresh');
    // V5 P0-B: block_count now includes the added analysis_result block.
    expect(payload.block_count).toBe(phase3Blocks.length + 1);
    expect(payload.stale_coaching_emitted).toBe(false);
  });

  // V5 P0-B — panel-aware keep-list + leak guards for the analysis_result
  // block. Enrichment is reduced to the fields DGAI hydrates the Results
  // panel from; every leak-carrying field is dropped at the build site. The
  // rich fixture mirrors the live staging bundle (build cef69b0): leak
  // markers live in DROPPED fields (_meta/meta → [REDACTED]; m1_coaching →
  // isl_engine; decision_brief/fact_objects → seed lineage).
  function richRunAnalysisFact(opts?: { withDecisionReview?: boolean; onlyLeak?: boolean }): RunAnalysisHandlerFact {
    const enrichment: Record<string, unknown> = opts?.onlyLeak
      ? {}
      : {
          option_comparison: [
            { option_id: 'opt_a', option_label: 'Plan A', win_probability: 0.7 },
            { option_id: 'opt_b', option_label: 'Plan B', win_probability: 0.3 },
          ],
          factor_sensitivity: [{ factor_id: 'fac_x', influence_score: 0.5 }],
          robustness: { level: 'fragile', fragile_edges: [] },
          results: [{ option_id: 'opt_a' }],
        };
    if (!opts?.onlyLeak && opts?.withDecisionReview !== false) {
      enrichment.decision_review = { narrative_summary: 'ok' };
    }
    // Leak carriers — always present, always dropped.
    enrichment._meta = { feature_flags_snapshot: { TOKEN_RL_ENABLE: '[REDACTED]' } };
    enrichment.meta = { build: 'cef69b0', feature_flags: { TOKEN_RL_ENABLE: '[REDACTED]' } };
    enrichment.m1_coaching = { assumptions_ledger: { assumptions: [{ source_service: 'isl_engine' }] } };
    enrichment.decision_brief = { seed: 12345 };
    enrichment.fact_objects = [{ lineage: { seed: 999 } }];
    enrichment.downstream_calls = { isl: [{ request_payload: { graph: { nodes: [] } } }] };
    enrichment.graph = { nodes: [] };
    enrichment.critiques = [{ code: 'MONTE_CARLO_FAILED', message: 'internal' }];
    enrichment.flip_thresholds = [{ factor_id: 'fac_x', flip_value: null }];
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        graph_hash_at_run: SOURCE_GRAPH_HASH,
        computed_at: '2026-05-17T00:00:00.000Z',
        enrichment,
      },
    } as unknown as RunAnalysisHandlerFact;
  }

  function analysisResultBlockFor(fact: RunAnalysisHandlerFact, opts: { currentTurn: boolean }) {
    const response = composeToolCallResponse({
      orientation: '', confirmation: 'x', coaching: null, stage: 'decide',
      handlerFacts: opts.currentTurn ? [fact] : [],
      lifecycle: opts.currentTurn
        ? undefined
        : {
            priorFacts: [fact],
            freshness: freshDerivation({ sourceHash: SOURCE_GRAPH_HASH, selectedIndex: 0 }),
            requestId: 'req', scenarioId: SCENARIO_ID,
          },
    });
    return response.blocks.find((b) => b.type === 'analysis_result') as
      | { win_probabilities?: Record<string, number>; enrichment?: Record<string, unknown> }
      | undefined;
  }

  it('LEAK GUARD: analysis_result enrichment is reduced to the panel keep-list; every leak carrier ([REDACTED]/isl_engine/seed/_meta/graph/critiques) is dropped', () => {
    const block = analysisResultBlockFor(richRunAnalysisFact(), { currentTurn: false });
    expect(block).toBeDefined();
    const enr = block!.enrichment ?? {};
    // Only panel-aware keep-list fields survive.
    expect(Object.keys(enr).sort()).toEqual([
      'decision_review', 'factor_sensitivity', 'option_comparison', 'results', 'robustness',
    ]);
    // Leak carriers dropped.
    for (const k of ['_meta', 'meta', 'm1_coaching', 'decision_brief', 'fact_objects', 'downstream_calls', 'graph', 'critiques', 'flip_thresholds']) {
      expect(k in enr).toBe(false);
    }
    // No leak markers survive ANYWHERE in the kept enrichment.
    const enrJson = JSON.stringify(enr);
    expect(enrJson).not.toContain('[REDACTED]');
    expect(enrJson.toLowerCase()).not.toContain('isl_engine');
    expect(enrJson).not.toMatch(/"seed"/);
    // win_probabilities preserved VERBATIM, keyed by option id (DGAI correlates by id).
    expect(block!.win_probabilities).toEqual({ opt_a: 0.7, opt_b: 0.3 });
  });

  it('KEEP-LIST: panel fields survive when decision_review is absent (chip-click autofire-off) — block is NOT starved', () => {
    const block = analysisResultBlockFor(richRunAnalysisFact({ withDecisionReview: false }), { currentTurn: false });
    const enr = block!.enrichment ?? {};
    expect(Object.keys(enr).sort()).toEqual([
      'factor_sensitivity', 'option_comparison', 'results', 'robustness',
    ]);
  });

  it('KEEP-LIST: when enrichment carries ONLY leak fields, the block omits enrichment entirely', () => {
    const block = analysisResultBlockFor(richRunAnalysisFact({ onlyLeak: true }), { currentTurn: false });
    expect(block).toBeDefined();
    expect('enrichment' in block!).toBe(false);
    expect(block!.win_probabilities).toEqual({ opt_a: 0.7, opt_b: 0.3 });
  });

  it('KEEP-LIST: DGAI read-side givens with no fallback (option_comparison_status, conditional_probabilities) survive while leak carriers are dropped', () => {
    // Codex closure review — these top-level fields reach enrichment via PLoT
    // .passthrough() + CEE's byte-for-byte store and are read with no fallback,
    // so dropping them would regress the Results panel (e.g. constraint-bearing
    // analyses). option_comparison_status is fixture-proven (value 'computed').
    const fact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        graph_hash_at_run: SOURCE_GRAPH_HASH,
        computed_at: '2026-05-17T00:00:00.000Z',
        enrichment: {
          option_comparison: [{ option_id: 'opt_a', win_probability: 0.7 }],
          option_comparison_status: 'computed',
          conditional_probabilities: [{ option_id: 'opt_a', given: 'c1', probability: 0.55 }],
          // leak carriers that must still be dropped
          _meta: { feature_flags_snapshot: { TOKEN_RL_ENABLE: '[REDACTED]' } },
          downstream_calls: { isl: [] },
        },
      },
    } as unknown as RunAnalysisHandlerFact;
    const block = analysisResultBlockFor(fact, { currentTurn: false });
    const enr = block!.enrichment ?? {};
    expect(enr.option_comparison_status).toBe('computed');
    expect(enr.conditional_probabilities).toEqual([{ option_id: 'opt_a', given: 'c1', probability: 0.55 }]);
    expect('_meta' in enr).toBe(false);
    expect('downstream_calls' in enr).toBe(false);
    expect(JSON.stringify(enr)).not.toContain('[REDACTED]');
  });

  it('DEDUPE CONSISTENCY: the current-turn run_analysis block and the reused follow-up block carry IDENTICAL enrichment for the same fact', () => {
    const fact = richRunAnalysisFact();
    const currentTurn = analysisResultBlockFor(fact, { currentTurn: true });
    const reused = analysisResultBlockFor(fact, { currentTurn: false });
    expect(currentTurn).toBeDefined();
    expect(reused).toBeDefined();
    // Same transform on both → identical block payload → DGAI content-hash
    // dedupe + panel hydration stay consistent across turns.
    expect(reused!.enrichment).toEqual(currentTurn!.enrichment);
    expect(reused!.win_probabilities).toEqual(currentTurn!.win_probabilities);
  });

  // V5 P0-B — Codex non-blocker: the keep-list is not merely a shallow
  // top-level pick. Internal/debug carriers NESTED inside a kept field are
  // deep-stripped at the build site, so they cannot survive even in debug-on
  // mode (where the response-finaliser's prose scrub is bypassed). Legitimate
  // science metadata (e.g. confidence_provenance) is preserved.
  it('LEAK GUARD (debug-independent): internal carriers NESTED inside kept fields are deep-stripped; science metadata is preserved', () => {
    const fact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        graph_hash_at_run: SOURCE_GRAPH_HASH,
        computed_at: '2026-05-17T00:00:00.000Z',
        enrichment: {
          factor_sensitivity: [
            {
              factor_id: 'fac_x',
              influence_score: 0.5,
              confidence_provenance: 'isl-model-v2', // legit science metadata — KEPT
              _meta: { TOKEN_RL_ENABLE: '[REDACTED]' }, // nested carrier — STRIPPED
              lineage: { seed: 12345 }, // nested carrier — STRIPPED
            },
          ],
          robustness: { level: 'fragile', graph_hash: 'deadbeef', fragile_edges: [] },
          option_comparison: [
            { option_id: 'opt_a', win_probability: 0.7, downstream_calls: { isl: [{}] } },
          ],
        },
      },
    } as unknown as RunAnalysisHandlerFact;

    const block = analysisResultBlockFor(fact, { currentTurn: false });
    const enr = block!.enrichment ?? {};
    const enrJson = JSON.stringify(enr);
    // Nested internal carriers gone — debug-independent (runs at the build site).
    expect(enrJson).not.toContain('[REDACTED]');
    expect(enrJson).not.toMatch(/"seed"/);
    expect(enrJson).not.toMatch(/"graph_hash"/);
    expect(enrJson).not.toMatch(/"_meta"/);
    expect(enrJson).not.toMatch(/"lineage"/);
    expect(enrJson).not.toMatch(/"downstream_calls"/);
    // Legit science metadata + structural values preserved (NOT over-stripped).
    expect(enrJson).toContain('confidence_provenance');
    expect(enrJson).toContain('isl-model-v2');
    const fs = enr.factor_sensitivity as Array<Record<string, unknown>>;
    expect(fs[0]!.influence_score).toBe(0.5);
  });

  // V5 P0-B — Codex non-blocker #2: VALUE-level guard. The redaction marker
  // `[REDACTED]` hiding under a harmless (non-denylisted) key is dropped, while
  // legitimate science values that merely CONTAIN internal-sounding substrings
  // (e.g. "Engineering Capacity" contains "engin"; confidence_provenance) are
  // preserved — we deliberately do not broad-scrub those tokens.
  it('LEAK GUARD (value-level): a [REDACTED] value under a harmless key is dropped; legit science labels with internal-sounding substrings survive', () => {
    const fact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      result: {
        scenario_id: SCENARIO_ID,
        leading_option_id: 'opt_a',
        summary: 'Ran analysis.',
        win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
        graph_hash_at_run: SOURCE_GRAPH_HASH,
        computed_at: '2026-05-17T00:00:00.000Z',
        enrichment: {
          factor_sensitivity: [
            {
              factor_id: 'fac_eng',
              factor_label: 'Engineering Capacity', // contains "engin" — MUST survive
              confidence_provenance: 'isl-model-v2', // legit metadata — MUST survive
              note: '[REDACTED]', // redaction marker under a harmless key — STRIPPED
            },
          ],
          option_comparison: [{ option_id: 'opt_a', win_probability: 0.7 }],
        },
      },
    } as unknown as RunAnalysisHandlerFact;

    const block = analysisResultBlockFor(fact, { currentTurn: false });
    const enr = block!.enrichment ?? {};
    const enrJson = JSON.stringify(enr);
    // The redaction marker is gone (value-level guard), and the carrier key with it.
    expect(enrJson).not.toContain('[REDACTED]');
    expect(enrJson).not.toMatch(/"note"/);
    // No false positives: legit labels / provenance with internal-sounding
    // substrings are preserved verbatim.
    expect(enrJson).toContain('Engineering Capacity');
    expect(enrJson).toContain('confidence_provenance');
    expect(enrJson).toContain('isl-model-v2');
  });

  // PR 3 contract — block_id stability across stale rebuilds.
  it('STALE re-emission: same source fact graph_hash → same stale block_id (UI dedupe)', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    const lifecycle = {
      priorFacts: [priorFact] as readonly HandlerFact[],
      freshness: staleDerivation({
        sourceHash: SOURCE_GRAPH_HASH,
        currentHash: DIVERGED_GRAPH_HASH,
        selectedIndex: 0,
      }),
      requestId: 'req-stale-stable',
      scenarioId: SCENARIO_ID,
    } as const;
    const r1 = composeToolCallResponse({
      orientation: '', confirmation: '', coaching: null,
      stage: 'decide', handlerFacts: [], lifecycle,
    });
    const r2 = composeToolCallResponse({
      orientation: '', confirmation: '', coaching: null,
      stage: 'decide', handlerFacts: [], lifecycle,
    });
    const stale1 = r1.blocks.find((b) => b.type === 'coaching');
    const stale2 = r2.blocks.find((b) => b.type === 'coaching');
    expect(stale1).toBeDefined();
    expect(stale2).toBeDefined();
    // PR 3 dedupe contract — identical block_id across re-emissions.
    expect(stale1!.block_id).toBe(stale2!.block_id);
    expect(stale1!.signal_id).toBe(stale2!.signal_id);
  });

  // Test 3 — stale graph emits exactly one rerun CoachingBlock with priority_rank:1.
  // Test 9 — no fresh ReviewCardBlock or EvidenceBlock after graph divergence.
  it('STALE: emits EXACTLY one rerun CoachingBlock (priority_rank:1, action_intent:rerun_analysis) and ZERO other Phase 3 blocks', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Explained.',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],
      lifecycle: {
        priorFacts: [priorFact],
        freshness: staleDerivation({
          sourceHash: SOURCE_GRAPH_HASH,
          currentHash: DIVERGED_GRAPH_HASH,
          selectedIndex: 0,
        }),
        requestId: 'req-stale',
        scenarioId: SCENARIO_ID,
      },
    });
    // No analysis_result, no review_card, no evidence.
    expect(response.blocks.find((b) => b.type === 'analysis_result')).toBeUndefined();
    expect(response.blocks.filter((b) => b.type === 'review_card')).toHaveLength(0);
    expect(response.blocks.filter((b) => b.type === 'evidence')).toHaveLength(0);
    // EXACTLY one coaching block — the stale rerun.
    const coaching = response.blocks.filter((b) => b.type === 'coaching');
    expect(coaching).toHaveLength(1);
    const staleBlock = coaching[0]!;
    expect(staleBlock.freshness).toBe('stale');
    expect(staleBlock.priority_rank).toBe(1);
    expect(staleBlock.action_intent).toBe('rerun_analysis');
    expect(staleBlock.coaching_kind).toBe('orientation');
    expect(staleBlock.graph_hash_at_generation).toBe(SOURCE_GRAPH_HASH);
    expect(UUID_VALIDATOR.safeParse(staleBlock.block_id).success).toBe(true);
    // Lifecycle telemetry: emitted_stale with stale_coaching_emitted=true.
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(1);
    const payload = lifecycleCalls[0]![0] as Record<string, unknown>;
    expect(payload.lifecycle_state).toBe('emitted_stale');
    expect(payload.stale_coaching_emitted).toBe(true);
    expect(payload.block_count).toBe(1);
    expect(payload.graph_hash_at_run).toBe(SOURCE_GRAPH_HASH);
    expect(payload.current_graph_hash).toBe(DIVERGED_GRAPH_HASH);
  });

  // Test 4 — unknown freshness suppresses blocks.
  it('UNKNOWN: suppresses Phase 3 emission and logs lifecycle_state=skipped_unknown (no pending block)', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Explained.',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],
      lifecycle: {
        priorFacts: [priorFact],
        freshness: unknownDerivation(),
        requestId: 'req-unknown',
        scenarioId: SCENARIO_ID,
      },
    });
    expect(response.blocks).toHaveLength(0);
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(1);
    const payload = lifecycleCalls[0]![0] as Record<string, unknown>;
    expect(payload.lifecycle_state).toBe('skipped_unknown');
    expect(payload.block_count).toBe(0);
    expect(payload.stale_coaching_emitted).toBe(false);
  });

  // NONE freshness — sibling case for completeness.
  it('NONE: suppresses Phase 3 emission and logs lifecycle_state=skipped_none', () => {
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Explained.',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],
      lifecycle: {
        priorFacts: [],
        freshness: noneDerivation(),
        requestId: 'req-none',
        scenarioId: SCENARIO_ID,
      },
    });
    expect(response.blocks).toHaveLength(0);
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(1);
    expect((lifecycleCalls[0]![0] as Record<string, unknown>).lifecycle_state).toBe('skipped_none');
  });

  // Test 5 — rerun refresh switches to newest run_analysis fact.
  it('RERUN: new current-turn run_analysis fact supersedes prior; fresh blocks come from the new graph hash; stale block disappears', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);  // stale
    const newFact = makeRunAnalysisFact(DIVERGED_GRAPH_HASH);  // current-turn rerun
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Re-ran.',
      coaching: null,
      stage: 'analyse',
      handlerFacts: [newFact],
      lifecycle: {
        priorFacts: [priorFact],
        // After rerun, freshness sees newFact AS the freshest with
        // current hash matching itself. The composer's branch-1
        // (current-turn fact) fires; branch-2 does NOT.
        freshness: freshDerivation({ sourceHash: DIVERGED_GRAPH_HASH, selectedIndex: -1 }),
        requestId: 'req-rerun',
        scenarioId: SCENARIO_ID,
      },
    });
    // analysis_result from NEW fact's hash.
    const analysisResult = response.blocks.find((b) => b.type === 'analysis_result');
    expect(analysisResult).toBeDefined();
    // Phase 3 blocks rebuilt from NEW graph hash, ALL fresh.
    const reviewCards = response.blocks.filter((b) => b.type === 'review_card');
    const coaching = response.blocks.filter((b) => b.type === 'coaching');
    expect(reviewCards.length).toBeGreaterThan(0);
    for (const b of [...reviewCards, ...coaching]) {
      expect(b.freshness).toBe('fresh');
      expect(b.graph_hash_at_generation).toBe(DIVERGED_GRAPH_HASH);
    }
    // No stale rerun coaching anywhere.
    expect(coaching.every((c) => c.coaching_kind !== 'orientation' || c.action_intent !== 'rerun_analysis')).toBe(true);
    // Lifecycle telemetry: emitted_fresh with reason=current_turn_fact (branch 1).
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(1);
    const payload = lifecycleCalls[0]![0] as Record<string, unknown>;
    expect(payload.lifecycle_state).toBe('emitted_fresh');
    expect(payload.reason).toBe('current_turn_fact');
  });

  // Telemetry safety audit — required by PR 3 spec.
  it('telemetry payload contains structural fields only (no prose, no labels, no scenario text, no decision_review content)', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    composeToolCallResponse({
      orientation: '',
      confirmation: '',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],
      lifecycle: {
        priorFacts: [priorFact],
        freshness: staleDerivation({
          sourceHash: SOURCE_GRAPH_HASH,
          currentHash: DIVERGED_GRAPH_HASH,
          selectedIndex: 0,
        }),
        requestId: 'req-tele',
        scenarioId: SCENARIO_ID,
      },
    });
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    const payload = lifecycleCalls[0]![0] as Record<string, unknown>;
    // Allowed fields only.
    const expectedKeys = new Set([
      'event',
      'request_id',
      'scenario_id',
      'lifecycle_state',
      'selected_fact_index',
      'graph_hash_at_run',
      'current_graph_hash',
      'reason',
      'block_count',
      'stale_coaching_emitted',
    ]);
    for (const key of Object.keys(payload)) {
      expect(expectedKeys.has(key)).toBe(true);
    }
    // Forbidden content: no prose, no labels, no scenario text, no
    // decision_review content. Sweep the serialised payload.
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('Plan A leads');
    expect(serialised).not.toContain('Market conditions persist');
    expect(serialised).not.toContain('pull on-time delivery rate');
    expect(serialised).not.toContain('Delivery risk');
    expect(serialised).not.toContain('narrative_summary');
  });

  // Test 8 — output-safety audit for stale block copy. The
  // deterministic stale-rerun copy MUST not contain banned terms
  // (recommendation/winner/winning), raw entity-IDs, raw decimals,
  // em dashes, or schema/internal terms (validator/Zod/dispatcher/
  // tool call). Since the in-builder prose guard
  // (validateProseAndSchemaOrDrop) would DROP the block on any of
  // these, this test would surface as "expected 1 coaching block,
  // got 0" rather than as a leak — but we also sweep the emitted
  // strings to make the contract explicit and protect against future
  // copy edits.
  it('output-safety: stale rerun coaching copy passes the wire-side ban list', () => {
    const priorFact = makeRunAnalysisFact(SOURCE_GRAPH_HASH);
    const response = composeToolCallResponse({
      orientation: '', confirmation: '', coaching: null,
      stage: 'decide', handlerFacts: [],
      lifecycle: {
        priorFacts: [priorFact],
        freshness: staleDerivation({
          sourceHash: SOURCE_GRAPH_HASH,
          currentHash: DIVERGED_GRAPH_HASH,
          selectedIndex: 0,
        }),
        requestId: 'req-safety',
        scenarioId: SCENARIO_ID,
      },
    });
    const stale = response.blocks.find((b) => b.type === 'coaching');
    expect(stale).toBeDefined();
    const prose = [stale!.title, stale!.body, stale!.action_label ?? ''].join(' ');
    // No banned recommendation/winner vocabulary.
    expect(prose).not.toMatch(/\brecommendations?\b/i);
    expect(prose).not.toMatch(/\brecommended\b/i);
    expect(prose).not.toMatch(/\bwinning\b/i);
    expect(prose).not.toMatch(/\bthe\s+winners?\b/i);
    // No em dashes.
    expect(prose).not.toContain('—');
    // No raw entity-id-shaped tokens (fac_/opt_/con_/out_/factor_/option_/…).
    expect(prose).not.toMatch(
      /\b(?:fac|opt|con|out|factor|option|node|edge|goal|risk|constraint|outcome)_[a-z0-9_]{4,}\b/i,
    );
    // No raw probability decimals.
    expect(prose).not.toMatch(/(?:^|[\s(=,])(?:0\.\d|\.\d)/);
    // No schema/internal terms.
    expect(prose).not.toMatch(/\b(?:validator|dispatcher|Zod|tool\s+calls?)\b/i);
  });

  // Defensive: no lifecycle context supplied → preserve PR #178/180 behaviour.
  it('no lifecycle context: preserves PR #178/180 behaviour — no Phase 3 emission, no telemetry', () => {
    const response = composeToolCallResponse({
      orientation: '',
      confirmation: 'Explained.',
      coaching: null,
      stage: 'decide',
      handlerFacts: [],  // no current-turn fact
      // no lifecycle
    });
    expect(response.blocks).toHaveLength(0);
    const lifecycleCalls = infoSpy.mock.calls.filter(
      ([payload]) =>
        typeof payload === 'object' &&
        payload !== null &&
        (payload as Record<string, unknown>).event === 'v5.phase3.block_lifecycle',
    );
    expect(lifecycleCalls).toHaveLength(0);
  });
});
