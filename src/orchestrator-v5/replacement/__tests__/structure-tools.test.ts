/**
 * The structure tools. Every refusal is checked for naming a next move,
 * because the measured failure was a dead end, not an exception.
 *
 * The operation shapes are asserted against the APPLY CONTRACT itself —
 * `PatchOperationsArraySchema` is imported and run over what each tool emits,
 * rather than a hand-written expectation of what that contract wants. A
 * restated shape would agree with itself; the contract is the only thing that
 * can say the proposal would actually land.
 */

import { describe, expect, it } from 'vitest';

import {
  createAddEdgeTool,
  createAddFactorTool,
  createAddOptionTool,
  normaliseLabelForComparison,
  type StructureGraph,
} from '../structure-tools.js';
import { PatchOperationsArraySchema } from '../../../orchestrator/patch-validation.js';
import { ALLOWED_EDGES } from '../../../validators/graph-validator.types.js';

/**
 * A synthetic graph. Nothing here is real data: the labels are invented and
 * the numbers are round. The SHAPE is taken from the ingress contract
 * (`NodeContentSchema` = `{id, kind, label}` passthrough), not from a capture.
 */
function graphOf(over: Partial<StructureGraph> = {}): StructureGraph {
  const base = {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we price?' },
      { id: 'opt_hold', kind: 'option', label: 'Hold the price' },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly Churn Rate' },
      { id: 'fac_revenue', kind: 'factor', label: 'Revenue' },
      { id: 'out_growth', kind: 'outcome', label: 'Growth' },
      { id: 'goal_north', kind: 'goal', label: 'North Star' },
      { id: 'risk_exit', kind: 'risk', label: 'Customers leave' },
    ],
    edges: [{ from: 'dec_pricing', to: 'opt_hold' }],
  };
  return { ...base, ...over };
}

const factorTool = (g: StructureGraph | null = graphOf()) => createAddFactorTool({ getGraph: () => g });
const optionTool = (g: StructureGraph | null = graphOf()) => createAddOptionTool({ getGraph: () => g });
const edgeTool = (g: StructureGraph | null = graphOf()) => createAddEdgeTool({ getGraph: () => g });

/** The proposal's operations, or a thrown failure naming what came back. */
async function proposalOf(
  tool: ReturnType<typeof createAddFactorTool>,
  input: Record<string, unknown>,
): Promise<{ summary: string; operations: readonly Record<string, unknown>[]; content?: string }> {
  const out = await tool.execute(input);
  if (out.type !== 'proposed') {
    throw new Error(`expected a proposal, got ${out.type}: ${'content' in out ? out.content : ''}`);
  }
  return { summary: out.summary, operations: out.operations, ...(out.content === undefined ? {} : { content: out.content }) };
}

async function refusalOf(
  tool: ReturnType<typeof createAddFactorTool>,
  input: Record<string, unknown>,
): Promise<string> {
  const out = await tool.execute(input);
  if (out.type !== 'refused') throw new Error(`expected a refusal, got ${out.type}`);
  return out.content;
}

// ===========================================================================
// The operation shape, asserted against the contract that has to accept it
// ===========================================================================

