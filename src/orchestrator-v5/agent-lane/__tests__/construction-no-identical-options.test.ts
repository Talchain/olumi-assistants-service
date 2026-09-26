/**
 * ⛔ CONSTRUCTION NEVER RETURNS OPTIONS THAT ARE IDENTICAL BY CONSTRUCTION
 * (Delivery Lead, olumi-programme-docs #70 5842361028 and 5842400604 — MG (b)).
 *
 * MEASURED on served CEE ef99a97 (`f-20260926T020217Z`) and cb1778b (`f-20260926T022404Z`), Paul's
 * pricing brief: the drafter added "Test £59 with AI release" (ai_inferred, NO level, acting on the
 * same two factors) beside the user's £59 option. The user approved the starting point, the fill gave
 * both the same levels, and the run refused `NOTHING_TO_COMPARE` ×2 with `may_run: false`. 2 of the 29
 * served first passes in that corpus (scanned 26 Sep 03:11Z) carry that shape; no other first pass does.
 *
 * The corpus is the SERVED drafts, copied read-only into `fixtures/served-option-identity-20260926.json`.
 * Each candidate here is the served `draft_graph` projected back into the strict construction contract
 * (`candidateFromServed`), and a FIDELITY row proves the projection: the rebuilt graph registers the
 * served graph node for node and edge for edge. Everything runs through the real path: strict schema ->
 * `buildModelFromBrief` (faked drafter) -> `/graph/register` body -> `GraphV3.parse` -> readiness /
 * run admission. Assertions bind by option id, exact label, exact reason code and exact sentence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, BUILD_INSTRUCTIONS, type CallStructuredModel } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { assessConstructionSize, COMPACT_LIMITS } from '../construction-size-gate.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { resolveRunAdmission, NO_COMPARISON_NEXT_STEP } from '../../tools/handlers/analysis-ready-core.js';
import { labelMatchesBaseline } from '../../../cee/transforms/analysis-ready.js';

// ── the served corpus ────────────────────────────────────────────────────────
type Level = { value: number; source?: string };
type SNode = {
  id: string; kind: string; label: string; provenance?: string; is_baseline?: boolean; description?: string;
  interventions?: Record<string, Level>; category?: string; scale_frame?: number;
  observed_state?: { value?: number; raw_value?: number; cap?: number; unit?: string; source?: string };
  goal_threshold_raw?: number; goal_threshold_unit?: string;
};
type SEdge = { from: string; to: string; origin?: string; effect_direction?: string; provenance?: { source?: string } };
type SConstraint = { label: string; operator: string; value: number; unit: string; provenance: string; provenance_unit_relabelled?: { pre_normalisation_unit?: string; pre_normalisation_value?: number } };
type SGraph = { nodes: SNode[]; edges: SEdge[]; goal_constraints?: SConstraint[] };
type Turn = { message: string; draft_graph: SGraph; assistant_text: string; may_run: boolean | null; nothing_to_compare_count: number };
type Run = { cee: string; brief: Turn; approve: Turn };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-option-identity-20260926.json', import.meta.url), 'utf8')) as { runs: Record<string, Run> };
const SHAPE_1 = SERVED.runs['f-20260926T020217Z']!;   // CEE ef99a97 — dead start
const SHAPE_2 = SERVED.runs['f-20260926T022404Z']!;   // CEE cb1778b — dead start
const PHASED_54 = SERVED.runs['f-20260926T001627Z']!; // CEE 85ce874 — Olumi "Raise to £54 with release", ran
const AT_49 = SERVED.runs['f-20260926T022612Z']!;     // CEE cb1778b — Olumi "£49 with AI release", ran
const TEST_ID = 'test_59_with_ai_release';

/**
 * The served graph, projected back into the strict construction contract. Every field is read off the
 * served graph: a factor's frame is its `observed_state.cap` or `scale_frame`; a level is the stored
 * value times that frame; an option -> factor edge stamped `brief_extraction` was a user restatement.
 * `olumi` is the drafter's provenance for an option shown `ai_inferred` — the graph cannot tell
 * `inferred` from `ai_proposed`, so rows run BOTH.
 */
