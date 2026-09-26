/**
 * ONE HELD CHANGE ADDS THE MISSING FACTOR AND THE OPTION (DL #70 5843303596; contract 5843960061,
 * ruled by Canonical 5843972346 + correction 5843988693).
 *
 * Served (F4, CEE 0c1e669 → fbb12b8): Paul's "Keep £49 and add a paid AI add-on". The drafted model has no
 * add-on factor, so the Agent could only ask. The typed add-option transaction rejected any factor the
 * graph lacked (`factor_not_found`), so even after the user answered, nothing could land it in one approval.
 *
 * The fixture is Paul's served graph (DL browser bf-20260926T054503Z, turn 3) with the two options (F) later
 * added removed — the state the user is in when they ask. Not authored.
 *
 *   factor node        → kind factor, `category: controllable` (an option sets it), NO value, NO prior, NO
 *                        provenance (R4 screens add_node; the value goes through the value path later)
 *   factor → target    → Olumi's DEFAULT hypothesis (STRENGTH_DEFAULT_SIGNATURE, DEFAULT_EXISTS_PROBABILITY,
 *                        `defaulted`, `cee_hypothesis`) signed by the user's direction — never strength 1.0
 *   order              → option add_node FIRST (the gmh_ handle), factor add_node, then every edge
 *   targets            → goal | outcome | risk | observable/external factor, and one must reach the goal
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXISTS_PROBABILITY, STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';

import { buildAddOptionsTransaction } from '../add-option-transaction.js';
import { dispatchAddOptionTransaction } from '../../handlers/add-option-dispatch.js';
import { assessHeldBatchAgainstGraph } from '../../handlers/edit-graph-referee-gate.js';
import { readGmHeldResume } from '../../handlers/gm-held-execute.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { checkPersistedGraphInvariants } from '../../persisted-graph-invariants.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(
  readFileSync(new URL('./fixtures/served-f4-pre-addon.bf-054503.json', import.meta.url), 'utf8'),
) as { nodes: Json[]; edges: Json[] };
const STORED = projectGraphForPersistence(structuredClone(SERVED)) as typeof SERVED;
const HASH = computeAnalysisAffectingGraphHash(STORED as never)!;

/** Paul's F4 option, as the Agent would send it once he has said what the add-on changes. */
const F4 = {
  parent_decision_id: 'decision_mrr',
  label: 'Keep £49 and add a paid AI add-on',
  interventions: [
    { factor_id: 'pro_plan_price', value: 0.245 },
    { factor_key: 'addon', value: null },
  ],
  new_factors: [
    {
      key: 'addon',
      label: 'Paid AI add-on',
      affects: [
        { node_id: 'new_pro_conversion_rate', effect_direction: 'positive' },
        { node_id: 'mrr', effect_direction: 'positive' },
      ],
    },
  ],
};
const built = () => buildAddOptionsTransaction(structuredClone(F4), STORED as never);
const opsOf = (r: ReturnType<typeof buildAddOptionsTransaction>) => (r.matched ? r.operations : []) as Json[];

describe('PRECONDITIONS (bound to the served graph)', () => {
  it('the served model has no add-on factor, no outcome nodes, and factor → goal edges', () => {
    expect(STORED.nodes.some((n) => /add-on/i.test(n.label ?? ''))).toBe(false);
    expect(STORED.nodes.some((n) => n.kind === 'outcome')).toBe(false);
    expect(STORED.edges.some((e) => e.from === 'pro_plan_price' && e.to === 'mrr')).toBe(true);
  });

  it('TODAY\'S REFUSAL — an option naming a factor the graph lacks is refused, never partially added', () => {
    const r = buildAddOptionsTransaction(
      { parent_decision_id: 'decision_mrr', label: 'X', interventions: [{ factor_id: 'fac_paid_ai_add_on', value: null }] },
      STORED as never,
    );
    expect(r).toEqual({ matched: false, reason: 'factor_not_found' });
  });
});

