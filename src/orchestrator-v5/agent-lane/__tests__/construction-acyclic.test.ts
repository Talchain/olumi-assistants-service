/**
 * ⛔ A FIRST MODEL WITH A LOOP IN IT CAN NEVER BE ANALYSED — AND NOTHING SAID WHY.
 *
 * SERVED (CEE bdd43f4a, Delivery Lead acceptance run f-20260925T231546Z, Paul's
 * pricing brief — `fixtures/served-pricing-loop-20260925.json`): the drafter
 * stated `AI feature availability -> AI release delay` AND `AI release delay ->
 * AI feature availability`, both Olumi's own hypotheses (`cee_hypothesis`).
 * Admission registered both. Readiness then refused the whole model on
 * `CYCLE_DETECTED` — the ONLY blocker — `may_run: false`, and the build result
 * said nothing about a loop at all. Paul's journey stopped at step 1 with nothing
 * he could act on.
 *
 * The rule readiness applies is `checkCycles` in
 * `src/orchestrator/graph-structure-validator.ts`: a DFS over EVERY directed edge
 * of the registered graph (only `bidirected` is skipped, and admission never
 * writes one) — decision->option, option->factor, the held status quo's repair
 * edges and every causal link alike. So the registered first model must be a DAG
 * over exactly that edge set.
 *
 * THE FIX, in the order the brief sets:
 *  (a) a loop among the CANDIDATE's links is a construction issue for the one
 *      existing repair retry (`prepareProvisionalCandidate`), naming the loop;
 *  (b) whatever is admitted, admission withholds ONE link per loop — never a
 *      link the user stated when one of Olumi's own closes the same loop; among
 *      Olumi's, the one whose absence leaves every node's path to the goal
 *      intact, then the one pointing furthest AWAY from the goal, then by kind,
 *      then by id — and SAYS it. A loop made only of the user's own links is left
 *      in place and said: that choice is theirs.
 *
 * Every assertion names nodes by id. The real path throughout: strict-schema
 * candidate -> `buildModelFromBrief` -> the `/graph/register` body ->
 * `GraphV3.parse` -> `validateGraphStructure` / `resolveRunAdmission` -> the
 * `run_analysis` handler through the production snapshot loader, PLoT faked.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildModelFromBrief, prepareProvisionalCandidate, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { SessionStore } from '../../session/store.js';

type Edge = { from: string; to: string; provenance?: { source?: string }; effect_direction?: string; strength?: { mean: number } };
type Node = { id: string; kind: string; label: string };
type Graph = { nodes: Node[]; edges: Edge[] };

const SERVED = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'served-pricing-loop-20260925.json'), 'utf8')) as {
  brief: string;
  draft_graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  analysis_ready: { status: string; blocked_reason: string; may_run: boolean };
};

// Served ids — the loop, and the nodes around it.
const AVAILABILITY = 'ai_feature_availability'; // factor, set by two options
const DELAY = 'ai_release_delay';               // risk
const GOAL = 'mrr';
const NEW_CONVERSIONS = 'new_pro_conversions';
const SUBSCRIBERS = 'pro_subscribers';
const PRO_MRR = 'pro_mrr';

type Link = { from: string; to: string; direction: 'positive' | 'negative' | 'unknown'; provenance: 'explicit' | 'inferred' | 'ai_proposed' };
const L = (from: string, to: string, direction: Link['direction'], provenance: Link['provenance'] = 'inferred'): Link => ({ from, to, direction, provenance });

/** The served back link, and its twin. Labels, as the drafter wrote them. */
const AVAIL_TO_DELAY = L('AI feature availability', 'AI release delay', 'negative');
const DELAY_TO_AVAIL = L('AI release delay', 'AI feature availability', 'negative');

/**
 * The served candidate, reconstructed from the served registered graph (every
 * label, level, range and link read off `draft_graph`). The first test below
 * proves the reconstruction: on this candidate the register body's nodes and
 * edges are the served bytes, less only what this fix withholds.
 */