function candidateFromServed(g: SGraph, opts: { olumi?: 'ai_proposed' | 'inferred'; horizon?: number | null; unknowns?: string[] } = {}): CandidateModel & { unknowns: string[] } {
  const byId = new Map(g.nodes.map((n) => [n.id, n] as const));
  const prov = (n: { provenance?: string }, olumi = 'ai_proposed') => (n.provenance === 'from_brief' ? 'explicit' : olumi);
  const frameOf = (n: SNode) => n.observed_state?.cap ?? n.scale_frame ?? 1;
  const unitOf = (n: SNode) => n.observed_state?.unit ?? null;
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const goal = g.nodes.find((n) => n.kind === 'goal')!;
  const factors = g.nodes.filter((n) => n.kind === 'factor');
  const optionEdges = (id: string) => g.edges.filter((e) => e.from === id && byId.get(e.to)?.kind === 'factor' && e.origin !== 'repair');
  return {
    goal: {
      metric: goal.label, operator: '>=', target_stated: true, value: goal.goal_threshold_raw ?? null, unit: goal.goal_threshold_unit ?? '',
      horizon_months: opts.horizon === undefined ? 12 : opts.horizon, provenance: 'explicit',
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit',
    },
    constraints: (g.goal_constraints ?? []).map((c) => ({
      metric: c.label, operator: c.operator, value: c.provenance_unit_relabelled?.pre_normalisation_value ?? c.value,
      unit: c.provenance_unit_relabelled?.pre_normalisation_unit ?? c.unit, provenance: c.provenance === 'explicit' ? 'explicit' : 'ai_proposed',
    })),
    options: g.nodes.filter((n) => n.kind === 'option').map((o) => {
      const levels = Object.entries(o.interventions ?? {});
      return {
        label: o.description ?? o.label,
        provenance: prov(o, opts.olumi),
        changes: optionEdges(o.id).map((e) => e.to).filter((f) => !(f in (o.interventions ?? {}))).map((f) => byId.get(f)!.label),
        interventions: levels.map(([f, lv]) => ({
          factor_label: byId.get(f)!.label, value: round(lv.value * frameOf(byId.get(f)!)), value_kind: 'absolute',
          unit: unitOf(byId.get(f)!) ?? '', provenance: lv.source === 'brief_extraction' ? 'explicit' : 'ai_proposed',
        })),
        is_status_quo: o.is_baseline === true ? true : null,
      };
    }),
    factors: factors.map((f) => {
      const os = f.observed_state;
      const estimated = os?.source === 'cee_inference';
      const baseline = os === undefined ? null : (os.raw_value ?? os.value ?? null);
      return {
        label: f.label, role: (f.category ?? 'observable') as 'controllable' | 'observable' | 'external',
        baseline_known: os !== undefined && !estimated, baseline_value: baseline, unit: unitOf(f),
        provenance: prov(f), plausible_max: frameOf(f),
      };
    }),
    risks: g.nodes.filter((n) => n.kind === 'risk').map((r) => ({ label: r.label, provenance: prov(r) })),
    outcomes: g.nodes.filter((n) => n.kind === 'outcome').map((r) => ({ label: r.label, provenance: prov(r) })),
    links: [
      // A user restatement of an option -> factor connection (the edge carries `brief_extraction`).
      ...g.edges.filter((e) => byId.get(e.from)?.kind === 'option' && e.origin !== 'repair' && e.provenance?.source === 'brief_extraction')
        .map((e) => ({ from: byId.get(e.from)!.label, to: byId.get(e.to)!.label, direction: 'positive', provenance: 'explicit' })),
      ...g.edges.filter((e) => !['option', 'decision'].includes(byId.get(e.from)?.kind ?? ''))
        .map((e) => ({ from: byId.get(e.from)!.label, to: byId.get(e.to)!.label, direction: e.effect_direction ?? 'positive',
          provenance: e.provenance?.source === 'brief_extraction' ? 'explicit' : 'inferred' })),
    ],
    unknowns: opts.unknowns ?? [],
  } as unknown as CandidateModel & { unknowns: string[] };
}

/**
 * The drafter's `unknowns`, as far as the served reply shows them. Each shown question is checked
 * against the served text below; the ones the reply cut ("(and N more)") are named as not captured.
 */
const UNKNOWNS_1 = [
  'Current MRR is not stated; it is required to estimate the probability of reaching £20k MRR within 12 months, but has not been estimated.',
  'Current monthly churn is not stated; it must be measured against the under-10% monthly constraint.',
  'Current number of Pro plan subscribers is not stated; this is required to quantify the direct MRR effect of changing the Pro plan price.',
  'Current new-Pro-plan conversion rate is not stated; this is needed to estimate whether the AI release offsets any price-related conversion loss.',
  '[not in the capture: 1 of 3 cut by "(and 3 more)"]', '[not in the capture: 2 of 3]', '[not in the capture: 3 of 3]',
];
const UNKNOWNS_2 = [
  'Current MRR is not stated, so the probability of reaching £20k MRR cannot yet be calculated from a known starting point.',
  'The provisional baselines for AI Feature Value (50/100), Upgrade Conversion (5%), Pro Plan Subscribers (250), and Monthly Churn (7% per month) are modelling assumptions, not measurements; replace them with current data before adopting a price decision.',
  'How much will the next AI feature release improve perceived value, upgrade conversion, and retention?',
  'What share of current and prospective Pro customers would resist, downgrade, or churn at £59, and will existing subscribers be grandfathered?',
  '[not in the capture: 1 of 1 cut by "(and 1 more)"]',
];

// ── the real path ────────────────────────────────────────────────────────────
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
const BRIEF = SHAPE_1.brief.message;

