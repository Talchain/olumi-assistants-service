/**
 * The agent-lane science context (SCIENCE/DSK, #85 5933229708): applicability of DSK-P-001 / DSK-P-004 on typed inputs,
 * and the pre-mortem's grounded items with their ONE change card each.
 *
 * ⭐ OUTSIDE CORPUS. Every state below is REASONING COACH's derivation of R3's served captures, and the expected
 * pre-mortem items are RC's own reference (`MT-PREMORTEM-GOOD`), extracted unchanged into
 * `fixtures/rc-5ff741ab-method-science.json` with the contract commit and every capture's sha256. Rows marked
 * CONSTRUCTED change ONE named field of a served state, to reach a clause no served state reaches.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StageType } from '@talchain/schemas/boundary';

import { deriveAuthoritativeStage } from '../../../context/derive-stage.js';
import { _resetDskBundleCache, loadVerifiedDskBundle } from '../../../compose/dsk-bundle-record.js';
import { computeDSKHash } from '../../../../dsk/hash.js';
import type { DSKBundle, DSKProtocol } from '../../../../dsk/types.js';
import {
  methodScienceContext,
  type MethodScienceInput,
  type MethodScienceSignals,
} from '../method-science-context.js';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/rc-5ff741ab-method-science.json', import.meta.url), 'utf8'),
) as {
  states: Record<string, MethodScienceSignals>;
  premortem_reference: { plan_label: string; current_option_labels: string[]; supplied_items: unknown[] };
  never_coach_fields: string[];
  goal_constraints: Record<string, unknown[]>;
  served: Record<string, { stage_indicator: StageType; freshness: 'fresh'; option_count: number }>;
};

const D3 = FIXTURE.states['A-PREMORTEM-LICENSED'];
const D3_S4 = FIXTURE.states['A-D3-S4-AFTER-WIDEN-DISMISSED'];
const D2 = FIXTURE.states['A-D2-RUN2-WIDEN-P1'];

/** The canonical stage of the served D3 s1 turn, from the ONE stage authority, never a literal. */
const D3_STAGE = deriveAuthoritativeStage({
  requestedStage: FIXTURE.served['d3-s1'].stage_indicator,
  freshness: FIXTURE.served['d3-s1'].freshness,
  optionCount: FIXTURE.served['d3-s1'].option_count,
  hasGraph: true,
});

function protocol(id: string): DSKProtocol {
  const bundle = loadVerifiedDskBundle();
  const p = bundle?.objects.find((o): o is DSKProtocol => o.type === 'protocol' && o.id === id);
  if (p === undefined) throw new Error(`fixture precondition: ${id} missing from the verified bundle`);
  return p;
}

const premortem = (over: Partial<MethodScienceInput> = {}): MethodScienceInput => ({
  method: 'pre_mortem',
  canonical_stage: D3_STAGE,
  signals: D3,
  graph: { goal_constraints: FIXTURE.goal_constraints['d3-s1'] },
  ...over,
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetDskBundleCache();
});

describe('fixture preconditions (a vacuous fixture would pass everything below)', () => {
  it('the served D3 s1 turn derives the canonical stage `decide` (fresh, 3 options), though it was served as `frame`', () => {
    expect(FIXTURE.served['d3-s1'].stage_indicator).toBe('frame');
    expect(D3_STAGE).toBe('decide');
  });

  it('the reference holds all three item kinds, and D3 licenses its leader', () => {
    const kinds = new Set((FIXTURE.premortem_reference.supplied_items as { kind: string }[]).map((i) => i.kind));
    expect([...kinds].sort()).toEqual(['factor', 'link', 'risk']);
    expect(D3['run.leader_licensed']).toBe(true);
    expect(D3['run.leader_option_id']).toBe('switch_to_gcp');
  });
});