function servedCandidate(links: readonly Link[] = SERVED_LINKS): CandidateModel {
  const est = (label: string, role: 'controllable' | 'observable', value: number, unit: string, plausible_max: number) =>
    ({ label, role, baseline_known: false, baseline_value: value, unit, provenance: 'inferred', plausible_max });
  return {
    goal: {
      metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP/month', horizon_months: 12,
      provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit',
    },
    constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit' }],
    options: [
      { label: 'Keep £49 Price', provenance: 'inferred', changes: [], interventions: [], is_status_quo: true },
      { label: 'Raise to £59', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP/month', provenance: 'explicit' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'release index', provenance: 'ai_proposed' },
      ] },
      { label: 'Phased £54 Price', provenance: 'ai_proposed', changes: [], is_status_quo: null, interventions: [
        { factor_label: 'Pro plan price', value: 54, value_kind: 'absolute', unit: 'GBP/month', provenance: 'ai_proposed' },
        { factor_label: 'AI feature availability', value: 1, value_kind: 'absolute', unit: 'release index', provenance: 'ai_proposed' },
      ] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP/month', provenance: 'explicit', plausible_max: 200 },
      est('AI feature availability', 'controllable', 0, 'release index', 2),
      est('Pro subscribers', 'observable', 250, 'subscribers', 2000),
      est('New Pro conversions', 'observable', 25, 'subscribers/month', 500),
      est('Monthly churn', 'observable', 7, '%', 100),
      est('Non-Pro MRR', 'observable', 5000, 'GBP/month', 50000),
    ],
    risks: [{ label: 'Price sensitivity', provenance: 'inferred' }, { label: 'AI release delay', provenance: 'inferred' }],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: links as CandidateModel['links'],
    unknowns: [],
  } as unknown as CandidateModel;
}

const SERVED_LINKS: readonly Link[] = [
  L('Pro plan price', 'Pro MRR', 'positive'),
  L('Pro plan price', 'Price sensitivity', 'positive'),
  L('AI feature availability', 'New Pro conversions', 'positive'),
  AVAIL_TO_DELAY,
  L('AI feature availability', 'Pro MRR', 'positive'),
  L('Pro subscribers', 'Pro MRR', 'positive'),
  L('New Pro conversions', 'Pro subscribers', 'positive'),
  L('Monthly churn', 'Pro subscribers', 'negative'),
  L('Price sensitivity', 'Monthly churn', 'positive'),
  DELAY_TO_AVAIL,
  L('Pro MRR', 'MRR', 'positive'),
  L('Non-Pro MRR', 'MRR', 'positive'),
];

/** The one construction issue the served loop raises, word for word. */
const SERVED_LOOP_ISSUE = '"AI feature availability" -> "AI release delay" -> "AI feature availability" is a loop: a model cannot hold one. '
  + 'Keep the direction that carries the cause toward the goal metric, remove the link that points back, and keep every '
  + 'option and risk connected to the goal through links whose direction you state.';

/** Replace one link (matched by from/to) — every other byte of the served candidate kept. */
const withLinks = (edit: (links: Link[]) => Link[]): CandidateModel => servedCandidate(edit([...SERVED_LINKS]));
const restamp = (from: string, to: string, provenance: Link['provenance']) => (ls: Link[]) =>
  ls.map((l) => (l.from === from && l.to === to ? { ...l, provenance } : l));

interface Built { out: Record<string, unknown>; body: Graph; graph: Graph; calls: number; inputs: string[]; instructions: string[] }