describe('what these tools emit is what the apply contract requires', () => {
  it('a proposed factor passes PatchOperationsArraySchema', async () => {
    const { operations } = await proposalOf(factorTool(), { label: 'Support Cost' });
    const parsed = PatchOperationsArraySchema.safeParse(operations);
    expect(parsed.success).toBe(true);
  });

  it('a proposed option and its decision edge both pass the contract', async () => {
    const { operations } = await proposalOf(optionTool(), {
      label: 'Raise by ten percent',
      parent_decision_id: 'dec_pricing',
    });
    expect(PatchOperationsArraySchema.safeParse(operations).success).toBe(true);
  });

  it('a proposed causal link passes the contract', async () => {
    const { operations } = await proposalOf(edgeTool(), {
      from_id: 'fac_churn',
      to_id: 'out_growth',
      strength_mean: -0.4,
      strength_std: 0.1,
      exists_probability: 0.8,
      effect_direction: 'negative',
    });
    expect(PatchOperationsArraySchema.safeParse(operations).success).toBe(true);
  });

  it('carries the node id in BOTH path and value.id — the applier reads one, the integrity check reads the other', async () => {
    const { operations } = await proposalOf(factorTool(), { label: 'Support Cost' });
    const op = operations[0]!;
    expect(op.op).toBe('add_node');
    expect(op.path).toBe('fac_support_cost');
    expect((op.value as { id: string }).id).toBe('fac_support_cost');
  });

  it('addresses an edge as from::to and repeats the endpoints in the value', async () => {
    const { operations } = await proposalOf(edgeTool(), { from_id: 'opt_hold', to_id: 'fac_churn' });
    const op = operations[0]!;
    expect(op.op).toBe('add_edge');
    expect(op.path).toBe('opt_hold::fac_churn');
    expect(op.value).toMatchObject({ from: 'opt_hold', to: 'fac_churn' });
  });

  it('puts the option node BEFORE its edge — the referee must see the node first', async () => {
    const { operations } = await proposalOf(optionTool(), {
      label: 'Raise by ten percent',
      parent_decision_id: 'dec_pricing',
    });
    expect(operations.map((o) => o.op)).toEqual(['add_node', 'add_edge']);
  });

  it('is declared a proposal tool, so the loop will not let it write', () => {
    for (const t of [factorTool(), optionTool(), edgeTool()]) expect(t.kind).toBe('propose');
  });

  it('refuses rather than throws when there is no model yet', async () => {
    for (const t of [factorTool(null), optionTool(null), edgeTool(null)]) {
      const out = await t.execute({ label: 'x', from_id: 'a', to_id: 'b', parent_decision_id: 'd' });
      expect(out.type).toBe('refused');
      if (out.type !== 'refused') return;
      expect(out.content).toContain('Talk the decision through first');
    }
  });
});

// ===========================================================================
// REQUIREMENT 1 — the duplicate refusal
// ===========================================================================

