/**
 * ⛔ AN OPTION NEVER SETS ITSELF — a first model registered with a loop that Run then refused.
 *
 * SERVED (CEE 9bd3747, DL journey run pj-20260927T183807Z, journey C step C01, scenario 46f84464 —
 * `fixtures/served-journey-c-self-loop-20260927.json`): the drafter named an option "Advertising investment"
 * AND the quantity it sets "Advertising investment". `assignIds` gives the same words ONE id, so the factor was
 * never built and the option's level on it resolved to the option ITSELF: a structural edge
 * `advertising_investment -> advertising_investment` (Olumi's, `cee_hypothesis`). `breakLoops`' caller protects
 * every structural edge, so the loop was KEPT (`loop_kept`), the model was registered, and readiness
 * (`graph-structure-validator.ts` `checkCycles`) refused it on `CYCLE_DETECTED` at birth and at every Run
 * ("'Advertising investment' currently points to itself"). Nothing the user could say removed it.
 *
 * THE FIX (construction's loop handling, `admit-model.ts`): a structural edge from an option to ITSELF is not
 * "what an option sets" — it is only ever born of a drafted quantity that shares the option's name — so when
 * neither the link nor the level it carries is the user's, it is Olumi's link like any other: withheld by
 * `breakLoops`, said (`loop_withheld`), asked of the one repair retry (`loopIssues`), and the level it carried
 * goes with it. A self-link the user stated, or one carrying the user's own figure, is never dropped.
 *
 * The real path throughout: strict-schema candidate -> `buildModelFromBrief` -> the `/graph/register` body ->
 * `GraphV3.parse` -> `validateGraphStructure` / `resolveRunAdmission` -> the `run_analysis` handler through the
 * production snapshot loader, PLoT faked. No LLM: the drafter is faked with the reconstructed candidate.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { SessionStore } from '../../session/store.js';
import { asServedBeforeOneForm } from './fixtures/one-form-levels.js';

type Edge = { from: string; to: string; provenance?: { source?: string } };
type Node = { id: string; kind: string; label: string; provenance?: string; interventions?: Record<string, { value: number; source: string }> };
type Graph = { nodes: Node[]; edges: Edge[]; goal_constraints?: unknown[] };

const SERVED = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-journey-c-self-loop-20260927.json'), 'utf8')) as {
  brief: string;
  draft_graph: Graph;
  analysis_ready: { status: string; blocked_reason: string; may_run: boolean };
  run1: { assistant_text: string; run_state: { reason_code: string } };
};

// Served ids.
const ADVERTISING = 'advertising_investment'; // the option — and, after the id merge, the "factor" it set
const SPEND = 'six_month_incremental_spend';
const ACQUISITION = 'paid_pro_acquisition_rate';
const GOAL = 'mrr';
const SELF = `${ADVERTISING}->${ADVERTISING}`;

type Link = { from: string; to: string; direction: 'positive' | 'negative'; provenance: 'explicit' | 'inferred'; effect_amount?: number; effect_per_source_change?: number };
type Level = { factor_label: string; value: number; unit: string; provenance: 'explicit' | 'inferred' };
const L = (from: string, to: string, direction: Link['direction'], extra: Partial<Link> = {}): Link => ({ from, to, direction, provenance: 'inferred', ...extra });

/** The option's level on the quantity that shares its name — Olumi's £20k, as served (`cee_hypothesis`). */
const ADVERTISING_LEVEL: Level = { factor_label: 'Advertising investment', value: 20000, unit: 'GBP over six months', provenance: 'inferred' };

const SERVED_LINKS: readonly Link[] = [
  L('Pro plan price', 'MRR', 'positive'),
  L('Pro plan price', 'Price sensitivity', 'positive'),
  L('Price sensitivity', 'Pro monthly churn', 'positive', { effect_amount: 0.8, effect_per_source_change: 1 }),
  L('Feature investment', 'Pro monthly churn', 'negative', { effect_amount: -0.5, effect_per_source_change: 20000 }),
  L('Feature investment', 'Paid Pro acquisition rate', 'positive', { effect_amount: 10, effect_per_source_change: 20000 }),
  L('Six-month incremental spend', 'Paid Pro acquisition rate', 'positive'),
  L('Paid Pro acquisition rate', 'Pro paying subscribers', 'positive'),
  L('Pro monthly churn', 'Pro paying subscribers', 'negative'),
  L('Pro paying subscribers', 'MRR', 'positive'),
];