async function build(...drafts: (CandidateModel & { unknowns: string[] })[]) {
  for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
  let body: { graph: unknown } | null = null;
  let calls = 0;
  const call = (async () => ({ text: JSON.stringify(drafts[Math.min(calls++, drafts.length - 1)]) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone(b as { graph: unknown }); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const graph = GraphV3.parse((body as unknown as { graph: unknown }).graph) as unknown as SGraph;
  return { out, graph, calls };
}

const withoutOption = (g: SGraph, id: string): SGraph => ({
  ...g, nodes: g.nodes.filter((n) => n.id !== id), edges: g.edges.filter((e) => e.from !== id && e.to !== id),
});
/**
 * A limit as the served build wrote it. #1934 (274cd885e, after ef99a97 and 85ce874) relabels a limit's
 * unit to its node's scale and keeps the stated unit in `provenance_unit_relabelled`; that is a later
 * commit's change, not this reconstruction's, so the stated unit is compared.
 */
const statedLimits = (g: SGraph) => (g.goal_constraints ?? []).map((c) => ({
  node_id: (c as unknown as { node_id: string }).node_id, operator: c.operator, provenance: c.provenance,
  value: c.provenance_unit_relabelled?.pre_normalisation_value ?? c.value, unit: c.provenance_unit_relabelled?.pre_normalisation_unit ?? c.unit,
}));

/**
 * ⭐ WHAT BASE REGISTERS, BYTE FOR BYTE. The served graphs above came back through the store, which
 * reorders keys (JSONB), so they can prove content but never bytes. These are the `/graph/register`
 * bodies origin/staging cb1778b86cc8f5c1d17285af366cc1909bab658b wrote for the same four drafts, made by
 * the one-off generator recorded at the bottom of this file, BEFORE the rule existed.
 */
const BASE_FIXTURE = new URL('./fixtures/staging-cb1778b-registered-graphs.json', import.meta.url);
const BASE = (() => {
  try { return JSON.parse(readFileSync(BASE_FIXTURE, 'utf8')) as { head: string; graphs: Record<string, string> }; } catch { return null; }
})();
const baseGraph = (key: string): SGraph => JSON.parse(BASE!.graphs[key]!) as SGraph;
const optionIds = (g: SGraph) => g.nodes.filter((n) => n.kind === 'option').map((n) => n.id);
const questions = (out: Record<string, unknown>) => (out.open_questions ?? []) as string[];
const statusLine = (out: Record<string, unknown>) =>
  narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [out as { ok: boolean; mutated: boolean }]).status ?? '';
/** Of the questions the server appends, the ones it SHOWS (write-outcome.ts caps them at five). */
const shownQuestions = (out: Record<string, unknown>) => questions(out).slice(0, 5);

/** The step, word for word. Never the user's words: "as drafted" is Olumi's draft. */
const STEP_1 = 'I left out "Test £59 with AI release" as a separate option: as drafted it sets nothing the model can hold that "£59 with AI release" does not — a test, pilot or staged rollout needs its own level on a factor the model holds. It stays open as a next step.';
const STEP_2 = 'I left out "Test £59 With AI Release" as a separate option: as drafted it sets nothing the model can hold that "Raise Pro Price to £59" does not — a test, pilot or staged rollout needs its own level on a factor the model holds. It stays open as a next step.';
const HORIZON = 'Does "MRR" get there within 12 months? The model holds no deadline yet, so no result answers that.';

/**
 * The starting point's fill, as it ran on the wire: every option level left open is filled from the SAME
 * source — the level a sibling option already sets on that factor, else one common proposed level.
 */
function fillFromSameSource(g: SGraph, common: Record<string, number>): SGraph {
  const next = structuredClone(g);
  const byId = new Map(next.nodes.map((n) => [n.id, n] as const));
  const options = next.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true);
  for (const o of options) {
    for (const e of next.edges.filter((x) => x.from === o.id && byId.get(x.to)?.kind === 'factor' && x.origin !== 'repair')) {
      if (o.interventions?.[e.to] !== undefined) continue;
      const sibling = options.find((p) => p.id !== o.id && p.interventions?.[e.to] !== undefined);
      const value = sibling?.interventions?.[e.to]?.value ?? common[e.to];
      if (value === undefined) continue;
      o.interventions = { ...(o.interventions ?? {}), [e.to]: { value, source: 'cee_hypothesis' } };
    }
  }
  return next;
}
/** PLoT's own identity for an option (`analysis-ready-core.ts` comparisonSurvivesDedup): sorted `id:value`, snapped to 1e-9. */
const fingerprint = (n: SNode) => Object.entries(n.interventions ?? {}).map(([k, v]) => `${k}:${Math.round(v.value / 1e-9)}`).sort().join('|');
const levelsById = (g: SGraph) => Object.fromEntries(g.nodes.filter((n) => n.kind === 'option').map((n) => [n.id, Object.fromEntries(Object.entries(n.interventions ?? {}).map(([k, v]) => [k, v.value]))]));

// ── served shapes ────────────────────────────────────────────────────────────
describe.each([
  { name: 'served shape 1 (f-20260926T020217Z, CEE ef99a97)', key: 'f-20260926T020217Z', run: SHAPE_1, unknowns: UNKNOWNS_1, step: STEP_1, olumi: 'ai_proposed' as const, twin: '59_with_ai_release', sq: 'keep_current_pricing', common: { ai_feature_availability: 1 } as Record<string, number> },
  { name: 'served shape 2 (f-20260926T022404Z, CEE cb1778b)', key: 'f-20260926T022404Z', run: SHAPE_2, unknowns: UNKNOWNS_2, step: STEP_2, olumi: 'inferred' as const, twin: 'raise_pro_price_to_59', sq: 'keep_pro_price_at_49', common: { ai_feature_value: 0.65 } as Record<string, number> },
])('$name', ({ key, run, unknowns, step, olumi, twin, sq, common }) => {
  const draft = () => candidateFromServed(run.brief.draft_graph, { olumi, unknowns });

  it('vacuity: the served turn is the dead start (first pass may_run false; approval NOTHING_TO_COMPARE, may_run false)', () => {
    expect([run.brief.may_run, run.approve.may_run, run.approve.nothing_to_compare_count]).toEqual([false, false, 2]);
    expect(optionIds(run.brief.draft_graph)).toContain(TEST_ID);
    for (const q of unknowns.filter((u) => !u.startsWith('[not in the capture'))) expect(run.brief.assistant_text).toContain(q);
  });

  it('FIDELITY: the reconstruction registers the served graph exactly, apart from the Olumi-added test option', async () => {
    const { graph } = await build(draft());
    const served = run.brief.draft_graph;
    expect(withoutOption(graph, TEST_ID).nodes).toEqual(withoutOption(served, TEST_ID).nodes);
    expect(withoutOption(graph, TEST_ID).edges).toEqual(withoutOption(served, TEST_ID).edges);
    expect(statedLimits(graph)).toEqual(statedLimits(served));
  });

  it('RED: everything else is byte-identical to what base registers — only the test option and its edges are gone', async () => {
    const { graph } = await build(draft());
    const base = baseGraph(key);
    expect(optionIds(base)).toContain(TEST_ID);
    expect(JSON.stringify(graph)).toBe(JSON.stringify(withoutOption(base, TEST_ID)));
  });

  it('RED: the Olumi-added test option is not registered — no node, no edge', async () => {
    const { graph, out } = await build(draft());
    expect(optionIds(graph)).toEqual(optionIds(withoutOption(run.brief.draft_graph, TEST_ID)));
    expect(graph.edges.filter((e) => e.from === TEST_ID || e.to === TEST_ID)).toEqual([]);
    expect(out.options).toBe(2);
  });

  it('RED: the reason is on the result — option_indistinct, naming the option it cannot be told from', async () => {
    const { out } = await build(draft());
    const label = run.brief.draft_graph.nodes.find((n) => n.id === TEST_ID)!.label;
    const like = run.brief.draft_graph.nodes.find((n) => n.id === twin)!.label;
    expect(out.options_withheld).toEqual([{ option: label, like, reason: 'option_indistinct' }]);
  });

  it('RED: the step is said where the user always sees it — shown, after the deadline question, word for word', async () => {
    const { out } = await build(draft());
    expect(questions(out).slice(0, 2)).toEqual([HORIZON, step]);
    expect(shownQuestions(out)).toContain(step);
    expect(statusLine(out)).toContain(`Questions this model does not answer yet: ${HORIZON} ${step}`);
  });

  it('RED: the options that remain are distinct — the status quo holds, the user\'s option sets a level', async () => {
    const { graph } = await build(draft());
    const remaining = graph.nodes.filter((n) => n.kind === 'option');
    expect(remaining.map((n) => [n.id, fingerprint(n)])).toEqual([[sq, ''], [twin, 'pro_plan_price:295000000']]);
    // The held status quo is untouched: the same node and the same held edges as served.
    const servedSq = run.brief.draft_graph;
    expect(graph.nodes.find((n) => n.id === sq)).toEqual(servedSq.nodes.find((n) => n.id === sq));
    expect(graph.edges.filter((e) => e.from === sq)).toEqual(servedSq.edges.filter((e) => e.from === sq));
  });

  it('CONTRAST (the fill is the wire): the same-source fill on the served draft reproduces the served identical pair', () => {
    const filled = levelsById(fillFromSameSource(run.brief.draft_graph, common));
    const served = levelsById(run.approve.draft_graph);
    expect(filled[TEST_ID]).toEqual(served[TEST_ID]);
    expect(filled[twin]).toEqual(served[twin]);
    expect(served[TEST_ID]).toEqual(served[twin]);
  });

  it('RED: after that same fill, every remaining option is still distinct by PLoT\'s own identity', async () => {
    const { graph } = await build(draft());
    const filled = fillFromSameSource(graph, common);
    const valued = filled.nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true);
    const prints = valued.map(fingerprint);
    expect(prints.every((p) => p !== '')).toBe(true);
    expect(new Set(prints).size).toBe(prints.length);
  });

  it('RECORDED LIMIT: withholding alone does not make this brief run — the approved served model minus the test option still has one valued option', () => {
    const cut = withoutOption(run.approve.draft_graph, TEST_ID);
    const admission = resolveRunAdmission(cut);
    expect([admission.willProceed, admission.strict.status, admission.blockedNextStep]).toEqual([false, 'analysis_ready', NO_COMPARISON_NEXT_STEP]);
  });
});