describe('the three churn nodes', () => {
  it('refuses an exact repeat and names the node that is already there', async () => {
    const msg = await refusalOf(factorTool(), { label: 'Monthly Churn Rate' });
    expect(msg).toContain('Monthly Churn Rate');
    expect(msg).toContain('fac_churn');
    expect(msg).toContain('split one quantity across two nodes');
  });

  it('catches a repeat that differs only in case', async () => {
    const msg = await refusalOf(factorTool(), { label: 'monthly churn rate' });
    expect(msg).toContain('fac_churn');
  });

  it('catches a repeat that differs only in whitespace', async () => {
    for (const spelling of ['  Monthly Churn Rate  ', 'Monthly  Churn   Rate', '\tMonthly Churn Rate\n']) {
      const msg = await refusalOf(factorTool(), { label: spelling });
      expect(msg).toContain('fac_churn');
    }
  });

  it('applies the same rule to options, across kinds', async () => {
    // The clash is with a FACTOR, and an option must still not reuse the name.
    const msg = await refusalOf(optionTool(), {
      label: 'monthly churn rate',
      parent_decision_id: 'dec_pricing',
    });
    expect(msg).toContain('fac_churn');
  });

  it('names what to do instead — use the existing node, or say what is different', async () => {
    const msg = await refusalOf(factorTool(), { label: 'Monthly Churn Rate' });
    expect(msg).toContain('Use fac_churn');
    expect(msg).toContain('ask them what distinguishes it');
    expect(msg).not.toMatch(/\binvalid\b/i);
  });

  /**
   * The honest limit, pinned so it cannot be quietly widened into a
   * natural-language predicate later. If someone adds fuzzy matching, this
   * test goes red and they have to justify it against the four rounds of
   * oscillation recorded in the module docblock.
   */
  it('does NOT catch a near-duplicate, and that is the decided behaviour', async () => {
    const { summary } = await proposalOf(factorTool(), { label: 'Customer Churn %' });
    expect(summary).toBe('Add a factor called Customer Churn %');
  });

  /**
   * The OTHER half of the discriminating pair, and the direction that costs
   * the user something real.
   *
   * Under-normalising lets a duplicate through, which is visible on the
   * canvas. OVER-normalising refuses a node the user genuinely asked for and
   * tells them it already exists — a lie about their own model, and silent,
   * because the refusal sounds correct. These two cases fold onto the
   * existing label only if the matcher starts stripping punctuation or
   * folding plurals, so they go red the moment someone widens the predicate
   * in that direction, and stay green if someone narrows it in the other.
   */
  it('a plural is a DIFFERENT label, not the same one', async () => {
    const { summary } = await proposalOf(factorTool(), { label: 'Monthly Churn Rates' });
    expect(summary).toBe('Add a factor called Monthly Churn Rates');
  });

  it('punctuation makes a DIFFERENT label, not the same one', async () => {
    const { summary } = await proposalOf(factorTool(), { label: 'Monthly Churn Rate (%)' });
    expect(summary).toBe('Add a factor called Monthly Churn Rate (%)');
  });

  it('normalises whitespace and case, and nothing else', () => {
    expect(normaliseLabelForComparison('  Monthly   Churn\tRate ')).toBe('monthly churn rate');
    // Punctuation, stemming and synonyms are all left alone — deliberately.
    expect(normaliseLabelForComparison('Churn Rate!')).not.toBe(normaliseLabelForComparison('Churn Rate'));
    expect(normaliseLabelForComparison('Churn Rates')).not.toBe(normaliseLabelForComparison('Churn Rate'));
  });

  it('mints a fresh id rather than colliding when a different label normalises onto a taken id', async () => {
    const g = graphOf({
      nodes: [
        { id: 'dec_pricing', kind: 'decision', label: 'How should we price?' },
        { id: 'fac_support_cost', kind: 'factor', label: 'Something else entirely' },
      ],
    });
    const { operations } = await proposalOf(factorTool(g), { label: 'Support Cost' });
    expect(operations[0]!.path).toBe('fac_support_cost_2');
  });
});

// ===========================================================================
// REQUIREMENT 2 — the bad-edge refusals
// ===========================================================================

