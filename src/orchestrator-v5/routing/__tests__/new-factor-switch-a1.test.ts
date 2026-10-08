import { beforeDoorTagsDeep } from '../../agent-lane/__tests__/licence-test-graphs.js';
/**
 * ⭐ A1 — ATOMIC, COMPLETE OPTION CHANGES: A NEW FACTOR AN OPTION SWITCHES ON IS A 0/1 SWITCH, IN THE SAME COMMIT.
 *
 * Rulings: Canonical #70 5854919806 item 1 (switches only; same commit; the existing `isSwitch` spelling; today-0 is
 * `cee_inference` through the value writer's own members; a graded new factor unchanged), AIQ 5854838919 (today-0 is
 * Olumi's INFERENCE: "I supplied N+1 values", "Estimated by Olumi"), DL 5854812811 (the B1 root) and MG 5854956233.
 *
 * WIRE (Paul's `90b8f080`, scenario a295e4a1): option 146aa89d "£59 for new Pro customers; grandfather existing
 * customers" landed with `interventions` {pro_plan_price} only, and the new factor `fac_existing_customers_grandfathered`
 * with no `observed_state` — so readiness said MISSING_OPTION_VALUE, the option duplicated "£59", and the factor was
 * sampled over an unbounded prior (Driver 1).
 *
 * FIXTURE: Paul's own persisted graph (`reload.json`) with EXACTLY that one Agent transaction removed (its option, its
 * factor and their five edges); `_provenance.persisted_after_transaction` keeps the persisted option and factor, so the
 * precondition row binds this path to the wire. Every spec runs through the REAL seams: the builder
 * (`buildAddOptionsTransaction`), the typed dispatch and referee hold (`dispatchAddOptionTransaction`), and the confirm
 * (`readGmHeldResume` → `executeGmHeldResume`), whose `mutatedGraph` is what the one commit writes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildAddOptionsTransaction,
  GM_HELD_SWITCH_FACTORS_KEY,
  NEW_SWITCH_TODAY,
  stampNewSwitchFactors,
} from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { executeGmHeldResume, readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { deriveMissingEffectPairs } from '../repair-value-binding.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { isSwitch, resolveMagnitudeFrame, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';
import { buildInferredValueDisclosure, deriveInferredValues } from '../../coaching/inferred-value-disclosure.js';
import { nodeProvenanceDisplay, valueSourceAuthorship } from '../../../cee/transforms/provenance-display.js';
import { projectEntity } from '../../agent-lane/runtime/agent-capabilities.js';
import { checkPersistedGraphInvariants } from '../../persisted-graph-invariants.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { rebindCapture } from '../../../../tests/helpers/legacy-analysis-hash-v2.js';

type Json = Record<string, any>;

const FX = JSON.parse(
  readFileSync(new URL('./fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8'),
) as Json;
const { _provenance: PROVENANCE, ...GRAPH } = FX;
const STORED = projectGraphForPersistence(structuredClone(GRAPH)) as Json;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

/** Executed at base 770a477c without this change (see the fixture's `_provenance`; re-recorded from 15e332b2 when brought current). */
const BASE_RECORDED = JSON.parse(
  readFileSync(new URL('./fixtures/a1-base-contrast-770a477c.json', import.meta.url), 'utf8'),
) as { specs: Record<string, Json>; outputs: Record<string, Json> };
// Shared Data row 1 (projection v3): the base record's stored hash is proven to be the pre-0.62.0 projection of STORED,
// then rebound to the current projection wherever it appears (tests/helpers/legacy-analysis-hash-v2.ts).
const BASE = rebindCapture(BASE_RECORDED, STORED, BASE_RECORDED.outputs.stored_hash as unknown as string);

const OPT = '146aa89d';
const FAC = 'fac_existing_customers_grandfathered';
const LABEL = '£59 for new Pro customers; grandfather existing customers';

/**
 * Paul's grandfathering add as the Agent now sends it: the user's £59 on the price (as persisted: user_specified,
 * 59 GBP per month on the 200 frame), and the new factor declared a SWITCH the option turns ON (level 1). The link to it
 * is Olumi's (`cee_hypothesis`), as persisted on his edge 146aa89d → the factor.
 */