/** The REAL construction, with the drafter faked: `drafts[i]` answers call i (the last repeats). */
async function build(...drafts: CandidateModel[]): Promise<Built> {
  let body: unknown = null;
  const inputs: string[] = [];
  const instructions: string[] = [];
  const call = (async (req: { input: string; instructions: string }) => {
    inputs.push(req.input);
    instructions.push(req.instructions);
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
  return { out, body: body as Graph, graph: GraphV3.parse(body) as unknown as Graph, calls: inputs.length, inputs, instructions };
}

const has = (g: Graph, from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);
const cycleFree = (g: Graph) => !validateGraphStructure(GraphV3.parse(g)).violations.some((v) => v.code === 'CYCLE_DETECTED');
const blockers = (g: Graph) => resolveRunAdmission(g).assessment.blockingIssues.map((i) => i.code).sort();
const loopWithheld = (out: Record<string, unknown>) =>
  ((out.withheld as { from: string; to: string; reason: string }[]) ?? []).filter((w) => w.reason === 'loop_closing_link').map((w) => `${w.from}->${w.to}`);
const saidAbout = (out: Record<string, unknown>, ...labels: string[]) =>
  ((out.not_represented as string[]) ?? []).filter((s) => /loop/i.test(s) && labels.every((l) => s.includes(l)));
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

/** Sorted-key JSON, so the served bytes and ours compare by content, not key order. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

/** `run_analysis` through the production snapshot loader, PLoT faked. */
async function runAnalysis(graph: Graph): Promise<{ plotCalls: { options: { option_id?: string; id?: string }[] }[]; error: unknown }> {
  const plotCalls: { options: { option_id?: string; id?: string }[] }[] = [];
  const store = {
    loadGraph: async () => graph,
    loadGraphAndBriefText: async () => ({ graph, briefText: null }),
  } as unknown as SessionStore;
  const plotClient = {
    run: async (payload: { options: { option_id?: string; id?: string }[] }) => {
      plotCalls.push(payload);
      return {
        analysis_status: 'computed',
        results: payload.options.map((o, i) => ({ option_id: o.option_id ?? o.id, option_label: String(o.option_id ?? o.id), win_probability: i === 0 ? 0.6 : 0.4 / Math.max(1, payload.options.length - 1) })),
        response_hash: 'hash_acyclic',
        meta: { seed_used: 1 },
      };
    },
  } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: async (scenarioId: string) => loadScenarioSnapshotForRunAnalysis(scenarioId, 'req-acyclic', store),
  });
  const invocation = { payload: { scenario_id: '77777777-7777-4777-8777-777777777777' }, requestId: 'req-acyclic', signal: undefined } as unknown as HandlerInvocation;
  let error: unknown = null;
  try { await handler(invocation); } catch (e) { error = e; }
  return { plotCalls, error };
}

describe('the fixture IS the served model (fidelity, not a self-authored stand-in)', () => {
  it('served: the loop was the only blocker and the run was refused', () => {
    expect(SERVED.analysis_ready).toMatchObject({ status: 'blocked', blocked_reason: 'CYCLE_DETECTED', may_run: false });
    const edges = SERVED.draft_graph.edges as unknown as Edge[];
    expect(edges.some((e) => e.from === AVAILABILITY && e.to === DELAY && e.provenance?.source === 'cee_hypothesis')).toBe(true);
    expect(edges.some((e) => e.from === DELAY && e.to === AVAILABILITY && e.provenance?.source === 'cee_hypothesis')).toBe(true);
  });

  it('the reconstructed candidate registers the served nodes byte-for-byte, and the served edges less ONLY the withheld loop link', async () => {
    const { out, body } = await build(servedCandidate());
    // The served fixture predates goal direction (NodeV3 `goal_direction`, CEE-minted from the user's stated
    // operator): bind it — the brief's ">= £20k" goal is attested `maximise` — then compare on the served-era shape.
    const goal = (body.nodes as { kind?: unknown; goal_direction?: unknown }[]).find((n) => n.kind === 'goal');
    expect(goal?.goal_direction, 'the stated >= goal carries its attested direction').toBe('maximise');
    const servedEra = (body.nodes as Record<string, unknown>[]).map((n) => {
      if (n.kind !== 'goal') return n;
      const { goal_direction: _direction, ...rest } = n;
      return rest;
    });
    expect(servedEra.map(canon)).toEqual(SERVED.draft_graph.nodes.map(canon));
    const withheld = new Set(loopWithheld(out));
    const servedLessWithheld = (SERVED.draft_graph.edges as unknown as Edge[]).filter((e) => !withheld.has(`${e.from}->${e.to}`));
    expect(body.edges.map(canon)).toEqual(servedLessWithheld.map(canon));
  });
});

