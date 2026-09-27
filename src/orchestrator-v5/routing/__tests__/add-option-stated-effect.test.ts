/**
 * ⭐ A SIZE THE USER STATED SIZES THE LINK — "with it, churn falls by 3 points" is the causal link's size, never a level
 * beside a placeholder strength (ChatGPT #70 5854144804; meaning AI Quality #70 5854410205, binding; design MG 5852271446 /
 * Runtime 5852192132).
 *
 * ⚠ SERVED (R&C `dloop3x-2`, CEE ecd379a): "Add a new option: keep the price at £49 and launch a retention programme
 * that we expect to cut monthly churn by 3 percentage points". The option was added with a graded factor; the user's 3
 * points became its LEVEL, and the link into churn was Olumi's placeholder, so the 3 points moved nothing.
 *
 * FIXTURE: Paul's served graph (DL browser bf-20260926T054503Z, turn 3; the same fixture `add-option-new-factor.test.ts`
 * binds). "Monthly churn rate" is 7% on a 0–100 frame, and it is OLUMI'S ESTIMATE (`cee_inference`) — Paul's churn, the
 * case AI Quality's item 5 names. Not authored; only the level is varied, where a row says so.
 *
 * The spec below is what the Agent sends for that sentence: a NEW factor "Retention programme" whose link into churn
 * carries `effect_amount: -3` (points, per switching on), and the option switching it on (level 1).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';

import { buildAddOptionsTransaction } from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { checkPersistedGraphInvariants } from '../../persisted-graph-invariants.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { magnitudeNodesOfGraph } from '../../../cee/magnitude/frame-defaulted-links.js';
import { isSwitch, resolveMagnitudeFrame, sizeLink, sourceSwing } from '../../../cee/magnitude/link-effect.js';
import { howStronglyWords } from '../../agent-lane/strength-authorship-words.js';
import { deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-f4-pre-addon.bf-054503.json', import.meta.url), 'utf8'),
) as { nodes: Json[]; edges: Json[]; goal_constraints?: Json[] };
const STORED = projectGraphForPersistence(structuredClone(SERVED)) as typeof SERVED;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

const SWITCH = 'fac_retention_programme';
const CHURN = 'monthly_churn_rate';
const LINK = `${SWITCH}::${CHURN}`;

/** The dloop3x-2 option as the Agent sends it. `amount` is the signed change in churn's own unit (points) per switching on. */
const retention = (amount: number | undefined, direction: 'positive' | 'negative' = 'negative', level: number | null = 1): Json => ({
  parent_decision_id: 'decision_mrr',
  label: '£49 with retention programme',
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.245 },
    { factor_key: 'retention', value: level },
  ],
  new_factors: [{
    key: 'retention',
    label: 'Retention programme',
    affects: [{ node_id: CHURN, effect_direction: direction, ...(amount !== undefined ? { effect_amount: amount } : {}) }],
  }],
});
/** The same served graph with churn's level set to `pct`% by `source` (Olumi's estimate unless said otherwise). */
const churnAt = (pct: number, source = 'cee_inference'): typeof SERVED => {
  const g = structuredClone(STORED);
  const churn = g.nodes.find((n) => n.id === CHURN)!;
  churn.observed_state = source === 'cee_inference'
    ? { unit: '%', value: pct / 100, raw_value: pct, source, extractionType: 'inferred' }
    : { unit: '%', value: pct / 100, raw_value: pct, source };
  return g;
};
const build = (spec: Json, graph: typeof SERVED = STORED) => buildAddOptionsTransaction(structuredClone(spec), graph as never);
const opsOf = (r: ReturnType<typeof buildAddOptionsTransaction>) => (r.matched ? r.operations : []) as Json[];
const edgeOf = (r: ReturnType<typeof buildAddOptionsTransaction>) => opsOf(r).find((o) => o.op === 'add_edge' && o.path === LINK)?.value as Json | undefined;

describe('PRECONDITIONS (bound to the served graph)', () => {
  it('churn is 7% on a 0–100 frame, and it is Olumi\'s estimate (the item-5 case); the model has no retention factor', () => {
    const churn = STORED.nodes.find((n) => n.id === CHURN)!;
    expect(churn.scale_frame).toBe(100);
    expect(churn.observed_state).toMatchObject({ value: 0.07, raw_value: 7, unit: '%', source: 'cee_inference' });
    expect(STORED.nodes.some((n) => /retention/i.test(n.label ?? ''))).toBe(false);
  });
});

