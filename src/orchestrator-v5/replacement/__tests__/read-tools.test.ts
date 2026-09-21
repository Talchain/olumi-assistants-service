/**
 * `read_workspace` and `read_results` — the two reads that put the computed
 * analysis in front of the conversation.
 *
 * FIXTURES ARE SHAPE-DERIVED, DIGITS INVENTED. Both repositories are public,
 * so the structure here is taken from live captures (a pricing decision with
 * three options, an enrichment carrying `option_comparison[].outcome`,
 * `option_comparison[].downside`, `robustness.near_tie`,
 * `robustness.fragile_edges[]` and `decision_evpi`) while every number is made
 * up. Nothing below is a real measurement of a real model.
 *
 * WHAT THESE PIN, beyond "it renders"
 * -----------------------------------
 * The interesting failures for a read tool are all failures of HONESTY, and
 * each has a named contract behind it:
 *
 *   · a missing `switch_probability` must read as NOT COMPUTED — its schema
 *     says absence is "never 0 and never 1", so a coalesce fabricates either
 *     the floor or the maximum of the scale;
 *   · a missing `decision_evpi` and a measured `0` must not read alike —
 *     one is "we did not compute this", the other is "we measured that
 *     information is worthless here";
 *   · a missing `percentiles_source` must not be reported as sampled;
 *   · a stale analysis must SAY it is stale AND still report the figures.
 *
 * Every assertion binds to its object by identity — an option by its id, an
 * edge by its endpoint labels — never by a value predicate another row could
 * satisfy.
 */

import { describe, expect, it } from 'vitest';

import { runAgentLoop, type ChatWithToolsLike } from '../agent-loop.js';
import {
  createReadResultsTool,
  createReadWorkspaceTool,
  READ_RESULTS_NO_ANALYSIS,
  READ_WORKSPACE_EMPTY,
  type AnalysisSnapshot,
} from '../read-tools.js';

import type { AnalysisEnrichment } from '@talchain/schemas/boundary';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── Identity constants. Every assertion names one of these. ─────────────────
const DECISION = 'dec_pricing';
const GOAL = 'out_monthly_revenue';
const OPT_HOLD = 'opt_hold_price';
const OPT_RAISE = 'opt_raise_new_only';
const FAC_PRICE = 'fac_plan_price';
const FAC_CHURN = 'fac_churn_rate';
const RISK_BACKLASH = 'risk_customer_backlash';

/**
 * Edges carry the three fields `EdgeV3` requires, so the fixture takes the
 * compactor's STRICT arm — the production path. It matters: the structural
 * fallback runs `withoutBaselineIdentity`, so a permissive fixture silently
 * removes status-quo identity and a test written on one would be asserting
 * against a degraded projection without saying so.
 */
function edge(from: string, to: string, mean = 0.5): Record<string, unknown> {
  return {
    from,
    to,
    strength: { mean, std: 0.1 },
    exists_probability: 1,
    effect_direction: mean < 0 ? 'negative' : 'positive',
  };
}

function graph(overrides: Partial<GraphStateIngress> = {}): GraphStateIngress {
  const base = {
    nodes: [
      { id: DECISION, kind: 'decision', label: 'How should we price next quarter?' },
      {
        id: OPT_HOLD,
        kind: 'option',
        label: 'Hold the current price',
        is_baseline: true,
        data: { interventions: { [FAC_PRICE]: 0 } },
      },
      {
        id: OPT_RAISE,
        kind: 'option',
        label: 'Raise the price for new customers only',
        data: { interventions: { [FAC_PRICE]: 1 } },
      },
      {
        id: FAC_PRICE,
        kind: 'factor',
        label: 'Plan Price',
        observed_state: { value: 47, unit: 'GBP' },
      },
      { id: FAC_CHURN, kind: 'factor', label: 'Churn Rate' },
      { id: RISK_BACKLASH, kind: 'risk', label: 'Customer Backlash' },
      { id: GOAL, kind: 'outcome', label: 'Monthly Revenue' },
    ],
    edges: [
      edge(DECISION, OPT_HOLD),
      edge(DECISION, OPT_RAISE),
      edge(OPT_RAISE, FAC_PRICE),
      edge(FAC_PRICE, GOAL),
      edge(FAC_CHURN, GOAL, -0.3),
    ],
    goal_node_id: GOAL,
  };
  return { ...base, ...overrides } as GraphStateIngress;
}

