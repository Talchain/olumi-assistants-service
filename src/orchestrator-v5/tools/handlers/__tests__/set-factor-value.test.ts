import { describe, expect, it } from 'vitest';

import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { HandlerInvocation } from '../../registry.js';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message: 'set churn to 5%',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeProposal(params: {
  readonly entityId: string;
  readonly value: unknown;
  readonly operator?: 'set' | 'increase' | 'decrease' | 'multiply';
}): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: params.entityId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value: params.value,
        ...(params.operator !== undefined ? { operator: params.operator } : {}),
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  };
}

describe('set_factor_value handler', () => {
  it('sets a percentage value with structured input on a capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );

    expect(outcome.assistant_text).toBe('Updated Customer churn from 4% to 5%.');
    expect(outcome.handler_facts).toHaveLength(1);
    const fact = outcome.handler_facts[0];
    expect(fact.fact_type).toBe('set_factor_value');
    expect(fact.result.target_id).toBe('f-churn');
    expect(fact.result.status).toBe('applied');
    expect(fact.result.after).toMatchObject({ value: 0.05, raw_value: 5, unit: '%' });

    const mutated = outcome.mutated_graph as GraphV3T;
    const churn = mutated.nodes.find((n) => n.id === 'f-churn');
    expect(churn?.observed_state?.value).toBe(0.05);
    expect(churn?.observed_state?.raw_value).toBe(5);

    // Hash divergence proves freshness will go stale on the next turn.
    expect(computeAnalysisAffectingGraphHash(graph)).not.toBe(
      computeAnalysisAffectingGraphHash(mutated),
    );
  });

  it('handles increase on a currency-capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget',
          value: { value: 10000, unit: '£', cap: 100000 },
          operator: 'increase',
        }),
      ),
    );

    expect(outcome.assistant_text).toBe('Updated Marketing budget from £40,000 to £50,000.');
    const mutated = outcome.mutated_graph as GraphV3T;
    const budget = mutated.nodes.find((n) => n.id === 'f-budget');
    expect(budget?.observed_state?.raw_value).toBe(50000);
    expect(budget?.observed_state?.value).toBe(0.5);
  });

  it('handles decrease', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 1, unit: '%', cap: 100 },
          operator: 'decrease',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.result.after).toMatchObject({ raw_value: 3, value: 0.03 });
  });

  it('handles multiply', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-budget',
          value: { value: 1.5, cap: 100000, unit: '£' },
          operator: 'multiply',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.result.after).toMatchObject({ raw_value: 60000 });
  });

  it('rejects ambiguous bare-number on a capped factor', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    // Bare number 5 against cap=100 (churn factor): without a unit, "5"
    // could mean 5% or 0.05. Refuse rather than guess.
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({ entityId: 'f-churn', value: 200, operator: 'set' }),
        ),
      ),
    ).rejects.toBeInstanceOf(HandlerInvocationFailedError);
  });

  it('rejects target with wrong kind', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'g-revenue', // goal, not factor
            value: { value: 5, unit: '%', cap: 100 },
            operator: 'set',
          }),
        ),
      ),
    ).rejects.toMatchObject({
      cause_kind: 'entity_kind_mismatch_at_execute',
    });
  });

  it('rejects unknown target id', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    await expect(
      handler(
        buildInvocation(
          graph,
          makeProposal({
            entityId: 'f-nonexistent',
            value: { value: 5, unit: '%', cap: 100 },
            operator: 'set',
          }),
        ),
      ),
    ).rejects.toMatchObject({
      cause_kind: 'entity_not_found_in_graph',
    });
  });

  it('emits noop status when the value does not change', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 4, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );
    const fact = outcome.handler_facts[0];
    expect(fact.noop).toBe(true);
    expect(fact.result.status).toBe('noop');
    // No LLM was called and the analysis-affecting hash is unchanged,
    // so post-dispatch freshness re-derivation will keep the verdict
    // at `fresh` (no spurious "Re-run analysis" chip emission).
    expect(outcome.llm_calls_used).toBe(0);
    expect(computeAnalysisAffectingGraphHash(graph)).toBe(
      computeAnalysisAffectingGraphHash(outcome.mutated_graph as GraphV3T),
    );
  });

  it('confirmation text contains no raw decimals or stray spaces before %', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );
    expect(outcome.assistant_text).not.toMatch(/\d\s+%/);
    // The handler emits "5%" not "0.05" — model unit never leaks into prose.
    expect(outcome.assistant_text).not.toContain('0.05');
  });
});