const SWITCH_SPEC = (): Json => ({
  parent_decision_id: 'decision_mrr',
  label: LABEL,
  option_id: OPT,
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.295, raw_value: 59, unit: 'GBP per month' },
    { factor_key: 'existing_customers_grandfathered', value: 1, source: 'cee_hypothesis' },
  ],
  new_factors: [{
    key: 'existing_customers_grandfathered',
    label: 'Existing customers grandfathered',
    kind: 'switch',
    affects: [
      { node_id: 'monthly_churn', effect_direction: 'negative' },
      { node_id: 'mrr', effect_direction: 'negative' },
    ],
  }],
});

const hold = (spec: Json, graph: Json = STORED, hash: string = HASH) => dispatchAddOptionTransaction({
  parameters: spec, currentGraph: graph, currentGraphHash: hash, freshness: 'none',
  mode: 'live', scenarioId: 'a295e4a1', turnId: 't-propose', requestId: 'r-propose', stage: 'decide',
} as never) as Json;

/** Propose → hold → the real confirm. Returns the confirm outcome and the pending it confirmed. */
function proposeAndConfirm(spec: Json): { held: Json; executed: Json } {
  const held = hold(spec);
  expect(held.kind, JSON.stringify(held.reason ?? held.governing ?? '')).toBe('held');
  const read = readGmHeldResume(held.pendingActions[0]) as Json;
  expect(read.kind).toBe('ok');
  const executed = executeGmHeldResume({
    operations: read.operations,
    ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    ...(read.switchFactorIds !== undefined ? { switchFactorIds: read.switchFactorIds } : {}),
    currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
    scenarioId: 'a295e4a1', turnId: 't-confirm', requestId: 'r-confirm',
  }) as Json;
  return { held, executed };
}

const nodeOf = (g: Json, id: string): Json | undefined => (g.nodes as Json[]).find((n) => n.id === id);

/** The magnitude contract's own view of a factor over a stored graph: its fields plus every level an option sets. */
function magnitudeNode(g: Json, id: string): MagnitudeNode {
  const n = nodeOf(g, id)!;
  const levels = (g.nodes as Json[])
    .filter((o) => o.kind === 'option')
    .map((o) => o.interventions?.[id])
    .map((iv) => (typeof iv === 'number' ? iv : iv?.value))
    .filter((v): v is number => typeof v === 'number');
  return { label: n.label, kind: 'factor', scale_frame: n.scale_frame, observed_state: n.observed_state, option_levels: levels };
}

/** JSONB reorders keys (feedback: never compare persisted JSON by string): a key-order-insensitive canonical form. */
function canonical(x: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v)
    ? v.map(sort)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Json).sort().map((k) => [k, sort((v as Json)[k])]))
      : v);
  return JSON.stringify(sort(x));
}

describe('PRECONDITION — the fixture and this path reproduce Paul\'s wire', () => {
  it('the fixture is Paul\'s graph without the grandfathering transaction (13 nodes; neither id present)', () => {
    expect(PROVENANCE.removed_nodes).toEqual([OPT, FAC]);
    expect(nodeOf(STORED, OPT)).toBeUndefined();
    expect(nodeOf(STORED, FAC)).toBeUndefined();
    expect((STORED.nodes as Json[]).length).toBe(13);
  });

  it('the SAME add without a kind (graded, today\'s only shape) commits exactly Paul\'s persisted option levels and factor', () => {
    const spec = structuredClone(BASE.specs.grandfathering_graded);
    const { executed } = proposeAndConfirm(spec);
    expect(executed.status).toBe('executed');
    const persisted = PROVENANCE.persisted_after_transaction.nodes as Json[];
    const wireOption = persisted.find((n) => n.id === OPT)!;
    const wireFactor = persisted.find((n) => n.id === FAC)!;
    // Key-order-insensitive: the persisted copy went through JSONB.
    expect(canonical(nodeOf(executed.mutatedGraph, FAC))).toBe(canonical(wireFactor));
    expect(canonical(nodeOf(executed.mutatedGraph, OPT)!.interventions)).toBe(canonical(wireOption.interventions));
    expect(Object.keys(wireOption.interventions)).toEqual(['pro_plan_price']);
    expect(wireFactor.observed_state).toBeUndefined();
    // …and the served readiness gap: the option is asked for the level it never got.
    const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(executed.mutatedGraph));
    expect(pairs.map((p) => `${p.optionId}::${p.factorId}`)).toContain(`${OPT}::${FAC}`);
  });
});