// ── controls ─────────────────────────────────────────────────────────────────
describe('controls — what the rule must never touch', () => {
  it.each([
    ['Phased £54 (f-20260926T001627Z, CEE 85ce874): the Olumi-added "Raise to £54 with release" sets a distinct known level', 'f-20260926T001627Z', PHASED_54, 'raise_to_54_with_release'],
    ['£49 with AI release (f-20260926T022612Z, CEE cb1778b): its price equals today and its AI level equals £59\'s, yet no option matches it on both', 'f-20260926T022612Z', AT_49, '49_with_ai_release'],
  ])('CONTROL %s — kept; the served graph, and base\'s registration byte for byte', async (_name, key, run, olumiId) => {
    expect(run.brief.may_run).toBe(true);
    const { graph, out } = await build(candidateFromServed(run.brief.draft_graph, { olumi: 'ai_proposed', horizon: null }));
    expect(optionIds(graph)).toContain(olumiId);
    expect(graph.nodes).toEqual(run.brief.draft_graph.nodes);
    expect(graph.edges).toEqual(run.brief.draft_graph.edges);
    expect(JSON.stringify(graph)).toBe(BASE!.graphs[key]);
    expect(out).not.toHaveProperty('options_withheld');
    expect(questions(out).filter((q) => q.startsWith('I left out ') || q.startsWith('What makes '))).toEqual([]);
  });

  it('CONTROL (the served approval that ran): the Phased £54 model, once filled, is admitted to run', () => {
    expect(resolveRunAdmission(PHASED_54.approve.draft_graph).willProceed).toBe(true);
  });

  it('CONTROL: two USER options identical by construction are both kept, with ONE question asking what tells them apart', async () => {
    const both = candidateFromServed(SHAPE_1.brief.draft_graph, { unknowns: UNKNOWNS_1 });
    const userTest = { ...both, options: both.options.map((o) => (o.label === 'Test £59 with AI release' ? { ...o, provenance: 'explicit' } : o)) } as typeof both;
    const { graph, out } = await build(userTest);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release', TEST_ID]);
    expect(out).not.toHaveProperty('options_withheld');
    const asked = questions(out).filter((q) => q.startsWith('What makes '));
    expect(asked).toEqual(['What makes "£59 with AI release" different from "Test £59 with AI release"? As drafted, nothing the model holds tells them apart, so the analysis cannot compare them yet.']);
    expect(questions(out)[1]).toBe(asked[0]);
  });

  it('CONTROL: a user-stated option is never withheld, even when it holds no level at all', async () => {
    const both = candidateFromServed(SHAPE_2.brief.draft_graph, { unknowns: UNKNOWNS_2 });
    const userTest = { ...both, options: both.options.map((o) => (o.label === 'Test £59 With AI Release' ? { ...o, provenance: 'explicit' } : o)) } as typeof both;
    const { graph } = await build(userTest);
    const test = graph.nodes.find((n) => n.id === TEST_ID);
    expect([test?.label, test?.provenance, test?.interventions]).toEqual(['Test £59 With AI Release', 'from_brief', undefined]);
  });

  /**
   * ⛔ THE STATUS QUO IS NOT "TODAY'S VALUE" FOR THIS RULE — MEASURED. The held status quo's map is empty and the
   * comparison floor does not count it, so an Olumi option that only restates today's level is the VALUED
   * comparator the run needs. Withholding it would create the dead start this rule exists to remove.
   */
  it('CONTROL: an Olumi option that only restates TODAY\'s level is kept — it is the comparator the run counts, and the status quo is not', async () => {
    const label = '£49 until next quarter';
    expect(labelMatchesBaseline(label)).toBe(false);
    const base = candidateFromServed(SHAPE_2.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: base.options.map((o) => (o.label !== 'Test £59 With AI Release' ? o : {
      ...o, label, changes: [], interventions: [{ factor_label: 'Pro Plan Price', value: 49, value_kind: 'absolute', unit: '£ per month', provenance: 'ai_proposed' }],
    })) } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_pro_price_at_49', 'raise_pro_price_to_59', '49_until_next_quarter']);
    expect(graph.nodes.find((n) => n.id === '49_until_next_quarter')?.interventions).toEqual({ pro_plan_price: { value: 0.245, source: 'cee_hypothesis' } });
    expect(out).not.toHaveProperty('options_withheld');
    // The run, on the served approved model: that option set to today's price alone PROCEEDS; without it, it does not.
    const approved = structuredClone(SHAPE_2.approve.draft_graph);
    const twin = approved.nodes.find((n) => n.id === TEST_ID)!;
    twin.interventions = { pro_plan_price: { value: 0.245, source: 'cee_hypothesis' } };
    approved.edges = approved.edges.filter((e) => !(e.from === TEST_ID && e.to !== 'pro_plan_price'));
    expect(resolveRunAdmission(approved).willProceed).toBe(true);
    expect(resolveRunAdmission(withoutOption(approved, TEST_ID)).willProceed).toBe(false);
  });

  it('CONTROL: the status quo is never withheld — a declared status quo acting on the same factors as the user\'s option, with no level, is kept', async () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: base.options
      .filter((o) => o.label !== 'Test £59 with AI release')
      .map((o) => (o.label !== 'Keep current pricing' ? o : { ...o, changes: ['Pro plan price', 'AI feature availability'] })) } as typeof base;
    // Vacuity: as drafted it acts on exactly the user's option's factors with no level — the withheld shape, but the status quo.
    expect(draft.options.find((o) => o.label === 'Keep current pricing')).toMatchObject({ is_status_quo: true, provenance: 'ai_proposed', interventions: [] });
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(out).not.toHaveProperty('options_withheld');
  });

  it('RED: an Olumi option that sets the SAME known level as the user\'s option (and nothing else known) is withheld', async () => {
    const base = candidateFromServed(SHAPE_2.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: base.options.map((o) => (o.label !== 'Test £59 With AI Release' ? o : {
      ...o, changes: ['AI Feature Value'], interventions: [{ factor_label: 'Pro Plan Price', value: 59, value_kind: 'absolute', unit: '£ per month', provenance: 'ai_proposed' }],
    })) } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).not.toContain(TEST_ID);
    expect(out.options_withheld).toEqual([{ option: 'Test £59 With AI Release', like: 'Raise Pro Price to £59', reason: 'option_indistinct' }]);
  });

  it('CONTROL: an Olumi option that acts, with no level yet, on a factor the status quo holds and differs from the user\'s option on price is kept', async () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: base.options.map((o) => (o.label !== 'Test £59 with AI release' ? o : {
      ...o, label: 'AI release only', changes: ['AI feature availability'], interventions: [],
    })) } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release', 'ai_release_only']);
    expect(out).not.toHaveProperty('options_withheld');
  });

});