/**
 * The served candidate, reconstructed from the served registered graph (every label, level, range and link read off
 * `draft_graph`). The fidelity rows below prove it: at the served SHA it registers the served bytes, and the served
 * level 0.2 on the option's own id is reproduced ONLY when a factor named "Advertising investment" was drafted.
 */
function servedCandidate(edit: { links?: Link[]; advertisingLevel?: Level; advertisingFactorLabel?: string | null } = {}): CandidateModel {
  // `null`: no factor of that name is drafted at all — the option's level names the option alone.
  const factorLabel = edit.advertisingFactorLabel === undefined || edit.advertisingFactorLabel === null ? 'Advertising investment' : edit.advertisingFactorLabel;
  const noFactor = edit.advertisingFactorLabel === null;
  const level = edit.advertisingLevel ?? ADVERTISING_LEVEL;
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP per month', horizon_months: 6,
      provenance: 'explicit', baseline_known: false, baseline_value: null,
      scope: { modelled: 'Pro plan MRR', alternative: 'MRR across all plans', stated_in_brief: false },
    },
    constraints: [
      { metric: 'Six-month incremental spend', operator: '<=', value: 20000, unit: 'GBP over six months', provenance: 'explicit', frame: 'level' },
      { metric: 'Pro monthly churn', operator: '<=', value: 4, unit: 'percent per month', provenance: 'explicit', frame: 'level' },
    ],
    options: [
      { label: 'Continue as now', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Feature + £59 price', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 59, unit: 'GBP per month', provenance: 'explicit' },
        { factor_label: 'Feature investment', value: 20000, unit: 'GBP over six months', provenance: 'inferred' },
        { factor_label: 'Six-month incremental spend', value: 20000, unit: 'GBP over six months', provenance: 'inferred' },
      ] },
      { label: 'Advertising investment', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { ...level, factor_label: factorLabel },
        { factor_label: 'Six-month incremental spend', value: 20000, unit: 'GBP over six months', provenance: 'inferred' },
        { factor_label: 'Paid Pro acquisition rate', value: 50, unit: 'new Pro subscribers per month', provenance: 'inferred' },
      ] },
      { label: 'Features, hold £49 price', provenance: 'inferred', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 49, unit: 'GBP per month', provenance: 'explicit' },
        { factor_label: 'Feature investment', value: 20000, unit: 'GBP over six months', provenance: 'inferred' },
        { factor_label: 'Six-month incremental spend', value: 20000, unit: 'GBP over six months', provenance: 'inferred' },
      ] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 },
      { label: 'Feature investment', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP over six months', provenance: 'inferred', plausible_max: 100000 },
      { label: 'Six-month incremental spend', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP over six months', provenance: 'inferred', plausible_max: 100000 },
      ...(noFactor ? [] : [{ label: factorLabel, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'GBP over six months', provenance: 'inferred', plausible_max: 100000 }]),
      { label: 'Paid Pro acquisition rate', role: 'observable', baseline_known: false, baseline_value: 20, unit: 'new Pro subscribers per month', provenance: 'inferred', plausible_max: 1000 },
      { label: 'Pro monthly churn', role: 'observable', baseline_known: false, baseline_value: 3, unit: 'percent per month', provenance: 'inferred', plausible_max: 100 },
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro paying subscribers', provenance: 'inferred' }],
    identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro paying subscribers'], provenance: 'inferred' }],
    links: edit.links ?? [...SERVED_LINKS],
    unknowns: [],
  } as unknown as CandidateModel;
}

interface Built { out: Record<string, unknown>; body: Graph; graph: Graph; calls: number; inputs: string[] }

/** The REAL construction, with the drafter faked: `drafts[i]` answers call i (the last repeats). */
async function build(...drafts: CandidateModel[]): Promise<Built> {
  let body: unknown = null;
  const inputs: string[] = [];
  const call = (async (req: { input: string }) => {
    inputs.push(req.input);
    return { text: JSON.stringify(drafts[Math.min(inputs.length - 1, drafts.length - 1)]) };
  }) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', SERVED.brief, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { out, body: body as Graph, graph: GraphV3.parse(body) as unknown as Graph, calls: inputs.length, inputs };
}

const has = (g: Graph, from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);
function reaches(g: Graph, from: string, to: string): boolean {
  const seen = new Set([from]);
  const stack = [from];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (x === to) return true;
    for (const e of g.edges) if (e.from === x && !seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
  }
  return false;
}
const cycleFree = (g: Graph) => !validateGraphStructure(GraphV3.parse(g)).violations.some((v) => v.code === 'CYCLE_DETECTED');
const blockers = (g: Graph) => resolveRunAdmission(g).assessment.blockingIssues.map((i) => i.code).sort();
const loopWithheld = (out: Record<string, unknown>) =>
  ((out.withheld as { from: string; to: string; reason: string }[]) ?? []).filter((w) => w.reason === 'loop_closing_link').map((w) => `${w.from}->${w.to}`);
