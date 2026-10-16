/**
 * ⭐ PREPARE-ONLY (DL-3 17:51Z, for FOUNDER's explicit rebuild of a saved model; AIE 16 Oct: "Prepare ONE candidate through
 * the existing construction/admission/widening pipeline … Nothing replaces the saved model before this card's own approval").
 * Inside `runPreparingDraftReplacement` for its own scenario, the real `buildModelFromBrief` runs every admission and
 * finalisation step and returns BEFORE any read or write: no `/graph` re-read, no `/graph/register`, nothing else. It hands
 * back the exact graph a registered build writes, with the same construction report (omissions, asks, disclosures), and no
 * pending action. Outside it, initial construction is unchanged. SYNTHETIC brief (never an unseen brief).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { runPreparingDraftReplacement } from '../runtime/draft-replacement-context.js';

type Rec = Record<string, any>;
const LEVEL = 'Our bakery sells about 400 loaves a week at the moment.';
const TARGET = 'We need to sell at least 520 loaves a week by the end of June.';
const EFFECT = 'Our manager reckons a second delivery van would add 90 loaves a week.';
const BRIEF = `${LEVEL} ${TARGET} Option one is a second delivery van. ${EFFECT} Option two is a loyalty card for regulars.`;
const statement = (quote: string, subject: Rec, field: string, form: string, figures: Rec, unit: string): Rec =>
  ({ quote, subject: { to_label: null, factor_label: null, ...subject }, field, form, value: null, low: null, high: null, ...figures, unit, qualifier: null, conditions: null });
const DRAFT = JSON.stringify({
  goal: { kind: null, deliverable: null, metric: 'weekly loaves sold', operator: '>=', target_stated: true, value: 520, unit: 'loaves per week', horizon_months: null,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 400, baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
    basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'loaves per week', effects_at_period_end: false, also_required: null, open_question: null },
    source_quote: TARGET, deadline_words: null },
  constraints: [],
  options: [
    { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
    { label: 'Second delivery van', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Second van in service', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
    { label: 'Loyalty card', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
      interventions: [{ factor_label: 'Loyalty card running', value: 1, value_kind: 'absolute', unit: '0/1', provenance: 'inferred' }] },
  ],
  factors: [
    { label: 'Second van in service', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 },
    { label: 'Loyalty card running', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '0/1', provenance: 'inferred', plausible_max: 1 },
  ],
  risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
  links: [
    { from: 'Second van in service', to: 'weekly loaves sold', direction: 'positive', provenance: 'explicit', effect_amount: 90,
      effect_per_source_change: null, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: EFFECT },
    { from: 'Loyalty card running', to: 'weekly loaves sold', direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
  ],
  statements: [
    statement(LEVEL, { kind: 'goal', label: 'weekly loaves sold' }, 'level', 'point', { value: 400 }, 'loaves per week'),
    statement(TARGET, { kind: 'goal', label: 'weekly loaves sold' }, 'target', 'lower_bound', { value: 520 }, 'loaves per week'),
    statement(EFFECT, { kind: 'link', label: 'Second van in service', to_label: 'weekly loaves sold' }, 'effect', 'point', { value: 90 }, 'loaves per week'),
  ],
});
const SCENARIO = '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f';

/** The real build, with every dispatch recorded; a register returns version 1 and keeps the graph it was sent. */
async function build(scenarioId: string): Promise<{ result: Rec; calls: string[]; registered: Rec | undefined }> {
  const calls: string[] = [];
  let registered: Rec | undefined;
  const result = await buildModelFromBrief(scenarioId, BRIEF, (async (path: string, body: Rec) => {
    calls.push(path);
    if (path.endsWith('/graph/register')) { registered = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: DRAFT, status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return { result, calls, registered };
}

describe('build_model_from_brief prepare-only: the whole construction, then return before any read or write', () => {
  // One instant for every build, so a statement record's `recorded_at` is the same on both arms.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-16T18:00:00.000Z')); });
  afterEach(() => { vi.useRealTimers(); });
  it('⭐ prepared: no dispatch at all (no /graph re-read, no /graph/register), mutated false, the exact graph a build writes', async () => {
    const live = await build(SCENARIO);
    expect(live.calls).toEqual([`/assist/v1/scenarios/${SCENARIO}/graph`, `/assist/v1/scenarios/${SCENARIO}/graph/register`]);
    const prepared = await runPreparingDraftReplacement(SCENARIO, () => build(SCENARIO));
    expect(prepared.calls).toEqual([]);
    expect(prepared.registered).toBeUndefined();
    expect(prepared.result).toMatchObject({ ok: true, mutated: false });
    expect(prepared.result.model_version).toBeUndefined();
    expect(prepared.result.prepared_graph).toEqual(live.registered);
  });
  it('⭐ the prepared result carries the SAME construction report as the registered one (omissions, asks, disclosures)', async () => {
    const { mutated: _m, model_version: _v, pending_action: _p, ...live } = (await build(SCENARIO)).result;
    const { mutated: _pm, prepared_graph: _g, ...prepared } = (await runPreparingDraftReplacement(SCENARIO, () => build(SCENARIO))).result;
    expect(prepared).toEqual(live);
    expect(Object.keys(prepared)).toEqual(Object.keys(live));
    expect(prepared.pending_action).toBeUndefined();
    // The report is not empty: the deadline the model cannot hold is asked, and Olumi's status-quo reading is said.
    expect((prepared.open_questions as string[]).join('\n')).toMatch(/Which date does "by the end of June" mean\?/);
    expect((prepared.not_represented as string[]).join('\n')).toMatch(/'Keep current setup' reads as carrying on as now/);
  });
  it('CONTRAST: a prepare run for ANOTHER scenario does not prepare this one: it reads, registers and is mutated', async () => {
    const other = await runPreparingDraftReplacement('00000000-0000-4000-8000-000000000000', () => build(SCENARIO));
    expect(other.calls).toEqual([`/assist/v1/scenarios/${SCENARIO}/graph`, `/assist/v1/scenarios/${SCENARIO}/graph/register`]);
    expect(other.result).toMatchObject({ ok: true, mutated: true, model_version: { version_number: 1 } });
    expect(other.result.prepared_graph).toBeUndefined();
  });
  it('UNCHANGED: a registered build still starts ok, mutated, model_version and carries no prepared graph', async () => {
    const { result } = await build(SCENARIO);
    expect(Object.keys(result).slice(0, 3)).toEqual(['ok', 'mutated', 'model_version']);
    expect(result.prepared_graph).toBeUndefined();
  });
});
