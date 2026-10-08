import { describe, expect, it } from 'vitest';
import { goalCoherenceAsk } from '../goal-coherence.js';

interface Level {
  raw_value?: number;
  value: number;
  unit: string;
  source: string;
  cap?: number;
}
interface Node {
  id: string;
  kind: string;
  label: string;
  observed_state?: Level;
  nonlinear_identity?: { operation: 'product' | 'sum'; factor_ids: string[]; stated_in_brief?: boolean };
  goal_threshold?: number;
  goal_threshold_raw?: number;
  goal_threshold_unit?: string;
  goal_threshold_frame?: string;
  goal_direction?: string;
  goal_scope?: Record<string, unknown>;
}
interface Graph {
  nodes: Node[];
  edges: { from: string; to: string }[];
  goal_constraints?: { node_id: string; value: number; unit: string; value_frame: string; operator: string }[];
}

const PRICE = 'price_id';
const SUBSCRIBERS = 'subs_id';
const GOAL = 'mrr_id';
const Q4 = 'At £49 × 8,000, MRR today would be about £390,000, about 20 times your £20,000 target, so the goal would already be met. Is 8,000 your Pro paying subscribers, or a different count, for example all users?';
const READING = ", if MRR = Pro plan price × Pro paying subscribers (Olumi's reading)";

/** The graph AFTER the canvas edit. Normalised figures deliberately cannot supply the raw arithmetic. */
function product(subscribers = 8_000, confirmed = true): Graph {
  return {
    nodes: [
      { id: PRICE, kind: 'factor', label: 'Pro plan price', observed_state: { raw_value: 49, value: 0.83, unit: 'GBP/month', source: 'brief_extraction' } },
      { id: SUBSCRIBERS, kind: 'factor', label: 'Pro paying subscribers', observed_state: { raw_value: subscribers, value: 0.17, unit: 'subscribers', source: 'user_edited' } },
      {
        id: GOAL, kind: 'goal', label: 'MRR',
        goal_threshold: 0.41, goal_threshold_raw: 20_000, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_direction: '>=',
        nonlinear_identity: { operation: 'product', factor_ids: [PRICE, SUBSCRIBERS], stated_in_brief: confirmed },
      },
    ],
    edges: [{ from: PRICE, to: GOAL }, { from: SUBSCRIBERS, to: GOAL }],
  };
}

function node(graph: Graph, id: string): Node {
  const found = graph.nodes.find((n) => n.id === id);
  if (found === undefined) throw new Error(`Missing fixture node ${id}`);
  return found;
}
function level(graph: Graph, id: string): Level {
  const found = node(graph, id).observed_state;
  if (found === undefined) throw new Error(`Missing fixture level ${id}`);
  return found;
}
const ask = (graph: Graph, nodeId = SUBSCRIBERS) => goalCoherenceAsk(graph, { nodeId });