const loopLines = (out: Record<string, unknown>) => ((out.not_represented as string[]) ?? []).filter((s) => /loop/i.test(s));
const advertising = (g: Graph) => g.nodes.find((n) => n.id === ADVERTISING)!;

/** Sorted-key JSON, so the served bytes and ours compare by content, not key order (the store is JSONB). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** `run_analysis` through the production snapshot loader, PLoT faked. */
async function runAnalysis(graph: Graph): Promise<{ plotCalls: { options: { option_id?: string; id?: string; interventions?: Record<string, number> }[] }[]; error: unknown }> {
  const plotCalls: { options: { option_id?: string; id?: string; interventions?: Record<string, number> }[] }[] = [];
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
  const plotClient = {
    run: async (payload: { options: { option_id?: string; id?: string }[] }) => {
      plotCalls.push(payload);
      return {
        analysis_status: 'computed',
        results: payload.options.map((o, i) => ({ option_id: o.option_id ?? o.id, option_label: String(o.option_id ?? o.id), win_probability: i === 0 ? 0.4 : 0.2 })),
        response_hash: 'hash_self_loop',
        meta: { seed_used: 1 },
      };
    },
  } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: async (scenarioId: string) => loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-self-loop', store),
  });
  const invocation = { payload: { scenario_id: '77777777-7777-4777-8777-777777777777' }, requestId: 'req-self-loop', signal: undefined } as unknown as HandlerInvocation;
  let error: unknown = null;
  try { await handler(invocation); } catch (e) { error = e; }
  return { plotCalls, error };
}

/** The fields G1 (#2140) stamps on the ONE goal node (`stated-by-user.ts`), named so a re-pin can never hide another move. */
const G1_GOAL_FIELDS = ['threshold_source', 'goal_direction', 'goal_horizon_months'] as const;
function withoutG1<T extends { kind?: string }>(n: T): T {
  if (n.kind !== 'goal') return n;
  const copy = { ...(n as Record<string, unknown>) };
  for (const k of G1_GOAL_FIELDS) delete copy[k];
  return copy as T;
}
function addedGoalKeys(built: ReadonlyArray<{ kind?: string }>, served: ReadonlyArray<{ kind?: string }>): string[] {
  const b = (built.find((n) => n.kind === 'goal') ?? {}) as Record<string, unknown>;
  const v = (served.find((n) => n.kind === 'goal') ?? {}) as Record<string, unknown>;
  return Object.keys(b).filter((k) => !(k in v)).sort();
}

