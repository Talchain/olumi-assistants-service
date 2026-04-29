/**
 * Integration test reproducing the original ENTITY_KIND_MISMATCH scenario
 * from debug bundle bef4470b (28 April 2026, hiring decision graph).
 *
 * The scenario that motivated this branch: user asks "What factor most
 * influences my decision?" against a hiring decision graph (14 nodes,
 * goal + decision + 2 options + factors). With only `run_analysis`
 * registered, Sonnet misrouted this as a `run_analysis` proposal targeting
 * the decision node (kind: 'node'), which produced ENTITY_KIND_MISMATCH at
 * the validator and a confusing error template for the user.
 *
 * The fix has two parts:
 *   - Sonnet's tool schema now exposes `explain_from_structure` so the
 *     intent space is no longer collapsed to `run_analysis`.
 *   - When Sonnet routes correctly (kind: 'goal'/'option'), the handler
 *     runs as a no-op; Sonnet's orientation text becomes assistant_text
 *     and a noop fact is persisted for observability.
 *   - When Sonnet still misroutes with kind: 'node' (the decision-node
 *     pattern), the validator catches it cleanly with ENTITY_KIND_MISMATCH
 *     and the recoverable-validator coaching path produces a 200 response
 *     asking the user to retarget — much better UX than the original
 *     opaque error template.
 *
 * The graph fixture below mirrors the bef4470b shape: 1 goal, 1 decision
 * node, 2 options, 10 factors, 28 edges. The fact details (exact node
 * labels and edge endpoints) are representative — the structural
 * properties that matter to this test (node kinds, kind=node target id,
 * goal_id presence) reproduce what the original bundle exhibited.
 */

import { describe, it, expect } from 'vitest';

import { createExplainFromStructureHandler } from '../explain-from-structure.js';
import { createExplainResultsHandler } from '../explain-results.js';
import type { HandlerInvocation } from '../../registry.js';
import type {
  AnalysisProjectionSummary,
  StructureProjectionSummary,
} from '../../../context/projection-summaries.js';
import { validateToolCall } from '../../../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import { containsMutationLanguage } from '../../../routing/mutation-language.js';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

const SCENARIO_ID = 'bef4470b-bef4-4470-bbef-4470bbef4470';
const REQUEST_ID = 'req-bef4470b-replay';

// --- Graph fixture (bef4470b shape) ---------------------------------------
//
// Structural properties: 14 nodes (1 goal + 1 decision + 2 options + 10
// factors), 28 edges. The decision node id is what Sonnet originally
// targeted with kind='node'.

const HIRING_GRAPH_NODES = [
  { id: 'goal_hire', kind: 'goal', label: 'Hire the best candidate' },
  { id: 'dec_hire', kind: 'decision', label: 'Hiring decision' },
  { id: 'opt_jr_dev', kind: 'option', label: 'Junior developer' },
  { id: 'opt_sr_dev', kind: 'option', label: 'Senior developer' },
  { id: 'fac_salary', kind: 'factor', label: 'Salary cost' },
  { id: 'fac_ramp_time', kind: 'factor', label: 'Ramp-up time' },
  { id: 'fac_quality', kind: 'factor', label: 'Code quality' },
  { id: 'fac_velocity', kind: 'factor', label: 'Team velocity' },
  { id: 'fac_culture_fit', kind: 'factor', label: 'Culture fit' },
  { id: 'fac_retention', kind: 'factor', label: 'Retention risk' },
  { id: 'fac_market_rate', kind: 'factor', label: 'Market rate' },
  { id: 'fac_growth', kind: 'factor', label: 'Growth potential' },
  { id: 'fac_mentor_load', kind: 'factor', label: 'Mentoring load' },
  { id: 'fac_runway', kind: 'factor', label: 'Runway impact' },
] as const;

const HIRING_GRAPH_EDGES = Array.from({ length: 28 }, (_, i) => ({
  id: `e_${i}`,
  source: HIRING_GRAPH_NODES[i % HIRING_GRAPH_NODES.length].id,
  target: HIRING_GRAPH_NODES[(i + 1) % HIRING_GRAPH_NODES.length].id,
}));