describe('R1 — Paul\'s grandfathering add: the factor is a switch, off today and on under the option, in ONE commit', () => {
  it('RED: the hold names the switch, and its factor op stays the bare shape the referee screens (R4 not widened)', () => {
    const held = hold(SWITCH_SPEC());
    expect(held.kind).toBe('held');
    const ip = held.pendingActions[0].action.inline_patch as Json;
    expect(ip[GM_HELD_SWITCH_FACTORS_KEY]).toEqual([FAC]);
    const factorOp = (ip.operations as Json[]).find((o) => o.op === 'add_node' && o.path === FAC)!;
    expect(factorOp.value).toEqual({ id: FAC, kind: 'factor', label: 'Existing customers grandfathered', category: 'controllable' });
    // Never a follow-up value write: the batch carries no update op at all.
    expect((ip.operations as Json[]).filter((o) => o.op !== 'add_node' && o.op !== 'add_edge')).toEqual([]);
  });

  it('RED: after the confirm, today = 0 is Olumi\'s (cee_inference) through the value writer\'s members, and 146aa89d sets 1', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    expect(executed.status).toBe('executed');
    const factor = nodeOf(executed.mutatedGraph, FAC)!;
    expect(factor.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    expect(factor.provenance).toBe('ai_inferred');
    expect(factor.scale_frame).toBeUndefined();
    const option = nodeOf(executed.mutatedGraph, OPT)!;
    expect(option.interventions[FAC]).toMatchObject({ value: 1, source: 'cee_hypothesis', target_match: { node_id: FAC } });
    // The user's £59 is untouched beside it.
    expect(option.interventions.pro_plan_price).toMatchObject({ value: 0.295, raw_value: 59, source: 'user_specified' });
    // The links landed in the same graph (one commit): decision → option, option → factor, factor → churn and MRR.
    const edges = (executed.mutatedGraph.edges as Json[]).map((e) => `${e.from}->${e.to}`);
    for (const e of [`decision_mrr->${OPT}`, `${OPT}->${FAC}`, `${FAC}->monthly_churn`, `${FAC}->mrr`]) expect(edges).toContain(e);
  });

  it('RED: the magnitude contract calls it a switch (isSwitch, frame 1, both states in use) and it renders "on" with no new code', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const mn = magnitudeNode(executed.mutatedGraph, FAC);
    expect(resolveMagnitudeFrame(mn)).toBe(1);
    expect(isSwitch(mn, resolveMagnitudeFrame(mn))).toBe(true);
    const ready = buildCanonicalAnalysisReadyFromGraph(executed.mutatedGraph) as Json;
    const option = (ready.options as Json[]).find((o) => o.option_id === OPT);
    expect(option?.status).toBe('ready');
    expect(option?.intervention_details?.[FAC]?.display_value).toBe('on');
  });

  it('RED: no MISSING_OPTION_VALUE for 146aa89d — deriveMissingEffectPairs is empty for the pair, readiness names nothing on it', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(executed.mutatedGraph));
    expect(pairs.filter((p) => p.optionId === OPT)).toEqual([]);
    const verdict = assessRouteAdmission(executed.mutatedGraph);
    expect(verdict.readiness_issues.filter((i) => i.option_id === OPT && i.code === 'MISSING_OPTION_VALUE')).toEqual([]);
    expect(verdict.readiness_issues.filter((i) => i.factor_id === FAC)).toEqual([]);
  });

  it('the committed graph introduces no invariant violation at the commit chokepoint', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const projected = projectGraphForPersistence(structuredClone(executed.mutatedGraph)) as Json;
    expect(checkPersistedGraphInvariants(projected, { baseGraph: STORED }).status).not.toBe('violated');
  });

  it('the option is now a different choice from "Increase price to £59" (its levels differ), so it is not dropped as a twin', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const plain = nodeOf(executed.mutatedGraph, 'increase_price_to_59')!;
    expect(Object.keys(plain.interventions)).toEqual(['pro_plan_price']);
    expect(Object.keys(nodeOf(executed.mutatedGraph, OPT)!.interventions).sort()).toEqual([FAC, 'pro_plan_price'].sort());
  });
});