describe('⭐ RED (dloop3x-2): "cut monthly churn by 3 percentage points" SIZES the link, as the user\'s', () => {
  it('the link carries −3 points of "Monthly churn rate" per switching on, stamped as the user\'s — not Olumi\'s placeholder', () => {
    const e = edgeOf(build(retention(-3)));
    expect(e, 'the link is written').toBeDefined();
    expect(e!.strength.mean).toBeCloseTo(-0.03, 12);
    expect(e!.strength.std).toBeCloseTo(0.015, 12);
    expect(e!.provenance).toEqual({
      source: 'user_specified',
      magnitude: 'user_stated',
      natural_effect: {
        amount: -3, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch',
        strength_mean: e!.strength.mean, strength_mean_frame: 'edge_strength',
      },
    });
    expect(e!.effect_direction).toBe('negative');
    expect(e!.exists_probability).toBe(DEFAULT_EXISTS_PROBABILITY);
    // Never Olumi's default: not `defaulted`, not the default signature, not `cee_hypothesis`.
    expect(e!.defaulted).toBeUndefined();
    expect(Math.abs(e!.strength.mean)).not.toBe(STRENGTH_DEFAULT_SIGNATURE.mean);
  });

  it('POINTS ARE POINTS: switched on, 7% today becomes 4% — never 7% × 0.97, never 3% of the range', () => {
    const e = edgeOf(build(retention(-3)))!;
    const today = 0.07;
    expect(today + e.strength.mean * 1).toBeCloseTo(0.04, 12);
    expect(today + e.strength.mean * 1).not.toBeCloseTo(0.07 * 0.97, 6);
  });

  it('the new factor is a 0/1 SWITCH with NO current value (Canonical\'s OPEN ruling), and the option switches it ON (level 1)', () => {
    const r = build(retention(-3));
    const ops = opsOf(r);
    // The bare new-factor shape: no value, no prior, no source, no stored frame (its frame is its 0/1 levels; item 3).
    expect(ops.find((o) => o.op === 'add_node' && o.path === SWITCH)!.value)
      .toEqual({ id: SWITCH, kind: 'factor', label: 'Retention programme', category: 'controllable' });
    const option = ops[0]!.value as Json;
    expect(option.kind).toBe('option');
    expect(option.interventions[SWITCH].value).toBe(1);
    expect(r.matched && r.proposals[0]!.configuredFactorIds).toContain(SWITCH);
  });

  it('it is said as the user\'s sentence, by the magnitude contract\'s own words', () => {
    const r = build(retention(-3));
    expect(r.matched && r.statedLinks).toEqual([{ from: SWITCH, to: CHURN, statement: 'switching on "Retention programme" lowers "Monthly churn rate" by 3 points' }]);
  });

  it('SIGN FROM THE VERB — CONTRAST "rises by 3 points": +3 points, raising it', () => {
    const e = edgeOf(build(retention(3, 'positive')))!;
    expect(e.strength.mean).toBeCloseTo(0.03, 12);
    expect(e.provenance.natural_effect.amount).toBe(3);
    expect(e.effect_direction).toBe('positive');
  });

  it('a size that runs against the stated direction is refused, never written the other way round', () => {
    for (const [amount, direction] of [[3, 'negative'], [-3, 'positive']] as const) {
      const r = build(retention(amount, direction));
      expect(r).toMatchObject({ matched: false, reason: 'stated_effect_unusable' });
      expect(r.matched ? '' : r.said).toContain('runs the other way');
    }
  });
});

