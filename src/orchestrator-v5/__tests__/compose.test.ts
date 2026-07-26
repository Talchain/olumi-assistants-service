import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import {
  composeDirectAnswerResponse,
  composeClarifyResponse,
  composeToolCallResponse,
} from '../compose.js';

describe('composeDirectAnswerResponse', () => {
  it('produces an OlumiResponseSchema-valid success envelope', () => {
    const env = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: 'hello world',
      stage: 'frame',
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.response_version).toBe(2);
    expect(parsed.assistant_text).toBe('hello world');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');
  });

  it('omits any session state / lineage fields not on the schema (constraint 6)', () => {
    const env = composeDirectAnswerResponse({
    answerKind: 'functional', assistant_text: 'x', stage: 'frame' });
    // .strict() rejects extra fields; verify none leaked.
    expect(Object.keys(env).sort()).toEqual(
      [
        'assistant_text',
        'blocks',
        'insights',
        'response_version',
        'stage_indicator',
        'suggested_actions',
      ].sort(),
    );
  });
});

describe('composeClarifyResponse (A2)', () => {
  it('produces an OlumiResponseSchema-valid clarify envelope', () => {
    const env = composeClarifyResponse({
      answerKind: 'functional',
      assistant_text: 'What decision are you weighing?',
      stage: 'frame',
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.response_version).toBe(2);
    expect(parsed.assistant_text).toBe('What decision are you weighing?');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');
  });

  it('produces the same field set as direct_answer (structural parity)', () => {
    const ans = composeDirectAnswerResponse({
    answerKind: 'functional', assistant_text: 'a', stage: 'frame' });
    const clar = composeClarifyResponse({
    answerKind: 'functional', assistant_text: 'c', stage: 'frame' });
    expect(Object.keys(ans).sort()).toEqual(Object.keys(clar).sort());
  });
});

describe('composeToolCallResponse (V5 Group 1 Task B)', () => {
  const baseInput = {
    orientation: 'Running the analysis.',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null as string | null,
    stage: 'analyse' as const,
    answerKind: 'functional' as const,
  };

  function runAnalysisFact(enrichment?: Record<string, unknown>): HandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-a',
        leading_option_id: 'opt-1',
        summary: 'Ran analysis on your current scenario.',
        ...(enrichment !== undefined ? { enrichment } : {}),
      },
    };
  }

  it('emits no blocks when no handlerFacts are supplied (backward compatible)', () => {
    const env = composeToolCallResponse(baseInput);
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks).toEqual([]);
  });

  it('emits an analysis_result block for a run_analysis fact without enrichment (thin content)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact()],
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks).toHaveLength(1);
    const block = parsed.blocks[0];
    expect(block.type).toBe('analysis_result');
    if (block.type !== 'analysis_result') throw new Error('narrowing');
    expect(block.summary).toBe('Ran analysis on your current scenario.');
    expect(block.leading_option_id).toBe('opt-1');
    expect(block.enrichment).toBeUndefined();
  });

  it('emits an analysis_result block with enrichment.decision_review when Task B completed', () => {
    const enrichment = {
      meta: { seed_used: 1, n_samples: 100, response_hash: 'h' },
      results: [{ option_id: 'opt-1', win_probability: 0.7 }],
      decision_review: {
        narrative_summary: 'option A wins',
        story_headlines: ['A ahead'],
      },
    };
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact(enrichment)],
    });
    const parsed = OlumiResponseSchema.parse(env);
    const block = parsed.blocks[0];
    if (block.type !== 'analysis_result') throw new Error('narrowing');
    expect(block.enrichment?.decision_review).toEqual(enrichment.decision_review);
    expect(block.enrichment?.results).toEqual(enrichment.results);
  });

  it('produces the same shape whether decision_review enrichment is present or absent (regression guard)', () => {
    const withoutDR = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [runAnalysisFact({ results: [{ option_id: 'opt-1' }] })],
    });
    const withDR = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [
        runAnalysisFact({
          results: [{ option_id: 'opt-1' }],
          decision_review: { narrative_summary: 'x' },
        }),
      ],
    });
    // Both parse against the boundary schema:
    OlumiResponseSchema.parse(withoutDR);
    OlumiResponseSchema.parse(withDR);
    // Both have exactly one analysis_result block; only enrichment.decision_review differs:
    expect(withoutDR.blocks).toHaveLength(1);
    expect(withDR.blocks).toHaveLength(1);
    const blockA = withoutDR.blocks[0];
    const blockB = withDR.blocks[0];
    if (blockA.type !== 'analysis_result' || blockB.type !== 'analysis_result') {
      throw new Error('narrowing');
    }
    expect(blockA.enrichment?.decision_review).toBeUndefined();
    expect(blockB.enrichment?.decision_review).toEqual({ narrative_summary: 'x' });
  });

  it('appends coaching text to assistant_text (Task C preview)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      coaching: 'This is your first analysis.',
    });
    expect(env.assistant_text).toContain('Running the analysis.');
    expect(env.assistant_text).toContain('Ran analysis');
    expect(env.assistant_text).toContain('This is your first analysis.');
  });
});