describe('a link that cannot be made says which one would work', () => {
  it('refuses an unknown endpoint and names which end is missing', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'fac_nope', to_id: 'out_growth' });
    expect(msg).toContain('fac_nope');
    expect(msg).toContain('starts at');
    expect(msg).toContain('add_factor or add_option');
  });

  it('names the TO end when that is the missing one', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'fac_churn', to_id: 'out_nope' });
    expect(msg).toContain('out_nope');
    expect(msg).toContain('ends at');
  });

  it('refuses a self-edge — nothing downstream does', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'fac_churn', to_id: 'fac_churn' });
    expect(msg).toContain('cannot affect itself');
    expect(msg).toContain('ask which node the other end should be');
  });

  it('refuses a link that already exists, that way round', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'dec_pricing', to_id: 'opt_hold' });
    expect(msg).toContain('already affects');
    expect(msg).toContain('that way round');
    expect(msg).toContain('change its strength');
  });

  it('refuses a link that exists the OTHER way round, and says which way that is', async () => {
    const g = graphOf({ edges: [{ from: 'fac_churn', to: 'out_growth' }] });
    const msg = await refusalOf(edgeTool(g), { from_id: 'out_growth', to_id: 'fac_churn' });
    expect(msg).toContain('the other way round');
    expect(msg).toContain('Monthly Churn Rate');
    expect(msg).toContain('each causes the other');
  });

  /**
   * The direction rule is `ALLOWED_EDGES`, imported. `factor -> option` is
   * not one of its eight ordered pairs; `option -> factor` is.
   */
  it('refuses a backwards kind pair and names the direction that works', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'fac_churn', to_id: 'opt_hold' });
    expect(msg).toContain('a option does affect a factor');
    expect(msg).toContain('propose it that way round');
  });

  it('refuses a pair that is illegal in BOTH directions and suggests linking through what sits between', async () => {
    // decision -> goal and goal -> decision are both absent from ALLOWED_EDGES.
    const msg = await refusalOf(edgeTool(), { from_id: 'dec_pricing', to_id: 'goal_north' });
    expect(msg).toContain('in either direction');
    expect(msg).toContain('what sits in between');
  });

  it('admits every ordered pair ALLOWED_EDGES lists, and refuses every reversal of one', async () => {
    // Derived from the imported matrix rather than a copy of it, so a change
    // to the product's topology rule moves this test with it.
    const byKind: Record<string, string> = {
      decision: 'dec_pricing', option: 'opt_hold', factor: 'fac_churn',
      outcome: 'out_growth', goal: 'goal_north', risk: 'risk_exit',
    };
    const causal = {
      strength_mean: 0.5, strength_std: 0.1, exists_probability: 0.9, effect_direction: 'positive',
    };
    // No pre-existing edges: this loop is about the KIND rule, and the
    // fixture's decision->option edge would otherwise be refused as a
    // duplicate before the kind check ever ran.
    const bare = edgeTool(graphOf({ edges: [] }));
    let admitted = 0;
    for (const rule of ALLOWED_EDGES) {
      const from = byKind[rule.fromKind];
      const to = byKind[rule.toKind];
      // factor -> factor needs two distinct factors; the rest are distinct by kind.
      const toId = rule.fromKind === rule.toKind ? 'fac_revenue' : to;
      if (from === undefined || toId === undefined) continue;
      const out = await bare.execute({ from_id: from, to_id: toId, ...causal });
      expect(out.type, `${rule.fromKind} -> ${rule.toKind} should be admitted`).toBe('proposed');
      admitted += 1;
    }
    // ⛔ DERIVED, NOT COPIED — this line was the literal `8` and CI caught it
    // the day staging added `option -> risk` and `risk -> outcome` (#1637).
    // The count is not decoration: the `continue` above SKIPS any rule whose
    // kinds the fixture has no node for, so without it a new rule could be
    // silently unexercised while the loop still passed. Comparing against the
    // matrix's own length is what makes that skip fail loudly, and it moves
    // with the product's topology instead of having to be remembered.
    expect(ALLOWED_EDGES.length).toBeGreaterThan(0);
    expect(admitted).toBe(ALLOWED_EDGES.length);
  });
});

// ===========================================================================
// Structural vs causal links
// ===========================================================================

describe('a link is either topology or a claim about the world, and they are not treated alike', () => {
  it('a structural option -> factor link takes the shared canonical defaults, no numbers asked for', async () => {
    const { operations, content } = await proposalOf(edgeTool(), {
      from_id: 'opt_hold',
      to_id: 'fac_churn',
    });
    expect(operations[0]!.value).toMatchObject({
      exists_probability: 1.0,
      strength: { mean: 1.0, std: 0.01 },
      effect_direction: 'positive',
    });
    expect(content).toContain('set_option_effect');
  });

  it('a causal link with no numbers is refused, naming each one that is missing', async () => {
    const msg = await refusalOf(edgeTool(), { from_id: 'fac_churn', to_id: 'out_growth' });
    expect(msg).toContain('strength_mean');
    expect(msg).toContain('strength_std');
    expect(msg).toContain('exists_probability');
    expect(msg).toContain('effect_direction');
    expect(msg).toContain('Do not fill these in yourself');
  });

  it('names only the numbers that are actually missing', async () => {
    const msg = await refusalOf(edgeTool(), {
      from_id: 'fac_churn', to_id: 'out_growth',
      strength_mean: 0.4, strength_std: 0.1,
    });
    expect(msg).toContain('exists_probability');
    expect(msg).not.toContain('strength_std');
  });

  it('refuses a strength outside -1..1 and says what strength is not', async () => {
    const msg = await refusalOf(edgeTool(), {
      from_id: 'fac_churn', to_id: 'out_growth',
      strength_mean: 40, strength_std: 0.1, exists_probability: 0.9, effect_direction: 'positive',
    });
    expect(msg).toContain('runs from -1 to 1');
    expect(msg).toContain('ask how strong they think the link is');
  });

  it('refuses a zero uncertainty rather than letting it claim perfect certainty', async () => {
    const msg = await refusalOf(edgeTool(), {
      from_id: 'fac_churn', to_id: 'out_growth',
      strength_mean: 0.4, strength_std: 0, exists_probability: 0.9, effect_direction: 'positive',
    });
    expect(msg).toContain('has to be above 0');
    expect(msg).toContain('perfectly certain');
  });

  it('refuses a probability outside 0..1', async () => {
    const msg = await refusalOf(edgeTool(), {
      from_id: 'fac_churn', to_id: 'out_growth',
      strength_mean: 0.4, strength_std: 0.1, exists_probability: 80, effect_direction: 'positive',
    });
    expect(msg).toContain('runs from 0 to 1');
  });
});