describe('ITEM 5 — a user\'s size is checked against the level the model HOLDS, Olumi\'s estimate included: SAID, never clamped, never kept silently', () => {
  it('on churn at Olumi\'s estimate of 2%, −3 points would go below 0%: refused, saying so and asking what churn is today', () => {
    const r = build(retention(-3), churnAt(2));
    expect(r).toMatchObject({ matched: false, reason: 'stated_effect_unusable' });
    const said = r.matched ? '' : String(r.said);
    expect(said).toContain('You said switching on "Retention programme" lowers "Monthly churn rate" by 3 points');
    expect(said).toContain('at Olumi\'s own estimate of "Monthly churn rate" today (2%), that would take it below 0%');
    expect(said).toContain('What is "Monthly churn rate" today?');
    // The 2% is Olumi's estimate and is said as one — never "is 2% today" (AI Quality on #2020, 5848196913).
    expect(said).not.toMatch(/is 2% today/);
  });

  it('CONTRAST — the same size on the served 7% estimate stays inside 0–100% and is written', () => {
    expect(build(retention(-3)).matched).toBe(true);
  });

  it('on a KNOWN 2% (the user\'s own figure) it is refused too, naming it as today\'s level', () => {
    const r = build(retention(-3), churnAt(2, 'user_specified'));
    expect(r).toMatchObject({ matched: false, reason: 'stated_effect_unusable' });
    expect(r.matched ? '' : r.said).toContain('"Monthly churn rate" is 2% today');
  });

  it('admission (D7) keeps the user\'s size on the estimated 2% exactly as stated — and now ASKS, quoting the estimate', () => {
    const nodes = magnitudeNodesOfGraph({ ...churnAt(2), nodes: [...churnAt(2).nodes, { id: SWITCH, kind: 'factor', label: 'Retention programme' }, { id: 'o', kind: 'option', interventions: { [SWITCH]: { value: 1 } } }] });
    const s = sizeLink({ direction: 'negative', effect_amount: -3, effect_per_source_change: 1, user_stated: true }, nodes.get(SWITCH)!, nodes.get(CHURN)!);
    expect(s.outcome).toBe('user_stated');
    expect(s.mean).toBeCloseTo(-0.03, 12);
    expect(s.problem).toBe('out_of_domain');
    expect(s.question).toContain('Olumi\'s own estimate');
    expect(s.question).toContain('It is kept exactly as you said it.');
    expect(s.question).not.toMatch(/is 2% today/);
  });
});

describe('D8 — a size the analysis cannot represent is SAID, not silently used', () => {
  it('"adds £30,000 a month to MRR" on MRR\'s 25,000 frame is more than one switch-on can carry: refused, saying so', () => {
    const spec = retention(undefined);
    spec.new_factors[0].affects = [{ node_id: 'mrr', effect_direction: 'positive', effect_amount: 30000 }];
    const r = build(spec);
    expect(r).toMatchObject({ matched: false, reason: 'stated_effect_unusable' });
    expect(r.matched ? '' : r.said).toContain('more than the analysis can represent');
  });
});

describe('the switch is switched ON by every option that acts on it', () => {
  it('unset, or any level but 1, is refused — never a size "per switching on" for a move no option makes', () => {
    expect(build(retention(-3, 'negative', null))).toMatchObject({ matched: false, reason: 'stated_effect_not_switched_on', index: 0 });
    expect(build(retention(-3, 'negative', 0.5))).toMatchObject({ matched: false, reason: 'stated_effect_not_switched_on', index: 0 });
  });
});

const hold = (spec: Json, graph: typeof SERVED = STORED) => dispatchAddOptionTransaction({
  parameters: structuredClone(spec), currentGraph: graph, currentGraphHash: computeAnalysisAffectingGraphHash(graph as never)!, freshness: 'none',
  mode: 'live', scenarioId: 's', turnId: 't', requestId: 'r', stage: 'decide',
} as never) as Json;