describe('SERVED 2-loop (factor <-> risk, both Olumi’s): withheld, said, and the model runs', () => {
  it('RED: the registered graph has no loop — by readiness’s own check', async () => {
    const { graph } = await build(servedCandidate());
    expect(cycleFree(graph)).toBe(true);
  });

  it('RED: the link pointing AWAY from the goal is the one withheld; the risk keeps its path to the goal', async () => {
    const { out, graph } = await build(servedCandidate());
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`]);
    expect(has(graph, AVAILABILITY, DELAY)).toBe(false);
    // The risk's own threat to availability is kept — and through it the risk still reaches MRR.
    expect(graph.edges.find((e) => e.from === DELAY && e.to === AVAILABILITY)?.effect_direction).toBe('negative');
    expect(reaches(graph, DELAY, GOAL)).toBe(true);
    // Nothing else moved: one link fewer than served, and no node lost its path to the goal.
    expect(graph.edges).toHaveLength(SERVED.draft_graph.edges.length - 1);
    for (const n of graph.nodes) if (n.kind !== 'goal' && n.kind !== 'decision') expect(reaches(graph, n.id, GOAL), n.id).toBe(true);
  });

  it('RED: it is SAID, once, in the user’s own labels, with the direction that was left out', async () => {
    const { out } = await build(servedCandidate());
    const lines = saidAbout(out, 'AI feature availability', 'AI release delay');
    expect(lines, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(lines[0]).toContain('the link from "AI feature availability" to "AI release delay" was left out');
    // …and it is not miscounted as a link whose direction nobody stated.
    expect((out.not_represented as string[]).some((s) => s.includes('nobody has stated which way they run'))).toBe(false);
  });

  it('RED (OUTCOME): readiness is no longer blocked — may_run, and PLoT is called once for every option', async () => {
    const { graph } = await build(servedCandidate());
    expect(blockers(graph)).toEqual([]);
    expect(resolveRunAdmission(graph).willProceed).toBe(true);
    const { plotCalls, error } = await runAnalysis(graph);
    expect(error).toBeNull();
    expect(plotCalls).toHaveLength(1);
    expect(plotCalls[0]!.options.map((o) => o.option_id ?? o.id).sort()).toEqual(['keep_49_price', 'phased_54_price', 'raise_to_59']);
  });

  it('RED (a): the loop is a construction issue for the ONE repair retry, naming the loop exactly', async () => {
    const { calls, inputs, instructions, out, graph } = await build(servedCandidate());
    expect(calls).toBe(2);
    // The retry is handed exactly the loop admission had to break (the input carries it as JSON).
    expect(JSON.parse(/Construction issues: (\[.*\])\n/.exec(inputs[1]!)![1]!)).toEqual([SERVED_LOOP_ISSUE]);
    expect(instructions[1]).toMatch(/Repair only the listed construction issues/);
    // The retry repeats the looped draft: whatever it is adopted on, the backstop acts on the loop.
    expect(out.construction_retried).toBe(true);
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`]);
    expect(cycleFree(graph)).toBe(true);
  });

  it('(a) adopted: a retry that routes the risk on to what it threatens is adopted, and nothing is withheld', async () => {
    const repaired = withLinks((ls) => [...ls.filter((l) => l !== DELAY_TO_AVAIL), L('AI release delay', 'New Pro conversions', 'negative')]);
    const { calls, out, graph } = await build(servedCandidate(), repaired);
    expect(calls).toBe(2);
    expect(has(graph, DELAY, NEW_CONVERSIONS)).toBe(true);
    expect(has(graph, AVAILABILITY, DELAY)).toBe(true);
    expect(has(graph, DELAY, AVAILABILITY)).toBe(false);
    expect(loopWithheld(out)).toEqual([]);
    expect(cycleFree(graph)).toBe(true);
    expect(saidAbout(out, 'AI release delay')).toEqual([]);
  });
});

