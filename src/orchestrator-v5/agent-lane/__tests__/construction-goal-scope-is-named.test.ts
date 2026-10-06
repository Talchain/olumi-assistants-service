/**
 * ⛔ C46 — "£20k MRR" MUST NOT SILENTLY BECOME PRO MRR (OR TOTAL MRR).
 *
 * Ruling (ChatGPT #70 5841314428, binding): "£20k MRR scope (Pro MRR vs total MRR) must be
 * clarified or explicitly named before analysis; never silently pick one." MEASURED on Paul's
 * captured brief (runs f-20260925T230446Z, f-20260925T230854Z, f-20260925T231324Z): the goal
 * came back as bare "MRR" while every path into it was Pro price and Pro subscribers — the
 * model measured Pro MRR and called it MRR. The scope question existed only as prose in
 * `open_questions`, and the first pass still ran on "MRR".
 *
 * The drafter DECLARES the scope (`goal.scope`); the build SAYS the modelled scope as OLUMI'S
 * ASSUMPTION, first in `not_represented`, and asks the question once, first, in the existing
 * `open_questions` channel. Never on the node: not in its label (the user's own metric under the
 * brief's provenance — independent verification of 6e33b95e, B2), and not in its description
 * either, because `get_canonical_state` shows a node's description to the Agent as its
 * `full_label` (re-verification of d2362e9d, item e). A brief that states its scope ("total MRR"), or
 * a metric whose own words already name the modelled part ("Pro MRR"), is not asked (N-a). Every candidate passes the REAL strict schema and is served
 * through `buildModelFromBrief` -> `/graph/register` -> `GraphV3.parse`. Bound by node id.
 *
 * ⭐ (b) SUPERSEDES THE PLAIN-TOTAL ASK (Science d5 #87 6006584860 / 6006646752; DL 6 Oct): a goal naming no part ("MRR",
 * "Total MRR") reads as the TOTAL — never Olumi's part-scope, never a withhold — and is said once only where an option adds a
 * part that counts only under the total (`untypedScopeComponents`; rows in `goal-scope-untyped-total.test.ts`). Any other
 * metric may name a part ("Starter MRR", "Non-Pro MRR", "Pro MRR"): it keeps the assumption and the question below (ask (a)),
 * now non-blocking (`metricReadsAsPlainTotal`; Codex buddy r1 P1).
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, buildModelFromBrief, retrySchemaPinningGoal, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { scopeIssueBlocks } from '../goal-scope.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase ' +
  'the Pro plan price from £49 to £59 per month with the next AI feature release?';

type Scope = { modelled: string; alternative: string; stated_in_brief: boolean } | null;

const AMBIGUOUS: Scope = { modelled: 'the Pro plan only', alternative: 'all plans together', stated_in_brief: false };
const STATED_TOTAL: Scope = { modelled: 'all plans together', alternative: 'the Pro plan only', stated_in_brief: true };

function pricing(metric: string, scope: Scope, unknowns: string[] = []): Record<string, unknown> {
  return {
    goal: {
      metric, operator: '>=', target_stated: true, frame: 'level', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope,
    },
    constraints: [],
    options: [
      { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'Pro plan price', to: 'Pro subscribers', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Pro plan price', to: metric, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Pro subscribers', to: metric, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
    ],
    identities: [],
    unknowns,
    decision_question: null,
  };
}

const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Graph = { nodes: { id: string; kind: string; label: string; description?: string; provenance?: string }[]; edges: { from: string; to: string }[] };

async function build(wire: Record<string, unknown>) {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('20202020-2020-4020-8020-202020202020', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return { graph: GraphV3.parse(registered) as unknown as Graph, raw: registered, out };
}

/** What `get_canonical_state` shows the Agent for the registered graph — the product's own read path. */
async function canonicalEntities(raw: unknown): Promise<Record<string, unknown>[]> {
  const d: InternalDispatch = async () => ({ status: 200, json: { graph: raw, graph_hash: 'h1' } });
  const caps = createAgentCapabilities(d, new ProposalStore());
  const r = await caps.getCanonicalState({ scenario_id: '20202020-2020-4020-8020-202020202020', authenticated_user_id: 'u', request_id: 'r' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return (r as unknown as { entities: Record<string, unknown>[] }).entities;
}

const goalOf = (g: Graph) => g.nodes.find((n) => n.kind === 'goal')!;
/**
 * The deadline question staging #1939 asks first for Paul's "within 12 months" (exact sentence, by the goal's metric).
 * G1: this brief writes "12 months", so the goal now HOLDS the deadline and the question says so (`holdStatedGoalAttributes`).
 */
const deadlineQuestion = (metric: string) =>
  `Does "${metric}" get there within 12 months? The model holds the deadline; no result answers that yet.`;
const allQuestions = (out: Record<string, unknown>) => (out.open_questions as string[] | undefined) ?? [];
/** Every open question except the deadline one (#1939), which this brief's 12-month horizon always adds. */
const questions = (out: Record<string, unknown>) => {
  const all = allQuestions(out);
  const deadline = all.filter((q) => /^Does ".*" get there within 12 months\? The model holds the deadline; no result answers that yet\.$/.test(q));
  expect(deadline, JSON.stringify(all)).toHaveLength(1);
  return all.filter((q) => !deadline.includes(q));
};
const notRepresented = (out: Record<string, unknown>) => (out.not_represented as string[] | undefined) ?? [];
const scopeLoss = (m: ReturnType<typeof admitCandidateModel>) => m.loss.filter((l) => /\.goal_scope$/.test(l.field_path));
const SCOPE_ASSUMPTION =
  'The model measures your "MRR" goal for the Pro plan only \u2014 Olumi\'s assumption; the brief does not say whether ' +
  'it covers the Pro plan only or all plans together.';
const SCOPE_QUESTION =
  'The brief does not say whether your "MRR" goal covers the Pro plan only or all plans together, so the model ' +
  'measures it for the Pro plan only. Which did you mean?';

describe('an unstated scope is named in the goal and asked, never silently picked', () => {
  it('(b) (was RED B2): bare "MRR" with the Pro plan modelled: the user\'s label is kept, it reads as the TOTAL, and no part is assumed', async () => {
    const { graph, out } = await build(pricing('MRR', AMBIGUOUS));
    const plain = await build(pricing('MRR', null));
    const goal = graph.nodes.find((n) => n.id === 'mrr')!;
    const before = plain.graph.nodes.find((n) => n.id === 'mrr')!;
    expect(goal.kind).toBe('goal');
    // The label is the user's metric, exactly as with no scope question at all.
    expect(goal.label).toBe('MRR');
    expect(goal.label).toBe(before.label);
    // (e) Not on the node at all: the description is untouched, exactly as with no scope question.
    expect(goal.description).toBeUndefined();
    expect(before.description).toBeUndefined();
    // (b): a plain total is never Olumi's part-scope, and no option here adds a part, so nothing is said or asked —
    // exactly as with no scope question at all.
    const scopeSaid = (o: Record<string, unknown>) => [...notRepresented(o), ...allQuestions(o)].filter((l) => /assumption|Pro plan only|as the total across/.test(l));
    expect(scopeSaid(out)).toEqual([]);
    expect(scopeSaid(plain.out)).toEqual([]);
    expect(questions(out)).toEqual(questions(plain.out));
    // The goal's provenance is untouched: the brief's metric stays the brief's.
    expect(goal.provenance).toBe('from_brief');
    expect(goal.provenance).toBe(before.provenance);
    // Every link still lands on the goal by id.
    expect(graph.edges.filter((e) => e.to === 'mrr').map((e) => e.from).sort()).toEqual(['pro_plan_price', 'pro_subscribers']);
  });

  it('RED (e): get_canonical_state shows the goal as the user\'s metric — its full_label is never Olumi\'s assumption', async () => {
    const { raw } = await build(pricing('MRR', AMBIGUOUS));
    const goal = (await canonicalEntities(raw)).find((e) => e.id === 'mrr')!;
    expect(goal.kind).toBe('goal');
    expect(goal.label).toBe('MRR');
    expect(goal.full_label ?? goal.label).toBe('MRR');
    expect(JSON.stringify(goal)).not.toContain('assumption');
  });

  it('RED (e) CONTROL: a goal whose label had to be shortened shows its full_label as the user\'s own full metric, and nothing else', async () => {
    // Over the 80-character label budget (52f8cd: a brief-length metric is now kept whole, so the control needs a longer one).
    const metric = 'Monthly recurring revenue across every paid plan, net of refunds and discounts, by the end of next year';
    const { raw, out } = await build(pricing(metric, AMBIGUOUS));
    const goal = (await canonicalEntities(raw)).find((e) => e.kind === 'goal')!;
    // The probe sees `full_label` (it is present here), and it is exactly the user's words.
    expect(goal.label).not.toBe(metric);
    expect(goal.full_label).toBe(metric);
    // "… net of refunds and discounts …" is not a plain total, so C46's question stays (non-blocking).
    expect(questions(out)).toHaveLength(1);
  });

  it('(b) (was RED ask-once): a plain total adds no question beside the drafter’s own; a part-named metric is asked ONCE, first', async () => {
    const { out } = await build(pricing('MRR', AMBIGUOUS, ['How price-sensitive are current Pro subscribers?']));
    expect(allQuestions(out)).toEqual([deadlineQuestion('MRR'), 'How price-sensitive are current Pro subscribers?']);
    // Ask (a): "Non-Pro MRR" while the model measures the Pro plan leads, the deadline question second, then the drafter's.
    const part = await build(pricing('Non-Pro MRR', AMBIGUOUS, ['How price-sensitive are current Pro subscribers?']));
    const partQuestion = SCOPE_QUESTION.replace('"MRR"', '"Non-Pro MRR"');
    expect(allQuestions(part.out)).toEqual([partQuestion, deadlineQuestion('Non-Pro MRR'), 'How price-sensitive are current Pro subscribers?']);
    expect(notRepresented(part.out)[0]).toBe(SCOPE_ASSUMPTION.replace('"MRR"', '"Non-Pro MRR"'));
  });

  const withStarterLaunch = (scope: Scope): Record<string, unknown> => {
    const wire = pricing('MRR', scope);
    (wire.options as unknown[]).push({ label: 'Launch a Starter tier at £19', provenance: 'explicit', is_status_quo: null, changes: [],
      interventions: [{ factor_label: 'Starter plan price', value: 19, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] });
    (wire.factors as unknown[]).push(
      // No Starter tier today: its price starts at £0, so "Keep Pro at £49" holding it is no baseline path (served T1b shape).
      { label: 'Starter plan price', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Starter subscribers', role: 'observable', baseline_known: false, baseline_value: 0, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 });
    (wire.links as unknown[]).push(
      { from: 'Starter plan price', to: 'Starter subscribers', direction: 'negative', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null },
      { from: 'Starter subscribers', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
    return wire;
  };

  it('(b) MATERIAL: an option that adds a tier only the total counts is disclosed ONCE, in Science\'s words, and never gates', async () => {
    const { out } = await build(withStarterLaunch(AMBIGUOUS));
    const words = 'I’ve read your goal, ‘MRR’, as the total across every tier, including ‘Starter subscribers’. If you meant only part of it, say which.';
    expect(allQuestions(out)[0]).toBe(words);
    // Said ONCE across every channel the reply is written from, and never as Olumi's part-scope.
    expect([...allQuestions(out), ...notRepresented(out)].filter((l) => l === words)).toHaveLength(1);
    expect(notRepresented(out).filter((l) => /assumption|Pro plan only/.test(l))).toEqual([]);
    // The ONE answer channel carries the same words, and it is untyped: it never gates the Run, the licence or a write.
    const pa = (out.pending_action as { action: { kind: string; expected: string; scope?: unknown; question: string } }).action;
    expect(pa).toMatchObject({ kind: 'reconcile_goal_scope', expected: 'scope', question: words });
    expect(pa.scope).toBeUndefined();
    expect(scopeIssueBlocks(pa)).toBe(false);
  });

  it('(b) MATERIAL with NO drafter declaration (Science d5 #87 6007341975 (2)): goal.scope null + a Starter tier created → disclosed', async () => {
    const { out } = await build(withStarterLaunch(null));
    const words = 'I’ve read your goal, ‘MRR’, as the total across every tier, including ‘Starter subscribers’. If you meant only part of it, say which.';
    expect(allQuestions(out)[0]).toBe(words);
    expect((out.pending_action as { action: { question: string; declared_scope?: unknown } }).action).toMatchObject({ question: words });
    // Control: a scope the BRIEF states is the user's reading, not Olumi's — nothing is said.
    expect(allQuestions((await build(withStarterLaunch(STATED_TOTAL))).out).filter((q) => q.includes('as the total across'))).toEqual([]);
  });

  it('RED: admission records the choice as a warning on the goal, with both readings', () => {
    const [entry, ...more] = scopeLoss(admitCandidateModel(pricing('MRR', AMBIGUOUS) as unknown as CandidateModel));
    expect(more).toEqual([]);
    expect(entry?.field_path).toBe('nodes[mrr].goal_scope');
    expect(entry?.severity).toBe('warn');
    expect(entry?.before).toEqual({ metric: 'MRR', modelled: 'the Pro plan only', alternative: 'all plans together' });
    expect(entry?.after).toBe(SCOPE_ASSUMPTION);
    expect(entry?.reason).toBe(SCOPE_QUESTION);
  });

  it('RED (N-a): a metric whose own words already name the modelled part ("Pro MRR") is the scope stated — no question, no assumption', async () => {
    for (const metric of ['Pro MRR', 'MRR for the Pro plan only']) {
      const { graph, out } = await build(pricing(metric, AMBIGUOUS));
      expect(goalOf(graph).label, metric).toBe(metric);
      expect(goalOf(graph).description, metric).toBeUndefined();
      expect(questions(out), metric).toEqual([]);
      expect(scopeLoss(admitCandidateModel(pricing(metric, AMBIGUOUS) as unknown as CandidateModel)), metric).toEqual([]);
    }
  });

  it('(b) (was CONTROL N-a): "Total MRR" while the model measures the Pro plan reads as the total — no assumption, no question', async () => {
    const { graph, out } = await build(pricing('Total MRR', AMBIGUOUS));
    expect(goalOf(graph).label).toBe('Total MRR');
    expect(notRepresented(out).filter((l) => l.includes('assumption'))).toEqual([]);
    expect(questions(out)).toEqual([]);
  });

  it('CONTROL (N-a): a metric with only SOME of the modelled scope\'s words, or with the alternative\'s too, is still asked', async () => {
    const europe: Scope = { modelled: 'the Pro plan in Europe', alternative: 'all plans worldwide', stated_in_brief: false };
    const cases: [string, Scope][] = [['Pro MRR', europe], ['MRR across all plans, Pro included', AMBIGUOUS]];
    for (const [metric, scope] of cases) {
      const { out } = await build(pricing(metric, scope));
      expect(questions(out), metric).toHaveLength(1);
      expect(scopeLoss(admitCandidateModel(pricing(metric, scope) as unknown as CandidateModel)), metric).toHaveLength(1);
    }
  });

  it('ask (a) (Codex buddy r1 P1): a metric naming an ORDINARY part the model does not measure ("Starter MRR") is still asked', async () => {
    const { out } = await build(pricing('Starter MRR', AMBIGUOUS));
    expect(questions(out)).toEqual([SCOPE_QUESTION.replace('"MRR"', '"Starter MRR"')]);
    expect(notRepresented(out)[0]).toBe(SCOPE_ASSUMPTION.replace('"MRR"', '"Starter MRR"'));
    // …and it never gates: the answer channel is the untyped question.
    const pa = (out.pending_action as { action: { expected: string; scope?: unknown } }).action;
    expect(scopeIssueBlocks(pa as { kind: string; expected: string; scope?: unknown })).toBe(false);
  });

  it('(b): only a metric made of whole/measure/period words reads as the total — each is neither asked nor assumed', async () => {
    for (const metric of ['MRR', 'Total MRR', 'monthly recurring revenue', 'Total monthly recurring revenue across all plans', '£20k MRR']) {
      const { out } = await build(pricing(metric, AMBIGUOUS));
      expect(questions(out), JSON.stringify(allQuestions(out))).toEqual([]);
      expect(notRepresented(out).filter((l) => l.includes('assumption')), metric).toEqual([]);
    }
  });

  it('(b) (Codex buddy r1 P2): the drafter\'s own restatement of the part-or-whole question is not asked beside a total reading', async () => {
    const restated = 'Does "MRR" mean the Pro plan only or all plans together?';
    const { out } = await build(pricing('MRR', AMBIGUOUS, [restated, 'How price-sensitive are current Pro subscribers?']));
    expect(questions(out)).toEqual(['How price-sensitive are current Pro subscribers?']);
    // Contrast: with no declared scope the drafter's question is its own, and it stays.
    expect(questions((await build(pricing('MRR', null, [restated]))).out)).toEqual([restated]);
  });

  it('RED (a): a COMPLEMENT metric — the part the model does NOT measure — never counts as the modelled scope stated', async () => {
    for (const metric of ['Non-Pro MRR', 'MRR excluding Pro', 'MRR from plans other than Pro', 'MRR except Pro', 'MRR without Pro']) {
      const { graph, out } = await build(pricing(metric, AMBIGUOUS));
      expect(goalOf(graph).label, metric).toBe(metric);
      expect(questions(out), metric).toHaveLength(1);
      expect(questions(out)[0], metric).toContain('covers the Pro plan only or all plans together');
      expect(scopeLoss(admitCandidateModel(pricing(metric, AMBIGUOUS) as unknown as CandidateModel)), metric).toHaveLength(1);
    }
  });

  it('CONTROL (a): a complement word that is PART of the modelled scope still states it ("plans other than Pro")', async () => {
    const others: Scope = { modelled: 'plans other than Pro', alternative: 'all plans together', stated_in_brief: false };
    const { out } = await build(pricing('MRR from plans other than Pro', others));
    expect(questions(out)).toEqual([]);
    expect(scopeLoss(admitCandidateModel(pricing('MRR from plans other than Pro', others) as unknown as CandidateModel))).toEqual([]);
    // …and a metric that names the complement of THAT scope ("Pro MRR") is asked.
    expect(questions((await build(pricing('Pro MRR', others))).out)).toHaveLength(1);
  });

  it('RED (N-d): the drafter is no longer told to keep the scope question out of `unknowns` (nothing enforces it yet)', () => {
    expect(BUILD_INSTRUCTIONS).toContain('NEVER PICK THE SCOPE OF THE GOAL SILENTLY.');
    expect(BUILD_INSTRUCTIONS).not.toContain('do not repeat that question');
  });

  it('naming the scope adds no readiness blocker', async () => {
    const named = await build(pricing('MRR', AMBIGUOUS));
    const plain = await build(pricing('MRR', null));
    const codes = (g: unknown) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => i.code).sort();
    expect(codes(named.graph)).toEqual(codes(plain.graph));
  });
});

describe('controls: a stated scope, or no scope question at all, changes nothing', () => {
  it('CONTROL: "total MRR" stated in the brief: no question, no rename, no ledger entry', async () => {
    const { graph, out } = await build(pricing('Total MRR', STATED_TOTAL));
    expect(goalOf(graph).label).toBe('Total MRR');
    expect(questions(out)).toEqual([]);
    expect(scopeLoss(admitCandidateModel(pricing('Total MRR', STATED_TOTAL) as unknown as CandidateModel))).toEqual([]);
  });

  it('CONTROL: scope null (a metric with no part-or-whole reading): no question, no rename', async () => {
    const { graph, out } = await build(pricing('MRR', null));
    expect(goalOf(graph).label).toBe('MRR');
    expect(questions(out)).toEqual([]);
  });
});

describe('the contract: the scope is required, and a compaction retry cannot change it', () => {
  it('RED: strict output must say "no scope question" (null) rather than omit the key', () => {
    const wire = pricing('MRR', null);
    const { scope: _dropped, ...goalWithout } = wire.goal as Record<string, unknown>;
    expect(strict({ ...wire, goal: goalWithout })).toBe(false);
  });

  it('RED: the retry pins the declared scope, and still accepts a null one', () => {
    const goal = pricing('MRR', AMBIGUOUS).goal as unknown as CandidateModel['goal'];
    const pinned = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(goal));
    expect(pinned(pricing('MRR', AMBIGUOUS)), JSON.stringify(pinned.errors)).toBe(true);
    expect(pinned(pricing('MRR', STATED_TOTAL)), 'the retry cannot switch to the other reading').toBe(false);
    expect(pinned(pricing('MRR', null)), 'nor drop the question').toBe(false);
    const pinnedNull = new Ajv({ strict: false }).compile(retrySchemaPinningGoal(pricing('MRR', null).goal as unknown as CandidateModel['goal']));
    expect(pinnedNull(pricing('MRR', null)), JSON.stringify(pinnedNull.errors)).toBe(true);
  });
});
