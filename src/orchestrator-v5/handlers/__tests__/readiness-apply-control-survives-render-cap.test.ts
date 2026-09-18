/**
 * The readiness APPLY control must survive the client's render cap.
 *
 * ─── The defect this pins (measured 2026-09-18 at CEE staging b53cb78c) ─────
 * `readiness-intake.ts` caps its own chip row at `READINESS_MAX_RENDERED_CHIPS`
 * and says why in its own docstring: *"The deployed `SuggestedChips` slices to
 * THREE … Emitting more would silently drop affordances this composer's own
 * prose may have promised — so the cap is enforced HERE."*
 *
 * Both readiness apply-control sites then APPENDED to that already-full list:
 *   `route-v2.ts` (S2-L1 readiness arm) and
 *   `turn-executor.ts` (`regenerateReadinessRepair`)
 * both built `[...readinessResponse.suggested_actions, applyChip]`, putting the
 * apply control at index 3 of 4. The client renders the first three.
 *
 * Measured on the real composers with the fixture below, BEFORE the fix:
 *   composeReadinessIntakeResponse → 3 suggested_actions   (its own cap)
 *   buildReadinessRepairOffer      → rrp_92d1e1ebadb2, "Apply 2 safe model fixes"
 *   plain append                   → 4
 *   client slice(0,3)              → the three answer chips
 *   apply control reaches the user → FALSE
 *
 * So CEE built an apply control over the user's own model, committed a durable
 * pending for it, and the user could never press it. Two modules, each correct
 * alone: one owns the cap, the other appends past it, and nothing named the
 * seam (CLAUDE.md trap 21).
 *
 * ─── Why the historic-record case below is load-bearing ────────────────────
 * A test asserting "the apply control survives" goes VACUOUS the moment the
 * fixture stops producing a full row — it would pass because there was never an
 * overflow, not because the fix works (trap 13b: a guard whose discrimination
 * depends on a fixture nothing pins). So the suite PINS ITS OWN PRECONDITION:
 * the fixture must fill the row exactly, and the OLD composition must still be
 * shown dropping the control.
 */
import { describe, it, expect } from 'vitest';

import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import {
  composeReadinessIntakeResponse,
  READINESS_MAX_RENDERED_CHIPS,
} from '../../routing/readiness-intake.js';
import {
  buildReadinessRepairOffer,
  withReadinessApplyControl,
} from '../readiness-repair-proposal.js';

/**
 * The UI's own cap, `SuggestedChips.tsx`:
 *   `const visible = polished.filter(isChipRenderable).slice(0, 3)`
 * It lives in another repo and cannot be imported, so it is restated ONCE here
 * and immediately asserted equal to CEE's constant — a drift on either side
 * goes RED rather than silently re-opening the overflow.
 */
const CLIENT_RENDER_CAP = 3;

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';

type Dict = Record<string, unknown>;
const edge = (from: string, to: string): Dict => ({
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 1,
  effect_direction: 'positive',
});

/**
 * Five options against two factors: two carry canonicalisable effect values
 * (→ the repair proposal's `changes`), three are unconfigured (→ answerable
 * blockers, i.e. a FULL answer-chip row). That co-occurrence is the whole point
 * — this module is named "multi-blocker readiness repair" — and it is exactly
 * the state in which the apply control was being deleted.
 */
const GRAPH: Dict = {
  goal_node_id: 'goal_1',
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow responsibly' },
    { id: 'fac_cost', kind: 'factor', label: 'Annual cost', category: 'controllable', observed_state: { value: 0.4, unit: '£', cap: 100 } },
    { id: 'fac_cap', kind: 'factor', label: 'Delivery capacity', category: 'controllable', observed_state: { value: 0.3, unit: '%', cap: 100 } },
    { id: 'opt_a', kind: 'option', label: 'Option A', data: { interventions: { fac_cost: { raw_value: 40, unit: '£' } } } },
    { id: 'opt_b', kind: 'option', label: 'Option B', 'data/interventions/fac_cost': { raw_value: 60, unit: '£' } },
    { id: 'opt_c', kind: 'option', label: 'Option C' },
    { id: 'opt_d', kind: 'option', label: 'Option D' },
    { id: 'opt_e', kind: 'option', label: 'Option E' },
  ],
  edges: [
    edge('opt_a', 'fac_cost'), edge('opt_b', 'fac_cost'), edge('opt_c', 'fac_cost'),
    edge('opt_d', 'fac_cost'), edge('opt_e', 'fac_cap'),
    edge('fac_cost', 'goal_1'), edge('fac_cap', 'goal_1'),
  ],
};