describe('RC5 deterministic goal coherence at the edited node', () => {
  it('300 → 8,000: asks in the exact Q4 words and binds both boundary actions to the edited id', () => {
    expect(ask(product())).toStrictEqual({
      text: Q4,
      ratio: 19.6,
      implied: 392_000,
      target: 20_000,
      controls: [
        { id: `coherence-keep:${SUBSCRIBERS}`, label: 'Yes, 8,000 Pro paying subscribers', message: "Yes, 8,000 is right for 'Pro paying subscribers'." },
        { id: `coherence-change:${SUBSCRIBERS}`, label: 'No, let me change it', message: "No, I'll change 'Pro paying subscribers'." },
      ],
    });
  });

  it('300 → 400: 0.98× is silent', () => {
    expect(ask(product(400))).toBeNull();
  });

  it('300 → 4,000: 9.8× is silent (k = 5 mutant must fail this boundary row)', () => {
    expect(ask(product(4_000))).toBeNull();
  });

  it('exactly 10× fires, without rounding the ratio before checking it', () => {
    const graph = product(4_000);
    level(graph, PRICE).raw_value = 50;
    expect(ask(graph)).toMatchObject({ ratio: 10, implied: 200_000, target: 20_000 });
  });

  it('at_most mirror fires at exactly one tenth of the stated target', () => {
    const graph = product(40);
    node(graph, GOAL).goal_direction = '<=';
    level(graph, PRICE).raw_value = 50;
    const result = ask(graph);
    expect(result).toMatchObject({ ratio: 0.1, implied: 2_000, target: 20_000 });
    // Science addendum (8 Oct): the mirror says "less than a tenth", never a fraction, and never "impossible".
    expect(result?.text).toContain("MRR today would be about £2,000, less than a tenth of your £20,000 limit, so you'd already be well under it.")
    expect(result?.text).not.toMatch(/times your/)
    expect(result?.text).not.toMatch(/impossible/i);
  });

  it('Science addendum (2): a money parent against a per-period goal asks "or a different figure, for example a yearly figure?"', () => {
    const graph = product(300);
    level(graph, PRICE).raw_value = 4_900;
    const result = ask(graph, PRICE);
    expect(result).not.toBeNull();
    expect(result?.text).toContain('or a different figure, for example a yearly figure?');
    expect(result?.text).not.toContain('all users');
  });

  it('at_most mirror is silent above one tenth', () => {
    const graph = product(41);
    node(graph, GOAL).goal_direction = '<=';
    level(graph, PRICE).raw_value = 50;
    expect(ask(graph)).toBeNull();
  });

  it('the at_most ratio preserves small decimal figures instead of rounding them to zero', () => {
    const graph = product(1);
    node(graph, GOAL).goal_direction = '<=';
    node(graph, GOAL).goal_threshold_raw = 49_000_000;
    const result = ask(graph);
    expect(result).toMatchObject({ ratio: 0.000001, implied: 49, target: 49_000_000 });
    expect(result?.text).toContain('less than a tenth of your £49,000,000 limit');
  });

  it('reads an at_most target and comparator from the goal\'s own constraint row', () => {
    const graph = product(40);
    const goal = node(graph, GOAL);
    delete goal.goal_threshold_raw;
    delete goal.goal_direction;
    graph.goal_constraints = [{ node_id: GOAL, value: 20_000, unit: 'GBP/month', value_frame: 'level', operator: '<=' }];
    level(graph, PRICE).raw_value = 50;
    expect(ask(graph)).toMatchObject({ ratio: 0.1, implied: 2_000, target: 20_000 });
  });

  it('no stated target: null, even when the normalised threshold remains', () => {
    const graph = product();
    delete node(graph, GOAL).goal_threshold_raw;
    expect(ask(graph)).toBeNull();
  });

  it('a target without a stated comparator: null', () => {
    const graph = product();
    delete node(graph, GOAL).goal_direction;
    expect(ask(graph)).toBeNull();
  });

  it('a relative-change target is not a current-level target', () => {
    const graph = product();
    node(graph, GOAL).goal_threshold_frame = 'change_rel';
    expect(ask(graph)).toBeNull();
  });

  it('the edited node must be a parent by id, even when a different node has the same label', () => {
    const graph = product();
    graph.nodes.push({ ...node(graph, SUBSCRIBERS), id: 'different_subscribers' });
    expect(ask(graph, 'different_subscribers')).toBeNull();
  });

  it('a product with neither a confirmed stamp nor an explicit Olumi reading is ineligible', () => {
    const graph = product();
    delete node(graph, GOAL).nonlinear_identity!.stated_in_brief;
    expect(ask(graph)).toBeNull();
  });

  it('one coherent unconfirmed reading adds the exact inline qualification', () => {
    expect(ask(product(8_000, false))?.text).toBe(Q4.replace('already be met.', `already be met${READING}.`));
  });

  it('the one product proposer reading on a bare goal carries the inline qualification', () => {
    const graph = product();
    const goal = node(graph, GOAL);
    delete goal.nonlinear_identity;
    goal.observed_state = { raw_value: 392_000, value: 0.4, unit: 'GBP/month', source: 'brief_extraction' };
    level(graph, SUBSCRIBERS).source = 'user_override';
    expect(ask(graph)?.text).toBe(Q4.replace('already be met.', `already be met${READING}.`));
  });

  it('a confirmed identity does not carry Olumi\'s-reading qualification', () => {
    expect(ask(product())?.text).toBe(Q4);
    expect(ask(product())?.text).not.toContain(READING);
  });

  it('unconfirmed reading: incoherent factor units fail closed', () => {
    const graph = product(8_000, false);
    level(graph, SUBSCRIBERS).unit = '%';
    expect(ask(graph)).toBeNull();
  });

  it('unconfirmed reading: a stated £30,000 current MRR contradicts £392,000 and fails closed', () => {
    const graph = product(8_000, false);
    node(graph, GOAL).observed_state = { raw_value: 30_000, value: 0.4, unit: 'GBP/month', source: 'brief_extraction' };
    expect(ask(graph)).toBeNull();
  });

  it('unconfirmed reading: a stated current MRR that reconciles within 5% permits the ask', () => {
    const graph = product(8_000, false);
    node(graph, GOAL).observed_state = { raw_value: 400_000, value: 0.4, unit: 'GBP/month', source: 'brief_extraction' };
    expect(ask(graph)).toMatchObject({ implied: 392_000, ratio: 19.6 });
    expect(ask(graph)?.text).toContain(READING);
  });

  it('unconfirmed reading: two product candidates are not one goal reading', () => {
    const graph = product(8_000, false);
    graph.nodes.push({
      id: 'second_goal', kind: 'goal', label: 'Other revenue', goal_threshold_raw: 20_000,
      goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_direction: '>=',
      nonlinear_identity: { operation: 'product', factor_ids: [PRICE, SUBSCRIBERS], stated_in_brief: false },
    });
    graph.edges.push({ from: PRICE, to: 'second_goal' }, { from: SUBSCRIBERS, to: 'second_goal' });
    expect(ask(graph)).toBeNull();
  });

  it('unconfirmed reading: identity factors must be the goal\'s own parents', () => {
    const graph = product(8_000, false);
    graph.edges = graph.edges.filter((edge) => edge.from !== PRICE);
    expect(ask(graph)).toBeNull();
  });

  it('no raw operand or safe today-level source: null; never reconstructs raw values from the scale', () => {
    const graph = product();
    delete level(graph, SUBSCRIBERS).raw_value;
    level(graph, SUBSCRIBERS).cap = 50_000;
    expect(ask(graph)).toBeNull();
  });

  it('an unlevelled outcome operand reads the one safe user-stated today-level cause', () => {
    const graph = product();
    const subscribers = node(graph, SUBSCRIBERS);
    delete subscribers.observed_state;
    subscribers.kind = 'outcome';
    graph.nodes.push({
      id: 'current_subscribers', kind: 'factor', label: 'Current Pro paying subscribers',
      observed_state: { raw_value: 8_000, value: 0.4, cap: 20_000, unit: 'subscribers', source: 'brief_extraction' },
    });
    graph.edges.push({ from: 'current_subscribers', to: SUBSCRIBERS });
    expect(ask(graph)?.text).toBe(Q4);
  });

  it('an outcome\'s own Olumi projection cannot replace its user-stated today level', () => {
    const graph = product();
    node(graph, SUBSCRIBERS).kind = 'outcome';
    level(graph, SUBSCRIBERS).source = 'cee_inference';
    graph.nodes.push({
      id: 'current_subscribers', kind: 'factor', label: 'Current Pro paying subscribers',
      observed_state: { raw_value: 300, value: 0.015, cap: 20_000, unit: 'subscribers', source: 'brief_extraction' },
    });
    graph.edges.push({ from: 'current_subscribers', to: SUBSCRIBERS });
    expect(ask(graph)).toBeNull();
  });

  it('only reads the graph; does not stamp, rewrite or rescale it', () => {
    const graph = product();
    const before = structuredClone(graph);
    expect(ask(graph)?.text).toBe(Q4);
    expect(graph).toStrictEqual(before);
  });
});