/**
 * ⛔ AN OPEN CELL CAN EQUAL AT MOST ONE LEVEL (independent review of b0a51c3e, 26 Sep). The first rule was a
 * SYMMETRIC "cannot be told apart", walked last-drafted first. An option with no level on a factor matched EVERY
 * level on it, so an Olumi "£54" drafted after a level-less test was withheld as the test's twin, then the test
 * too: a false sentence ("sets nothing … that \"Test £59 …\" does not") naming an option that was itself gone, and
 * a runnable model turned into a dead start. The status quo, acting on factors, was a twin too.
 *
 * The rule these rows hold is the DL's own clause ("differs only in something unmodelled"): an option is withheld
 * only when ANOTHER option already COVERS it — the same factors, and every level it sets set to the same level
 * there. That relation is transitive, so the option it names is always one that stays. The status quo is never a
 * candidate (its map is empty and PLoT counts only valued maps — EXECUTED on all four served runs).
 *
 * Each draft below is a SERVED draft with one option added or changed in the shape the review composed; the
 * served approval graph carries the outcome row. None of these shapes was seen on the wire.
 */
describe('fix round — an open cell can equal at most one level; the status quo is never a twin', () => {
  const OPT = (label: string, provenance: 'explicit' | 'ai_proposed' | 'inferred', changes: string[], level?: { factor: string; value: number }) => ({
    label, provenance, changes, is_status_quo: null,
    interventions: level === undefined ? [] : [{ factor_label: level.factor, value: level.value, value_kind: 'absolute', unit: '£ per month', provenance: 'ai_proposed' }],
  });
  const levelOf = (g: SGraph, id: string) => g.nodes.find((n) => n.id === id)?.interventions ?? null;
  const registeredLabels = (g: SGraph) => g.nodes.filter((n) => n.kind === 'option').map((n) => n.description ?? n.label);
  const withheldOf = (out: Record<string, unknown>) => (out.options_withheld ?? []) as { option: string; like: string; reason: string }[];
  /** Served shape 1 with Olumi's "£54 with AI release" drafted AFTER the level-less test option. */
  const shape1With54 = () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    return { ...base, options: [...base.options, OPT('£54 with AI release', 'ai_proposed', ['AI feature availability'], { factor: 'Pro plan price', value: 54 })] } as typeof base;
  };

  it('RED (review 1, served shape 1): Olumi "£54 with AI release" drafted AFTER the level-less test option is registered at £54; only the test option is withheld, named against the user\'s option', async () => {
    const draft = shape1With54();
    expect(draft.options.map((o) => o.label)).toEqual(['Keep current pricing', '£59 with AI release', 'Test £59 with AI release', '£54 with AI release']);
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelOf(graph, '54_with_ai_release')).toEqual({ pro_plan_price: { value: 0.27, source: 'cee_hypothesis' } });
    expect(withheldOf(out)).toEqual([{ option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' }]);
    expect(questions(out).filter((q) => q.startsWith('I left out '))).toEqual([STEP_1]);
  });

  it('RED (review 1, the outcome): on the served APPROVED model plus that £54 option, what the rule registers still runs', async () => {
    const { graph } = await build(shape1With54());
    const approved = structuredClone(SHAPE_1.approve.draft_graph);
    const test = approved.nodes.find((n) => n.id === TEST_ID)!;
    approved.nodes.push({ ...structuredClone(test), id: '54_with_ai_release', label: '£54 with AI release', interventions: { ...test.interventions!, pro_plan_price: { value: 0.27, source: 'cee_hypothesis' } } });
    approved.edges.push(
      ...approved.edges.filter((e) => e.from === TEST_ID).map((e) => ({ ...e, from: '54_with_ai_release' })),
      ...approved.edges.filter((e) => e.to === TEST_ID).map((e) => ({ ...e, to: '54_with_ai_release' })),
    );
    // Vacuity: every option kept runs; the test and £54 both removed is the dead start.
    expect(resolveRunAdmission(approved).willProceed).toBe(true);
    expect(resolveRunAdmission(withoutOption(withoutOption(approved, TEST_ID), '54_with_ai_release')).blockedNextStep).toBe(NO_COMPARISON_NEXT_STEP);
    const registered = new Set(optionIds(graph));
    const notRegistered = optionIds(approved).filter((id) => !registered.has(id));
    const admission = resolveRunAdmission(notRegistered.reduce(withoutOption, approved));
    expect([notRegistered, admission.willProceed, admission.blockedNextStep]).toEqual([[TEST_ID], true, null]);
  });

  it('RED (review 1, served shape 2): Olumi "Raise Pro Price to £54" (inferred) drafted after the test option is registered at £54', async () => {
    const base = candidateFromServed(SHAPE_2.brief.draft_graph, { olumi: 'inferred', unknowns: [] });
    const draft = { ...base, options: [...base.options, OPT('Raise Pro Price to £54', 'inferred', ['AI Feature Value'], { factor: 'Pro Plan Price', value: 54 })] } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_pro_price_at_49', 'raise_pro_price_to_59', 'raise_pro_price_to_54']);
    expect(levelOf(graph, 'raise_pro_price_to_54')).toEqual({ pro_plan_price: { value: 0.27, source: 'cee_hypothesis' } });
    expect(withheldOf(out)).toEqual([{ option: 'Test £59 With AI Release', like: 'Raise Pro Price to £59', reason: 'option_indistinct' }]);
    expect(questions(out).filter((q) => q.startsWith('I left out '))).toEqual([STEP_2]);
  });

  it('RED (review 2): a USER option with no level never makes Olumi\'s £54 and £64 its twins — all four are registered, nothing is said withheld', async () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: [base.options[0]!,
      OPT('Raise the Pro price with the AI release', 'explicit', ['Pro plan price', 'AI feature availability']),
      OPT('£54 with AI release', 'ai_proposed', ['AI feature availability'], { factor: 'Pro plan price', value: 54 }),
      OPT('£64 with AI release', 'ai_proposed', ['AI feature availability'], { factor: 'Pro plan price', value: 64 }),
    ] } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', 'raise_the_pro_price_with_the_ai_release', '54_with_ai_release', '64_with_ai_release']);
    expect([levelOf(graph, '54_with_ai_release'), levelOf(graph, '64_with_ai_release')]).toEqual([
      { pro_plan_price: { value: 0.27, source: 'cee_hypothesis' } }, { pro_plan_price: { value: 0.32, source: 'cee_hypothesis' } }]);
    expect(out).not.toHaveProperty('options_withheld');
    expect(questions(out).filter((q) => q.startsWith('I left out ') || q.startsWith('What makes '))).toEqual([]);
  });

  it('RED (review 2, the same class in the question): three USER options — a level-less one, £54 and £64 — get ONE question, and it never says £54 and £64 cannot be told apart', async () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const draft = { ...base, options: [base.options[0]!,
      OPT('Raise the Pro price with the AI release', 'explicit', ['Pro plan price', 'AI feature availability']),
      OPT('£54 with AI release', 'explicit', ['AI feature availability'], { factor: 'Pro plan price', value: 54 }),
      OPT('£64 with AI release', 'explicit', ['AI feature availability'], { factor: 'Pro plan price', value: 64 }),
    ] } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', 'raise_the_pro_price_with_the_ai_release', '54_with_ai_release', '64_with_ai_release']);
    expect(questions(out).filter((q) => q.startsWith('What makes '))).toEqual([
      'What makes "Raise the Pro price with the AI release" different from "£54 with AI release"? As drafted, nothing the model holds tells them apart, so the analysis cannot compare them yet.',
    ]);
  });

  it('RED (review 3): a declared status quo that ACTS on both factors (served "£49 with AI release" draft) is never a twin — "£49 with AI release" is registered at its served levels', async () => {
    const base = candidateFromServed(AT_49.brief.draft_graph, { olumi: 'ai_proposed', horizon: null });
    const draft = { ...base, options: base.options.map((o) => (o.is_status_quo === true ? { ...o, changes: ['Pro plan price', 'AI feature availability'] } : o)) } as typeof base;
    // Vacuity: the status quo acts on both factors with no level, as the review's P8 drafted it.
    expect(draft.options.map((o) => [o.label, o.provenance, o.is_status_quo, o.changes, (o.interventions ?? []).length])).toEqual([
      ['Current setup', 'ai_proposed', true, ['Pro plan price', 'AI feature availability'], 0],
      ['£59 with AI release', 'explicit', null, [], 2],
      ['£49 with AI release', 'ai_proposed', null, [], 2],
    ]);
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['current_setup', '59_with_ai_release', '49_with_ai_release']);
    expect(levelOf(graph, '49_with_ai_release')).toEqual(AT_49.brief.draft_graph.nodes.find((n) => n.id === '49_with_ai_release')!.interventions);
    expect(out).not.toHaveProperty('options_withheld');
  });

  it('RED (review 1, "like"): never names a withheld option — an Olumi restatement of the user\'s £59 drafted FIRST is withheld, and the test option is named against the user\'s option', async () => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const [sq, user, test] = base.options;
    const draft = { ...base, options: [sq!, OPT('Launch Pro at £59 with AI release', 'ai_proposed', ['AI feature availability'], { factor: 'Pro plan price', value: 59 }), user!, test!] } as typeof base;
    const { graph, out } = await build(draft);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(withheldOf(out)).toEqual([
      { option: 'Launch Pro at £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' },
      { option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' },
    ]);
    for (const w of withheldOf(out)) expect(registeredLabels(graph)).toContain(w.like);
  });
});