describe('R2 — today = 0 is Olumi\'s INFERENCE: "I supplied N+1 values" and "Estimated by Olumi" (AIQ 5854838919)', () => {
  it('RED: the disclosure reader counts N+1, naming the new factor', () => {
    const before = deriveInferredValues(STORED);
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const after = deriveInferredValues(executed.mutatedGraph);
    expect(before.length).toBe(4);
    expect(after.length).toBe(before.length + 1);
    expect(after.map((r) => r.factor_id)).toContain(FAC);
    expect(buildInferredValueDisclosure(after)).toContain(`I supplied ${before.length + 1} of the values behind this`);
  });

  it('RED: it reads as Olumi\'s estimate on every CEE reader of authorship — never the user\'s, never source-less', () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const factor = nodeOf(executed.mutatedGraph, FAC)!;
    // The display projection: `cee_inference` defers to `extractionType`, which says the model inferred it.
    expect(valueSourceAuthorship(factor.observed_state.source)).toBeUndefined();
    expect(nodeProvenanceDisplay(factor.observed_state.extractionType)).toBe('ai_inferred');
    // What the Agent is shown: a stated 0, with its author.
    const shown = projectEntity(factor as never);
    expect(shown.value).toBe(0);
    expect(shown.value_provenance).toEqual({ source: 'cee_inference', extraction_type: 'inferred' });
    expect(String(factor.observed_state.source)).not.toMatch(/^user/);
  });
});

describe('R2b — correctable: the user\'s own "it is already in place" lands through the EXISTING value writer as theirs', () => {
  it('a factor_value_edit to 1 on the committed switch is applied and stamped the user\'s; it then counts N, not N+1', async () => {
    const { executed } = proposeAndConfirm(SWITCH_SPEC());
    const payload = { kind: 'system_event', scenario_id: 'a295e4a1', turn_id: 't-edit', stage: 'frame',
      event: { kind: 'factor_value_edit', target_id: FAC, value: 1, field: 'value' } } as Json;
    const out = await applyFactorValueEdit({ payload: payload as never, event: payload.event as never, requestId: 'r-edit',
      persistedGraph: executed.mutatedGraph, priorFacts: [] }) as Json;
    expect(out.kind, JSON.stringify(out.reason ?? '')).toBe('mutated');
    const edited = nodeOf(out.mutatedGraph, FAC)!;
    expect(edited.observed_state.value).toBe(1);
    expect(String(edited.observed_state.source)).toMatch(/^user/);
    expect(edited.observed_state.extractionType).toBeUndefined();
    expect(deriveInferredValues(out.mutatedGraph).map((r) => r.factor_id)).not.toContain(FAC);
  });
});