function carrier(): Graph {
  const graph = product(8_000, false);
  const identity = node(graph, GOAL).nonlinear_identity!;
  delete node(graph, GOAL).nonlinear_identity;
  graph.nodes.push({
    id: 'pro_plan_mrr', kind: 'factor', label: 'Pro plan MRR', nonlinear_identity: identity,
    observed_state: { raw_value: 392_000, value: 0.5, unit: 'GBP/month', source: 'cee_inference' },
  });
  graph.edges = [{ from: PRICE, to: 'pro_plan_mrr' }, { from: SUBSCRIBERS, to: 'pro_plan_mrr' }, { from: 'pro_plan_mrr', to: GOAL }];
  return graph;
}

describe('RC5 one coherent product carrier on the goal path', () => {
  it('a sole product carrier on a causal link is NOT the goal\'s definition: fails closed (buddy r2 P1; §(f) Q3)', () => {
    expect(ask(carrier())).toBeNull();
    const sized = carrier();
    (sized.edges.find((e) => e.from === 'pro_plan_mrr') as Record<string, unknown>).strength = { mean: 0.01, std: 0.005 };
    expect(ask(sized)).toBeNull();
  });

  it('one goal with two unconfirmed product carriers fails closed instead of inventing one reading', () => {
    const graph = carrier();
    graph.nodes.push({ ...node(graph, 'pro_plan_mrr'), id: 'other_plan_mrr', label: 'Other plan MRR' });
    graph.edges.push({ from: PRICE, to: 'other_plan_mrr' }, { from: SUBSCRIBERS, to: 'other_plan_mrr' }, { from: 'other_plan_mrr', to: GOAL });
    expect(ask(graph)).toBeNull();
  });

  it('a scoped total cannot be computed from its single product component covering half the total', () => {
    const graph = carrier();
    node(graph, GOAL).goal_scope = {
      modelled: 'All plan revenue', alternative: 'Pro plan revenue only', extent: 'total', stated_in_brief: true,
      source: { quote: 'MRR covers all plans.' },
      component: {
        label: 'Pro plan', rate_id: PRICE, count_id: SUBSCRIBERS, share: 0.5, basis: 'same',
        source: { quote: 'Pro is 50% of all plan revenue.' },
        basis_source: { quote: 'The same monthly billing basis.' },
      },
    };
    expect(ask(graph)).toBeNull();
  });
});