function realOffer() {
  const parsed = GraphStateIngressSchema.parse(GRAPH);
  const hash = computeAnalysisAffectingGraphHash(parsed);
  expect(hash).not.toBeNull();
  const readiness = composeReadinessIntakeResponse(GRAPH, 'frame');
  expect(readiness.assessment).not.toBeNull();
  const offer = buildReadinessRepairOffer({
    assessment: readiness.assessment!,
    currentGraphHash: hash!,
    scenarioId: SCENARIO_ID,
  });
  expect(offer).not.toBeNull();
  return { readiness, offer: offer! };
}

describe('readiness apply control vs the client render cap', () => {
  it('PRECONDITION: CEE\'s cap is the client\'s cap', () => {
    expect(READINESS_MAX_RENDERED_CHIPS).toBe(CLIENT_RENDER_CAP);
  });

  it('PRECONDITION: this fixture FILLS the chip row and mints a real apply control', () => {
    const { readiness, offer } = realOffer();
    // Exactly full — if this stops holding, every survival assertion below
    // would pass for want of an overflow rather than because of the fix.
    expect(readiness.response.suggested_actions).toHaveLength(READINESS_MAX_RENDERED_CHIPS);
    expect(offer.chip.id.startsWith('rrp_')).toBe(true);
    expect(offer.chip.label).toMatch(/^Apply \d+ safe model fixes$|^Apply the safe model fix$/);
  });

  it('HISTORIC RECORD: the plain append the two call sites used DROPS the apply control', () => {
    const { readiness, offer } = realOffer();
    const plainAppend = [
      ...readiness.response.suggested_actions,
      { id: offer.chip.id, label: offer.chip.label, message: offer.chip.message },
    ];
    expect(plainAppend).toHaveLength(READINESS_MAX_RENDERED_CHIPS + 1);
    const rendered = plainAppend.slice(0, CLIENT_RENDER_CAP);
    expect(rendered.some((a) => a.id === offer.chip.id)).toBe(false);
  });

  it('the apply control REACHES THE USER through the client cap', () => {
    const { readiness, offer } = realOffer();
    const composed = withReadinessApplyControl(readiness.response.suggested_actions, offer.chip);
    const rendered = composed.slice(0, CLIENT_RENDER_CAP);
    expect(rendered.some((a) => a.id === offer.chip.id)).toBe(true);
  });

  it('never emits more than the client will render', () => {
    const { readiness, offer } = realOffer();
    const composed = withReadinessApplyControl(readiness.response.suggested_actions, offer.chip);
    expect(composed.length).toBeLessThanOrEqual(CLIENT_RENDER_CAP);
  });

  it('carries the offer\'s `detail` onto the emitted action', () => {
    const { readiness, offer } = realOffer();
    expect(offer.chip.detail).toBeTruthy();
    const composed = withReadinessApplyControl(readiness.response.suggested_actions, offer.chip);
    const applied = composed.find((a) => a.id === offer.chip.id);
    expect(applied).toBeDefined();
    expect((applied as { detail?: string }).detail).toBe(offer.chip.detail);
  });

  it('drops the OVERFLOW answer chips only, keeping the earlier ones in order', () => {
    const { readiness, offer } = realOffer();
    const before = readiness.response.suggested_actions.map((a) => a.id);
    const composed = withReadinessApplyControl(readiness.response.suggested_actions, offer.chip);
    expect(composed.map((a) => a.id)).toEqual([
      ...before.slice(0, READINESS_MAX_RENDERED_CHIPS - 1),
      offer.chip.id,
    ]);
  });

  it('TWIN: a row with room to spare loses nothing', () => {
    const { offer } = realOffer();
    const one = [{ id: 'a1', label: 'A', message: 'a' }];
    const composed = withReadinessApplyControl(one as never, offer.chip);
    expect(composed.map((a) => a.id)).toEqual(['a1', offer.chip.id]);
  });

  it('TWIN: an empty row yields the apply control alone', () => {
    const { offer } = realOffer();
    const composed = withReadinessApplyControl([] as never, offer.chip);
    expect(composed.map((a) => a.id)).toEqual([offer.chip.id]);
  });

  it('TWIN: a chip with no `detail` emits no `detail` key', () => {
    const composed = withReadinessApplyControl(
      [] as never,
      { id: 'rrp_nodetail', label: 'Apply the safe model fix', message: 'Yes, apply the safe model fix.' },
    );
    expect('detail' in composed[0]!).toBe(false);
  });
});