describe('the whole class: every loop shape', () => {
  it('RED: a 3-loop (factor -> factor -> outcome -> factor): the outcome’s link back is withheld and said', async () => {
    const c = withLinks((ls) => [...ls, L('Pro MRR', 'New Pro conversions', 'positive')]);
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    // One link per loop: the served 2-loop in the same draft, then the 3-loop's outcome link back.
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`, `${PRO_MRR}->${NEW_CONVERSIONS}`]);
    expect(has(graph, NEW_CONVERSIONS, SUBSCRIBERS) && has(graph, SUBSCRIBERS, PRO_MRR)).toBe(true);
    const lines = saidAbout(out, 'New Pro conversions', 'Pro subscribers', 'Pro MRR');
    expect(lines, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(lines[0]).toContain('the link from "Pro MRR" to "New Pro conversions" was left out');
  });

  it('RED: both directions leave every node connected — the link pointing AWAY from the goal is withheld', async () => {
    // The risk gains its own route on (to conversions), so neither withholding strands anything:
    // availability is 2 links from MRR, the delay 3, so availability -> delay points away.
    const c = withLinks((ls) => [...ls, L('AI release delay', 'New Pro conversions', 'negative')]);
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`]);
    expect(has(graph, DELAY, AVAILABILITY) && has(graph, DELAY, NEW_CONVERSIONS)).toBe(true);
  });

  it('RED: equally far from the goal — by kind, the risk’s link back onto the factor is withheld', async () => {
    // The risk links straight to Pro MRR too, so both nodes sit 2 links from MRR and neither choice strands.
    const c = withLinks((ls) => [...ls, L('AI release delay', 'Pro MRR', 'negative')]);
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    expect(loopWithheld(out)).toEqual([`${DELAY}->${AVAILABILITY}`]);
    expect(has(graph, AVAILABILITY, DELAY) && has(graph, DELAY, PRO_MRR)).toBe(true);
    expect(blockers(graph)).not.toContain('NO_PATH_TO_GOAL');
  });

  it('RED: one link in the loop is the USER’s — Olumi’s is withheld, even where it strands the risk, and that is said too', async () => {
    const c = withLinks(restamp('AI feature availability', 'AI release delay', 'explicit'));
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    const kept = graph.edges.find((e) => e.from === AVAILABILITY && e.to === DELAY);
    expect(kept?.provenance?.source).toBe('brief_extraction');
    expect(has(graph, DELAY, AVAILABILITY)).toBe(false);
    expect(loopWithheld(out)).toEqual([`${DELAY}->${AVAILABILITY}`]);
    expect(saidAbout(out, 'AI release delay', 'AI feature availability')[0]).toContain('the link from "AI release delay" to "AI feature availability" was left out');
    // ⛔ REVIEW (a): the risk left with no link gets the SAME risk -> goal repair every unconnected risk gets —
    // computed after the loop is broken, not from the edges before it.
    const repair = graph.edges.find((e) => e.from === DELAY && e.to === GOAL);
    expect(repair?.effect_direction).toBe('negative');
    expect(repair?.provenance?.source).toBe('cee_hypothesis');
    expect(blockers(graph)).not.toContain('NO_PATH_TO_GOAL');
    expect(blockers(graph)).not.toContain('CYCLE_DETECTED');
  });

  it('RED: every link in the loop is the USER’s — nothing withheld, the loop kept, said, and the blocker is honest', async () => {
    const c = withLinks((ls) => restamp('AI release delay', 'AI feature availability', 'explicit')(restamp('AI feature availability', 'AI release delay', 'explicit')(ls)));
    const { out, graph, calls } = await build(c);
    expect(calls, 'the user’s own loop is not the drafter’s to repair').toBe(1);
    expect(loopWithheld(out)).toEqual([]);
    expect(has(graph, AVAILABILITY, DELAY) && has(graph, DELAY, AVAILABILITY)).toBe(true);
    expect(blockers(graph)).toContain('CYCLE_DETECTED');
    const lines = saidAbout(out, 'AI feature availability', 'AI release delay');
    expect(lines, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(lines[0]).toMatch(/you linked/i);
    expect(lines[0]).toMatch(/which way/i);
  });

  it.each([
    ['inferred', true],
    ['explicit', false],
  ] as const)('RED: a self-loop (%s) — Olumi’s is withheld; the user’s is kept; either way it is said', async (provenance, withheld) => {
    const c = withLinks((ls) => [...ls, L('Monthly churn', 'Monthly churn', 'positive', provenance)]);
    const { out, graph } = await build(c);
    expect(has(graph, 'monthly_churn', 'monthly_churn')).toBe(!withheld);
    expect(loopWithheld(out).includes('monthly_churn->monthly_churn')).toBe(withheld);
    expect(saidAbout(out, 'Monthly churn')).toHaveLength(1);
    expect(blockers(graph).includes('CYCLE_DETECTED')).toBe(!withheld);
  });

  it('RED: a loop through an OPTION (factor -> option) — the structural option edge is never the one withheld', async () => {
    const c = withLinks((ls) => [...ls, L('Pro subscribers', 'Raise to £59', 'positive')]);
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    expect(loopWithheld(out)).toContain(`${SUBSCRIBERS}->raise_to_59`);
    expect(has(graph, 'raise_to_59', 'pro_plan_price') && has(graph, 'raise_to_59', AVAILABILITY)).toBe(true);
  });
});