describe('the fixture IS the served model (fidelity, not a self-authored stand-in)', () => {
  it('served: the option pointed at itself, the self-link was the only loop, and Run was refused on it', async () => {
    expect(SERVED.analysis_ready).toMatchObject({ status: 'blocked', blocked_reason: 'CYCLE_DETECTED', may_run: false });
    expect(SERVED.run1.run_state.reason_code).toBe('CYCLE_DETECTED');
    const self = SERVED.draft_graph.edges.filter((e) => e.from === e.to);
    expect(self.map((e) => `${e.from}->${e.to}`)).toEqual([SELF]);
    expect(self[0]!.provenance?.source).toBe('cee_hypothesis');
    expect(SERVED.draft_graph.nodes.filter((n) => n.id === ADVERTISING).map((n) => n.kind)).toEqual(['option']);
    expect(Object.keys(advertising(SERVED.draft_graph).interventions ?? {})).toContain(ADVERTISING);
    // Readiness's own check, and the Run itself: refused, PLoT never called.
    expect(cycleFree(SERVED.draft_graph)).toBe(false);
    expect(blockers(SERVED.draft_graph)).toEqual(['CYCLE_DETECTED']);
    const { plotCalls, error } = await runAnalysis(SERVED.draft_graph);
    expect(plotCalls).toHaveLength(0);
    expect(String(error)).toMatch(/not analysis-ready/);
  });

  it('the reconstructed candidate registers the served nodes, edges and limits — less ONLY the withheld self-link and the level it carried', async () => {
    const { out, body } = await build(servedCandidate());
    const withheld = new Set(loopWithheld(out));
    const servedNodes = SERVED.draft_graph.nodes.map((n) => {
      if (n.id !== ADVERTISING || !withheld.has(SELF)) return n;
      const { [ADVERTISING]: _self, ...rest } = n.interventions!;
      return { ...n, interventions: rest };
    });
    // G1 (#2140, landed after this capture) stamps the goal's held attributes. They are NAMED here and subtracted, never
    // hidden: the rest of every node must still equal the served model byte for byte.
    // 0.67.0's goal `unit_reading` also postdates this capture: read back in the served form first (`one-form-levels.ts`).
    const added = addedGoalKeys(asServedBeforeOneForm(body, SERVED.draft_graph).nodes, servedNodes);
    expect(added.length).toBeGreaterThan(0); // G1 did stamp this brief's goal (a vacuous subtraction is a failure)
    expect(added.every((k) => (G1_GOAL_FIELDS as readonly string[]).includes(k)), added.join(',')).toBe(true);
    // P2 A5 (#2139), landed after this capture too: option levels are read back in the served short form, on the SERVED
    // factors' own frames and units (`one-form-levels.ts`); anything else they carry still fails this compare.
    expect(asServedBeforeOneForm(body, SERVED.draft_graph).nodes.map((n) => canon(withoutG1(n)))).toEqual(servedNodes.map(canon));
    expect(body.edges.map(canon)).toEqual(SERVED.draft_graph.edges.filter((e) => !withheld.has(`${e.from}->${e.to}`)).map(canon));
    expect(canon(body.goal_constraints)).toEqual(canon(SERVED.draft_graph.goal_constraints));
  });

  it('control: the served level (0.2 on the option’s own id) needs a drafted FACTOR of that name — an option naming itself alone gives 20000', async () => {
    // The frame (100000) that makes 20000 read 0.2 is a FACTOR's: so a factor named "Advertising investment" was
    // drafted and folded into the option by the shared name. Read through the user-figure arm, which is kept.
    const mine = { ...ADVERTISING_LEVEL, provenance: 'explicit' as const };
    expect(advertising(SERVED.draft_graph).interventions![ADVERTISING]!.value).toBe(0.2);
    const withFactor = await build(servedCandidate({ advertisingLevel: mine }));
    expect(advertising(withFactor.graph).interventions![ADVERTISING]!.value).toBe(0.2);
    const optionAlone = await build(servedCandidate({ advertisingLevel: mine, advertisingFactorLabel: null }));
    expect(advertising(optionAlone.graph).interventions![ADVERTISING]!.value).toBe(20000);
  });
});

