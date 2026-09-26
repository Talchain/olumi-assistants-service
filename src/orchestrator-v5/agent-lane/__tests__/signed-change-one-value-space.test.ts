/**
 * ⛔ A SIGNED CHANGE KEEPS ITS SIGN, AND EVERY OPTION'S LEVEL ON ONE FACTOR LIVES IN ONE VALUE SPACE.
 *
 * Served CEE 06325c6 (OpenAI lane, AI Quality, #69 5835137365): the brief "respond to the
 * competitor's price cut" built "Cut List Price 15%" as `list_price_change = -15` (RAW) on a
 * factor framed `{ cap: 100, declared_scale: unit_interval }`, while the sibling "Raise" option
 * wrote `0.1` (NORMALISED). Two value spaces on one factor, so `run_analysis` refused the whole
 * comparison: `mixed_scale_unresolved`, "values … the analysis engine would silently rescale".
 *
 * WHY A NEGATIVE CANNOT SIMPLY BE NORMALISED (measured through the real handler, not assumed):
 * the analysis seam is sign-symmetric — any wire value outside [0, 1] fires PLoT's request-level
 * rescale — so `-0.15` beside `0.1` is refused just the same, and an all-raw `-15`/`10` is refused
 * as soon as the model carries an ordinary estimated sibling. The conventional drafter refuses
 * negatives for the same reason (`records/projector.ts`, "any magnitude < 0 → NO frame").
 *
 * So the contract is met in the one space every consumer reads truthfully: a signed PERCENTAGE
 * change of a quantity is stated as that quantity's LEVEL relative to today — today 100, "cut
 * 15%" 85, "raise 10%" 110 — on one frame. The sign survives as the side of today each option
 * sits on, `raw_value` keeps a number the user can read, and it is said once. A signed change
 * that cannot be restated that way is WITHHELD at build (the option still acts on the factor)
 * and said — never registered in a second value space. A level above the stated range widens
 * the factor's frame (derived, said) instead of being kept raw beside normalised siblings.
 *
 * Every assertion names nodes by id, on the REAL path: strict-schema candidate →
 * `buildModelFromBrief` → `/graph/register` body → `GraphV3.parse` → the real `run_analysis`
 * handler (PLoT faked; no model call anywhere).
 */
import { describe, it, expect, vi } from 'vitest';
import type { CandidateModel } from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import {
  createRunAnalysisHandler, HandlerInvocationFailedError, type RunAnalysisScenarioSnapshot,
} from '../../tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const SCENARIO = 'abababab-abab-4bab-8bab-abababababab';
const BRIEF = "Our main competitor just cut prices. Should we cut our list price 15% or raise it 10%?";

type Iv = { factor_label: string; value: number; value_kind: 'absolute' | 'additional'; unit: string; provenance: string };
const iv = (factor_label: string, value: number, unit: string, provenance = 'explicit', value_kind: Iv['value_kind'] = 'absolute'): Iv =>
  ({ factor_label, value, value_kind, unit, provenance });

/**
 * The served shape, in the strict schema's own fields: a percentage-CHANGE factor whose
 * status-quo value is 0, framed 0..100, beside an ordinary capped sibling and an ESTIMATED
 * (capless, `scale_frame`) sibling — the sibling that makes an all-raw request refuse.
 */
function candidate(cut: Iv[], raise: Iv[], priceFactor: Partial<CandidateModel['factors'][number]> = {}): CandidateModel {
  return {
    goal: { metric: 'Market share', operator: '>=', value: 30, unit: '%', horizon_months: null, provenance: 'explicit', target_stated: true },
    constraints: [],
    options: [
      { label: 'Cut List Price 15%', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        ...cut, iv('Promo spend', 20000, 'GBP', 'ai_proposed'), iv('Sales headcount', 8, 'FTE', 'ai_proposed')] },
      { label: 'Raise List Price 10%', provenance: 'explicit', changes: [], is_status_quo: null, interventions: [
        ...raise, iv('Promo spend', 5000, 'GBP', 'ai_proposed'), iv('Sales headcount', 6, 'FTE', 'ai_proposed')] },
      { label: 'Keep current pricing', provenance: 'inferred', changes: [], is_status_quo: true, interventions: [] },
    ],
    factors: [
      { label: 'List price change', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'inferred', plausible_max: 100, ...priceFactor },
      { label: 'Promo spend', role: 'controllable', baseline_known: true, baseline_value: 10000, unit: 'GBP', provenance: 'explicit', plausible_max: 50000 },
      { label: 'Sales headcount', role: 'controllable', baseline_known: false, baseline_value: 5, unit: 'FTE', provenance: 'ai_proposed', plausible_max: 20 },
    ],
    risks: [], outcomes: [],
    links: [
      { from: 'List price change', to: 'Market share', direction: 'negative', provenance: 'inferred' },
      { from: 'Promo spend', to: 'Market share', direction: 'positive', provenance: 'inferred' },
      { from: 'Sales headcount', to: 'Market share', direction: 'positive', provenance: 'inferred' },
    ],
  } as unknown as CandidateModel;
}

