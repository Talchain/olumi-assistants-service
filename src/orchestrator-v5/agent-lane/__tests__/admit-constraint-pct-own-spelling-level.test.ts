/**
 * ⭐ A LEVEL LIMIT IN ITS NODE'S OWN PERCENT SPELLING IS THAT PERCENT (DL #72 5868320182, AIQ 5868296245; MG root 5868338154).
 *
 * SERVED (DL acceptance-f-runs `pj-20260928T101026Z` A14, journey A run 2; fixture verbatim in
 * `tests/fixtures/magnitude/pa3-run2-pct-own-spelling-served.json`): the drafter spelled churn "% monthly churn" on BOTH the
 * node (Olumi's 3%, `scale_frame` 100) and the ≤ 4 level limit. `canonicaliseLimitUnit` relabels only a percent head plus a
 * period ("% per month" — run 1) or "% of <population>", so the unit stayed verbatim; PLoT's exact-token `isPercentUnit`
 * missed it, read 4 on the default [0,1], clamped it and refused the limit (`CONSTRAINT_REFUSED_FRAME_FIDELITY`,
 * `threshold_clamped`) — 4% inside 0–100%, unscored. Runs 1 and 3 ("% per month" relabelled, "%") scored it.
 *
 * THE SPEC: a LEVEL limit whose unit IS its node's own unit, spelled as a percent, on a node whose level is the percent ÷ 100,
 * is that percent — relabelled to "%" with provenance. The same guard the "of" rule uses: the limit reads only a node in its
 * own spelling. A delta, a different spelling from the node, another period and a fraction-scale value stay verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { admitCandidateConstraints, canonicaliseLimitUnit, type LimitTargetScale } from '../admit-constraint.js';

type Rec = Record<string, unknown>;
const RUN = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../../tests/fixtures/magnitude/pa3-run2-pct-own-spelling-served.json', import.meta.url)), 'utf8'),
) as { goal_node_id: string; node: Rec; limit: Rec };

const UNIT = '% monthly churn';
const os = RUN.node.observed_state as Rec;
const SCALE: LimitTargetScale = { unit: os.unit as string, value: os.value as number, raw_value: os.raw_value as number, scale_frame: RUN.node.scale_frame as number, label: RUN.node.label as string };

const admit = (unit = UNIT, frame: 'level' | 'delta' | undefined = 'level', scale = SCALE, value = 4) =>
  admitCandidateConstraints([{ metric: 'Monthly churn', operator: '<=', value, unit, provenance: 'explicit', frame }],
    () => 'monthly_churn', () => scale).constraints[0]!;

describe('a LEVEL limit in its node\'s own percent spelling is that percent', () => {
  it('[served A14] PRECONDITION: the served limit and node are both "% monthly churn", node framed on 100 at 3%', () => {
    expect(RUN.limit).toMatchObject({ unit: UNIT, value: 4, operator: '<=', value_frame: 'level', node_id: 'monthly_churn' });
    expect(SCALE).toEqual({ unit: UNIT, value: 0.03, raw_value: 3, scale_frame: 100, label: 'Monthly churn' });
  });

  it('⭐ RED [served A14]: admission relabels it to "%", value unchanged, provenance stamped', () => {
    const c = admit();
    expect(c.unit).toBe('%');
    expect(c.value).toBe(4);
    expect(c.provenance_unit_relabelled).toEqual({ rule: 'agent_lane_limit_pct_own_spelling_level_v1', pre_normalisation_value: 4, pre_normalisation_unit: UNIT });
  });

  it('⭐ RED: another label word in the same shape ("% weekly trial conversion" on its own node) is the same class', () => {
    const u = '% weekly trial conversion';
    expect(canonicaliseLimitUnit(20, u, { ...SCALE, unit: u, value: 0.2, raw_value: 20, label: 'Trial conversion' }, 'level').unit).toBe('%');
  });

  it('CONTRAST (CI red on the first head): the same spelling whose words name a RELATION, not the node, stays verbatim', () => {
    // "% change" / "% growth" on a node spelled the same: the tail is not the node's name, so it is a change, not a level.
    expect(admit('% change', 'level', { ...SCALE, unit: '% change' }, 10).unit).toBe('% change');
    expect(admit('% monthly growth', 'level', { ...SCALE, unit: '% monthly growth' }, 10).unit).toBe('% monthly growth');
  });

  it('CONTRAST: a target that is no real node (no label — percentLevelFrame\'s self-target) never matches', () => {
    const { label: _l, ...unlabelled } = SCALE;
    expect(admit(UNIT, 'level', unlabelled).unit).toBe(UNIT);
  });

  it('CONTROL (run 1\'s shape): "% per month" still relabels under its own rule, unchanged', () => {
    const c = admit('% per month', 'level', { ...SCALE, unit: '% per month' });
    expect(c.unit).toBe('%');
    expect((c.provenance_unit_relabelled as Rec).rule).toBe('agent_lane_limit_unit_v1');
  });

  it('CONTRAST: a spelling that is NOT the node\'s own stays verbatim (the node decides what the words mean)', () => {
    expect(admit('% monthly churn', 'level', { ...SCALE, unit: '% per month' }).unit).toBe('% monthly churn');
    expect(admit('% monthly revenue churn', 'level', SCALE).unit).toBe('% monthly revenue churn');
  });

  it('CONTRAST: a delta, a fraction-scale value, a node not framed on 100, and a capped node stay verbatim', () => {
    expect(admit(UNIT, 'delta').unit).toBe(UNIT);
    expect(admit(UNIT, 'level', SCALE, 0.04).unit).toBe(UNIT);
    expect(admit(UNIT, 'level', { ...SCALE, scale_frame: 20 }).unit).toBe(UNIT);
    // A capped node in the same spelling: PLoT reconciles it against the cap already (`explicit_cap [0,cap]`).
    expect(admit(UNIT, 'level', { unit: UNIT, value: 0.03, raw_value: 3, cap: 100 }).unit).toBe(UNIT);
  });

  it('CONTRAST: a unit that is not a percent in its node\'s spelling ("subscribers") stays verbatim', () => {
    expect(admit('subscribers', 'level', { unit: 'subscribers', value: 0.3, raw_value: 30, scale_frame: 100 }, 20).unit).toBe('subscribers');
  });
});