describe('R3 — a refusal leaves the stored graph byte-identical (key-order-insensitive snapshot)', () => {
  it('RED: an option that acts on the switch without switching it on is refused at the builder, and nothing is held', () => {
    const snapshot = canonical(STORED);
    for (const level of [null, 0.5, 0]) {
      const spec = SWITCH_SPEC();
      spec.interventions[1].value = level;
      expect(buildAddOptionsTransaction(spec, STORED as never)).toMatchObject({ matched: false, reason: 'new_switch_not_switched_on' });
      expect(hold(spec).kind).not.toBe('held');
    }
    expect(canonical(STORED)).toBe(snapshot);
  });

  /**
   * ⛔ A SWITCH HAS NO LEVEL OF ITS OWN (independent verification, round 2). Each row is a level of 1 — so the level check
   * alone reads it as on — with the figure the user gave riding beside it: a unit, a raw figure, or both. Taken as on,
   * the user's figure would be dropped without a word and today-0 written as Olumi's. The unit-only row (1%) and the
   * raw-only rows ("0.5", "50%") each pin one half of the check.
   */
  it.each([
    ['£1/month', { raw_value: 1, unit: 'GBP per month' }],
    ['1%', { unit: '%' }],
    ['1 hire', { raw_value: 1, unit: 'hire' }],
    ["'0.5' (a string)", { raw_value: '0.5' }],
    ["'50%' (a string)", { raw_value: '50%' }],
    ['100%', { raw_value: 100, unit: '%' }],
  ])('RED: a switch level of 1 that carries %s is refused at the builder, and nothing is held', (_name, figure) => {
    const snapshot = canonical(STORED);
    const spec = SWITCH_SPEC();
    Object.assign(spec.interventions[1], figure);
    expect(spec.interventions[1].value).toBe(1);
    expect(buildAddOptionsTransaction(spec, STORED as never)).toMatchObject({ matched: false, reason: 'new_switch_not_switched_on' });
    expect(hold(spec).kind).not.toBe('held');
    expect(canonical(STORED)).toBe(snapshot);
  });

  it('CONTRAST: a bare 1 (no unit, no raw figure) is on — built and held with its switch named', () => {
    const spec = SWITCH_SPEC();
    expect(spec.interventions[1]).toEqual({ factor_key: 'existing_customers_grandfathered', value: 1, source: 'cee_hypothesis' });
    expect(buildAddOptionsTransaction(spec, STORED as never)).toMatchObject({ matched: true, switchFactorIds: [FAC] });
    const held = hold(spec);
    expect(held.kind).toBe('held');
    expect(held.pendingActions[0].action.inline_patch[GM_HELD_SWITCH_FACTORS_KEY]).toEqual([FAC]);
  });

  it('RED: a hold whose switch member does not match its batch is refused WHOLE at the confirm — nothing to commit', () => {
    const snapshot = canonical(STORED);
    const held = hold(SWITCH_SPEC());
    const read = readGmHeldResume(held.pendingActions[0]) as Json;
    const confirm = (switchFactorIds: string[], operations = read.operations) => executeGmHeldResume({
      operations, switchFactorIds, ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
      currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
      scenarioId: 'a295e4a1', turnId: 't-confirm', requestId: 'r-confirm',
    }) as Json;
    // (a) names a factor the batch does not add; (b) the batch's option no longer switches it on.
    const offOps = structuredClone(read.operations) as Json[];
    offOps[0]!.value.interventions[FAC].value = 0.5;
    for (const out of [confirm(['fac_not_in_this_batch']), confirm([FAC], offOps)]) {
      expect(out).toEqual({ status: 'apply_failed', reason: 'apply_error' });
      expect(out.mutatedGraph).toBeUndefined();
    }
    expect(canonical(STORED)).toBe(snapshot);
    // Positive control: the untampered hold executes.
    expect(confirm([FAC]).status).toBe('executed');
  });

  it('a malformed switch member on a stored hold is not executable (no_payload), never applied without its today-0', () => {
    const held = hold(SWITCH_SPEC());
    const bad = (value: unknown) => ({ ...held.pendingActions[0], action: { ...held.pendingActions[0].action,
      inline_patch: { ...held.pendingActions[0].action.inline_patch, [GM_HELD_SWITCH_FACTORS_KEY]: value } } });
    for (const v of [[], [''], [7], 'fac', null]) expect(readGmHeldResume(bad(v) as never).kind).toBe('no_payload');
    expect(readGmHeldResume(held.pendingActions[0])).toMatchObject({ kind: 'ok', switchFactorIds: [FAC] });
  });

  it('stampNewSwitchFactors is fail-closed by identity and never mutates its input', () => {
    const ops = (hold(SWITCH_SPEC()).pendingActions[0].action.inline_patch.operations) as Json[];
    const before = canonical(ops);
    const ok = stampNewSwitchFactors(ops as never, [FAC]);
    expect(ok.ok).toBe(true);
    expect(canonical(ops)).toBe(before);
    expect(stampNewSwitchFactors(ops as never, [FAC, FAC]).ok).toBe(false);
    expect(stampNewSwitchFactors(ops as never, ['decision_mrr']).ok).toBe(false);
    expect(stampNewSwitchFactors(ops as never, [OPT]).ok).toBe(false);
    expect(stampNewSwitchFactors(ops as never, []).ok && (stampNewSwitchFactors(ops as never, []) as Json).operations).toEqual(ops);
    const stamped = (ok as Json).operations.find((o: Json) => o.path === FAC);
    expect(stamped.value.observed_state).toEqual(NEW_SWITCH_TODAY.observed_state);
    expect(stampNewSwitchFactors((ok as Json).operations, [FAC]).ok).toBe(false);
  });
});