/** The same model plus a signed HEADCOUNT change: FTE, not a percentage of today. */
function withHiring(cut: Iv[], raise: Iv[]): CandidateModel {
  const c = candidate(cut, raise);
  return {
    ...c,
    factors: [...c.factors, { label: 'Hiring change', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'FTE', provenance: 'inferred', plausible_max: 20 }],
    links: [...c.links, { from: 'Hiring change', to: 'Market share', direction: 'positive', provenance: 'inferred' }],
  } as CandidateModel;
}

type Node = Record<string, unknown> & { id: string; kind: string; interventions?: Record<string, { value: number; source?: string }> };
type Graph = { nodes: Node[]; edges: { from: string; to: string }[] };

async function build(c: CandidateModel): Promise<{ out: Record<string, unknown>; graph: Graph }> {
  let registered: unknown = null;
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = vi.fn(async () => ({ text: JSON.stringify({ ...c, unknowns: [] }) })) as unknown as CallStructuredModel;
  const out = await buildModelFromBrief(SCENARIO, BRIEF, d, call) as Record<string, unknown>;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { out, graph: GraphV3.parse(registered) as unknown as Graph };
}

/** The real `run_analysis` handler over the registered graph, as the loader would feed it. */
async function runAnalysis(graph: Graph): Promise<{ wire: Record<string, Record<string, number>> | null; refusal: string | null }> {
  const run = vi.fn(async (_request: unknown) => ({
    meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
  }) as unknown as V2RunResponseEnvelope);
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const snapshot = {
    graph, rawPersistedGraph: graph,
    goal_node_id: graph.nodes.find((n) => n.kind === 'goal')?.id ?? null,
    options: graph.nodes.filter((n) => n.kind === 'option').map((n) => ({
      id: n.id, option_id: n.id, label: n.label, interventions: mergeInterventionSourceObjects(n),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: vi.fn(async () => snapshot) });
  try {
    await handler({
      context: {
        stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'req-signed', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
      },
      payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-signed', signal: new AbortController().signal, orientationText: '',
    } as unknown as HandlerInvocation);
  } catch (err) {
    const d = err instanceof HandlerInvocationFailedError ? (err.details as { reason_code?: string }) : undefined;
    return { wire: null, refusal: d?.reason_code ?? String(err) };
  }
  expect(run).toHaveBeenCalledTimes(1);
  const payload = run.mock.calls[0]![0] as unknown as { options: { option_id?: string; id?: string; interventions: Record<string, number> }[] };
  return { wire: Object.fromEntries(payload.options.map((o) => [o.option_id ?? o.id, o.interventions])), refusal: null };
}

const byId = (g: Graph, id: string): Node => {
  const n = g.nodes.find((x) => x.id === id);
  expect(n, `node ${id}`).toBeDefined();
  return n!;
};
const level = (g: Graph, option: string, factor: string): number | undefined => byId(g, option).interventions?.[factor]?.value;
/** What the build says about a factor, excluding the held-status-quo sentence (its own contract). */
const said = (out: Record<string, unknown>, re: RegExp): string[] =>
  (out.not_represented as string[]).filter((s) => re.test(s) && !/reads as carrying on as now/.test(s));
/** Every option level on one factor is in [0, 1] — the one value space its frame defines. */
const oneSpace = (g: Graph, factor: string): void => {
  for (const o of g.nodes.filter((n) => n.kind === 'option')) {
    const v = o.interventions?.[factor]?.value;
    if (v === undefined) continue;
    expect(v, `${o.id} -> ${factor}`).toBeGreaterThanOrEqual(0);
    expect(v, `${o.id} -> ${factor}`).toBeLessThanOrEqual(1);
  }
};

const CUT = 'cut_list_price_15';
const RAISE = 'raise_list_price_10';
const HOLD = 'keep_current_pricing';
const PRICE = 'list_price_change';

describe('a signed change keeps its sign, and one factor carries one value space', () => {
  it('fixture: the strict schema lets the drafter emit the served shape (an unbounded signed level)', () => {
    const options = (buildCandidateSchema() as { properties: { options: { items: { properties: { interventions: { items: { properties: Record<string, unknown> } } } } } } })
      .properties.options.items.properties.interventions.items.properties;
    expect(options.value).toEqual({ type: 'number' });
    expect(options.value_kind).toMatchObject({ enum: ['absolute', 'additional'] });
  });

  it('RED (served): "cut 15%" beside "raise 10%" RUNS — cut below today, raise above, one space', async () => {
    const { out, graph } = await build(candidate([iv('List price change', -15, '%')], [iv('List price change', 10, '%')]));
    oneSpace(graph, PRICE);
    const today = byId(graph, PRICE).observed_state as { value: number; raw_value: number; unit: string; cap: number };
    // Level relative to today, on one frame: 85 / 100 / 110 of 200.
    expect(today).toMatchObject({ value: 0.5, raw_value: 100, cap: 200 });
    expect(level(graph, CUT, PRICE)).toBeCloseTo(0.425, 10);
    expect(level(graph, RAISE, PRICE)).toBeCloseTo(0.55, 10);
    // The sign survives as the side of today each option sits on.
    expect(level(graph, CUT, PRICE)!).toBeLessThan(today.value);
    expect(level(graph, RAISE, PRICE)!).toBeGreaterThan(today.value);
    // The user's own figure keeps its authority.
    expect(byId(graph, CUT).interventions?.[PRICE]?.source).toBe('brief_extraction');
    // The link's direction is unchanged: a higher price level still lowers share.
    const { wire, refusal } = await runAnalysis(graph);
    expect(refusal, 'the comparison must run').toBeNull();
    expect(wire![CUT]![PRICE]).toBeCloseTo(0.425, 10);
    expect(wire![RAISE]![PRICE]).toBeCloseTo(0.55, 10);
    for (const v of Object.values(wire!).flatMap((o) => Object.values(o))) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Said once, in words, naming the factor.
    expect(said(out, /List price change/)).toHaveLength(1);
    expect(said(out, /List price change/)[0]).toMatch(/today/);
  });

  it('RED: a cut stated as a signed ADDITION to a 0 baseline takes the same path', async () => {
    const { graph } = await build(candidate(
      [iv('List price change', -15, '%', 'explicit', 'additional')], [iv('List price change', 10, '%', 'explicit', 'additional')]));
    oneSpace(graph, PRICE);
    expect(level(graph, CUT, PRICE)).toBeCloseTo(0.425, 10);
    expect((await runAnalysis(graph)).refusal).toBeNull();
  });

  it('RED: "cut 15%" alone (beside the held status quo) runs, and sits below today', async () => {
    const { graph } = await build(candidate([iv('List price change', -15, '%')], []));
    oneSpace(graph, PRICE);
    expect(level(graph, CUT, PRICE)!).toBeLessThan((byId(graph, PRICE).observed_state as { value: number }).value);
    const { wire, refusal } = await runAnalysis(graph);
    expect(refusal).toBeNull();
    expect(wire![CUT]![PRICE]).toBeCloseTo(0.425, 10);
    // The held status quo sets no level of its own on the factor and is wired to it, so it is
    // compared at today's level (0.5) — the cut sits below it.
    expect(level(graph, HOLD, PRICE)).toBeUndefined();
    expect(graph.edges.some((e) => e.from === HOLD && e.to === PRICE)).toBe(true);
  });

  it('CONTROL: "raise 10%" with no cut is unchanged — 0.1 on the stated 0..100 frame, nothing said', async () => {
    const { out, graph } = await build(candidate([], [iv('List price change', 10, '%')]));
    expect(byId(graph, PRICE).observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 100 });
    expect(level(graph, RAISE, PRICE)).toBeCloseTo(0.1, 10);
    expect(said(out, /List price change/), JSON.stringify(out.not_represented)).toHaveLength(0);
    const { wire, refusal } = await runAnalysis(graph);
    expect(refusal).toBeNull();
    expect(wire![RAISE]![PRICE]).toBeCloseTo(0.1, 10);
  });

  it('RED: a signed change that cannot be restated as a level is WITHHELD at build, never registered raw', async () => {
    // FTE is not a percentage of today, and today's headcount-CHANGE of 0 says nothing about
    // today's headcount — so there is no truthful level to restate "-3" as.
    const { out, graph } = await build(withHiring(
      [iv('List price change', 5, '%'), iv('Hiring change', -3, 'FTE')],
      [iv('List price change', 10, '%'), iv('Hiring change', 2, 'FTE')],
    ));
    const HIRING = 'hiring_change';
    oneSpace(graph, HIRING);
    expect(level(graph, CUT, HIRING), 'the -3 is not registered in a second value space').toBeUndefined();
    expect(level(graph, RAISE, HIRING)).toBeCloseTo(0.1, 10);
    // The option still ACTS on the factor: it is not silently disconnected.
    expect(graph.edges.some((e) => e.from === CUT && e.to === HIRING)).toBe(true);
    expect(said(out, /Hiring change/)).toHaveLength(1);
    expect(said(out, /Hiring change/)[0]).toMatch(/-3/);
    const { refusal } = await runAnalysis(graph);
    expect(refusal).not.toBe('mixed_scale_unresolved');
  });

  it('CONTROL: a percentage whose value TODAY is not zero is already a level — a negative on it is withheld, never restated', async () => {
    // "Discount rate" is 5% today: 100 + change would misstate it, so nothing is restated.
    const { out, graph } = await build(candidate(
      [iv('List price change', -3, '%')], [iv('List price change', 10, '%')],
      { label: 'List price change', baseline_value: 5, provenance: 'explicit' },
    ));
    oneSpace(graph, PRICE);
    expect(byId(graph, PRICE).observed_state).toMatchObject({ value: 0.05, raw_value: 5, cap: 100 });
    expect(level(graph, CUT, PRICE)).toBeUndefined();
    expect(level(graph, RAISE, PRICE)).toBeCloseTo(0.1, 10);
    expect(said(out, /today is 100/)).toHaveLength(0);
    expect(said(out, /List price change/)).toHaveLength(1);
    expect((await runAnalysis(graph)).refusal).not.toBe('mixed_scale_unresolved');
  });

  it('RED: a level above the stated range widens the frame instead of being kept raw beside normalised siblings', async () => {
    const { out, graph } = await build(candidate([iv('List price change', 5, '%')], [iv('List price change', 150, '%')]));
    oneSpace(graph, PRICE);
    expect(level(graph, RAISE, PRICE)! / level(graph, CUT, PRICE)!).toBeCloseTo(30, 8);
    expect(said(out, /List price change/)).toHaveLength(1);
    expect((await runAnalysis(graph)).refusal).toBeNull();
  });
});

/**
 * ⛔ B1 (review 5835754404): A SIGNED CHANGE IS RESTATED ONLY ON A *KNOWN* ZERO TODAY.
 *
 * The gate was `today !== null && today !== 0`, so an UNKNOWN baseline (`null`, or an unknown
 * `0`) was restated too, and the restated factor came out `baseline_known: true, 100` under the
 * factor's own provenance — for an `explicit` factor, `observed_state.source: 'brief_extraction'`:
 * a baseline the user never gave, recorded as extracted from their brief. It also asserted the
 * factor was a change-from-today when nothing said so (a percent LEVEL such as a margin at -5 vs
 * 12). Only `baseline_known === true && baseline_value === 0` licenses the restatement; anything
 * else falls through to the withhold-and-say path.
 */
describe('B1 (review 5835754404): restated only when today is KNOWN to be zero', () => {
  /** Nothing restated on `factorId`: no minted "today", no restatement sentence, the negative withheld and said. */
  const notRestated = (out: Record<string, unknown>, graph: Graph, factorId: string, factorLabel: string): void => {
    const os = byId(graph, factorId).observed_state as Record<string, unknown> | undefined;
    expect(os?.source, `${factorId}: no baseline minted as the user's`).not.toBe('brief_extraction');
    expect(os?.raw_value, `${factorId}: no invented "today" of 100`).not.toBe(100);
    expect(os?.unit, `${factorId}: not restated as a level relative to today`).not.toBe('% of today');
    expect(said(out, /today is 100/), JSON.stringify(out.not_represented)).toHaveLength(0);
    // The negative is WITHHELD at admission (the option still acts on the factor) and said.
    expect(level(graph, CUT, factorId), 'the -5 is withheld, never registered').toBeUndefined();
    expect(graph.edges.some((e) => e.from === CUT && e.to === factorId)).toBe(true);
    const withheld = said(out, new RegExp(`"Cut List Price 15%" puts "${factorLabel}" at -5\\b`));
    expect(withheld, JSON.stringify(out.not_represented)).toHaveLength(1);
    expect(withheld[0]).toMatch(/no level was set/);
    // The positive level stays on the factor's stated 0..100 frame: 12 / 100.
    expect(level(graph, RAISE, factorId)).toBeCloseTo(0.12, 10);
    oneSpace(graph, factorId);
  };
  const cutRaise = (label: string): [Iv[], Iv[]] =>
    [[iv(label, -5, '%', 'ai_proposed')], [iv(label, 12, '%', 'ai_proposed')]];

  it('RED row 1: an UNKNOWN baseline (null) on a factor the user named is not restated — no "today" is minted as brief_extraction', async () => {
    const { out, graph } = await build(candidate(...cutRaise('List price change'),
      { baseline_known: false, baseline_value: null, provenance: 'explicit' }));
    notRestated(out, graph, PRICE, 'List price change');
    // Handler level only (PLoT faked): the withheld level does not stop the comparison.
    expect((await runAnalysis(graph)).refusal).toBeNull();
  });

  it('RED row 2: an UNKNOWN baseline of 0 (baseline_known: false) is not restated either', async () => {
    const { out, graph } = await build(candidate(...cutRaise('List price change'),
      { baseline_known: false, baseline_value: 0, provenance: 'explicit' }));
    notRestated(out, graph, PRICE, 'List price change');
    expect((await runAnalysis(graph)).refusal).toBeNull();
  });

  it('RED row 2b: a baseline marked known but with NO value (known: true, null) is not restated — known-ness alone licenses nothing', async () => {
    const { out, graph } = await build(candidate(...cutRaise('List price change'),
      { baseline_known: true, baseline_value: null, provenance: 'explicit' }));
    notRestated(out, graph, PRICE, 'List price change');
    expect((await runAnalysis(graph)).refusal).toBeNull();
  });

  it('RED row 3: a percent LEVEL with no known value (a margin at -5 vs 12) is never read as a change from today', async () => {
    const base = candidate(
      [iv('List price change', 5, '%'), iv('Gross margin', -5, '%', 'ai_proposed')],
      [iv('List price change', 10, '%'), iv('Gross margin', 12, '%', 'ai_proposed')],
    );
    const c = {
      ...base,
      factors: [...base.factors, { label: 'Gross margin', role: 'observable', baseline_known: false, baseline_value: null, unit: '%', provenance: 'inferred', plausible_max: 100 }],
      links: [...base.links, { from: 'Gross margin', to: 'Market share', direction: 'positive', provenance: 'inferred' }],
    } as unknown as CandidateModel;
    const { out, graph } = await build(c);
    notRestated(out, graph, 'gross_margin', 'Gross margin');
    expect((await runAnalysis(graph)).refusal).not.toBe('mixed_scale_unresolved');
  });

  const restated = async (provenance: 'inferred' | 'explicit'): Promise<Record<string, unknown>> => {
    const { out, graph } = await build(candidate([iv('List price change', -15, '%')], [iv('List price change', 10, '%')],
      { baseline_known: true, baseline_value: 0, provenance }));
    const os = byId(graph, PRICE).observed_state as Record<string, unknown>;
    expect(os).toMatchObject({ value: 0.5, raw_value: 100, cap: 200, unit: '% of today' });
    expect(level(graph, CUT, PRICE)).toBeCloseTo(0.425, 10);
    expect(level(graph, RAISE, PRICE)).toBeCloseTo(0.55, 10);
    expect(said(out, /today is 100/)).toHaveLength(1);
    expect((await runAnalysis(graph)).refusal).toBeNull();
    return os;
  };

  it('CONTROL row 4a: a KNOWN zero today the builder inferred IS restated, and carries no source', async () => {
    const os = await restated('inferred');
    expect(Object.prototype.hasOwnProperty.call(os, 'source'), JSON.stringify(os)).toBe(false);
  });

  it('CONTROL row 4b: a KNOWN zero today the user stated IS restated, and stays brief_extraction ("no change today")', async () => {
    const os = await restated('explicit');
    expect(os.source).toBe('brief_extraction');
  });
});
