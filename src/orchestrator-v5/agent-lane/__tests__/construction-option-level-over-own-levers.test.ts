/**
 * ⛔ AN OPTION SETS WHAT THE USER CHOSE, NOT A TOTAL ITS OWN LEVERS ALREADY COMPUTE (Journey E PJ-E-FIG; R3 lock #72
 * 5900597834; MG successor #75 5902260283 / 5902277663).
 *
 * Served lock on CEE `f95ea20` (rep1, rep3): every hiring option set `annual_salary_spend` directly at an Olumi total
 * (`cee_hypothesis`) AND set the headcount linked into it. Paul's "£120k a year each" then had no place: the door
 * correctly refused rate drivers ("would duplicate the same cost calculation") and his figures were never held (rep2,
 * whose options set only headcounts, held both as `user_override`). Corpus: 10/20 E drafter wires; 7/17 still carry
 * the shape after admission on staging `1f9d769`. The same class on journey A (R3 #75 5902268039): the retention
 * option pinned churn at Olumi's 2.5% while its own lever → churn link was a placeholder, so R-c scored it P = 1 on
 * Olumi's own level.
 *
 * Rule: an option's Olumi-proposed level on a node that one of the SAME option's set levers feeds is dropped; the node
 * follows from its parts (one mechanism, one route). A level the user stated is kept; a node no lever of that option
 * feeds keeps the option's level.
 * Real path: strict candidate (a real drafter wire, R3 `wires-spike-97.json` #74) → `buildModelFromBrief` → the
 * `/graph/register` body.
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

const SCENARIO = '1f9d7698-0000-4000-8000-0000000e0f16';
const BRIEF = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
type Rec = Record<string, unknown>;

/** R3 `wires-spike-97.json` #74 (27 Sep drafter wire), verbatim. */
const RAW_74 = {"goal":{"metric":"ship the new platform","operator":">=","target_stated":false,"value":null,"unit":"ship status (0/1)","horizon_months":null,"provenance":"explicit","baseline_known":false,"baseline_value":null,"baseline_provenance":"explicit","scope":null},"constraints":[{"metric":"Annual salary spend","operator":"<=","value":400000,"unit":"GBP/year","provenance":"explicit","frame":"level"}],"options":[{"label":"Hire two senior engineers","provenance":"explicit","changes":[],"interventions":[{"factor_label":"Senior engineers hired","value":2,"value_kind":"additional","unit":"engineers","provenance":"explicit"},{"factor_label":"Annual salary spend","value":300000,"value_kind":"absolute","unit":"GBP/year","provenance":"ai_proposed"}],"is_status_quo":null},{"label":"Hire four junior engineers","provenance":"explicit","changes":[],"interventions":[{"factor_label":"Junior engineers hired","value":4,"value_kind":"additional","unit":"engineers","provenance":"explicit"},{"factor_label":"Annual salary spend","value":280000,"value_kind":"absolute","unit":"GBP/year","provenance":"ai_proposed"}],"is_status_quo":null},{"label":"Carry on as now","provenance":"ai_proposed","changes":[],"interventions":[],"is_status_quo":true}],"factors":[{"label":"Senior engineers hired","role":"controllable","baseline_known":true,"baseline_value":0,"unit":"engineers","provenance":"explicit","plausible_max":10},{"label":"Junior engineers hired","role":"controllable","baseline_known":true,"baseline_value":0,"unit":"engineers","provenance":"explicit","plausible_max":20},{"label":"Annual salary spend","role":"controllable","baseline_known":false,"baseline_value":null,"unit":"GBP/year","provenance":"explicit","plausible_max":1000000},{"label":"Platform build effort","role":"external","baseline_known":false,"baseline_value":60,"unit":"engineer-months remaining","provenance":"ai_proposed","plausible_max":200},{"label":"Incremental onboarding load","role":"observable","baseline_known":true,"baseline_value":0,"unit":"load score points","provenance":"ai_proposed","plausible_max":100}],"risks":[{"label":"Delayed ramp-up","provenance":"ai_proposed"}],"outcomes":[{"label":"Platform delivery progress by Q3","provenance":"ai_proposed"}],"links":[{"from":"Senior engineers hired","to":"Annual salary spend","direction":"positive","provenance":"ai_proposed","effect_amount":150000,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Junior engineers hired","to":"Annual salary spend","direction":"positive","provenance":"ai_proposed","effect_amount":70000,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Senior engineers hired","to":"Platform delivery progress by Q3","direction":"positive","provenance":"ai_proposed","effect_amount":25,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Junior engineers hired","to":"Platform delivery progress by Q3","direction":"positive","provenance":"ai_proposed","effect_amount":13,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Platform build effort","to":"Platform delivery progress by Q3","direction":"negative","provenance":"ai_proposed","effect_amount":-1,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Senior engineers hired","to":"Incremental onboarding load","direction":"positive","provenance":"ai_proposed","effect_amount":4,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Junior engineers hired","to":"Incremental onboarding load","direction":"positive","provenance":"ai_proposed","effect_amount":10,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Incremental onboarding load","to":"Delayed ramp-up","direction":"positive","provenance":"ai_proposed","effect_amount":1,"effect_per_source_change":10,"effect_provenance":"ai_proposed"},{"from":"Delayed ramp-up","to":"Platform delivery progress by Q3","direction":"negative","provenance":"ai_proposed","effect_amount":-8,"effect_per_source_change":1,"effect_provenance":"ai_proposed"},{"from":"Annual salary spend","to":"ship the new platform","direction":"negative","provenance":"ai_proposed","effect_amount":-0.1,"effect_per_source_change":100000,"effect_provenance":"ai_proposed"},{"from":"Platform delivery progress by Q3","to":"ship the new platform","direction":"positive","provenance":"ai_proposed","effect_amount":1,"effect_per_source_change":100,"effect_provenance":"ai_proposed"}],"identities":[],"unknowns":["The Q3 year and its exact deadline are not stated, so the horizon cannot be converted defensibly to months.","The current platform completion state is not stated; therefore the current level of the goal metric is unknown.","The £400k cap may mean incremental compensation for these hires or total company annual salary spend. This model provisionally treats it as the annual spend attributable to the hiring choice.","The provisional salary assumptions are £150k/year per senior engineer and £70k/year per junior engineer; validate fully loaded compensation, including benefits and recruitment costs.","The estimated 60 engineer-months remaining, senior productivity, junior productivity, and ramp-up effects are modelling assumptions rather than measurements. Confirm platform scope, existing team capacity, and expected time-to-productivity."]};
/** The two keys today's strict schema added since 27 Sep: `decision_question`, and the goal's `frame` (a ship/not goal is a level). */
const WIRE_74: Rec = { decision_question: null, ...RAW_74, goal: { ...RAW_74.goal, frame: 'level' } };

async function build(wire: Rec): Promise<{ nodes: Rec[]; edges: Rec[] }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return registered as { nodes: Rec[]; edges: Rec[] };
}

const variant = (edit: (w: any) => void): Rec => { const w = structuredClone(WIRE_74) as any; edit(w); return w; };
const optionSets = (g: { nodes: Rec[] }, labelPrefix: string): Record<string, Rec> => {
  const o = g.nodes.find((n) => n.kind === 'option' && String(n.label).startsWith(labelPrefix))!;
  expect(o, labelPrefix).toBeDefined();
  return ((o.interventions ?? (o.data as Rec | undefined)?.interventions ?? {}) as Record<string, Rec>);
};
const spendId = (g: { nodes: Rec[] }): string => String(g.nodes.find((n) => String(n.label).toLowerCase() === 'annual salary spend')!.id);
const headcountId = (g: { nodes: Rec[] }, word: 'senior' | 'junior'): string =>
  String(g.nodes.find((n) => n.kind === 'factor' && new RegExp(word + ' engineers hired', 'i').test(String(n.label)))!.id);

describe('an option sets what the user chose, not a total its own levers compute', () => {
  it('PREMISE: the wire has each hiring option set its headcount (stated) AND salary spend (Olumi), headcount → spend linked', () => {
    const opts = (WIRE_74.options as any[]).filter((o) => o.is_status_quo !== true);
    for (const o of opts) {
      expect(o.interventions.map((i: any) => [i.factor_label.includes('hired') ? 'headcount' : i.factor_label, i.provenance]).sort())
        .toEqual([['Annual salary spend', 'ai_proposed'], ['headcount', 'explicit']]);
    }
    expect((WIRE_74.links as any[]).filter((l) => l.to === 'Annual salary spend').map((l) => l.from).sort())
      .toEqual(['Junior engineers hired', 'Senior engineers hired']);
  });

  it('ROW 1 (E-FIG shape, served rep1/rep3): the options set their headcounts only; salary spend follows from them', async () => {
    const g = await build(WIRE_74);
    const spend = spendId(g);
    for (const [prefix, word, n] of [['Hire two senior', 'senior', 2], ['Hire four junior', 'junior', 4]] as const) {
      const sets = optionSets(g, prefix);
      expect(Object.keys(sets), `${prefix} must not set ${spend}`).not.toContain(spend);
      expect((sets[headcountId(g, word)] as Rec | undefined)?.raw_value ?? (sets[headcountId(g, word)] as Rec | undefined)?.value, prefix).toBeDefined();
      expect(n).toBeGreaterThan(0);
    }
    // The route that stays: headcount → salary spend.
    expect(g.edges.some((e) => e.from === headcountId(g, 'senior') && e.to === spend)).toBe(true);
    expect(g.edges.some((e) => e.from === headcountId(g, 'junior') && e.to === spend)).toBe(true);
  });

  it('CONTROL (the user stated the option\'s total): a spend level the user gave is kept', async () => {
    const g = await build(variant((w) => { for (const o of w.options) for (const i of o.interventions) if (i.factor_label === 'Annual salary spend') i.provenance = 'explicit'; }));
    expect(Object.keys(optionSets(g, 'Hire two senior'))).toContain(spendId(g));
  });

  it('CONTROL (no lever of the option feeds it): an Olumi spend level with no headcount → spend link is kept', async () => {
    const g = await build(variant((w) => { w.links = w.links.filter((l: any) => l.to !== 'Annual salary spend'); }));
    expect(Object.keys(optionSets(g, 'Hire two senior'))).toContain(spendId(g));
  });
});