describe('SERVED self-loop (Olumi’s link, Olumi’s level): withheld, said, asked, and the model runs', () => {
  it('RED: the registered graph has no loop — by readiness’s own check', async () => {
    const { graph } = await build(servedCandidate());
    expect(has(graph, ADVERTISING, ADVERTISING)).toBe(false);
    expect(cycleFree(graph)).toBe(true);
  });

  it('RED: the level the self-link carried goes with it — no option sets an option', async () => {
    const { graph } = await build(servedCandidate());
    const optionIds = new Set(graph.nodes.filter((n) => n.kind === 'option').map((n) => n.id));
    for (const o of graph.nodes.filter((n) => n.kind === 'option')) {
      expect(Object.keys(o.interventions ?? {}).filter((k) => optionIds.has(k)), o.id).toEqual([]);
    }
    // The user's option is kept, with everything else it does.
    expect(advertising(graph)).toMatchObject({ kind: 'option', label: 'Advertising investment', provenance: 'from_brief' });
    expect(Object.keys(advertising(graph).interventions ?? {}).sort()).toEqual([ACQUISITION, SPEND]);
    expect(has(graph, ADVERTISING, SPEND) && has(graph, ADVERTISING, ACQUISITION)).toBe(true);
    expect(reaches(graph, ADVERTISING, GOAL)).toBe(true);
  });

  it('RED: it is SAID, once, as Olumi’s link; nothing is said as kept', async () => {
    const { out } = await build(servedCandidate());
    expect(loopWithheld(out)).toEqual([SELF]);
    const lines = loopLines(out);
    expect(lines, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(lines[0]).toBe('"Advertising investment" was linked to itself; a model cannot hold a loop, so that link was left out '
      + "(it was Olumi's reading, not something you said).");
  });

  it('RED: the self-link is a construction issue for the ONE repair retry, like any loop Olumi closed', async () => {
    const { calls, inputs, out } = await build(servedCandidate());
    expect(calls).toBe(2);
    const issues = JSON.parse(/Construction issues: (\[.*\])\n/.exec(inputs[1]!)![1]!) as string[];
    expect(issues.filter((i) => i.startsWith('"Advertising investment" -> "Advertising investment" is a loop'))).toHaveLength(1);
    expect(out.construction_retried).toBe(true);
  });

  it('RED (OUTCOME): readiness is not blocked, and Run calls PLoT once for all four options — none carrying an option id as a level', async () => {
    const { graph } = await build(servedCandidate());
    expect(blockers(graph)).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    const { plotCalls, error } = await runAnalysis(graph);
    expect(error).toBeNull();
    expect(plotCalls).toHaveLength(1);
    const options = plotCalls[0]!.options;
    expect(options.map((o) => o.option_id ?? o.id).sort()).toEqual([ADVERTISING, 'continue_as_now', 'feature_59_price', 'features_hold_49_price']);
    const ids = new Set(options.map((o) => o.option_id ?? o.id));
    for (const o of options) expect(Object.keys(o.interventions ?? {}).filter((k) => ids.has(k)), String(o.option_id ?? o.id)).toEqual([]);
  });
});

describe('CONTRAST — nothing else moves, and nothing of the user’s is dropped', () => {
  /**
   * The same draft with the quantity named apart ("Advertising spend"): no shared name, no loop. Its registered
   * body is pinned to the digest recorded at the served SHA (CEE cd489f1, before this fix): byte-identical.
   */
  const ACYCLIC_BODY_SHA256_AT_BASE = '2a2b04a4b4cce87995a9c42b96a95c478a617045d4aea6d626f548b40d909c58';

  it('an acyclic draft registers byte-identical, with no loop said or asked', async () => {
    const { out, body, calls } = await build(servedCandidate({ advertisingFactorLabel: 'Advertising spend' }));
    expect(cycleFree(body)).toBe(true);
    expect(loopWithheld(out)).toEqual([]);
    expect(loopLines(out)).toEqual([]);
    expect(calls).toBe(1);
    // The digest recorded at cd489f1 (before G1) still pins every byte except G1's named goal fields (#2140) and the
    // members P2 A5 (#2139) adds to an option level, read back to the served short form. This draft has no served graph
    // of its own, so the frames are read off the body; that is sound HERE because the factor nodes carrying those frames
    // are inside the same digest, so a wrong frame, figure or unit still moves it.
    // 0.67.0's goal `unit_reading` postdates the digest too: the stand-in "served" graph is the body without it, so the
    // helper removes it only in the writer's closed shape; every frame is still read off the same factor nodes.
    const readBack = asServedBeforeOneForm(body, { ...body, nodes: (body.nodes as Record<string, unknown>[]).map(({ unit_reading: _r, ...n }) => n) });
    expect(createHash('sha256').update(canon({ ...readBack, nodes: readBack.nodes.map(withoutG1) })).digest('hex')).toBe(ACYCLIC_BODY_SHA256_AT_BASE);
  });

  // Re-recorded (CEE #2355; AIQ 5909754019 (2), P0 PARTNER CR 5909944908): a drafted `explicit` self-link with no
  // figure of the user's behind it rests only on the drafter's word, so it is Olumi's link and is left out like one. The
  // row below (the self-link carrying the USER's own figure) is the one the user owns, and it is still never dropped.
  it('a drafted "explicit" self-link with no figure of the user\'s is Olumi\'s: left out, and said as Olumi\'s', async () => {
    const links = [...SERVED_LINKS, { ...L('Advertising investment', 'Advertising investment', 'positive'), provenance: 'explicit' as const }];
    const { out, graph } = await build(servedCandidate({ links }));
    expect(loopWithheld(out)).toEqual([SELF]);
    expect(graph.edges.find((e) => e.from === ADVERTISING && e.to === ADVERTISING)).toBeUndefined();
    expect(loopLines(out).some((s) => s.includes("it was Olumi's reading, not something you said"))).toBe(true);
  });

  it('a self-link carrying the USER’s own figure is never dropped: the figure stays, and nothing says it was Olumi’s', async () => {
    const { out, graph } = await build(servedCandidate({ advertisingLevel: { ...ADVERTISING_LEVEL, provenance: 'explicit' } }));
    expect(loopWithheld(out)).toEqual([]);
    expect(has(graph, ADVERTISING, ADVERTISING)).toBe(true);
    // P2 A5 (#2139): the level also names the key it is stored under (`target_match`), as every constructed level does.
    expect(advertising(graph).interventions?.[ADVERTISING]).toEqual({
      value: 0.2, source: 'brief_extraction', target_match: { node_id: ADVERTISING, match_type: 'exact_id', confidence: 'high' },
    });
    expect(loopLines(out).some((s) => s.includes("Olumi's reading"))).toBe(false);
  });
});