function sum(storedIdentity: boolean): Graph {
  const graph = product();
  const goal = node(graph, GOAL);
  if (storedIdentity) goal.nonlinear_identity = { operation: 'sum', factor_ids: [PRICE, SUBSCRIBERS], stated_in_brief: false };
  else delete goal.nonlinear_identity;
  Object.assign(node(graph, PRICE), { label: 'Pro plan MRR', observed_state: { raw_value: 300_000, value: 0.11, unit: 'GBP/month', source: 'brief_extraction' } });
  Object.assign(node(graph, SUBSCRIBERS), { label: 'Other-plan MRR', observed_state: { raw_value: 92_000, value: 0.22, unit: '£ per month', source: 'user_edited' } });
  return graph;
}

describe('RC5 deterministic sum of parents in the goal\'s own units', () => {
  it('without a definitional sum identity, same-unit parents on causal links are NOT a sum (buddy r1 P1)', () => {
    expect(ask(sum(false))).toBeNull();
  });

  it.each([true])('sum fires with a stored sum identity = %s', (storedIdentity) => {
    const result = ask(sum(storedIdentity));
    expect(result).toMatchObject({ implied: 392_000, ratio: 19.6, target: 20_000 });
    expect(result?.text).toContain('MRR today would be about £390,000, about 20 times your £20,000 target, so the goal would already be met.');
    expect(result?.text).not.toContain("Olumi's reading");
  });

  it('monthly and annual money parents are not a deterministic sum in the goal\'s unit', () => {
    const graph = sum(true);
    level(graph, SUBSCRIBERS).unit = 'GBP/year';
    expect(ask(graph)).toBeNull();
  });

  it('bare money units still reject annual and monthly periods inherited from the node labels', () => {
    const graph = sum(true);
    const goal = node(graph, GOAL);
    goal.label = 'Monthly recurring revenue';
    goal.goal_threshold_unit = 'GBP';
    node(graph, PRICE).label = 'Yearly revenue';
    level(graph, PRICE).unit = 'GBP';
    node(graph, SUBSCRIBERS).label = 'Monthly other revenue';
    level(graph, SUBSCRIBERS).unit = 'GBP';
    expect(ask(graph)).toBeNull();
  });

  it('a sum with an unfigured parent is not computable', () => {
    const graph = sum(false);
    delete level(graph, PRICE).raw_value;
    expect(ask(graph)).toBeNull();
  });
});

describe('RC5 buddy r1 fixes', () => {
  it('re-entering the same figure asks nothing (asked once per value, Science §(f))', () => {
    expect(goalCoherenceAsk(product(8_000), { nodeId: SUBSCRIBERS, previousRaw: 8_000 })).toBeNull();
    expect(goalCoherenceAsk(product(8_000), { nodeId: SUBSCRIBERS, previousRaw: 300 })?.text).toBe(Q4);
  });

  it('the today-level fallback never reads a retained_excluded cause', () => {
    const graph = product(8_000);
    const subs = node(graph, SUBSCRIBERS);
    delete subs.observed_state;
    subs.kind = 'outcome';
    graph.nodes.push({ id: 'cause_subs', kind: 'factor', label: 'Signed-up subscribers', analysis_participation: 'retained_excluded',
      observed_state: { raw_value: 8_000, value: 0.5, unit: 'subscribers', source: 'user_edited' } } as unknown as Node);
    graph.edges.push({ from: 'cause_subs', to: SUBSCRIBERS });
    expect(ask(graph, PRICE)).toBeNull();
  });

  it('a tiny implied level keeps two significant figures instead of "£0"', () => {
    const graph = product(1);
    node(graph, GOAL).goal_direction = '<=';
    level(graph, PRICE).raw_value = 0.0025;
    expect(ask(graph)?.text).toContain('about less than £0.01,');
  });
});

describe('RC5 buddy r2 fixes', () => {
  it.each(['percent', 'percentage', 'pct', '% per month', 'per cent'])('a percentage part (%s) is never a count of the goal\'s units', (unit) => {
    const graph = product(2);
    level(graph, SUBSCRIBERS).unit = unit;
    node(graph, GOAL).goal_direction = '<=';
    expect(ask(graph)).toBeNull();
  });
});