describe('⭐ it lands through the REAL seams', () => {
  const committed = () => projectGraphForPersistence(applyPatchOperations(structuredClone(STORED) as never, opsOf(build(retention(-3))) as never) as never) as typeof SERVED;

  it('held as ONE change, then EXECUTED by the real confirm path', () => {
    const out = hold(retention(-3));
    expect(out.kind).toBe('held');
    const read = readGmHeldResume(out.pendingActions[0]) as Json;
    const executed = executeGmHeldResume({
      operations: read.operations, ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
      currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
      scenarioId: 's', turnId: 't-confirm', requestId: 'r-confirm',
    }) as Json;
    expect(executed.status).toBe('executed');
  });

  it('committed and persisted: the switch has no value and reads as a switch; the link keeps the user\'s size; no invariant is violated', () => {
    const g = committed();
    const node = g.nodes.find((n) => n.id === SWITCH)!;
    expect(node.observed_state).toBeUndefined();
    const m = magnitudeNodesOfGraph(g).get(SWITCH)!;
    expect(isSwitch(m, resolveMagnitudeFrame(m))).toBe(true);
    const e = g.edges.find((x) => x.from === SWITCH && x.to === CHURN)!;
    expect(e.provenance).toMatchObject({ source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: -3, per_source_change_unit: 'switch' } });
    expect(e.defaulted).toBeUndefined();
    expect(checkPersistedGraphInvariants(g, { baseGraph: STORED }).status).not.toBe('violated');
    expect(resolveRunAdmission(g).willProceed).toBe(true);
  });

  it('ITEM 4 — WHOSE SIZE: "how strongly is as you stated it", and "I supplied N values" does not count it', () => {
    const g = committed();
    expect(howStronglyWords(g.edges.filter((e) => e.from === SWITCH))).toBe('how strongly is as you stated it.');
    expect(deriveInferredValues(g).map((v) => v.factor_id)).not.toContain(SWITCH);
  });

  it('a refused size is refused with its sentence at the dispatcher — never skipped into the free-text edit lane', () => {
    const out = hold(retention(-3), churnAt(2));
    expect(out.kind).toBe('refused');
    expect(out.reason).toBe('stated_effect_unusable');
    expect(String(out.response.assistant_text)).toContain('What is "Monthly churn rate" today?');
    expect(out.pendingActions).toBeUndefined();
  });

  const writeToday = (g: unknown, value: number) => {
    const event = { kind: 'factor_value_edit' as const, target_id: SWITCH, value };
    return applyFactorValueEdit({
      payload: { kind: 'system_event', turn_id: '8b1c7d7e-6c1f-4a55-9d0b-2f4a9b1d3e01', scenario_id: '5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c01', stage: 'frame', event } as never,
      event: event as never, requestId: 'r', persistedGraph: g, priorFacts: [],
    }) as Promise<Json>;
  };

  it('ITEM 3 — TODAY: the user\'s "not running today, so 0 now" lands through the EXISTING value writer as 0 (never 0.5, never a new range), and the switch still reads as switching on', async () => {
    const res = await writeToday(committed(), 0);
    expect(res.kind, JSON.stringify(res).slice(0, 600)).toBe('mutated');
    const after = res.mutatedGraph as typeof SERVED;
    const node = after.nodes.find((n) => n.id === SWITCH)!;
    expect(node.observed_state.value).toBe(0);
    expect(node.observed_state.cap).toBeUndefined();
    expect(node.scale_frame).toBeUndefined();
    const m = magnitudeNodesOfGraph(after).get(SWITCH)!;
    expect(isSwitch(m, resolveMagnitudeFrame(m))).toBe(true);
    // The status quo holds it at 0; the option moves it 0 → 1: the swing the user's "per switching on" was said over.
    expect(sourceSwing(m)).toEqual({ lo: 0, hi: 1 });
  });

  it('WHY THE SWITCH STORES NO scale_frame: with a stored frame of 1, the same writer refuses the user\'s 0 (scale_ambiguous)', async () => {
    const g = committed();
    g.nodes.find((n) => n.id === SWITCH)!.scale_frame = 1;
    const res = await writeToday(g, 0);
    expect(res).toMatchObject({ kind: 'refused', reason: 'scale_ambiguous' });
  });
});

describe('CONTROL — no stated size: today\'s bytes, today\'s placeholder', () => {
  it('the factor is the bare controllable node and the link is Olumi\'s default hypothesis, exactly as before', () => {
    const spec = retention(undefined, 'negative', null);
    const r = build(spec);
    expect(r.matched).toBe(true);
    const ops = opsOf(r);
    expect(ops.find((o) => o.op === 'add_node' && o.path === SWITCH)!.value)
      .toEqual({ id: SWITCH, kind: 'factor', label: 'Retention programme', category: 'controllable' });
    expect(edgeOf(r)).toEqual({
      from: SWITCH, to: CHURN,
      strength: { mean: -STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std },
      exists_probability: DEFAULT_EXISTS_PROBABILITY, effect_direction: 'negative', defaulted: true,
      provenance: { source: 'cee_hypothesis' },
    });
    expect(r.matched && r.statedLinks).toBeUndefined();
  });
});