describe('⭐ one batch adds the factor and the option', () => {
  it('matches, in the PINNED order: option node → factor node → decision→option → factor→affects → option→factor', () => {
    const r = built();
    expect(r.matched).toBe(true);
    const ops = opsOf(r);
    const opt = ops[0]!.path;
    expect(ops.map((o) => `${o.op}:${o.path}`)).toEqual([
      `add_node:${opt}`,
      'add_node:fac_paid_ai_add_on',
      `add_edge:decision_mrr::${opt}`,
      'add_edge:fac_paid_ai_add_on::new_pro_conversion_rate',
      'add_edge:fac_paid_ai_add_on::mrr',
      `add_edge:${opt}::pro_plan_price`,
      `add_edge:${opt}::fac_paid_ai_add_on`,
    ]);
    expect(ops[0]).toMatchObject({ value: { kind: 'option', label: 'Keep £49 and add a paid AI add-on' } });
  });

  it('the factor is controllable and carries NO value, prior, provenance or source', () => {
    const factor = opsOf(built())[1]!;
    expect(factor.path).toBe('fac_paid_ai_add_on');
    expect(factor.value).toEqual({ id: 'fac_paid_ai_add_on', kind: 'factor', label: 'Paid AI add-on', category: 'controllable' });
  });

  it('each factor → target edge is Olumi\'s DEFAULT hypothesis, signed by the user\'s direction — never strength 1.0', () => {
    const edges = opsOf(built()).filter((o) => o.op === 'add_edge' && o.value.from === 'fac_paid_ai_add_on');
    expect(edges.map((e) => e.value.to).sort()).toEqual(['mrr', 'new_pro_conversion_rate']);
    for (const e of edges) {
      expect(e.value).toMatchObject({
        strength: { mean: STRENGTH_DEFAULT_SIGNATURE.mean, std: STRENGTH_DEFAULT_SIGNATURE.std },
        exists_probability: DEFAULT_EXISTS_PROBABILITY,
        effect_direction: 'positive',
        defaulted: true,
        provenance: { source: 'cee_hypothesis' },
      });
      expect(e.value.strength.mean).not.toBe(STRUCTURAL_EDGE_DEFAULTS.strength.mean);
    }
  });

  it('a NEGATIVE direction signs the default mean', () => {
    const spec = structuredClone(F4);
    spec.new_factors[0]!.affects = [{ node_id: 'monthly_churn_rate', effect_direction: 'negative' }];
    const e = opsOf(buildAddOptionsTransaction(spec, STORED as never)).find((o) => o.value?.from === 'fac_paid_ai_add_on')!;
    expect(e.value.strength.mean).toBe(-STRENGTH_DEFAULT_SIGNATURE.mean);
    expect(e.value.effect_direction).toBe('negative');
  });

  it('the option links to the NEW factor, resolved from its batch key, as linked-but-unvalued', () => {
    const r = built();
    expect(r.matched && r.proposals[0]!.linkedUnvaluedFactorIds).toEqual(['fac_paid_ai_add_on']);
    expect(opsOf(r).some((o) => o.op === 'add_edge' && o.value.to === 'fac_paid_ai_add_on' && o.value.from === (opsOf(r)[0]!.path))).toBe(true);
  });

  it('a given factor_id is used as-is when canonical and free', () => {
    const spec = structuredClone(F4) as Json;
    spec.new_factors[0].factor_id = 'ai_addon';
    spec.interventions[1] = { factor_key: 'addon', value: null };
    const ops = opsOf(buildAddOptionsTransaction(spec, STORED as never));
    expect(ops[1]!.path).toBe('ai_addon');
  });
});

describe('⭐ it lands through the REAL seams', () => {
  it('applies with the production applier and introduces NO invariant violation at the commit chokepoint', () => {
    const committed = applyPatchOperations(structuredClone(STORED) as never, opsOf(built()) as never);
    const projected = projectGraphForPersistence(committed as never) as typeof SERVED;
    expect(projected.nodes.find((n) => n.id === 'fac_paid_ai_add_on')).toMatchObject({ kind: 'factor', category: 'controllable' });
    expect(checkPersistedGraphInvariants(projected, { baseGraph: STORED }).status).not.toBe('violated');
  });

  it('the typed dispatcher HOLDS it as ONE change (a single pending), naming the new factor by its label', () => {
    const out = dispatchAddOptionTransaction({
      parameters: structuredClone(F4), currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
      mode: 'live', scenarioId: 's', turnId: 't', requestId: 'r', stage: 'decide',
    } as never);
    expect(out.kind).toBe('held');
    const held = out as Json;
    expect(held.pendingActions).toHaveLength(1);
    expect(held.response.assistant_text).toContain('Paid AI add-on');
    expect(held.response.assistant_text).not.toContain('fac_paid_ai_add_on');
  });

  it('the hold LAPSES if the factor id is taken before approval (contrast: unmoved → still held)', () => {
    const out = dispatchAddOptionTransaction({
      parameters: structuredClone(F4), currentGraph: STORED, currentGraphHash: HASH, freshness: 'none',
      mode: 'live', scenarioId: 's', turnId: 't', requestId: 'r', stage: 'decide',
    } as never) as Json;
    const read = readGmHeldResume(out.pendingActions[0]) as Json;
    const taken = structuredClone(STORED) as Json;
    taken.nodes.push({ id: 'fac_paid_ai_add_on', kind: 'factor', label: 'Something else', category: 'controllable' });
    const takenHash = computeAnalysisAffectingGraphHash(taken as never)!;
    const assess = (graph: unknown, hash: string) => assessHeldBatchAgainstGraph({
      operations: read.operations, currentGraph: graph, currentGraphHash: hash, scenarioId: 's', turnId: 't2', requestId: 'r2',
      ...(read.envelopeCap !== undefined ? { envelopeCap: read.envelopeCap } : {}),
    });
    expect(assess(STORED, HASH).valid).toBe(true);
    expect(assess(taken, takenHash).valid).toBe(false);
  });

  it('⭐ after approval, with the add-on level UNSET: the run is admitted and the readiness NAMES the missing value', () => {
    const committed = projectGraphForPersistence(applyPatchOperations(structuredClone(STORED) as never, opsOf(built()) as never) as never);
    expect(resolveRunAdmission(committed).willProceed).toBe(true);
    const v = assessRouteAdmission(committed);
    expect(v.may_run).toBe(true);
    const named = v.readiness_issues.filter((i) => i.factor_id === 'fac_paid_ai_add_on');
    expect(named.map((i) => i.code)).toEqual(['MISSING_OPTION_VALUE']);
  });

  it('CONTRAST — with a level set, nothing names the add-on', () => {
    const spec = structuredClone(F4) as Json;
    spec.interventions[1].value = 0.2;
    const committed = projectGraphForPersistence(applyPatchOperations(structuredClone(STORED) as never, opsOf(buildAddOptionsTransaction(spec, STORED as never)) as never) as never);
    expect(assessRouteAdmission(committed).readiness_issues.some((i) => i.factor_id === 'fac_paid_ai_add_on')).toBe(false);
  });
});