describe('CONTROL: an acyclic model is unchanged', () => {
  it('the served model without its back link: no retry, nothing withheld, every served edge but that one, byte-for-byte', async () => {
    const acyclic = withLinks((ls) => ls.filter((l) => l !== AVAIL_TO_DELAY));
    expect(prepareProvisionalCandidate(acyclic).mechanism_issues).toEqual([]);
    const { out, body, calls } = await build(acyclic);
    expect(calls).toBe(1);
    expect(loopWithheld(out)).toEqual([]);
    expect(saidAbout(out)).toEqual([]);
    const served = (SERVED.draft_graph.edges as unknown as Edge[]).filter((e) => !(e.from === AVAILABILITY && e.to === DELAY));
    expect(body.edges).toHaveLength(served.length);
    expect(body.edges.map(canon)).toEqual(served.map(canon));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Independent verification of f504b8e0 — two blocking findings, four cheap ones.
// ─────────────────────────────────────────────────────────────────────────────

type Addition = {
  factors?: string[];
  risks?: string[];
  links?: Link[];
  /** option label -> factor label, an `ai_proposed` level of 1 */
  sets?: [string, string][];
};
/** The served candidate, plus what a case needs — nothing of the served draft changed. */
function extended(base: CandidateModel, add: Addition): CandidateModel {
  const c = structuredClone(base) as unknown as {
    factors: Record<string, unknown>[]; risks: Record<string, unknown>[]; links: Link[];
    options: { label: string; interventions?: Record<string, unknown>[] }[];
  };
  for (const label of add.factors ?? []) {
    c.factors.push({ label, role: 'observable', baseline_known: false, baseline_value: 10, unit: 'index', provenance: 'ai_proposed', plausible_max: 100 });
  }
  for (const label of add.risks ?? []) c.risks.push({ label, provenance: 'inferred' });
  c.links.push(...(add.links ?? []));
  for (const [option, factor] of add.sets ?? []) {
    const o = c.options.find((x) => x.label === option)!;
    o.interventions = [...(o.interventions ?? []), { factor_label: factor, value: 1, value_kind: 'absolute', unit: 'index', provenance: 'ai_proposed' }];
  }
  return c as unknown as CandidateModel;
}
const speculative = (kind: 'factors' | 'risks', n: number): Addition => {
  const labels = Array.from({ length: n }, (_, i) => `Speculative ${kind === 'factors' ? 'factor' : 'risk'} ${i}`);
  return { [kind]: labels, links: labels.map((l) => L(l, 'MRR', kind === 'factors' ? 'positive' : 'negative', 'ai_proposed')) };
};
const ledger = (c: CandidateModel) => admitCandidateModel(prepareProvisionalCandidate(c).candidate, {}).loss.map((l) => String(l.field_path));

describe('BLOCKING-1: a loop never costs the user their model — an oversized first draft is still built', () => {
  it('RED: oversized + looped; the size retry EDITS its draft (the measured 8/8 route), keeps the loop, and is adopted — the backstop withholds and says it', async () => {
    const first = extended(servedCandidate(), speculative('factors', 5));
    const { out, graph, calls, inputs, instructions } = await build(first, servedCandidate());
    expect(out.size_retried, 'PRECONDITION: the first draft was oversized').toBe(true);
    expect(calls).toBe(2);
    // A loop alone never reroutes an oversized draft away from #1898's size-only edit-own-draft retry.
    expect(instructions[1]).toMatch(/Copy every item you keep EXACTLY/);
    expect(inputs[1]).toContain('Your previous model, to shrink:');
    expect(inputs[1]).not.toContain('Construction issues');
    // …and a retry still carrying a loop the backstop can break is not refused for it.
    expect(out.within_compact_limits).toBe(true);
    expect(graph.nodes.some((n) => n.label.startsWith('Speculative'))).toBe(false);
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`]);
    expect(cycleFree(graph)).toBe(true);
    expect(saidAbout(out, 'AI feature availability', 'AI release delay')).toHaveLength(1);
  });

  it('RED: oversized + looped; a size retry that sheds Olumi’s own added risks is adopted (no risk-retention gate a loop alone would impose)', async () => {
    const first = extended(servedCandidate(), speculative('risks', 5));
    const fixed = withLinks((ls) => [...ls.filter((l) => l !== DELAY_TO_AVAIL), L('AI release delay', 'New Pro conversions', 'negative')]);
    const { out, graph } = await build(first, fixed);
    expect(out.size_retried).toBe(true);
    expect(out.within_compact_limits).toBe(true);
    expect(graph.nodes.some((n) => n.label.startsWith('Speculative'))).toBe(false);
    expect(has(graph, DELAY, NEW_CONVERSIONS)).toBe(true);
    expect(loopWithheld(out)).toEqual([]);
    expect(cycleFree(graph)).toBe(true);
  });
});

describe('BLOCKING-2: the user’s link restated by Olumi is ONE link, and it is the user’s', () => {
  it.each([
    ['Olumi’s restatement first', (ls: Link[]) => [...ls, L('AI feature availability', 'AI release delay', 'negative', 'explicit')]],
    ['the user’s statement first', (ls: Link[]) => [...restamp('AI feature availability', 'AI release delay', 'explicit')(ls), AVAIL_TO_DELAY]],
  ] as const)('RED (%s): only Olumi’s back link is withheld; the user is never told their link was Olumi’s and left out; its ledger stays', async (_order, edit) => {
    const c = withLinks(edit);
    const { out, graph } = await build(c);
    expect(cycleFree(graph)).toBe(true);
    expect(loopWithheld(out)).toEqual([`${DELAY}->${AVAILABILITY}`]);
    expect(graph.edges.some((e) => e.from === AVAILABILITY && e.to === DELAY && e.provenance?.source === 'brief_extraction')).toBe(true);
    expect((out.not_represented as string[]).some((s) => s.includes('the link from "AI feature availability" to "AI release delay" was left out'))).toBe(false);
    // The kept link's own projection entries are untouched (one per instance); none says it was withheld.
    const paths = ledger(c);
    expect(paths.filter((p) => p === `edges[${AVAILABILITY}::${DELAY}].strength.mean`)).toHaveLength(2);
    expect(paths).not.toContain(`edges[${AVAILABILITY}::${DELAY}].loop_withheld`);
  });
});

describe('(a) a risk a withheld loop link leaves unconnected gets the risk -> goal repair', () => {
  it('RED: a risk and a factor linked only to each other — the risk’s link back is withheld, and the risk is connected to the goal', async () => {
    const c = extended(servedCandidate(), {
      factors: ['Competitor pricing'],
      risks: ['Competitor launch'],
      links: [L('Competitor launch', 'Competitor pricing', 'positive'), L('Competitor pricing', 'Competitor launch', 'positive')],
    });
    const { out, graph } = await build(c);
    expect(loopWithheld(out)).toContain('competitor_launch->competitor_pricing');
    const repair = graph.edges.find((e) => e.from === 'competitor_launch' && e.to === GOAL);
    expect(repair?.effect_direction).toBe('negative');
    expect(repair?.provenance?.source).toBe('cee_hypothesis');
    expect(reaches(graph, 'competitor_pricing', GOAL)).toBe(true);
    expect(blockers(graph)).not.toContain('NO_PATH_TO_GOAL');
    expect(cycleFree(graph)).toBe(true);
    // The repair's record says why this risk needed one — not "never connected to anything".
    const record = admitCandidateModel(prepareProvisionalCandidate(c).candidate, {}).loss.find((l) => l.field_path === `edges[competitor_launch->${GOAL}]`);
    expect(record?.reason).toContain('led only to "Competitor pricing", and that link was left out to break a loop');
  });
});

describe('(b) the rules no test pinned', () => {
  it('a structural option -> factor edge is never withheld, even where withholding it would strand nothing', async () => {
    // "Raise to £59" sets "Launch buzz"; Olumi links "Launch buzz" back to the option. Withholding the option's own
    // edge would strand nothing, withholding Olumi's strands "Launch buzz" — the structural edge is still never the one.
    const c = extended(servedCandidate(), {
      factors: ['Launch buzz'], sets: [['Raise to £59', 'Launch buzz']], links: [L('Launch buzz', 'Raise to £59', 'positive')],
    });
    const { out, graph } = await build(c);
    expect(has(graph, 'raise_to_59', 'launch_buzz')).toBe(true);
    expect(loopWithheld(out)).toContain('launch_buzz->raise_to_59');
    expect(loopWithheld(out)).not.toContain('raise_to_59->launch_buzz');
    expect(cycleFree(graph)).toBe(true);
  });

  it('a withheld link takes its own projection entries with it, and leaves one record that it was withheld', () => {
    const paths = ledger(servedCandidate());
    expect(paths.filter((p) => p.startsWith(`edges[${AVAILABILITY}::${DELAY}]`))).toEqual([`edges[${AVAILABILITY}::${DELAY}].loop_withheld`]);
    // CONTRAST: the kept direction keeps its entries.
    expect(paths).toContain(`edges[${DELAY}::${AVAILABILITY}].strength.mean`);
  });

  it('rule 2 outranks kind: equally far from the goal, the link whose absence strands nothing is withheld, not the risk’s only link', async () => {
    // Referral rate -> Churn spike -> Non-Pro MRR -> Referral rate, the last the user's. Both of Olumi's links point
    // one step toward the goal; by kind the risk's link back onto a factor would go — but it is the risk's ONLY route.
    const c = extended(servedCandidate(), {
      factors: ['Referral rate'], risks: ['Churn spike'],
      links: [
        L('Referral rate', 'Pro subscribers', 'positive'),
        L('Referral rate', 'Churn spike', 'positive'),
        L('Churn spike', 'Non-Pro MRR', 'negative'),
        L('Non-Pro MRR', 'Referral rate', 'positive', 'explicit'),
      ],
    });
    const { out, graph } = await build(c);
    expect(loopWithheld(out)).toEqual([`${AVAILABILITY}->${DELAY}`, 'referral_rate->churn_spike']);
    expect(has(graph, 'churn_spike', 'non_pro_mrr')).toBe(true);
    expect(cycleFree(graph)).toBe(true);
  });
});

describe('(c) the retry’s loop check is admission’s: a loop through an undeclared label costs no retry call', () => {
  it('RED: a "loop" through a label the draft never declared registers nothing to loop — no retry', async () => {
    const acyclicWithPhantom = withLinks((ls) => [
      ...ls.filter((l) => l !== AVAIL_TO_DELAY),
      L('Pro MRR', 'Ghost metric', 'positive'),
      L('Ghost metric', 'Pro MRR', 'positive'),
    ]);
    expect(prepareProvisionalCandidate(acyclicWithPhantom).mechanism_issues).toEqual([]);
    const { out, calls } = await build(acyclicWithPhantom);
    expect(calls).toBe(1);
    expect(out.construction_retried).toBe(false);
    expect(loopWithheld(out)).toEqual([]);
  });
});

describe('(d) a kept loop never says Olumi’s part of it was the user’s', () => {
  it('RED: the user links a factor back to the option that sets it — the option’s edge is named as what it sets, not as the user’s', async () => {
    const c = withLinks((ls) => [...ls.filter((l) => l !== AVAIL_TO_DELAY), L('AI feature availability', 'Raise to £59', 'positive', 'explicit')]);
    const { out, graph } = await build(c);
    expect(loopWithheld(out)).toEqual([]);
    expect(blockers(graph)).toContain('CYCLE_DETECTED');
    const lines = saidAbout(out, 'Raise to £59', 'AI feature availability');
    expect(lines, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(lines[0]).not.toMatch(/^You linked/);
    expect(lines[0]).toContain('You linked "AI feature availability" to "Raise to £59"');
    expect(lines[0]).toContain('the link from "Raise to £59" to "AI feature availability" is what that option sets');
    expect(lines[0]).toMatch(/which way/i);
  });
});
