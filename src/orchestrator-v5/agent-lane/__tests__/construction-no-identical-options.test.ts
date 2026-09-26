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
import { buildCandidateSchema, buildModelFromBrief, BUILD_INSTRUCTIONS, prepareProvisionalCandidate, type CallStructuredModel } from '../runtime/build-model.js';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { assessConstructionSize, COMPACT_LIMITS } from '../construction-size-gate.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { labelMatchesBaseline } from '../../../cee/transforms/analysis-ready.js';
import { assessCanonicalAnalysisReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';

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
      baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
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
    identities: [],
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

  // Staging moved under this PR: #1963 (Runtime, the Run-time held status quo) makes the admission floor count
  // the held status quo the run submits. Before #1963 this row RECORDED the limit that withholding alone left
  // the brief with one valued option and NO_COMPARISON_NEXT_STEP; with #1963 the same cut RUNS, the status quo
  // being the comparator. Pinned so a regression of either half shows here.
  it('WITH #1963: the approved served model minus the test option RUNS — the held status quo is the comparator', () => {
    const cut = withoutOption(run.approve.draft_graph, TEST_ID);
    const admission = resolveRunAdmission(cut);
    expect([admission.willProceed, admission.strict.status, admission.blockedNextStep]).toEqual([true, 'analysis_ready', null]);
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
    // The run, on the served approved model: that option set to today's price alone PROCEEDS. Since #1963 the held
    // status quo also counts, so the model without it proceeds too; the control's point is that (b) KEEPS it.
    const approved = structuredClone(SHAPE_2.approve.draft_graph);
    const twin = approved.nodes.find((n) => n.id === TEST_ID)!;
    twin.interventions = { pro_plan_price: { value: 0.245, source: 'cee_hypothesis' } };
    approved.edges = approved.edges.filter((e) => !(e.from === TEST_ID && e.to !== 'pro_plan_price'));
    expect(resolveRunAdmission(approved).willProceed).toBe(true);
    expect(resolveRunAdmission(withoutOption(approved, TEST_ID)).willProceed).toBe(true);
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
    // Every option kept runs. (Before #1963, the test and £54 both removed was the dead start; since #1963 the
    // held status quo counts, so identity — WHICH options register — is what this row binds, below.)
    expect(resolveRunAdmission(approved).willProceed).toBe(true);
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
/**
 * The served shape-1 draft, padded with `n` Olumi factors so the size gate is the question.
 *
 * ⚠ RE-PINNED FOR #1891 (merge of staging into #1891): #1891 makes every option × factor it acts on with no level,
 * and every acted-on factor with no baseline, a repair issue for the one retry. The served draft carries one of each
 * on the USER's kept option ("£59 with AI release" acts on "AI feature availability", which has no level and no
 * baseline), so #1891 legitimately spends its retry on them — a different question from the one these rows ask
 * (does the size gate measure what is registered?). So by default the kept option is given a level (1, ai_proposed)
 * and the factor a baseline (0, not known) — exactly as `451b4a19c` made #1904's limit fixture gap-free — and the
 * rows keep their assertions unchanged. Olumi's "Test £59 with AI release" is left AS SERVED (no level): it is the
 * option admission withholds, so its pairs must never count as gaps. `servedGaps: true` keeps the served draft's
 * gaps, for the combined rows below.
 */
const padded = (n: number, withTest: boolean, { servedGaps = false }: { servedGaps?: boolean } = {}) => {
  const base = candidateFromServed(SHAPE_1.brief.draft_graph, { olumi: 'ai_proposed', unknowns: [] });
  const extra = Array.from({ length: n }, (_, i) => `Market signal ${i + 1}`);
  type Opt = (typeof base.options)[number];
  const gapFree = (o: Opt): Opt => (servedGaps || o.label !== '£59 with AI release' ? o : {
    ...o,
    changes: (o.changes ?? []).filter((f) => f !== 'AI feature availability'),
    interventions: [...(o.interventions ?? []), { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' }],
  } as Opt);
  return {
    ...base,
    options: (withTest ? base.options : base.options.filter((o) => o.label !== 'Test £59 with AI release')).map(gapFree),
    factors: [
      ...base.factors.map((f) => (servedGaps || f.label !== 'AI feature availability' ? f : { ...f, baseline_known: false, baseline_value: 0 })),
      ...extra.map((label) => ({ label, role: 'observable' as const, baseline_known: false, baseline_value: null, unit: null, provenance: 'ai_proposed', plausible_max: 100 })),
    ],
    links: [...base.links, ...extra.map((from) => ({ from, to: 'MRR', direction: 'positive', provenance: 'ai_proposed' }))],
  } as unknown as typeof base;
};

describe('ordering — the rule runs inside admission, so the size gate measures what is registered', () => {

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

/**
 * ⛔ COMBINED (merge of staging into #1891): an oversized draft carrying Olumi's indistinct option AND coverage gaps.
 * #1967 withholds the option inside admission and says it; #1891 asks the gaps of the one retry, as a compaction. Both
 * at once: the size gate and the gaps both read the model that is REGISTERED — so the withheld option's own pairs are
 * never asked — the compliant retry is adopted, and the withheld option is said exactly once whichever draft is kept.
 */
describe('COMBINED (#1891 × #1967): an oversized draft with Olumi\'s duplicate option and coverage gaps', () => {
  const USER_GAP = '£59 with AI release -> AI feature availability: give the level this option sets in interventions (the user\'s number if stated, '
    + 'otherwise an ai_proposed estimate in the factor\'s unit and plausible_max frame); keep it only in changes if no defensible level exists';
  const BASELINE_GAP = 'AI feature availability: give a baseline_value (a provisional estimate with baseline_known:false) \u2014 an option acts on it';
  type Req = { instructions: string; input: string };
  /** The real construction, drafter faked (`drafts[i]` answers call i, the last repeats); a refusal is returned, not thrown. */
  async function construct(...drafts: (CandidateModel & { unknowns: string[] })[]) {
    for (const d of drafts) expect(strict(d), JSON.stringify(strict.errors)).toBe(true);
    let body: { graph: unknown } | null = null;
    const reqs: Req[] = [];
    const call = (async (req: Req) => {
      reqs.push({ instructions: req.instructions, input: req.input });
      return { text: JSON.stringify(drafts[Math.min(reqs.length - 1, drafts.length - 1)]) };
    }) as unknown as CallStructuredModel;
    const d: InternalDispatch = async (path, b) => {
      if (path.endsWith('/graph/register')) { body = structuredClone(b as { graph: unknown }); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    };
    const out = await buildModelFromBrief('55555555-5555-4555-8555-555555555555', BRIEF, d, call) as Record<string, unknown>;
    const graph = body === null ? null : GraphV3.parse((body as { graph: unknown }).graph) as unknown as SGraph;
    return { out, graph, reqs };
  }
  const issues = (input: string): string[] => JSON.parse(/Construction issues: (\[.*\])\n/.exec(input)![1]!) as string[];
  const withheldOptions = (out: Record<string, unknown>) => out.options_withheld;
  const said = (out: Record<string, unknown>) => questions(out).filter((q) => q === STEP_1).length;
  const first = () => padded(8, true, { servedGaps: true });

  it('PRECONDITION: the served gaps sit on the user\'s kept option AND on the option admission withholds; oversized after withholding', () => {
    const prep = prepareProvisionalCandidate(first());
    expect(prep.level_gaps).toEqual([
      { option: '£59 with AI release', factor: 'AI feature availability' },
      { option: 'Test £59 with AI release', factor: 'Pro plan price' },
      { option: 'Test £59 with AI release', factor: 'AI feature availability' },
    ]);
    expect(prep.baseline_gaps).toEqual([{ factor: 'AI feature availability' }]);
    const admitted = admitCandidateModel(prep.candidate, {});
    expect((admitted.options_withheld ?? []).map((w) => [w.option, w.like])).toEqual([['Test £59 with AI release', '£59 with AI release']]);
    expect(assessConstructionSize(admitted).within).toBe(false);
  });

  it('RED (row 2): the compaction is asked the gaps on what is REGISTERED — never the withheld option\'s own pairs', async () => {
    const { out, reqs } = await construct(first(), padded(0, false));
    expect(reqs).toHaveLength(2);
    expect(out.size_retried).toBe(true);
    expect(issues(reqs[1]!.input)).toEqual([USER_GAP, BASELINE_GAP]);
    expect(reqs[1]!.input).not.toContain('Test £59 with AI release -> ');
    expect(reqs[1]!.input).toContain(`Candidate to repair (your previous model, to shrink): ${JSON.stringify(first())}`);
    expect(reqs[1]!.instructions).toContain('Keep every option the brief states, and every other option in your previous model unless you ADDED it beyond the brief');
    expect(reqs[1]!.instructions).not.toContain('Preserve every option');
  });

  it('RED (row 2a): a compliant retry that sheds the duplicate and levels the user\'s option is adopted — the duplicate is still withheld and said, once', async () => {
    const { out, graph } = await construct(first(), padded(0, false));
    expect([out.ok, out.size_retried, out.within_compact_limits]).toEqual([true, true, true]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(Object.keys(graph!.nodes.find((n) => n.id === '59_with_ai_release')!.interventions ?? {}).sort()).toEqual(['ai_feature_availability', 'pro_plan_price']);
    expect(withheldOptions(out)).toEqual([{ option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' }]);
    expect(said(out)).toBe(1);
    const leftOut = ((out.left_out_to_stay_compact ?? []) as { label: string }[]).map((x) => x.label);
    expect(leftOut).not.toContain('Test £59 with AI release');
    expect(leftOut).toContain('Market signal 1');
  });

  it('RED (row 2b): a compliant retry that COPIES the duplicate as drafted is adopted — its own admission withholds it, and it is said once, not twice', async () => {
    const { out, graph } = await construct(first(), padded(0, true));
    expect([out.ok, out.size_retried, out.within_compact_limits]).toEqual([true, true, true]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(graph!.nodes.some((n) => n.id === TEST_ID)).toBe(false);
    expect(withheldOptions(out)).toEqual([{ option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' }]);
    expect(said(out)).toBe(1);
  });

  it('RED (row 2d, the retry side): WITHIN the limit, a retry that levels the user\'s gap and copies the duplicate as drafted covers strictly more — adopted', async () => {
    // Coverage is the only reason for this retry, so #1891 adopts it only if it covers strictly MORE. The duplicate the
    // retry copies is withheld by the RETRY's admission too, so its pairs are no gap there either: 0 < 2. Counted on the
    // retry alone, 2 < 2 fails and the user's option loses the level the retry gave it.
    const { out, graph, reqs } = await construct(padded(0, true, { servedGaps: true }), padded(0, true));
    expect(reqs).toHaveLength(2);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(issues(reqs[1]!.input)).toEqual([USER_GAP, BASELINE_GAP]);
    expect(Object.keys(graph!.nodes.find((n) => n.id === '59_with_ai_release')!.interventions ?? {}).sort()).toEqual(['ai_feature_availability', 'pro_plan_price']);
    expect(graph!.nodes.some((n) => n.id === TEST_ID)).toBe(false);
    expect(said(out)).toBe(1);
  });

  it('CONTROL (row 2c): a retry that takes the user\'s option\'s action away is refused — the oversized first draft is refused out loud', async () => {
    const lossy = padded(0, false);
    const o = lossy.options.find((x) => x.label === '£59 with AI release')!;
    (o as { interventions?: unknown[] }).interventions = (o.interventions ?? []).filter((i) => i.factor_label !== 'AI feature availability');
    (o as { changes?: string[] }).changes = [];
    (lossy as unknown as { links: { from: string; to: string }[] }).links = lossy.links.filter((l) => !(l.from === '£59 with AI release' && l.to === 'AI feature availability'));
    const { out, graph, reqs } = await construct(first(), lossy);
    expect(reqs).toHaveLength(2);
    expect([out.ok, out.refusal, out.retried]).toEqual([false, 'model_too_large', true]);
    expect(graph).toBeNull();
  });

  /**
   * ⛔ THE RETRY SIDE NEVER CLOSES A GAP BY WITHHOLDING AN OPTION THE FIRST DRAFT REGISTERED (adversarial verify of
   * 843c0960, blocking). Within the limit, Olumi's "£54 with AI release" (its price level set, AI availability open) is
   * registered and distinct, and its one gap is the only reason for the retry. A retry that makes £54 indistinct, so the
   * retry's own admission withholds it, has not covered more: it is refused and £54 stays registered at its level. The
   * duplicate the FIRST draft already withheld is still left out of the retry's gaps — the first draft never registered it.
   */
  const GAP_54 = '£54 with AI release -> AI feature availability: give the level this option sets in interventions (the user\'s number if stated, '
    + 'otherwise an ai_proposed estimate in the factor\'s unit and plausible_max frame); keep it only in changes if no defensible level exists';
  const PRICE_54 = { factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: '£ per month', provenance: 'ai_proposed' };
  type Opt = CandidateModel['options'][number];
  /** Within the limit: `padded(0, withTest)` (the user's option gap-free) plus Olumi's £54, AI availability open unless `o54` sets it. */
  const with54 = (withTest: boolean, o54: Partial<Opt> = {}) => {
    const base = padded(0, withTest);
    const opt = { label: '£54 with AI release', provenance: 'ai_proposed', changes: ['AI feature availability'], is_status_quo: null, interventions: [PRICE_54], ...o54 } as unknown as Opt;
    return { ...base, options: [...base.options, opt] } as typeof base;
  };
  const LEVELLED_54 = { changes: [], interventions: [PRICE_54, { factor_label: 'AI feature availability', value: 0.5, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' }] } as unknown as Partial<Opt>;
  const ONLY_TEST_WITHHELD = [{ option: 'Test £59 with AI release', like: '£59 with AI release', reason: 'option_indistinct' }];
  /** Readiness on the registered graph. A kept £54 whose AI availability stays open is one honest value question, never a withheld option. */
  const blocking = (g: SGraph) => assessCanonicalAnalysisReadiness(g).blockingIssues.map((i) => [i.code, i.message]);
  const ASK_54_AI = [['MISSING_OPTION_VALUE', 'Factor "AI feature availability" needs a numeric value for option "£54 with AI release"']];

  it('PRECONDITION (row 2e): within the limit, "£54 with AI release" is registered and distinct, and the one gap asked is £54\'s', async () => {
    for (const withTest of [true, false]) {
      const prep = prepareProvisionalCandidate(with54(withTest));
      const admitted = admitCandidateModel(prep.candidate, {});
      expect(assessConstructionSize(admitted).within).toBe(true);
      expect((admitted.options_withheld ?? []).map((w) => w.option)).toEqual(withTest ? ['Test £59 with AI release'] : []);
      expect(prep.mechanism_issues).toEqual([]);
    }
    const { reqs } = await construct(with54(true), with54(true));
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
  });

  it('CONTROL (row 2e, no progress): a retry that echoes the first draft is refused — the first draft registers, £54 at its price level', async () => {
    const { out, graph } = await construct(with54(true), with54(true));
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
  });

  it('CONTROL (row 2e, compliant): a retry that levels £54 -> AI feature availability is adopted — no duplicate in either draft', async () => {
    const { out, graph, reqs } = await construct(with54(false), with54(false, LEVELLED_54));
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27, ai_feature_availability: 0.5 });
    expect(blocking(graph!)).toEqual([]);
    expect(withheldOptions(out) ?? []).toEqual([]);
  });

  it('CONTROL (row 2f, the other side): the FIRST draft already withheld the duplicate — the compliant retry that copies it as drafted is adopted', async () => {
    // The duplicate is withheld by both admissions. The first draft never registered it, so the retry side still leaves
    // its pairs out: 0 < 1. Counted, 2 < 1 fails and £54 never gets the level the retry gave it.
    const { out, graph, reqs } = await construct(with54(true), with54(true, LEVELLED_54));
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27, ai_feature_availability: 0.5 });
    expect(blocking(graph!)).toEqual([]);
    expect(graph!.nodes.some((n) => n.id === TEST_ID)).toBe(false);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(said(out)).toBe(1);
  });

  it.each([
    ['A: re-prices £54 at the user\'s £59, AI availability still open', { interventions: [{ ...PRICE_54, value: 59 }] }],
    ['B: moves £54\'s price level into changes — it levels nothing', { changes: ['AI feature availability', 'Pro plan price'], interventions: [] }],
    ['C: levels AI availability like the user\'s option and drops its own price level', { changes: ['Pro plan price'], interventions: [{ factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' }] }],
  ])('RED (row 2g, probe %s): making the REGISTERED £54 withheld closes no gap — refused; £54 stays registered at its level', async (_probe, o54) => {
    const retry = with54(true, o54 as unknown as Partial<Opt>);
    // Vacuity: the retry's own admission withholds £54, so excluding it on the retry side would read 0 gaps (0 < 1).
    expect((admitCandidateModel(prepareProvisionalCandidate(retry).candidate, {}).options_withheld ?? []).map((w) => w.option))
      .toEqual(['Test £59 with AI release', '£54 with AI release']);
    const { out, graph, reqs } = await construct(with54(true), retry);
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(questions(out).filter((q) => q.startsWith('I left out "£54 with AI release"'))).toEqual([]);
    expect(said(out)).toBe(1);
  });

  /**
   * ⛔ COVERAGE ALONE NEVER COSTS A REGISTERED OPTION (adversarial verify of 58a22db8, blocking: probes P2-A..P2-E).
   * Counting a withheld option's gaps (row 2g) keeps the COUNT honest, not the registered model. A retry that levels
   * £64 AND makes the registered £54 indistinct still covers strictly more (1 < 2); one that levels £54's own gap while
   * re-pricing it like the user's £59 does too (0 < 1). Either way admission withholds £54 from what registers, and a
   * draft that was within the limit says it left £54 out "to keep it readable". When coverage is the only reason for the
   * retry, the retry must register every option the first draft registered, or it is refused.
   */
  const LEVELLED = (price: number, ai: number) => ({
    changes: [],
    interventions: [{ ...PRICE_54, value: price }, { factor_label: 'AI feature availability', value: ai, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' }],
  }) as unknown as Partial<Opt>;
  /** Within the limit, two gaps: `with54(true, o54)` plus Olumi's £64, its price level set and AI availability open unless `o64` sets it. */
  const with54And64 = (o54: Partial<Opt> = {}, o64: Partial<Opt> = {}) => {
    const base = with54(true, o54);
    const opt = { label: '£64 with AI release', provenance: 'ai_proposed', changes: ['AI feature availability'], is_status_quo: null, interventions: [{ ...PRICE_54, value: 64 }], ...o64 } as unknown as Opt;
    return { ...base, options: [...base.options, opt] } as typeof base;
  };
  const GAP_64 = GAP_54.replace('£54 with AI release', '£64 with AI release');
  const ASK_54_64_AI = [...ASK_54_AI, ['MISSING_OPTION_VALUE', 'Factor "AI feature availability" needs a numeric value for option "£64 with AI release"']];
  const FOUR = ['keep_current_pricing', '59_with_ai_release', '54_with_ai_release', '64_with_ai_release'];
  /** A draft's level gaps on the options the first draft registers ("Test £59 with AI release" is withheld by every draft here). */
  const gapsOnRegistered = (d: CandidateModel) => prepareProvisionalCandidate(d).level_gaps.filter((g) => g.option !== 'Test £59 with AI release');
  const withheldBy = (d: CandidateModel) => (admitCandidateModel(prepareProvisionalCandidate(d).candidate, {}).options_withheld ?? []).map((w) => w.option);

  it('CONTROL (row 2h, no progress): the two-gap first draft registers all four options and asks both value questions', async () => {
    const { out, graph, reqs } = await construct(with54And64(), with54And64());
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54, GAP_64]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(FOUR);
    expect(levelsById(graph!)['64_with_ai_release']).toEqual({ pro_plan_price: 0.32 });
    expect(blocking(graph!)).toEqual(ASK_54_64_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
  });

  it('CONTROL (row 2h, partial progress — the verifier\'s P2-ctrl): a retry that levels £64 and leaves £54 as drafted is adopted — all four registered, £54 still asked', async () => {
    const { out, graph } = await construct(with54And64(), with54And64({}, LEVELLED(64, 0.5)));
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(FOUR);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(levelsById(graph!)['64_with_ai_release']).toEqual({ pro_plan_price: 0.32, ai_feature_availability: 0.5 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(out.left_out_to_stay_compact).toBeUndefined();
  });

  it.each([
    ['P2-A: re-prices £54 at the user\'s £59, AI availability still open', { interventions: [{ ...PRICE_54, value: 59 }] }, 1],
    ['P2-C: levels £54\'s AI availability like the user\'s option and moves its price into changes', { changes: ['Pro plan price'], interventions: [{ factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: '', provenance: 'ai_proposed' }] }, 1],
    ['P2-D: sets £54 to the user\'s exact levels', LEVELLED(59, 1), 0],
  ])('RED (row 2h, probe %s, and levels £64): strictly fewer gaps, but £54 is withheld — refused; all four stay registered at their levels', async (_probe, o54, gapsLeft) => {
    const first = with54And64();
    const retry = with54And64(o54 as unknown as Partial<Opt>, LEVELLED(64, 0.5));
    // Vacuity: counted on £54 as well, the retry covers strictly more than the first draft — the count alone adopts it.
    expect(gapsOnRegistered(first)).toHaveLength(2);
    expect(gapsOnRegistered(retry)).toHaveLength(gapsLeft as number);
    expect(withheldBy(retry)).toEqual(['Test £59 with AI release', '£54 with AI release']);
    const { out, graph, reqs } = await construct(first, retry);
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54, GAP_64]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(FOUR);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(levelsById(graph!)['64_with_ai_release']).toEqual({ pro_plan_price: 0.32 });
    expect(blocking(graph!)).toEqual(ASK_54_64_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(out.left_out_to_stay_compact).toBeUndefined();
    expect(statusLine(out)).not.toContain('To keep it readable');
    expect(questions(out).filter((q) => q.startsWith('I left out "£54 with AI release"'))).toEqual([]);
    expect(said(out)).toBe(1);
  });

  it('RED (row 2h, a swap): the retry levels £64, makes £54 indistinct AND adds a distinct option — as many options registered, but not £54: refused', async () => {
    // By identity, never by count: the retry registers four options, as the first draft did, and covers strictly more.
    const first = with54And64();
    const base = with54And64({ interventions: [{ ...PRICE_54, value: 59 }] }, LEVELLED(64, 0.5));
    const retry = { ...base, options: [...base.options, { label: '£69 with AI release', provenance: 'ai_proposed', is_status_quo: null, ...LEVELLED(69, 0.8) } as unknown as Opt] } as typeof base;
    expect(gapsOnRegistered(retry)).toHaveLength(1);
    expect(withheldBy(retry)).toEqual(['Test £59 with AI release', '£54 with AI release']);
    const retryAdmitted = admitCandidateModel(prepareProvisionalCandidate(retry).candidate, {});
    expect(assessConstructionSize(retryAdmitted).within).toBe(true);
    expect(retryAdmitted.nodes.filter((n) => n.kind === 'option').map((n) => n.id)).toEqual(['keep_current_pricing', '59_with_ai_release', '64_with_ai_release', '69_with_ai_release']);
    const { out, graph } = await construct(first, retry);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(FOUR);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_64_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(out.left_out_to_stay_compact).toBeUndefined();
  });

  it('RED (row 2i, the verifier\'s P2-E): ONE gap, genuinely levelled while £54 is re-priced like the user\'s £59 — refused; £54 stays registered', async () => {
    const retry = with54(true, LEVELLED(59, 1));
    // Vacuity: £54's own gap is closed in the retry (0 < 1), so no count reads it as a gap; only its withholding is left.
    expect(gapsOnRegistered(with54(true))).toEqual([{ option: '£54 with AI release', factor: 'AI feature availability' }]);
    expect(gapsOnRegistered(retry)).toEqual([]);
    expect(withheldBy(retry)).toEqual(['Test £59 with AI release', '£54 with AI release']);
    const { out, graph, reqs } = await construct(with54(true), retry);
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(out.left_out_to_stay_compact).toBeUndefined();
    expect(statusLine(out)).not.toContain('To keep it readable');
    expect(questions(out).filter((q) => q.startsWith('I left out "£54 with AI release"'))).toEqual([]);
    expect(said(out)).toBe(1);
  });

  /**
   * THE COUNT STILL MATTERS WHERE STRICT-MORE IS WAIVED (13d0cd3f's retry-side exclusion, kept). Within the limit, a loop
   * asked beside £54's gap waives "strictly more", but #1891's "never cover LESS" still holds — and it is counted on what
   * the first draft registered. Mutant Ma (the retry's own `options_withheld`, unfiltered) reads 1 ≤ 1 for a retry that
   * withholds £54 and opens £64's gap, adopts it, and £54 drops out of the registered model.
   */
  const LOOP_BACK = { from: 'Pro plan subscribers', to: 'Monthly churn', direction: 'positive', provenance: 'inferred' };
  const LOOP_ISSUE = '"Monthly churn" -> "Pro plan subscribers" -> "Monthly churn" is a loop: a model cannot hold one. Keep the direction that carries the '
    + 'cause toward the goal metric, remove the link that points back, and keep every option and risk connected to the goal through links whose direction you state.';
  const withLoop = (d: ReturnType<typeof with54>) => ({ ...d, links: [...d.links, LOOP_BACK] }) as unknown as ReturnType<typeof with54>;
  /** `out.withheld`'s loop entries: the first draft's loop link is withheld by admission; a retry that broke the loop has none. */
  const loopWithheld = (out: Record<string, unknown>) => ((out.withheld ?? []) as { from: string; to: string; reason: string }[])
    .filter((w) => w.reason === 'loop_closing_link').map((w) => `${w.from}->${w.to}`);
  const NEW_64_GAP = { label: '£64 with AI release', provenance: 'ai_proposed', changes: ['AI feature availability'], is_status_quo: null, interventions: [{ ...PRICE_54, value: 64 }] } as unknown as Opt;

  it('CONTROL (row 2k, loop + gap): a retry that breaks the loop and leaves £54 as drafted is adopted — strict-more is waived, nothing covers less', async () => {
    const { out, graph, reqs } = await construct(withLoop(with54(true)), with54(true));
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54, LOOP_ISSUE]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(loopWithheld(out)).toEqual([]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
  });

  it('CONTRAST (row 2k, covers less): a retry that breaks the loop and opens £64\'s gap is refused — the first draft registers, its loop link withheld', async () => {
    const { out, graph } = await construct(withLoop(with54(true)), { ...with54(true), options: [...with54(true).options, NEW_64_GAP] });
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(loopWithheld(out)).toEqual(['pro_plan_subscribers->monthly_churn']);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
  });

  it('RED vs mutant Ma (row 2k): a retry that breaks the loop, withholds £54 and opens £64\'s gap covers LESS of what registered — refused; £54 stays', async () => {
    const base = with54(true, { interventions: [{ ...PRICE_54, value: 59 }] });
    const retry = { ...base, options: [...base.options, NEW_64_GAP] } as typeof base;
    // Vacuity: the retry withholds £54; its own registered model has one gap (£64), the first draft's one (£54): 1 ≤ 1 by that count.
    expect(withheldBy(retry)).toEqual(['Test £59 with AI release', '£54 with AI release']);
    expect(gapsOnRegistered(retry).filter((g) => g.option !== '£54 with AI release')).toEqual([{ option: '£64 with AI release', factor: 'AI feature availability' }]);
    const { out, graph, reqs } = await construct(withLoop(with54(true)), retry);
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54, LOOP_ISSUE]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(loopWithheld(out)).toEqual(['pro_plan_subscribers->monthly_churn']);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(questions(out).filter((q) => q.startsWith('I left out "£54 with AI release"'))).toEqual([]);
  });

  it('CONTROL (row 2j, a duplicate only the RETRY adds): the first draft withholds nothing; a retry that levels £54 and adds the duplicate is adopted', async () => {
    // The rule is about options the first draft REGISTERED: a new duplicate is the retry's own to withhold and say, and its
    // pairs are no gap (0 < 1). Counted, 2 < 1 fails; refused for withholding anything, £54 never gets its level.
    expect(withheldBy(with54(false))).toEqual([]);
    expect(withheldBy(with54(true, LEVELLED_54))).toEqual(['Test £59 with AI release']);
    const { out, graph, reqs } = await construct(with54(false), with54(true, LEVELLED_54));
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27, ai_feature_availability: 0.5 });
    expect(blocking(graph!)).toEqual([]);
    expect(graph!.nodes.some((n) => n.id === TEST_ID)).toBe(false);
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
    expect(said(out)).toBe(1);
  });

  /**
   * ⛔ A GAP IS ANSWERED ONLY BY WHAT REGISTERS, AND A RETRY NEVER TAKES AWAY THE HELD STATUS QUO (adversarial verify of
   * e7052de7, blocking: X3-SQ and SQ-H1..H3). `findCoverageGaps` reads the drafter's own words, so a pair missing from a
   * retry's count is not thereby answered. A retry can declare £54 the status quo (a status quo's pairs are never gaps),
   * give an addition preparation cannot make a total, or give a level below zero that admission withholds. Each one reads
   * "fewer gaps" while readiness asks the same value question of what registers. And the declaration decides what
   * admission holds: two declared options means neither is held, so "Keep current pricing" loses its edges. Un-declared,
   * it is still held (its label reads as the status quo), but it loses the `is_baseline` stamp, and run admission reads
   * that stamp to keep it as a comparator.
   */
  const KEEP = 'Keep current pricing';
  const declare = <D extends ReturnType<typeof with54>>(d: D, label: string, v: boolean | null): D =>
    ({ ...d, options: d.options.map((o) => (o.label === label ? { ...o, is_status_quo: v } : o)) }) as D;
  const held = (g: SGraph) => g.nodes.filter((n) => n.kind === 'option' && n.is_baseline === true).map((n) => n.id);
  const keepEdges = (g: SGraph) => g.edges.filter((e) => e.from === 'keep_current_pricing').map((e) => e.to).sort();
  const AI_54 = (value: number, value_kind: 'absolute' | 'additional', unit: string) =>
    ({ changes: [], interventions: [PRICE_54, { factor_label: 'AI feature availability', value, value_kind, unit, provenance: 'ai_proposed' }] }) as unknown as Partial<Opt>;
  /** The first draft, registered as it stands: £54 at its price level, its AI availability the one value question, "Keep current pricing" held and declared. */
  const expectFirstDraftRegistered = (out: Record<string, unknown>, graph: SGraph | null) => {
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release', '54_with_ai_release']);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27 });
    expect(held(graph!)).toEqual(['keep_current_pricing']);
    expect(keepEdges(graph!)).toEqual(['ai_feature_availability', 'pro_plan_price']);
    expect(blocking(graph!)).toEqual(ASK_54_AI);
    expect(out.additions_without_total).toBeUndefined();
    expect(withheldOptions(out)).toEqual(ONLY_TEST_WITHHELD);
  };

  it('PRECONDITION (rows 3): the first draft declares "Keep current pricing"; its admission holds it, stamped', async () => {
    expect(with54(true).options.find((o) => o.label === KEEP)).toMatchObject({ is_status_quo: true, changes: [], interventions: [] });
    const { out, graph } = await construct(with54(true), with54(true));
    expectFirstDraftRegistered(out, graph);
  });

  it('RED (row 3a, the verifier\'s X3-SQ): a retry that declares £54 the status quo and changes nothing else is refused', async () => {
    const retry = declare(with54(true), '£54 with AI release', true);
    // Vacuity: declared, £54's one gap is not counted (0 < 1), and nothing else about the retry differs.
    expect(gapsOnRegistered(retry)).toEqual([]);
    const { out, graph, reqs } = await construct(with54(true), retry);
    expect(reqs).toHaveLength(2);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54]);
    expectFirstDraftRegistered(out, graph);
  });

  it('RED (row 3b): a retry that levels £54 AND un-declares "Keep current pricing" is refused — the stamp is the comparator run admission keeps', async () => {
    const retry = declare(with54(true, LEVELLED_54), KEEP, null);
    const retryAdmitted = admitCandidateModel(prepareProvisionalCandidate(retry).candidate, {});
    // Vacuity: still held (the label reads as the status quo), so only the stamp is lost; and £54 is genuinely levelled.
    expect(labelMatchesBaseline(KEEP)).toBe(true);
    expect(retryAdmitted.loss.some((e) => e.field_path === 'nodes[keep_current_pricing].status_quo_held')).toBe(true);
    expect(retryAdmitted.nodes.find((n) => n.id === 'keep_current_pricing')?.is_baseline).toBeUndefined();
    expect(gapsOnRegistered(retry)).toEqual([]);
    const { out, graph } = await construct(with54(true), retry);
    expectFirstDraftRegistered(out, graph);
  });

  it('RED (row 3c): a retry that levels £54 AND declares the user\'s £59 as well is refused — two declared, neither held', async () => {
    const { out, graph } = await construct(with54(true), declare(with54(true, LEVELLED_54), '£59 with AI release', true));
    expectFirstDraftRegistered(out, graph);
  });

  it('CONTROL (row 3c): the same levelled retry, declaring nothing new, is adopted — "Keep current pricing" held and stamped', async () => {
    const { out, graph } = await construct(with54(true), with54(true, LEVELLED_54));
    expect([out.ok, out.size_retried]).toEqual([true, false]);
    expect(levelsById(graph!)['54_with_ai_release']).toEqual({ pro_plan_price: 0.27, ai_feature_availability: 0.5 });
    expect(held(graph!)).toEqual(['keep_current_pricing']);
    expect(blocking(graph!)).toEqual([]);
  });

  it('RED (row 3d): an ADDITION to AI availability that preparation cannot make a total covers nothing — refused, and never said', async () => {
    const retry = with54(true, AI_54(0.5, 'additional', 'percentage points'));
    // Vacuity: the drafter's words carry a level on the pair, so the count reads 0 < 1; preparation makes it no total.
    expect(gapsOnRegistered(retry)).toEqual([]);
    expect(prepareProvisionalCandidate(retry).additions_without_total.map((a) => [a.option, a.factor, a.value])).toEqual([['£54 with AI release', 'AI feature availability', 0.5]]);
    const { out, graph } = await construct(with54(true), retry);
    expectFirstDraftRegistered(out, graph);
    expect(((out.not_represented ?? []) as string[]).filter((s) => s.includes('adds 0.5'))).toEqual([]);
  });

  it('RED (row 3e): a level below zero, which admission withholds, covers nothing — refused, and never said', async () => {
    const retry = with54(true, AI_54(-0.5, 'absolute', ''));
    expect(gapsOnRegistered(retry)).toEqual([]);
    expect(admitCandidateModel(prepareProvisionalCandidate(retry).candidate, {}).loss.some((e) => e.field_path.endsWith('.signed_level_withheld'))).toBe(true);
    const { out, graph } = await construct(with54(true), retry);
    expectFirstDraftRegistered(out, graph);
    expect(((out.not_represented ?? []) as string[]).filter((s) => s.includes('-0.5'))).toEqual([]);
  });

  it('RED (row 3f, the ≤ arm): a loop retry that "answers" £54 with that addition and opens £64\'s gap covers LESS of what registers — refused', async () => {
    const base = with54(true, AI_54(0.5, 'additional', 'percentage points'));
    const retry = { ...base, options: [...base.options, NEW_64_GAP] } as typeof base;
    // Vacuity: by the drafter's words, one gap (£64) against the first draft's one: 1 ≤ 1, and strict-more is waived for the loop.
    expect(gapsOnRegistered(retry)).toEqual([{ option: '£64 with AI release', factor: 'AI feature availability' }]);
    const { out, graph, reqs } = await construct(withLoop(with54(true)), retry);
    expect(issues(reqs[1]!.input)).toEqual([GAP_54, LOOP_ISSUE]);
    expect(loopWithheld(out)).toEqual(['pro_plan_subscribers->monthly_churn']);
    expectFirstDraftRegistered(out, graph);
  });

  it('RED (row 3g, the loop route): a retry that breaks the loop and un-declares "Keep current pricing" is refused — the held status quo is kept on every route within the limit', async () => {
    const { out, graph } = await construct(withLoop(with54(true)), declare(with54(true), KEEP, null));
    expect(loopWithheld(out)).toEqual(['pro_plan_subscribers->monthly_churn']);
    expectFirstDraftRegistered(out, graph);
  });

  it('CONTROL (row 3h, a compaction): the status-quo rule never refuses a compaction — refusing would cost the user their model (`model_too_large`)', async () => {
    // Row 2a's compliant compaction, un-declaring "Keep current pricing": its label still reads as the status quo, so it is held, unstamped.
    const { out, graph } = await construct(first(), declare(padded(0, false), KEEP, null));
    expect([out.ok, out.size_retried, out.within_compact_limits]).toEqual([true, true, true]);
    expect(optionIds(graph!)).toEqual(['keep_current_pricing', '59_with_ai_release']);
    expect(keepEdges(graph!)).toEqual(['ai_feature_availability', 'pro_plan_price']);
    expect(held(graph!)).toEqual([]);
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