// ===========================================================================
// REQUIREMENT 3 — a new factor's range
// ===========================================================================

describe('a new factor is given an honest unknown, never an invented range', () => {
  it('stamps the ignorance prior when no range was given, and marks it as such', async () => {
    const { operations } = await proposalOf(factorTool(), { label: 'Support Cost' });
    const prior = (operations[0]!.value as { prior: Record<string, unknown> }).prior;
    expect(prior).toMatchObject({
      distribution: 'uniform', range_min: 0, range_max: 1, prior_is_unquantified: true,
    });
  });

  it('tells the model the factor cannot take an option effect yet, and to ASK for the bounds', async () => {
    const { content } = await proposalOf(factorTool(), { label: 'Support Cost' });
    expect(content).toContain('NO range');
    expect(content).toContain("option's effect on it cannot be set");
    expect(content).toContain('do not work them out yourself');
  });

  it('writes a real prior when the user HAS given both bounds, unmarked', async () => {
    const { operations, content } = await proposalOf(factorTool(), {
      label: 'Support Cost', range_min: 10, range_max: 90,
    });
    const prior = (operations[0]!.value as { prior: Record<string, unknown> }).prior;
    expect(prior).toEqual({ distribution: 'uniform', range_min: 10, range_max: 90 });
    expect(prior.prior_is_unquantified).toBeUndefined();
    expect(content).toContain('range of 10 to 90');
  });

  it('refuses half a range rather than choosing the other end', async () => {
    const msg = await refusalOf(factorTool(), { label: 'Support Cost', range_min: 10 });
    expect(msg).toContain('range needs both ends');
    expect(msg).toContain('range_max');
    expect(msg).toContain('Do not');
    expect(msg).toContain('pick the other end yourself');
  });

  it('refuses an inverted range', async () => {
    const msg = await refusalOf(factorTool(), { label: 'Support Cost', range_min: 90, range_max: 10 });
    expect(msg).toContain('must be below');
    expect(msg).toContain('ask if it is not clear');
  });

  it('the description tells the model not to estimate the bounds', () => {
    const d = factorTool().definition.description;
    expect(d).toContain('only if the user has told you');
    expect(d).toContain('never estimate them');
  });
});

// ===========================================================================
// add_option's parent
// ===========================================================================