const DECISION_NODE_ID = 'dec_hire';
const GOAL_NODE_ID = 'goal_hire';

function bef4470bInvocation(
  proposal: ProposalAction,
  orientationText: string,
): HandlerInvocation {
  return {
    context: {
      stage: 'frame',
      entity_registry: {
        option_ids: ['opt_jr_dev', 'opt_sr_dev'],
        goal_id: GOAL_NODE_ID,
      },
      capabilities: {},
      messages: [
        {
          role: 'user',
          content: 'What factor most influences my decision?',
        },
      ],
      session_id: SCENARIO_ID,
      request_id: REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
    } as unknown as HandlerInvocation['context'],
    payload: {
      turn_id: 't1',
      scenario_id: SCENARIO_ID,
      message: 'What factor most influences my decision?',
      turn_class: 'frame',
      stage: 'frame',
    } as unknown as HandlerInvocation['payload'],
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText,
    proposal,
    analysisReady: {
      options: [
        { option_id: 'opt_jr_dev', label: 'Junior developer', status: 'ready', interventions: { f: 1 } },
        { option_id: 'opt_sr_dev', label: 'Senior developer', status: 'ready', interventions: { f: 1 } },
      ],
      goal_node_id: GOAL_NODE_ID,
      status: 'ready',
    },
  };
}