// ============================================================================
// V5 Phase 3A — composer-extraction integration
//
// Verifies the full path: a `run_analysis` fact whose
// `enrichment.decision_review` carries a representative slice of v11 LLM
// output fields, plus `graph_hash_at_run` and `enrichment.graph.nodes[]`,
// is decomposed into typed Phase 3 blocks per Analysis tab data
// contract v1.3 §1.1–§1.3. ExerciseBlock is NOT auto-emitted from this
// path (handler-only per §1.4); the case exists in output-safety for
// exhaustiveness but no composer builds it from decision_review.
// ============================================================================

describe('composeToolCallResponse — V5 Phase 3A block extraction', () => {
  const baseInput = {
    orientation: 'Running the analysis.',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null as string | null,
    stage: 'analyse' as const,
    answerKind: 'functional' as const,
  };

  const PHASE3_GRAPH_HASH = 'gh_phase3a_test_0001';

  const STANDARD_GRAPH = {
    nodes: [
      { id: 'goal_launch', label: 'Launch success', kind: 'goal' },
      { id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' },
      { id: 'fac_cost_overrun', label: 'Cost overrun', kind: 'factor' },
      { id: 'edge_delivery_goal', label: 'Delivery risk → Launch success', kind: 'edge' },
      { id: 'opt_hire_locally', label: 'Hire locally', kind: 'option' },
    ],
    edges: [],
  };

  const STANDARD_FACTOR_SENSITIVITY = [
    { factor_id: 'fac_delivery_risk', confidence: 0.2 }, // low
    { factor_id: 'fac_cost_overrun', confidence: 0.6 }, // medium
  ];

  const RICH_DECISION_REVIEW = {
    narrative_summary:
      'Hire two senior engineers locally is currently ahead by a narrow lead, with delivery risk as the largest variance driver.',
    story_headlines: {
      opt_hire_locally: 'Local team holds the lead on delivery certainty',
    },
    robustness_explanation: {
      summary: 'The result holds across most plausible delivery-risk scenarios.',
      primary_risk: 'Delivery risk volatility could flip the analysis.',
      stability_factors: [],
      fragility_factors: [],
    },
    readiness_rationale: 'Model has enough structure to compare options.',
    evidence_enhancements: {
      fac_delivery_risk: {
        specific_action: 'Pull on-time delivery rate from the last two releases.',
        rationale: 'Delivery rate is the largest variance driver here.',
        evidence_type: 'internal_data',
        decision_hygiene: 'Estimate first, then look at the data.',
      },
      fac_cost_overrun: {
        specific_action: 'Talk to the finance team about historical overruns.',
        rationale: 'Cost variance is the second-largest driver.',
        evidence_type: 'expert_input',
        decision_hygiene: 'Assign someone to argue the cost will not overrun.',
      },
    },
    scenario_contexts: {
      edge_delivery_goal: {
        trigger_description: 'If delivery risk spikes during launch month',
        consequence: 'then the timeline slips past the target launch date.',
      },
    },
    flip_thresholds: [
      {
        factor_id: 'fac_delivery_risk',
        factor_label: 'Delivery risk',
        current_display: '0.3',
        flip_display: '0.7',
        narrative: 'A move from low to high delivery risk would flip the result.',
      },
    ],
    bias_findings: [
      {
        type: 'ANCHORING',
        source: 'structural',
        description: 'The model edges cluster on a single strength band.',
        affected_elements: ['fac_delivery_risk'],
        suggested_action: 'Check estimates against base rates.',
        linked_critique_code: 'STRENGTH_CLUSTERING',
      },
    ],
    key_assumptions: [
      'Edge strengths assume current market conditions persist.',
      'The brief assumes competitor timeline is predictable.',
    ],
    decision_quality_prompts: [
      {
        question: 'What would change your mind about delivery risk?',
        principle: 'Disconfirmation',
        applies_because: 'Win probability is high.',
      },
    ],
    pre_mortem: {
      failure_scenario: 'Team underestimated integration risk.',
      warning_signs: ['Velocity drops two sprints in a row'],
      mitigation: 'Weekly review with the team lead.',
      grounded_in: ['fac_delivery_risk'],
    },
  };

  function phase3Fact(): HandlerFact {
    return {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-phase3a',
        leading_option_id: 'opt_hire_locally',
        summary: 'Ran analysis on your current scenario.',
        enrichment: {
          graph: STANDARD_GRAPH,
          factor_sensitivity: STANDARD_FACTOR_SENSITIVITY,
          decision_review: { ...RICH_DECISION_REVIEW, produced_at: '2026-05-16T15:00:00.000Z' },
          // T1 claim safety — the fixture must DECLARE its constraint verdict.
          // `rebuildPhase3BlocksFresh` reads this stamp and FAILS CLOSED without
          // it, dropping every leader-presuming block. `evaluated_feasible` is the branch
          // this fixture must reach: the per-card_kind COUNTS asserted below are a
          // statement about block CONSTRUCTION, so the leader must be nameable.
          __cee_claim_safety: {
            may_name_leading_option: true,
            constraint_verdict_state: 'evaluated_feasible',
          },
        },
        graph_hash_at_run: PHASE3_GRAPH_HASH,
        computed_at: '2026-05-16T14:59:00.000Z',
      },
    };
  }

  it('emits analysis_result + ReviewCardBlocks + CoachingBlocks + EvidenceBlocks (no ExerciseBlocks)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [phase3Fact()],
    });
    const parsed = OlumiResponseSchema.parse(env);

    const byType = (t: string) => parsed.blocks.filter((b) => b.type === t);
    expect(byType('analysis_result')).toHaveLength(1);
    expect(byType('review_card').length).toBeGreaterThan(0);
    expect(byType('coaching').length).toBeGreaterThan(0);
    expect(byType('evidence').length).toBeGreaterThan(0);
    // ExerciseBlock is handler-only per v1.3 §1.4 — never auto-emitted.
    expect(byType('exercise')).toHaveLength(0);
  });

  it('emits expected counts per card_kind from the rich-fixture decision_review', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [phase3Fact()],
    });
    const parsed = OlumiResponseSchema.parse(env);
    const reviewCards = parsed.blocks.filter((b) => b.type === 'review_card');
    const byCardKind = (k: string) =>
      reviewCards.filter((b) => b.type === 'review_card' && b.card_kind === k);
    expect(byCardKind('narrative')).toHaveLength(1);
    expect(byCardKind('pre_mortem')).toHaveLength(1);
    expect(byCardKind('flip_threshold')).toHaveLength(1);
    expect(byCardKind('bias')).toHaveLength(1);
    expect(byCardKind('robustness')).toHaveLength(1);
    expect(byCardKind('evidence_priority')).toHaveLength(1);
    expect(byCardKind('assumption')).toHaveLength(2); // key_assumptions[].length
    expect(byCardKind('scenario_context')).toHaveLength(1);
  });

  it('emits 2 CoachingBlocks (1 assumption_check per key_assumption + 1 calibration_prompt)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [phase3Fact()],
    });
    const parsed = OlumiResponseSchema.parse(env);
    const coaching = parsed.blocks.filter((b) => b.type === 'coaching');
    const byKind = (k: string) =>
      coaching.filter((b) => b.type === 'coaching' && b.coaching_kind === k);
    expect(byKind('assumption_check')).toHaveLength(2);
    expect(byKind('calibration_prompt')).toHaveLength(1);
  });

  it('emits 2 EvidenceBlocks (one per evidence_enhancements entry) with §1.3 consistency rule satisfied', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [phase3Fact()],
    });
    const parsed = OlumiResponseSchema.parse(env);
    const evidence = parsed.blocks.filter((b) => b.type === 'evidence');
    expect(evidence).toHaveLength(2);
    for (const block of evidence) {
      if (block.type !== 'evidence') throw new Error('narrowing');
      // §1.3: factor_ref must match the primary target_refs factor entry.
      expect(block.target_refs[0]?.id).toBe(block.factor_ref.id);
      expect(block.target_refs[0]?.label).toBe(block.factor_ref.label);
      expect(block.target_refs[0]?.kind).toBe('factor');
      // Common metadata invariants.
      expect(block.source_handler).toBe('decision_review_enricher');
      expect(block.graph_hash_at_generation).toBe(PHASE3_GRAPH_HASH);
      expect(block.freshness).toBe('fresh');
    }
  });

  it('skips Phase 3 emission when graph_hash_at_run is absent (Codex correction #4 fresh-only)', () => {
    const factWithoutHash: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-no-hash',
        leading_option_id: 'opt_hire_locally',
        summary: 'Ran analysis.',
        enrichment: {
          graph: STANDARD_GRAPH,
          factor_sensitivity: STANDARD_FACTOR_SENSITIVITY,
          decision_review: RICH_DECISION_REVIEW,
        },
        // NO graph_hash_at_run — proves freshness cannot be established
        // → Phase 3 emission is suppressed.
      },
    };
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [factWithoutHash],
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks.filter((b) => b.type === 'analysis_result')).toHaveLength(1);
    expect(parsed.blocks.filter((b) => b.type === 'review_card')).toHaveLength(0);
    expect(parsed.blocks.filter((b) => b.type === 'coaching')).toHaveLength(0);
    expect(parsed.blocks.filter((b) => b.type === 'evidence')).toHaveLength(0);
  });

  it('emits no Phase 3 blocks when decision_review is absent (thin-content path unchanged)', () => {
    const fact: HandlerFact = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: 'scen-thin',
        leading_option_id: 'opt_hire_locally',
        summary: 'Ran analysis.',
        enrichment: { graph: STANDARD_GRAPH },
        graph_hash_at_run: PHASE3_GRAPH_HASH,
      },
    };
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [fact],
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.blocks.filter((b) => b.type === 'analysis_result')).toHaveLength(1);
    expect(parsed.blocks.filter((b) => b.type === 'review_card')).toHaveLength(0);
    expect(parsed.blocks.filter((b) => b.type === 'coaching')).toHaveLength(0);
    expect(parsed.blocks.filter((b) => b.type === 'evidence')).toHaveLength(0);
  });

  it('every emitted Phase 3 block parses against BlockSchema via OlumiResponseSchema (boundary contract)', () => {
    const env = composeToolCallResponse({
      ...baseInput,
      handlerFacts: [phase3Fact()],
    });
    // OlumiResponseSchema.parse() walks the discriminated BlockSchema
    // union with the §1.3 EvidenceBlock consistency-rule superRefine
    // applied at the union level — if anything we emit fails v1.3,
    // this call throws.
    const parsed = OlumiResponseSchema.parse(env);
    // Sanity check we actually emitted Phase 3 blocks (test would also
    // pass on an empty blocks array — guard against that).
    expect(parsed.blocks.length).toBeGreaterThan(3); // analysis_result + ≥3 Phase 3
  });
});