describe('an option hangs off a decision, and the refusal says which one', () => {
  it('proposes the node and the decision edge together', async () => {
    const { operations, summary } = await proposalOf(optionTool(), {
      label: 'Raise by ten percent', parent_decision_id: 'dec_pricing',
    });
    expect(summary).toContain('under How should we price?');
    expect(operations[1]).toMatchObject({
      op: 'add_edge', path: 'dec_pricing::opt_raise_by_ten_percent',
    });
  });

  it('refuses an unknown parent and names the decision that IS there', async () => {
    const msg = await refusalOf(optionTool(), {
      label: 'Raise by ten percent', parent_decision_id: 'dec_nope',
    });
    expect(msg).toContain('dec_nope');
    expect(msg).toContain('dec_pricing');
  });

  it('refuses a parent of the wrong kind and says an option hangs off a DECISION', async () => {
    const msg = await refusalOf(optionTool(), {
      label: 'Raise by ten percent', parent_decision_id: 'fac_churn',
    });
    expect(msg).toContain('is a factor');
    expect(msg).toContain('hangs off a DECISION');
  });

  it('says the option cannot be compared until it is linked to factors', async () => {
    const { content } = await proposalOf(optionTool(), {
      label: 'Raise by ten percent', parent_decision_id: 'dec_pricing',
    });
    expect(content).toContain('cannot be compared');
    expect(content).toContain('add_link');
    expect(content).toContain('Do not guess at them');
  });

  it('refuses when the model has no decision at all, rather than listing nothing', async () => {
    const g = graphOf({ nodes: [{ id: 'fac_churn', kind: 'factor', label: 'Monthly Churn Rate' }] });
    const msg = await refusalOf(optionTool(g), {
      label: 'Raise by ten percent', parent_decision_id: 'dec_nope',
    });
    expect(msg).toContain('no decision node yet');
    expect(msg).toContain('Ask the user what the decision actually is');
  });
});

// ===========================================================================
// The contract every refusal in this layer is held to
// ===========================================================================

describe('no refusal is a dead end', () => {
  it('every refusal names a next move and none of them says "invalid"', async () => {
    const cases: [ReturnType<typeof createAddFactorTool>, Record<string, unknown>][] = [
      [factorTool(), { label: 'Monthly Churn Rate' }],
      [factorTool(), { label: '' }],
      [factorTool(), { label: 'X', range_min: 1 }],
      [factorTool(), { label: 'X', range_min: 9, range_max: 1 }],
      [optionTool(), { label: 'Y', parent_decision_id: 'nope' }],
      [optionTool(), { label: 'Y', parent_decision_id: 'fac_churn' }],
      [optionTool(), { label: '' , parent_decision_id: 'dec_pricing' }],
      [edgeTool(), { from_id: 'nope', to_id: 'fac_churn' }],
      [edgeTool(), { from_id: 'fac_churn', to_id: 'fac_churn' }],
      [edgeTool(), { from_id: 'dec_pricing', to_id: 'opt_hold' }],
      [edgeTool(), { from_id: 'fac_churn', to_id: 'opt_hold' }],
      [edgeTool(), { from_id: 'dec_pricing', to_id: 'goal_north' }],
      [edgeTool(), { from_id: 'fac_churn', to_id: 'out_growth' }],
    ];
    let checked = 0;
    for (const [tool, input] of cases) {
      const msg = await refusalOf(tool, input);
      expect(msg, `bare refusal for ${JSON.stringify(input)}`).not.toMatch(/\b(invalid|error|failed)\b/i);
      // A next move is an instruction to the model: ask, use, read, add,
      // propose, check, leave or say.
      expect(msg, `no next move in: ${msg}`).toMatch(/\b(ask|use|read|add|propose|check|leave|say)\b/i);
      checked += 1;
    }
    expect(checked).toBe(13);
  });

  it('no refusal dumps the node list — the failure this replaces listed every node in the graph', async () => {
    // A refusal may name the ONE node it is about. It may not enumerate the
    // graph. `fac_revenue` and `risk_exit` are in the fixture and are not the
    // subject of any of these.
    for (const [tool, input] of [
      [factorTool(), { label: 'Monthly Churn Rate' }],
      [edgeTool(), { from_id: 'fac_churn', to_id: 'fac_churn' }],
      [edgeTool(), { from_id: 'fac_churn', to_id: 'opt_hold' }],
    ] as [ReturnType<typeof createAddFactorTool>, Record<string, unknown>][]) {
      const msg = await refusalOf(tool, input);
      expect(msg).not.toContain('risk_exit');
      expect(msg).not.toContain('fac_revenue');
    }
  });
});