describe('refusals are loud, and nothing is held', () => {
  const refuse = (mutate: (s: Json) => void) => {
    const spec = structuredClone(F4) as Json;
    mutate(spec);
    return buildAddOptionsTransaction(spec, STORED as never);
  };

  it('a label the model already has → new_factor_exists (use the existing factor)', () => {
    expect(refuse((s) => { s.new_factors[0].label = 'AI feature adoption'; }))
      .toMatchObject({ matched: false, reason: 'new_factor_exists' });
  });
  it('a given id that is taken → factor_id_collision; not canonical → factor_id_invalid', () => {
    expect(refuse((s) => { s.new_factors[0].factor_id = 'pro_plan_price'; }))
      .toMatchObject({ matched: false, reason: 'factor_id_collision' });
    expect(refuse((s) => { s.new_factors[0].factor_id = 'Bad Id'; }))
      .toMatchObject({ matched: false, reason: 'factor_id_invalid' });
  });
  it('a target that is missing, an option, a decision or a CONTROLLABLE factor → affects_target_invalid', () => {
    for (const id of ['nope', 'status_quo', 'decision_mrr', 'pro_plan_price']) {
      expect(refuse((s) => { s.new_factors[0].affects = [{ node_id: id, effect_direction: 'positive' }]; }))
        .toMatchObject({ matched: false, reason: 'affects_target_invalid' });
    }
  });
  it('a target that cannot reach the goal → new_factor_unreachable', () => {
    const island = structuredClone(STORED) as Json;
    island.nodes.push({ id: 'island_obs', kind: 'factor', label: 'Island', category: 'observable' });
    const spec = structuredClone(F4) as Json;
    spec.new_factors[0].affects = [{ node_id: 'island_obs', effect_direction: 'positive' }];
    expect(buildAddOptionsTransaction(spec, island as never)).toMatchObject({ matched: false, reason: 'new_factor_unreachable' });
  });
  it('an intervention naming a key the batch does not add → new_factor_not_found', () => {
    expect(refuse((s) => { s.interventions[1].factor_key = 'other'; }))
      .toMatchObject({ matched: false, reason: 'new_factor_not_found' });
  });
  it('a new factor no option changes → new_factor_unused', () => {
    expect(refuse((s) => { s.interventions = [{ factor_id: 'pro_plan_price', value: 0.245 }]; }))
      .toMatchObject({ matched: false, reason: 'new_factor_unused' });
  });
  it('an empty affects, a duplicate key, or an unknown key (a unit with no value carrier) → parameters_invalid', () => {
    expect(refuse((s) => { s.new_factors[0].affects = []; })).toMatchObject({ matched: false, reason: 'parameters_invalid' });
    expect(refuse((s) => { s.new_factors.push({ ...s.new_factors[0], label: 'Other add-on' }); })).toMatchObject({ matched: false, reason: 'parameters_invalid' });
    expect(refuse((s) => { s.new_factors[0].unit = '£ per month'; })).toMatchObject({ matched: false, reason: 'parameters_invalid' });
  });
});

describe('CONTROL — a batch without new_factors is unchanged', () => {
  it('the single-option spec builds exactly what it built before (no factor op, no hypothesis edge)', () => {
    const r = buildAddOptionsTransaction(
      { parent_decision_id: 'decision_mrr', label: 'Raise to £64', interventions: [{ factor_id: 'pro_plan_price', value: 0.32 }] },
      STORED as never,
    );
    expect(r.matched).toBe(true);
    const ops = opsOf(r);
    expect(ops.filter((o) => o.op === 'add_node')).toHaveLength(1);
    expect(ops.some((o) => o.value?.defaulted === true)).toBe(false);
  });
});