describe('a second real draft, another domain — the banked LIVE hiring candidate (gpt-5.6-terra, 23 Sep)', () => {
  it('RED: Olumi\'s "Pilot Developer Hire" (no level, the same factors as "Hire Two Developers") is withheld, and the step reads true for hiring', () => {
    const live = (JSON.parse(readFileSync(new URL('./fixtures/live-hiring-envelope-candidate-20260923.json', import.meta.url), 'utf8')) as { candidate: CandidateModel }).candidate;
    const a = admitCandidateModel(live, {});
    expect(a.nodes.filter((n) => n.kind === 'option').map((n) => n.id)).toEqual(['hire_a_tech_lead', 'hire_two_developers', 'maintain_current_staffing']);
    expect(a.options_withheld).toEqual([{
      option: 'Pilot Developer Hire', like: 'Hire Two Developers', reason: 'option_indistinct',
      sentence: 'I left out "Pilot Developer Hire" as a separate option: as drafted it sets nothing the model can hold that "Hire Two Developers" does not — a test, pilot or staged rollout needs its own level on a factor the model holds. It stays open as a next step.',
    }]);
  });
});

// ── ordering: the size gate, and an adopted retry ─────────────────────────────
describe('ordering — the rule runs inside admission, so the size gate measures what is registered', () => {
  const padded = (n: number, withTest: boolean) => {
    const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
    const extra = Array.from({ length: n }, (_, i) => `Market signal ${i + 1}`);
    return {
      ...base,
      options: withTest ? base.options : base.options.filter((o) => o.label !== 'Test £59 with AI release'),
      factors: [...base.factors, ...extra.map((label) => ({ label, role: 'observable' as const, baseline_known: false, baseline_value: null, unit: null, provenance: 'ai_proposed', plausible_max: 100 }))],
      links: [...base.links, ...extra.map((from) => ({ from, to: 'MRR', direction: 'positive', provenance: 'ai_proposed' }))],
    } as unknown as typeof base;
  };

  it('RED: a draft oversized ONLY by its indistinct option is registered on the first pass — no retry is spent', async () => {
    const draft = padded(7, true);
    // Vacuity: with the option given a distinct level (so nothing is withheld) the same draft is oversized; without it, within.
    const distinct = { ...draft, options: draft.options.map((o) => (o.label !== 'Test £59 with AI release' ? o : { ...o, interventions: [{ factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: '£ per month', provenance: 'ai_proposed' }] })) } as typeof draft;
    expect(assessConstructionSize(admitCandidateModel(distinct, {})).nodes).toBe(COMPACT_LIMITS.maxNodes + 1);
    expect(assessConstructionSize(admitCandidateModel(padded(7, false), {})).within).toBe(true);
    const { out, calls } = await build(draft);
    expect([calls, out.size_retried, out.within_compact_limits]).toEqual([1, false, true]);
    expect(out.options_withheld).toEqual([{ option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' }]);
  });

  it('RED: an adopted size retry that drops the withheld option still says the step (never silently)', async () => {
    const first = padded(8, true);
    const retry = padded(0, false);
    const { out, calls, graph } = await build(first, retry);
    expect([calls, out.size_retried]).toEqual([2, true]);
    expect(optionIds(graph)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(questions(out)).toContain(STEP_1);
    const leftOut = ((out.left_out_to_stay_compact ?? []) as { label: string }[]).map((x) => x.label);
    expect(leftOut).not.toContain('Test £59 with AI release');
  });
});

describe('the construction contract names the shape (one sentence)', () => {
  const SENTENCE = 'Every option you add must differ from every other option in at least one factor level; a test, pilot or phased rollout of another option is not a separate option unless it sets a factor the model holds to a different level, such as the share of customers it reaches.';
  it('RED: BUILD_INSTRUCTIONS carries the sentence exactly once', () => {
    expect(BUILD_INSTRUCTIONS.split(SENTENCE)).toHaveLength(2);
  });
});

/**
 * How `fixtures/staging-cb1778b-registered-graphs.json` was made (a one-off, kept as a record rather than
 * as a skipped test, so the test-skip inventory stays unchanged): the block below was run as a test on a tree
 * whose `src/` is origin/staging cb1778b86cc8f5c1d17285af366cc1909bab658b (before the rule), with
 * GEN_NO_DUP_BASE_HEAD set to that sha.
 */
// describe.runIf(process.env.GEN_NO_DUP_BASE === '1')('generator (base only)', () => {
//   it('writes what base registers for the four served drafts', async () => {
//     const { writeFileSync } = await import('node:fs');
//     const graphs: Record<string, string> = {};
//     for (const [key, run, olumi, unknowns, horizon] of [
//       ['f-20260926T020217Z', SHAPE_1, 'ai_proposed', UNKNOWNS_1, 12],
//       ['f-20260926T022404Z', SHAPE_2, 'inferred', UNKNOWNS_2, 12],
//       ['f-20260926T001627Z', PHASED_54, 'ai_proposed', [], null],
//       ['f-20260926T022612Z', AT_49, 'ai_proposed', [], null],
//     ] as const) {
//       const { graph } = await build(candidateFromServed(run.brief.draft_graph, { olumi, unknowns: [...unknowns], horizon }));
//       graphs[key] = JSON.stringify(graph);
//     }
//     writeFileSync(BASE_FIXTURE, `${JSON.stringify({ head: process.env.GEN_NO_DUP_BASE_HEAD, graphs }, null, 1)}\n`);
//   });
// });