describe('integration: bef4470b ENTITY_KIND_MISMATCH replay', () => {
  it('graph fixture has the bef4470b structural properties', () => {
    expect(HIRING_GRAPH_NODES).toHaveLength(14);
    expect(HIRING_GRAPH_EDGES).toHaveLength(28);
    const goalCount = HIRING_GRAPH_NODES.filter((n) => n.kind === 'goal').length;
    const optionCount = HIRING_GRAPH_NODES.filter(
      (n) => n.kind === 'option',
    ).length;
    expect(goalCount).toBe(1);
    expect(optionCount).toBe(2);
  });

  it('validator accepts the corrected route (kind=goal, target=goal node) for explain_from_structure', () => {
    // Pre-0.9.0: questions like "what factor most influences my decision?"
    // misrouted as run_analysis proposals targeting the decision node
    // (kind: 'node') → ENTITY_KIND_MISMATCH and an opaque error template.
    // Post-0.9.0: with explain_from_structure registered (accepted_entity_kinds
    // = ['goal', 'option']), Sonnet's tool description now explicitly steers
    // pre-analysis structural questions to this handler. The well-routed
    // proposal targets the goal node, and the validator passes.
    const proposal: ProposalAction = {
      handler_id: 'explain_from_structure',
      entity: {
        id: GOAL_NODE_ID,
        kind: 'goal',
        label: 'Hire the best candidate',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: ['graph.nodes'],
    };
    const result = validateToolCall(proposal, undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(true);
  });

  it('validator rejects a residual node-kind misroute on explain_from_structure (degraded path)', () => {
    // If Sonnet still emits kind: 'node' instead of 'goal'/'option', the
    // validator catches it with ENTITY_KIND_MISMATCH. The recoverable-
    // validator pipeline turns this into a 200 + coaching response asking
    // the user to retarget — the correct degradation when the wire schema
    // cannot disambiguate which node class the user meant.
    const proposal: ProposalAction = {
      handler_id: 'explain_from_structure',
      entity: {
        id: DECISION_NODE_ID,
        kind: 'node',
        label: 'Hiring decision',
        resolution_status: 'resolved',
        resolution_method: 'kind_inference',
      },
      parameters: [],
      cited_context_fields: ['graph.nodes'],
    };
    const result = validateToolCall(proposal, undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    }
  });

  it('validator rejects the same misroute against run_analysis (regression guard)', () => {
    // Asserts the original failure mode is unchanged for run_analysis —
    // the existing handler's contract did not widen as part of this branch.
    const proposal: ProposalAction = {
      handler_id: 'run_analysis',
      entity: {
        id: DECISION_NODE_ID,
        kind: 'node',
        resolution_status: 'resolved',
        resolution_method: 'kind_inference',
      },
      parameters: [],
      cited_context_fields: [],
    };
    const result = validateToolCall(proposal, undefined, HANDLER_VALIDATION_REGISTRY);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error.code).toBe('ENTITY_KIND_MISMATCH');
    }
  });

  it('explain_from_structure handler runs as no-op against bef4470b proposal', async () => {
    const proposal: ProposalAction = {
      handler_id: 'explain_from_structure',
      entity: {
        id: GOAL_NODE_ID,
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: ['graph.nodes'],
    };
    const orientation =
      'Looking at your hiring decision, the salary and ramp-up time factors ' +
      'have the most direct edges to the goal.';
    const handler = createExplainFromStructureHandler();
    const outcome = await handler(bef4470bInvocation(proposal, orientation));

    // Answer-carrying contract (post-Commit-4): handler always owns the
    // user-visible string, suppress_orientation is always true. Without an
    // explanation payload OR a structureProjection, the handler composes
    // the generic "could not be summarised" fallback. Compose with a
    // structureProjection in dedicated tests; this integration test only
    // checks the no-op fact persistence and the suppress_orientation flag.
    expect(outcome.llm_calls_used).toBe(0);
    expect(outcome.handler_facts).toHaveLength(1);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('explain_from_structure');
    expect(fact.noop).toBe(true);
    if (fact.fact_type === 'explain_from_structure') {
      expect(fact.result.option_count).toBe(2);
    }
    expect(outcome.suppress_orientation).toBe(true);
  });
});

// --- Answer-carrying integration tests (Commit 6) -----------------------
//
// These exercise the post-v40 contract end-to-end on the bef4470b graph
// shape: the handler now consumes invocation.explanation and falls back to
// composing from the projection summaries. They cover the four key cases
// the brief calls out:
//   1. valid answer_text → used verbatim
//   2. bare tool_use (missing explanation) → deterministic fallback
//   3. post-analysis explain_results with empty answer_text → fallback cites
//      leading option AND a top driver
//   4. mutation language in answer_text → fallback used (covered indirectly
//      via the invalid path)

const HIRING_STRUCTURE_PROJECTION: StructureProjectionSummary = {
  goal_label: 'Hire the best candidate',
  top_causal_links: [
    { label_from: 'Salary cost', label_to: 'Hire the best candidate', strength: -0.55 },
    { label_from: 'Code quality', label_to: 'Hire the best candidate', strength: 0.62 },
    { label_from: 'Ramp-up time', label_to: 'Hire the best candidate', strength: -0.41 },
  ],
  named_factor_label: undefined,
  named_factor_pathways: [],
  factor_count: 10,
  option_count: 2,
};

const HIRING_ANALYSIS_PROJECTION: AnalysisProjectionSummary = {
  status: 'complete',
  leading_option: { label: 'Senior developer', probability: 0.71 },
  runner_up: { label: 'Junior developer', probability: 0.21 },
  margin_pp: 50,
  robustness_band: 'stable',
  top_drivers: [
    { factor_label: 'Code quality', sensitivity_value: 0.62 },
    { factor_label: 'Salary cost', sensitivity_value: -0.55 },
  ],
  staleness_reason: null,
};

const RUN_ANALYSIS_FACT: RunAnalysisHandlerFact = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_sr_dev',
    summary: 'Senior developer leads the analysis.',
  },
};