// ---------------------------------------------------------------------------
// P0 V5 golden-path repair (Wave 2) — receipt staleness narrative + redaction.
// ---------------------------------------------------------------------------

import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

function buildInvocationWithPriorAnalysis(
  graph: GraphV3T,
  proposal: ProposalAction,
  options: { successful: boolean },
): HandlerInvocation {
  const successFact: RunAnalysisHandlerFact = {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scn-1',
      leading_option_id: 'opt_1',
      summary: 'Prior analysis.',
      enrichment: options.successful ? { analysis_status: 'computed' } : { analysis_status: 'partial' },
    },
  };
  const inv = buildInvocation(graph, proposal);
  return {
    ...inv,
    context: {
      ...inv.context,
      prior_facts: [successFact],
    } as HandlerInvocation['context'],
  };
}

describe('set_factor_value — Wave 2 receipt: staleness narrative + redaction', () => {
  it('non-noop apply WITHOUT prior successful analysis → no staleness narrative (pre-analysis edits are not stale)', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocation(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
      ),
    );
    expect(outcome.assistant_text).toMatch(/Updated/);
    expect(outcome.assistant_text).not.toMatch(/stale/i);
    expect(outcome.assistant_text).not.toMatch(/re-run/i);
  });

  it('non-noop apply WITH prior successful analysis → appends staleness + re-run prompt', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocationWithPriorAnalysis(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
        { successful: true },
      ),
    );
    expect(outcome.assistant_text).toMatch(/Updated/);
    // V5 stale-aware explain recovery: "previous analysis" is on the
    // brief's hard-fail list. The narrative now uses "the last analysis"
    // (not forbidden). The test asserts the staleness signal is present
    // without coupling to the previous-wording variant.
    expect(outcome.assistant_text).toMatch(/the last analysis (?:is now |stale|.*stale)/i);
    expect(outcome.assistant_text).toMatch(/Re-run analysis/);
    // Hard-fail prose check: no forbidden phrase reaches the wire.
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/previous analysis/);
    expect(outcome.assistant_text.toLowerCase()).not.toMatch(/prior analysis/);
  });

  it('non-noop apply WITH prior DEGRADED analysis (status partial) → no staleness narrative (no successful prior)', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocationWithPriorAnalysis(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 5, unit: '%', cap: 100 },
          operator: 'set',
        }),
        { successful: false },
      ),
    );
    expect(outcome.assistant_text).toMatch(/Updated/);
    expect(outcome.assistant_text).not.toMatch(/stale/i);
  });

  it('redaction: receipt copy contains no internal terms (raw IDs, schema language, normalised values)', async () => {
    const handler = createSetFactorValueHandler();
    const graph = buildD1Fixture();
    const outcome = await handler(
      buildInvocationWithPriorAnalysis(
        graph,
        makeProposal({
          entityId: 'f-churn',
          value: { value: 30000, unit: '£', cap: 1000000 },
          operator: 'set',
        }),
        { successful: true },
      ),
    );
    const text = outcome.assistant_text;
    // User unit verbatim; no normalised model-unit fraction.
    expect(text).toMatch(/£30,000/);
    expect(text).not.toMatch(/0\.\d{2,}/); // no 0.03 or similar
    // Forbidden internal vocabulary.
    for (const pat of [
      /\bf-churn\b/,
      /\bnoop\b/i,
      /\bzod\b/i,
      /\bnormalised\b/i,
      /\bnormalized\b/i,
      /\bpatch\b/i,
      /\bhandler\b/i,
      /\bfact_type\b/i,
      /\bBUDGET_TARGET\b/i,
      /\bedit_graph\b/i,
    ]) {
      expect(text, text).not.toMatch(pat);
    }
    // Prescription-shaped nouns banned by the foamy-bee UI handoff.
    // Pins the post-audit copy fix so the noun form `recommendation`
    // cannot drift back into the staleness narrative.
    for (const pat of [
      /\brecommendation\b/i,
      /\brecommended\b/i,
      /\bwinner\b/i,
      /\bwinning\b/i,
    ]) {
      expect(text, text).not.toMatch(pat);
    }
  });
});