function workspace(g: GraphStateIngress | null): string {
  const tool = createReadWorkspaceTool({ getGraph: () => g });
  const outcome = tool.execute({});
  if (outcome instanceof Promise) throw new Error('read_workspace must be synchronous here');
  if (outcome.type !== 'result') throw new Error(`expected a result, got ${outcome.type}`);
  return outcome.content;
}

function results(snapshot: AnalysisSnapshot | null): string {
  const tool = createReadResultsTool({ getAnalysis: () => snapshot });
  const outcome = tool.execute({});
  if (outcome instanceof Promise) throw new Error('read_results must be synchronous here');
  if (outcome.type !== 'result') throw new Error(`expected a result, got ${outcome.type}`);
  return outcome.content;
}

/** Live enrichment SHAPE; every digit invented. */
function enrichment(overrides: Record<string, unknown> = {}): AnalysisEnrichment {
  const base: Record<string, unknown> = {
    confidence_tier: 'fair',
    option_comparison: [
      {
        option_id: OPT_RAISE,
        option_label: 'Raise the price for new customers only',
        status: 'computed',
        win_probability: 0.63,
        outcome: {
          mean: 0.42,
          std: 0.21,
          p10: 0.11,
          p50: 0.4,
          p90: 0.74,
          n_samples: 4000,
          percentiles_source: 'samples',
        },
        downside: { p05: -0.03, cvar_10: -0.07, expected_regret: 0.05 },
      },
      {
        option_id: OPT_HOLD,
        option_label: 'Hold the current price',
        status: 'computed',
        win_probability: 0.37,
        outcome: {
          mean: 0.29,
          std: 0.18,
          p10: 0.04,
          p50: 0.27,
          p90: 0.58,
          n_samples: 4000,
          percentiles_source: 'samples',
        },
        downside: { p05: -0.12, cvar_10: -0.19, expected_regret: 0.18 },
      },
    ],
    robustness: {
      near_tie: {
        is_tie: false,
        top_option_id: OPT_RAISE,
        second_option_id: OPT_HOLD,
        tied_option_ids: [],
        gap: 0.26,
        threshold: 0.1,
      },
      // Deliberately NOT in metric order: the shared authority must reorder
      // them. A fixture already sorted could not tell a real ordering from
      // an accidental passthrough of producer order.
      fragile_edges: [
        {
          edge_id: `${FAC_CHURN}->${GOAL}`,
          from_id: FAC_CHURN,
          to_id: GOAL,
          from_label: 'Churn Rate',
          to_label: 'Monthly Revenue',
          switch_probability: 0.21,
          alternative_winner_id: OPT_HOLD,
          alternative_winner_label: 'Hold the current price',
        },
        {
          edge_id: `${FAC_PRICE}->${GOAL}`,
          from_id: FAC_PRICE,
          to_id: GOAL,
          from_label: 'Plan Price',
          to_label: 'Monthly Revenue',
          switch_probability: 0.58,
          marginal_switch_probability: 0.16,
          alternative_winner_id: OPT_HOLD,
          alternative_winner_label: 'Hold the current price',
        },
      ],
      robust_edges: [],
    },
    decision_evpi: 0.034,
  };
  return { ...base, ...overrides } as AnalysisEnrichment;
}