describe('DSK-P-001 on the pre-mortem', () => {
  it('ROW 1: D3 licensed Run at the canonical stage cites DSK-P-001, and its items EQUAL RC\'s reference', () => {
    const ctx = methodScienceContext(premortem());
    expect(ctx.not_cited).toBeNull();
    expect(ctx.dsk?.protocol_id).toBe('DSK-P-001');
    expect(ctx.dsk?.decision_stage).toBe('decide');
    expect(ctx.dsk?.bundle_hash).toBe(loadVerifiedDskBundle()?.dsk_version_hash);
    // Agreement with the policy owner's reference, order included: the harness passes these to checkMethodTurn unchanged.
    expect(ctx.supplied_items).toEqual(FIXTURE.premortem_reference.supplied_items);
    expect(ctx.plan).toEqual({ option_id: 'switch_to_gcp', label: FIXTURE.premortem_reference.plan_label, basis: 'licensed_leader' });
    expect(ctx.current_option_labels).toEqual(FIXTURE.premortem_reference.current_option_labels);
  });

  it('ROW 1b: the blind-spot step is P-001 step 2, carried APART from the steps the stories already embody', () => {
    const p001 = protocol('DSK-P-001');
    const ctx = methodScienceContext(premortem());
    expect(ctx.dsk?.blind_spot_step).toBe(p001.steps[1]);
    // The pre-mortem's "Watch for:" / "Mitigate:" shape carries steps 3-4, so they are not asked again.
    expect(ctx.dsk?.protocol_directive).toContain(`"${p001.title}"`);
    expect(ctx.dsk?.protocol_directive).not.toContain('Put them to the user as written');
    // Step 1 names `[winning option]`: never in the context, resolved or not.
    expect(p001.steps[0]).toMatch(/\[winning option\]/);
    expect(ctx.dsk?.literal_steps).not.toContain(p001.steps[0]);
    expect(JSON.stringify(ctx)).not.toContain('[winning option]');
  });

  it('ROW 2: no canonical stage → no citation; the items are still supplied (the method runs without a badge)', () => {
    const ctx = methodScienceContext(premortem({ canonical_stage: null }));
    expect(ctx.dsk).toBeNull();
    expect(ctx.not_cited).toBe('no_canonical_stage');
    expect(ctx.supplied_items).toEqual(FIXTURE.premortem_reference.supplied_items);
  });

  it('ROW 2b CONTROL: the SERVED literal stage `frame` is not evaluate|decide → no citation (why T3 must derive it)', () => {
    const ctx = methodScienceContext(premortem({ canonical_stage: FIXTURE.served['d3-s1'].stage_indicator }));
    expect(ctx.not_cited).toBe('stage_not_applicable');
  });

  it('ROW 3 CONSTRUCTED (run.kind none, stage analyse): no current Run → no citation', () => {
    const ctx = methodScienceContext(premortem({ canonical_stage: 'analyse', signals: { ...D3, 'run.kind': 'none' } }));
    expect(ctx.not_cited).toBe('no_current_run');
  });

  it('ROW 4 PAIR: unlicensed leader → no plan and no citation; a user-chosen plan gets items but NEVER P-001', () => {
    const unlicensed: MethodScienceSignals = { ...D3, 'run.leader_licensed': false, 'run.leader_option_id': null };
    const none = methodScienceContext(premortem({ signals: unlicensed }));
    expect(none.plan).toBeNull();
    expect(none.supplied_items).toEqual([]);
    expect(none.not_cited).toBe('no_identified_plan');

    const chosen = methodScienceContext(premortem({ signals: unlicensed, user_selected_option_id: 'switch_to_gcp' }));
    expect(chosen.plan?.basis).toBe('user_selected');
    expect(chosen.supplied_items).toEqual(FIXTURE.premortem_reference.supplied_items);
    expect(chosen.dsk).toBeNull();
    expect(chosen.not_cited).toBe('no_identified_plan');
  });

  it('ROW 5 SERVED (D3 s4: one own option, leader withheld): the single option is the plan, never cited', () => {
    expect(D3_S4['model.non_sq_option_ids']).toEqual(['switch_to_gcp']);
    const ctx = methodScienceContext(premortem({ signals: D3_S4, graph: { goal_constraints: FIXTURE.goal_constraints['d3-s4'] } }));
    expect(ctx.plan).toEqual({ option_id: 'switch_to_gcp', label: 'Switch to GCP', basis: 'single_option' });
    expect(ctx.dsk).toBeNull();
  });

  it('ROW 5b CONSTRUCTED (licensed leader, ONE own option): the P-001 contraindication holds', () => {
    const ctx = methodScienceContext(premortem({ signals: { ...D3, 'model.non_sq_option_ids': ['switch_to_gcp'] } }));
    expect(ctx.not_cited).toBe('single_option');
  });

  it('ROW 6 CONSTRUCTED (every plan-path link and factor is the user\'s): no evidence gap → no citation', () => {
    const allYours: MethodScienceSignals = {
      ...D3,
      'model.goal_path_links': D3['model.goal_path_links'].map((l) => ({ ...l, link_sizing: 'user' as const })),
      'model.goal_path_factors': D3['model.goal_path_factors'].map((f) => ({ ...f, value_authorship: 'yours' as const })),
    };
    const ctx = methodScienceContext(premortem({ signals: allYours }));
    expect(ctx.not_cited).toBe('no_evidence_gap');
    // Only the risk is left to rest a story on.
    expect(ctx.supplied_items.map((i) => i.kind)).toEqual(['risk']);
  });
});