describe('CONTRAST — everything that is not a new switch is byte-identical to base 770a477c', () => {
  const headOutputs = (spec: Json): Json => {
    const built = buildAddOptionsTransaction(structuredClone(spec), STORED as never);
    const held = hold(structuredClone(spec));
    const out: Json = { built, dispatch_kind: held.kind };
    if (held.kind === 'held') {
      const { candidate_id: _random, ...ip } = held.pendingActions[0].action.inline_patch as Json;
      out.inline_patch = ip;
      out.public_label = held.pendingActions[0].action.public_label;
      out.assistant_text = held.response.assistant_text;
      const read = readGmHeldResume(held.pendingActions[0]) as Json;
      const ex = executeGmHeldResume({ operations: read.operations, ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
        ...(read.switchFactorIds !== undefined ? { switchFactorIds: read.switchFactorIds } : {}),
        currentGraph: STORED, currentGraphHash: HASH, freshness: 'none', hasExistingAnalysis: false,
        scenarioId: 's', turnId: 't2', requestId: 'r2' }) as Json;
      out.execute_status = ex.status;
      if (ex.status === 'executed') out.mutatedGraph = ex.mutatedGraph;
    }
    return out;
  };

  it('the fixture graph hashes as it did at base', () => {
    expect(HASH).toBe(BASE.outputs.stored_hash);
  });

  /**
   * The ONE change since base, by design: C2 consent (consent-names-new-option-levels.test.ts, AIC #70 5859629053) — the
   * hold ask names each level the option writes, right after the option's label. Pinned as that exact insertion into
   * the recorded base text; every other output (ops, inline_patch, public label, committed graph) stays byte-identical.
   */
  const C2_LEVELS: Record<string, string> = {
    existing: ", with 'Pro plan price' at 64 GBP per month",
    grandfathering_graded: ", with 'Pro plan price' at 59 GBP per month",
  };
  it.each(['existing', 'graded', 'grandfathering_graded'])('%s: builder ops, hold inline_patch, copy and committed graph are byte-identical', (name) => {
    const head = headOutputs(BASE.specs[name]!);
    const base = BASE.outputs[name] as Json;
    const levels = C2_LEVELS[name];
    const named = `add option '${BASE.specs[name]!.label}'`;
    if (levels !== undefined) expect(base.assistant_text, 'control: the base text names the option').toContain(named);
    const expected = levels === undefined ? base.assistant_text : String(base.assistant_text).replace(named, `${named}${levels}`);
    expect(head.assistant_text).toBe(expected);
    // Science 393023 LICENCE (a): subtract only the new door-default tag; keep the full old fidelity assertion.
    expect(JSON.stringify(beforeDoorTagsDeep({ ...head, assistant_text: undefined }, base))).toBe(JSON.stringify({ ...base, assistant_text: undefined }));
  });

  it('CONTRAST: a GRADED new factor ("Marketing spend", £5,000/month asked) stays valueless and asked — never 0', () => {
    const { executed } = proposeAndConfirm(structuredClone(BASE.specs.graded));
    expect(executed.status).toBe('executed');
    const factor = nodeOf(executed.mutatedGraph, 'fac_marketing_spend')!;
    expect(factor.observed_state).toBeUndefined();
    expect(nodeOf(executed.mutatedGraph, 'mkt5000')!.interventions).toEqual({});
    const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(executed.mutatedGraph));
    expect(pairs.map((p) => `${p.optionId}::${p.factorId}`)).toContain('mkt5000::fac_marketing_spend');
    expect(deriveInferredValues(executed.mutatedGraph).map((r) => r.factor_id)).not.toContain('fac_marketing_spend');
  });
});