function fresh(overrides: Record<string, unknown> = {}): AnalysisSnapshot {
  return {
    enrichment: enrichment(overrides),
    freshness: 'fresh',
    freshnessReason: 'graph_hash_match',
    computedAt: '2026-09-20T09:00:00.000Z',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('read_workspace — the model as it stands', () => {
  it('names the decision, the options and what each one sets, by id', () => {
    const out = workspace(graph());

    expect(out).toContain('How should we price next quarter?');
    expect(out).toContain(`[${DECISION}]`);

    expect(out).toContain('Raise the price for new customers only');
    expect(out).toContain(`[${OPT_RAISE}]`);
    // The whole point of the id: the next operation addresses the option by
    // it. The failure this layer replaces asked the user "I wasn't sure what
    // you meant by ..." because it only ever had a label.
    expect(out).toContain(`[${OPT_HOLD}]`);
    expect(out).toContain('status-quo option');

    // What each option SETS — the thing that makes it an option at all.
    const raiseLine = out.split('\n').find((l) => l.includes(`[${OPT_RAISE}]`));
    expect(raiseLine).toContain('sets');
    expect(raiseLine).toContain('Plan Price');
    // "sets sets" — the compactor's summary is already a sentence.
    expect(out).not.toContain('sets sets');
  });

  it('does not report "no value set" against nodes that have no value of their own', () => {
    const out = workspace(graph());
    const optionLine = out.split('\n').find((l) => l.includes(`[${OPT_HOLD}]`));
    const decisionLine = out.split('\n').find((l) => l.includes(`[${DECISION}]`));
    // An option's quantity is what it sets; a decision has none at all.
    // Reporting an absence that is not a gap devalues the gaps that are real.
    expect(optionLine).not.toContain('no value set');
    expect(decisionLine).not.toContain('no value set');
    // ...while a risk genuinely carrying none still says so.
    expect(out.split('\n').find((l) => l.includes(`[${RISK_BACKLASH}]`))).toContain(
      'no value set',
    );
  });

  it('does NOT claim status-quo identity when the compactor could not license it', () => {
    // A permissive ingress (no edge strength) takes the compactor's structural
    // fallback, which strips `is_baseline` on the rule that a degraded parse
    // may not attest baseline identity. The tool must inherit that silence
    // rather than infer the flag from the raw node it was handed.
    const permissive = {
      ...graph(),
      edges: [{ from: DECISION, to: OPT_HOLD }],
    } as unknown as GraphStateIngress;

    const out = workspace(permissive);
    expect(out).toContain(`[${OPT_HOLD}]`);
    expect(out).not.toContain('status-quo option');
  });

  it('gives a factor its value AND its unit, and says when one has none', () => {
    const out = workspace(graph());
    const priceLine = out.split('\n').find((l) => l.includes(`[${FAC_PRICE}]`));
    const churnLine = out.split('\n').find((l) => l.includes(`[${FAC_CHURN}]`));

    expect(priceLine).toContain('value 47');
    expect(priceLine).toContain('GBP');
    expect(churnLine).toContain('no value set');
  });

  it('separates risks and outcomes from factors', () => {
    const out = workspace(graph());
    expect(out).toContain('RISKS (1):');
    expect(out.split('\n').find((l) => l.includes(`[${RISK_BACKLASH}]`))).toBeDefined();
    expect(out).toContain('OUTCOMES (1):');
  });

  it('says NO TARGET SET when the goal has no constraint — the user can fix that', () => {
    const out = workspace(graph());
    expect(out).toContain('Monthly Revenue');
    expect(out).toContain('NO TARGET SET');
  });

  it('renders a target that IS set, with its operator, threshold and unit', () => {
    const out = workspace(
      graph({
        goal_constraints: [
          {
            constraint_id: 'constraint_revenue_min',
            node_id: GOAL,
            operator: '>=',
            value: 90000,
            label: 'Monthly revenue floor',
            unit: 'GBP',
          },
        ],
      }),
    );
    expect(out).toContain('target set (1 recorded)');
    expect(out).toContain('Monthly revenue floor');
    expect(out).toContain('>= 90000 GBP');
    expect(out).not.toContain('NO TARGET SET');
  });

  it('an empty graph, and no graph at all, both say there is nothing to read', () => {
    expect(workspace(null)).toBe(READ_WORKSPACE_EMPTY);
    expect(workspace({ nodes: [], edges: [] } as unknown as GraphStateIngress)).toBe(
      READ_WORKSPACE_EMPTY,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('read_results — the numbers the product computed and never showed', () => {
  it('reports the full outcome distribution per option, bound to the option id', () => {
    const out = results(fresh());
    const lines = out.split('\n');
    const raiseAt = lines.findIndex((l) => l.includes(`[${OPT_RAISE}]`));
    const holdAt = lines.findIndex((l) => l.includes(`[${OPT_HOLD}]`));
    expect(raiseAt).toBeGreaterThanOrEqual(0);
    expect(holdAt).toBeGreaterThan(raiseAt);

    const raiseBlock = lines.slice(raiseAt, holdAt).join('\n');
    expect(raiseBlock).toContain('mean 0.42');
    expect(raiseBlock).toContain('p10 0.11');
    expect(raiseBlock).toContain('p50 (median) 0.4');
    expect(raiseBlock).toContain('p90 0.74');
  });

  it('reports the downside block, which no existing projection carries', () => {
    const out = results(fresh());
    const lines = out.split('\n');
    const holdAt = lines.findIndex((l) => l.includes(`[${OPT_HOLD}]`));
    const holdBlock = lines.slice(holdAt).join('\n');

    expect(holdBlock).toContain('p05 -0.12');
    expect(holdBlock).toContain('cvar_10) -0.19');
    expect(holdBlock).toContain('expected regret 0.18');
  });

  it('states the separation gap, the tie threshold, and that the options do NOT tie', () => {
    const out = results(fresh());
    expect(out).toContain('gap between the top two is 0.26');
    expect(out).toContain('tie threshold of 0.1');
    expect(out).toContain('DO NOT TIE');
  });

  it('says the options TIE when the producer says so, and forbids naming a leader', () => {
    const tied = fresh({
      robustness: {
        near_tie: {
          is_tie: true,
          top_option_id: OPT_RAISE,
          second_option_id: OPT_HOLD,
          tied_option_ids: [OPT_RAISE, OPT_HOLD],
          gap: 0.009,
          threshold: 0.1,
        },
        fragile_edges: [],
      },
    });
    const out = results(tied);
    expect(out).toContain('THE OPTIONS TIE');
    expect(out).toContain('Do not name a leader');
  });

  it('ranks fragile edges by the producer metric, not by arrival order', () => {
    const out = results(fresh());
    const lines = out.split('\n');
    const priceAt = lines.findIndex((l) => l.includes('Plan Price -> Monthly Revenue'));
    const churnAt = lines.findIndex((l) => l.includes('Churn Rate -> Monthly Revenue'));

    expect(priceAt).toBeGreaterThanOrEqual(0);
    expect(churnAt).toBeGreaterThanOrEqual(0);
    // Plan Price arrives SECOND in the fixture and carries the higher metric
    // (0.58 vs 0.21), so it must come first here. Binding to these two labels
    // rather than to "the first line" means a re-ordering of unrelated rows
    // cannot satisfy the assertion.
    expect(priceAt).toBeLessThan(churnAt);
    expect(lines[priceAt]).toContain('1.');
    expect(lines[churnAt]).toContain('2.');
  });

  it('gives each fragile edge its alternative winner and its switch probability', () => {
    const out = results(fresh());
    const line = out.split('\n').find((l) => l.includes('Plan Price -> Monthly Revenue'));
    expect(line).toContain('if this link is wrong');
    expect(line).toContain('"Hold the current price" wins instead');
    expect(line).toContain('0.58 of runs');
    expect(out).toContain('attributable to this link alone: 0.16');
  });

  it('reports the value of perfect information', () => {
    expect(results(fresh())).toContain('VALUE OF PERFECT INFORMATION: 0.034');
  });

  it("carries the producer's own confidence tier", () => {
    expect(results(fresh())).toContain("PRODUCER'S OWN CONFIDENCE TIER: fair");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('absence is never zero — the contract the schema states on the field', () => {
  it('a fragile edge with no switch probability reads NOT COMPUTED, never 0 and never 1', () => {
    const out = results(
      fresh({
        robustness: {
          near_tie: {
            is_tie: false,
            top_option_id: OPT_RAISE,
            second_option_id: OPT_HOLD,
            tied_option_ids: [],
            gap: 0.26,
            threshold: 0.1,
          },
          fragile_edges: [
            {
              edge_id: `${FAC_PRICE}->${GOAL}`,
              from_id: FAC_PRICE,
              to_id: GOAL,
              from_label: 'Plan Price',
              to_label: 'Monthly Revenue',
              alternative_winner_label: 'Hold the current price',
            },
          ],
        },
      }),
    );

    const line = out.split('\n').find((l) => l.includes('Plan Price -> Monthly Revenue'));
    expect(line).toBeDefined();
    expect(line).toContain('NOT COMPUTED');
    // The two fabrications the field's own contract names by name.
    expect(line).not.toContain('0 of runs');
    expect(line).not.toContain('1 of runs');
    // And the row is kept, not silently dropped.
    expect(out).toContain('FRAGILE LINKS (1');
  });

  it('a measured switch probability of 0 is preserved as a measurement', () => {
    const out = results(
      fresh({
        robustness: {
          near_tie: {
            is_tie: false,
            top_option_id: OPT_RAISE,
            second_option_id: OPT_HOLD,
            tied_option_ids: [],
            gap: 0.26,
            threshold: 0.1,
          },
          fragile_edges: [
            {
              edge_id: `${FAC_PRICE}->${GOAL}`,
              from_id: FAC_PRICE,
              to_id: GOAL,
              from_label: 'Plan Price',
              to_label: 'Monthly Revenue',
              switch_probability: 0,
              alternative_winner_label: 'Hold the current price',
            },
          ],
        },
      }),
    );
    const line = out.split('\n').find((l) => l.includes('Plan Price -> Monthly Revenue'));
    expect(line).toContain('0 of runs');
    expect(line).not.toContain('NOT COMPUTED');
  });

  it('an absent decision EVPI and a measured 0 do not read alike', () => {
    const absent = fresh();
    const withoutEvpi: AnalysisSnapshot = {
      ...absent,
      enrichment: (() => {
        const e = { ...(absent.enrichment as Record<string, unknown>) };
        delete e.decision_evpi;
        return e as AnalysisEnrichment;
      })(),
    };

    const absentOut = results(withoutEvpi);
    const zeroOut = results(fresh({ decision_evpi: 0 }));

    expect(absentOut).toContain('VALUE OF PERFECT INFORMATION: not computed');
    expect(zeroOut).toContain('measured, not missing');
    expect(zeroOut).not.toContain('not computed for this decision');
  });

  it('percentiles with no stated source are not reported as sampled', () => {
    const out = results(
      fresh({
        option_comparison: [
          {
            option_id: OPT_RAISE,
            option_label: 'Raise the price for new customers only',
            status: 'computed',
            outcome: { mean: 0.42, p10: 0.11, p50: 0.4, p90: 0.74 },
          },
        ],
      }),
    );
    expect(out).toContain('did not state where the percentiles came from');
    expect(out).not.toContain('computed from simulation samples');
  });

  it('a separation verdict the producer never computed is named as missing', () => {
    const out = results(fresh({ robustness: { fragile_edges: [] } }));
    expect(out).toContain('SEPARATION: not computed');
    expect(out).toContain('Do not infer a leader');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('staleness is information, not a reason to withhold', () => {
  it('a stale analysis says so FIRST and still reports every figure', () => {
    const out = results({
      enrichment: enrichment(),
      freshness: 'stale',
      freshnessReason: 'graph_hash_diverged',
      computedAt: '2026-09-19T08:00:00.000Z',
    });

    expect(out.split('\n')[0]).toContain('ANALYSIS IS OUT OF DATE');
    expect(out).toContain('graph_hash_diverged');
    expect(out).toContain('2026-09-19T08:00:00.000Z');

    // Withholding is the failure mode this replaces: the figures are still
    // real measurements of a model the user worked on.
    expect(out).toContain('mean 0.42');
    expect(out).toContain('p90 0.74');
    expect(out).toContain('0.58 of runs');
    expect(out).toContain('VALUE OF PERFECT INFORMATION: 0.034');
  });

  it('an unestablished currency verdict is reported as unverified, not as current', () => {
    const out = results({ enrichment: enrichment(), freshness: null });
    expect(out).toContain('CURRENCY COULD NOT BE ESTABLISHED');
    expect(out).not.toContain('ANALYSIS IS CURRENT');
    expect(out).toContain('mean 0.42');
  });

  it("a fresh analysis says it is current", () => {
    expect(results(fresh()).split('\n')[0]).toContain('ANALYSIS IS CURRENT');
  });

  it('no analysis at all is named as never computed, not as withheld', () => {
    expect(results(null)).toBe(READ_RESULTS_NO_ANALYSIS);
    expect(results({ enrichment: null, freshness: 'none' })).toBe(READ_RESULTS_NO_ANALYSIS);
  });

  it('an analysis carrying no options says so rather than rendering an empty list', () => {
    const out = results(fresh({ option_comparison: [] }));
    expect(out).toContain('PER-OPTION RESULTS: none reported');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('a read is a read', () => {
  it('both tools declare kind "read"', () => {
    expect(createReadWorkspaceTool({ getGraph: () => graph() }).kind).toBe('read');
    expect(createReadResultsTool({ getAnalysis: () => fresh() }).kind).toBe('read');
  });

  it('neither tool ever returns a proposal, on any of its branches', () => {
    const graphs: (GraphStateIngress | null)[] = [
      graph(),
      graph({ goal_constraints: [{ constraint_id: 'c', node_id: GOAL, operator: '<=', value: 1 }] }),
      { nodes: [], edges: [] } as unknown as GraphStateIngress,
      null,
    ];
    for (const g of graphs) {
      const outcome = createReadWorkspaceTool({ getGraph: () => g }).execute({});
      expect(outcome).not.toBeInstanceOf(Promise);
      expect((outcome as { type: string }).type).toBe('result');
    }

    const snapshots: (AnalysisSnapshot | null)[] = [
      fresh(),
      { enrichment: enrichment(), freshness: 'stale' },
      { enrichment: enrichment(), freshness: null },
      { enrichment: {} as AnalysisEnrichment, freshness: 'fresh' },
      null,
    ];
    for (const s of snapshots) {
      const outcome = createReadResultsTool({ getAnalysis: () => s }).execute({});
      expect(outcome).not.toBeInstanceOf(Promise);
      expect((outcome as { type: string }).type).toBe('result');
    }
  });

  it('runs through the real agent loop, which THROWS on a read that stages operations', async () => {
    // The strongest available binding: the loop itself enforces the rule
    // (`a read must not stage operations`). A turn that calls both tools and
    // completes proves the property against the enforcer, not against a
    // restatement of it here.
    const calls: string[] = [];
    const chatWithTools: ChatWithToolsLike = async ({ messages }) => {
      const round = messages.filter((m) => m.role === 'assistant').length;
      if (round === 0) {
        return {
          content: [
            { type: 'tool_use', id: 't1', name: 'read_workspace', input: {} },
            { type: 'tool_use', id: 't2', name: 'read_results', input: {} },
          ],
          stop_reason: 'tool_use',
        };
      }
      const returned = messages
        .flatMap((m) => (typeof m.content === 'string' ? [] : m.content))
        .filter((b) => b.type === 'tool_result');
      for (const block of returned) {
        if (block.type === 'tool_result') calls.push(block.content);
      }
      return { content: [{ type: 'text', text: 'Read both.' }], stop_reason: 'end_turn' };
    };

    const result = await runAgentLoop(
      {
        system: 'test',
        messages: [{ role: 'user', content: 'what does the model say?' }],
        tools: [
          createReadWorkspaceTool({ getGraph: () => graph() }),
          createReadResultsTool({ getAnalysis: () => fresh() }),
        ],
      },
      { chatWithTools },
    );

    expect(result.proposed).toEqual([]);
    expect(result.toolsCalled).toEqual(['read_workspace', 'read_results']);
    expect(result.haltedAtCeiling).toBe(false);
    // The tool output genuinely reached the model, rather than the loop
    // returning early on an empty result.
    expect(calls.join('\n')).toContain('Raise the price for new customers only');
    expect(calls.join('\n')).toContain('VALUE OF PERFECT INFORMATION');
  });

  it('neither tool mutates what it was given', () => {
    const g = graph();
    const before = JSON.stringify(g);
    workspace(g);
    expect(JSON.stringify(g)).toBe(before);

    const snapshot = fresh();
    const analysisBefore = JSON.stringify(snapshot);
    results(snapshot);
    expect(JSON.stringify(snapshot)).toBe(analysisBefore);
  });
});