describe('integration: bef4470b answer-carrying explanation contract', () => {
  it('explain_from_structure: valid answer_text is used verbatim', async () => {
    const handler = createExplainFromStructureHandler();
    const validAnswer =
      'Code quality has the strongest direct link to the goal at 0.62 strength, ahead of salary cost which works in the opposite direction. These two are the largest structural drivers in your hiring model.';
    const proposal: ProposalAction = {
      handler_id: 'explain_from_structure',
      entity: {
        id: GOAL_NODE_ID,
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: [],
      explanation: { answer_text: validAnswer },
    };
    const invocation = {
      ...bef4470bInvocation(proposal, ''),
      explanation: { answer_text: validAnswer, answer_text_valid: true },
      structureProjection: HIRING_STRUCTURE_PROJECTION,
    };
    const outcome = await handler(invocation);
    expect(outcome.assistant_text).toBe(validAnswer);
    expect(outcome.suppress_orientation).toBe(true);
  });

  it('explain_from_structure: bare tool_use (missing explanation) → fallback contains causal links AND factor labels', async () => {
    // Brief Task 5 integration test: simulate Sonnet response with tool_use
    // block, no text blocks, no explanation field → handler produces
    // deterministic fallback, NOT the 39-char SAFE_FALLBACK stub.
    const handler = createExplainFromStructureHandler();
    const proposal: ProposalAction = {
      handler_id: 'explain_from_structure',
      entity: {
        id: GOAL_NODE_ID,
        kind: 'goal',
        resolution_status: 'resolved',
        resolution_method: 'context_inference',
      },
      parameters: [],
      cited_context_fields: [],
    };
    const invocation = {
      ...bef4470bInvocation(proposal, ''),
      explanation: undefined,
      structureProjection: HIRING_STRUCTURE_PROJECTION,
    };
    const outcome = await handler(invocation);
    // Strongest causal links present (factor labels and goal label)
    expect(outcome.assistant_text).toContain('Code quality');
    expect(outcome.assistant_text).toContain('Hire the best candidate');
    // Strength formatting present
    expect(outcome.assistant_text).toMatch(/strength\s+-?0\.\d{2}/);
    // Length well above the 39-char SAFE_FALLBACK stub
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).not.toBe('Here is what the model structure shows.');
  });

  it('explain_results post-analysis: empty answer_text → fallback contains leading option AND driver', async () => {
    // Brief Task 5 integration test: post-analysis explain_results with
    // empty answer_text → deterministic fallback contains leading option
    // and driver.
    const handler = createExplainResultsHandler();
    const proposal: ProposalAction = {
      handler_id: 'explain_results',
      entity: {
        id: 'opt_sr_dev',
        kind: 'option',
        resolution_status: 'resolved',
        resolution_method: 'label_match',
      },
      parameters: [],
      cited_context_fields: [],
    };
    const baseInvocation = bef4470bInvocation(proposal, '');
    const invocation: HandlerInvocation = {
      ...baseInvocation,
      context: {
        ...baseInvocation.context,
        prior_facts: [RUN_ANALYSIS_FACT],
      } as HandlerInvocation['context'],
      explanation: {
        answer_text: '',
        answer_text_valid: false,
        answer_validation_error: 'missing',
      },
      analysisProjection: HIRING_ANALYSIS_PROJECTION,
    };
    const outcome = await handler(invocation);
    // Leading option label is present
    expect(outcome.assistant_text).toContain('Senior developer');
    // Raw probability value preserved (not converted to per-cent).
    expect(outcome.assistant_text).toContain('0.71');
    // A top driver factor label is present, with sensitivity value.
    expect(outcome.assistant_text).toContain('Code quality');
    expect(outcome.assistant_text).toContain('0.62');
    // Length well above the 32-char SAFE_FALLBACK stub
    expect(outcome.assistant_text.length).toBeGreaterThan(80);
    expect(outcome.assistant_text).not.toBe('Here is what the analysis shows.');
  });

  it('explain_from_structure: happy-path answer_text on hiring graph never triggers mutation-language guard', () => {
    // Defensive: confirm a healthy explain_from_structure answer about
    // bef4470b's hiring graph reads as exposition, not as a mutation.
    const healthyAnswer =
      'Code quality drives the goal most strongly at 0.62 strength, with salary cost working in the opposite direction at -0.55. The senior-developer option performs best because of how those two factors combine.';
    expect(containsMutationLanguage(healthyAnswer)).toBe(false);
  });
});