describe('items bind by IDENTITY to the plan\'s path', () => {
  it('ROW 7 PAIR: a link only on ANOTHER option\'s path, and a risk off the path, are excluded', () => {
    const offPath: MethodScienceSignals = {
      ...D3,
      'model.risk_ids': [...D3['model.risk_ids'], 'a_risk_nowhere_near_the_plan'],
      'model.goal_path_links': [
        ...D3['model.goal_path_links'],
        { link_id: 'phased_only_factor->monthly_spend', from_label: 'Phased only', to_label: 'Monthly spend',
          link_sizing: 'olumi_estimate', option_ids: ['phased_gcp_migration'], goal_distance: 0 },
      ],
    };
    const forSwitch = methodScienceContext(premortem({ signals: offPath }));
    expect(forSwitch.supplied_items).toEqual(FIXTURE.premortem_reference.supplied_items);
    // CONTROL: the same link IS supplied when the plan is the option whose path it lies on.
    const forPhased = methodScienceContext(premortem({
      signals: { ...offPath, 'run.leader_option_id': 'phased_gcp_migration' },
    }));
    expect(forPhased.supplied_items.map((i) => i.id)).toContain('phased_only_factor->monthly_spend');
  });

  it('ROW 8 PAIR: a limit is supplied only when its quantity sits on the plan\'s path (D3: off it; D2: on the goal)', () => {
    const d3 = methodScienceContext(premortem());
    expect(d3.supplied_items.some((i) => i.kind === 'limit')).toBe(false);
    // D2: the plan path ends at the goal `securing_funding`, which is the limit's quantity.
    const d2 = methodScienceContext({
      method: 'pre_mortem', canonical_stage: 'decide', signals: D2, user_selected_option_id: 'angel_investor_outreach',
      graph: { goal_constraints: FIXTURE.goal_constraints['d2-run2'] },
    });
    expect(d2.supplied_items.filter((i) => i.kind === 'limit')).toEqual([
      { id: 'gc-e7bc6239-8ac4-43c3-9b75-77c03c68eb57', kind: 'limit', labels: ['securing funding'], card: 'propose_new_risk' },
    ]);
  });
});

describe('DSK-P-004 on Widen', () => {
  it('ROW 9 SERVED (D2 run 2, post-Run): no P-004 badge (DL 5933063973 (a))', () => {
    const stage = deriveAuthoritativeStage({
      requestedStage: FIXTURE.served['d2-run2'].stage_indicator,
      freshness: FIXTURE.served['d2-run2'].freshness,
      optionCount: FIXTURE.served['d2-run2'].option_count,
      hasGraph: true,
    });
    const ctx = methodScienceContext({ method: 'elicit_options', canonical_stage: stage, signals: D2 });
    expect(ctx.dsk).toBeNull();
    expect(ctx.not_cited).toBe('stage_not_applicable');
  });

  it('ROW 10 PAIR (D3 options at `frame`): two own options cite P-004 and ask its steps; one own option never does', () => {
    const p004 = protocol('DSK-P-004');
    const two = methodScienceContext({ method: 'elicit_options', canonical_stage: 'frame', signals: D3 });
    expect(two.dsk?.protocol_id).toBe('DSK-P-004');
    expect(two.dsk?.protocol_directive).toContain('Put them to the user as written');
    for (const step of two.dsk?.literal_steps ?? []) expect(two.dsk?.protocol_directive).toContain(step);
    expect(two.dsk?.literal_steps.length).toBe(p004.steps.filter((s) => !/\[[^\]]*\]/.test(s)).length);
    expect(two.dsk?.blind_spot_step).toBeNull();
    expect(two.supplied_items).toEqual([]);

    const one = methodScienceContext({ method: 'elicit_options', canonical_stage: 'frame', signals: D2 });
    expect(one.not_cited).toBe('single_option');
  });
});

describe('the context is an allow-list', () => {
  it('ROW 11: exactly the allowed keys, item by item, and no never-coach field anywhere', () => {
    const ctx = methodScienceContext(premortem());
    expect(Object.keys(ctx).sort()).toEqual(
      ['current_option_labels', 'dsk', 'goal_label', 'method', 'not_cited', 'plan', 'supplied_figures', 'supplied_items'],
    );
    for (const item of ctx.supplied_items) expect(Object.keys(item).sort()).toEqual(['card', 'id', 'kind', 'labels']);
    const body = JSON.stringify(ctx);
    const leaves = FIXTURE.never_coach_fields.map((f) => f.split(' ')[0]!.split('.').pop()!);
    expect(leaves.length).toBeGreaterThan(10);
    for (const leaf of leaves) expect(body).not.toContain(`"${leaf}"`);
    // CONTROL: the scan sees a field when one is there.
    expect(JSON.stringify({ ...ctx, win_probability: 0.7 })).toContain('"win_probability"');
  });
});

/** Serve `bundle` as `data/dsk/v1.json` from a temp dir, as the loader reads it. */
function serveBundle(bundle: unknown): void {
  const dir = mkdtempSync(join(tmpdir(), 'sdsk-bundle-'));
  mkdirSync(join(dir, 'data', 'dsk'), { recursive: true });
  writeFileSync(join(dir, 'data', 'dsk', 'v1.json'), JSON.stringify(bundle));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  _resetDskBundleCache();
}

const realBundle = (): DSKBundle =>
  JSON.parse(readFileSync(join(process.cwd(), 'data', 'dsk', 'v1.json'), 'utf8')) as DSKBundle;

describe('the bundle is the authority', () => {
  it('ROW 12: a bundle that fails its own hash cites nothing (missing badge, never a wrong one)', () => {
    const real = realBundle();
    serveBundle({ ...real, objects: real.objects.map((o) => (o.id === 'DSK-P-001' ? { ...o, title: 'Tampered' } : o)) });
    const ctx = methodScienceContext(premortem());
    expect(ctx.dsk).toBeNull();
    expect(ctx.not_cited).toBe('bundle_unverified');
  });

  it('ROW 13 PAIR: a NEW valid bundle with P-001\'s steps reordered still cites, but gives NO blind-spot step', () => {
    const real = realBundle();
    const reordered = {
      ...real,
      objects: real.objects.map((o) =>
        o.id === 'DSK-P-001' && o.type === 'protocol' ? { ...o, steps: [...(o as DSKProtocol).steps].reverse() } : o),
    } as DSKBundle;
    const rehashed = { ...reordered, dsk_version_hash: computeDSKHash(reordered) };
    expect(rehashed.dsk_version_hash).not.toBe(real.dsk_version_hash);
    serveBundle(rehashed);
    const ctx = methodScienceContext(premortem());
    expect(ctx.dsk?.protocol_id).toBe('DSK-P-001');
    expect(ctx.dsk?.bundle_hash).toBe(rehashed.dsk_version_hash);
    // Position 1 of the new bundle is a different step: bound to the hash it was read from, it is withheld.
    expect(ctx.dsk?.blind_spot_step).toBeNull();
  });
});
