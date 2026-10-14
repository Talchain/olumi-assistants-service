/**
 * THE BLOCKED-SLOT GUARD AFTER CEE-ECHO-F1: what it does with the blocker's own "is currently …" figure, at head and base.
 * (DL 0df0e1: settle it, don't watch it.)
 *
 * WHAT THE GUARD READS: reply text, the blockers' ids + labels (`deriveMissingEffectPairs`), the persisted graph. Never
 * `display_value`, never the blocker's message. So for any one reply, head and base give the same result. Pinned below
 * by running one reply against both messages.
 *
 * WHAT CHANGED UPSTREAM: the blocker's message reaches composers verbatim (`analysis-ready-helper.ts`, the pair-scoped
 * producer message). On an Olumi-estimate count factor whose label sits inside its own unit, base said "is currently
 * 0.13" and head says "is currently 4 senior developers".
 *
 * MEASURED: a possession sentence quoting either figure is REFUSED, at base and at head alike. The guard grounds the
 * factor's exact level (0.1333…), which neither quote matches. This is a pre-existing over-refusal: the replacement
 * names the pair and asks for the option's value, a true sentence in place of a true sentence. #2578 does not widen
 * it.
 *
 * ⛔ WHY THE GUARD IS NOT WIDENED HERE: grounding the factor's raw figure was built and withdrawn (e17613ed; Codex
 * CHANGES_REQUIRED, two P1s):
 *   · ownership — an option-named claim borrows the baseline ("The Hire option is modelled using 4 senior developers"
 *     survives although the option holds no value);
 *   · units — `readClaimedNumbers` is unit-, sign- and suffix-blind, so raw 4 would ground "£4", "400%", "4k".
 * A correct ground needs typed baseline-vs-option evidence that keeps unit, sign and scale. That is a separate design,
 * not a scalar. The twins below fail on that withdrawn widening, so any future one must answer both classes.
 *
 * FIXTURES are the writer's shapes (admit-model), and the blocker is the real one from `buildAnalysisReadyPayload`. The
 * quoted figure is lifted from that blocker's own message.
 */
import { describe, expect, it } from 'vitest';
import { applyBlockedSlotClaimGuard } from '../blocked-slot-claim-guard.js';
import { buildAnalysisReadyPayload } from '../../../cee/transforms/analysis-ready.js';
import type { GraphV3T, OptionV3T } from '../../../schemas/cee-v3.js';

const FACTOR = 'fac_dev';
const OPTION = 'opt_hire';
const GOAL = 'goal_1';
const FRAME = 30;

/**
 * The label sits inside its own unit, so the reading CONTAINS the label: the echo case. Two label tokens, because the
 * guard binds a unit to a label only on ≥2 matched tokens (`MIN_MATCHED_TOKENS`). A one-word "Developers" never
 * anchors at all; that is the guard suite's own pinned gap, not this row's.
 */
const developers = {
  id: FACTOR,
  kind: 'factor',
  label: 'Senior developers',
  observed_state: { value: 4 / FRAME, raw_value: 4, unit: 'senior developers', source: 'cee_inference' },
  scale_frame: FRAME,
};
/** A second count factor whose raw figure is 9: a number the graph holds, but not for the blocked slot. */
const contractors = {
  id: 'fac_con',
  kind: 'factor',
  label: 'Contractors',
  observed_state: { value: 9 / FRAME, raw_value: 9, unit: 'contractors', source: 'cee_inference' },
  scale_frame: FRAME,
};

function graphWith(...factors: Record<string, unknown>[]): GraphV3T {
  return {
    nodes: [{ id: GOAL, kind: 'goal', label: 'Ship the platform' }, { id: OPTION, kind: 'option', label: 'Hire' }, ...factors],
    edges: factors.map((f) => ({ from: OPTION, to: f.id })),
  } as unknown as GraphV3T;
}

function blockersFor(graph: GraphV3T) {
  const opt = { id: OPTION, label: 'Hire', status: 'needs_user_input', interventions: {} } as unknown as OptionV3T;
  const blockers = buildAnalysisReadyPayload([opt], GOAL, graph).blockers ?? [];
  const mine = blockers.find((b) => b.option_id === OPTION && b.factor_id === FACTOR);
  if (!mine) throw new Error('fixture precondition failed: no missing_value blocker for opt_hire→fac_dev');
  return { blockers, mine };
}

/** The figure the producer's own message states, exactly as written. */
function statedFigure(message: string): string {
  const m = /is currently (.+?)(?: \(Olumi's estimate\))?\. What should/.exec(message);
  if (!m) throw new Error(`fixture precondition failed: no "is currently …" figure in ${JSON.stringify(message)}`);
  return m[1];
}

const BASE_MESSAGE = `Factor "Senior developers" is currently 0.13 (Olumi's estimate). What should option "Hire" set it to?`;

const guard = (assistantText: string, blockers: unknown, persistedGraph: unknown) =>
  applyBlockedSlotClaimGuard({ assistantText, blockers, persistedGraph });

/** Refused, and bound to opt_hire × fac_dev by id. */
function expectRefusedOnTheSlot(out: ReturnType<typeof guard>, ungrounded: string[]) {
  expect(out.changed).toBe(true);
  expect(out.slot?.optionId).toBe(OPTION);
  expect(out.slot?.factorId).toBe(FACTOR);
  expect(out.ungroundedValues).toEqual(ungrounded);
}

describe("the blocker's own figure quoted back: same verdict at head and base", () => {
  it("the head blocker states '4 senior developers' (CEE-ECHO-F1), the figure behind level 4/30", () => {
    const { mine } = blockersFor(graphWith(developers));
    expect(statedFigure(mine.message)).toBe('4 senior developers');
  });

  it('KNOWN GAP, pre-existing (pinned so that a change is deliberate): either quote is refused — base "0.13", head "4 senior developers"', () => {
    const graph = graphWith(developers);
    const { blockers, mine } = blockersFor(graph);
    expectRefusedOnTheSlot(guard(`Your model already has Senior developers at ${statedFigure(BASE_MESSAGE)}.`, blockers, graph), ['0.13']);
    expectRefusedOnTheSlot(guard(`Your model already has Senior developers at ${statedFigure(mine.message)}.`, blockers, graph), ['4']);
  });

  it("the guard does not read the blocker's message: one reply, either message, the same result", () => {
    const graph = graphWith(developers);
    const { blockers, mine } = blockersFor(graph);
    const baseWorded = blockers.map((b) => (b === mine ? { ...b, message: BASE_MESSAGE } : b));
    for (const reply of [
      'Your model already has Senior developers at 4 senior developers.',
      'Your model already has Senior developers at 0.13.',
      'Your model already has Senior developers at 9 senior developers.',
    ]) {
      expect(guard(reply, baseWorded, graph)).toEqual(guard(reply, blockers, graph));
    }
  });

  it("control: the factor's exact level is still grounded (the guard's carrier 2), so the probe can say yes", () => {
    const graph = graphWith(developers);
    const { blockers } = blockersFor(graph);
    const reply = `Your model already has Senior developers at ${String(4 / FRAME)}.`;
    const out = guard(reply, blockers, graph);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(reply);
  });
});

describe('refusal twins any future raw grounding must keep (Codex r2 on the withdrawn e17613ed)', () => {
  it('a figure the slot does not hold: "9 senior developers" is refused', () => {
    const graph = graphWith(developers);
    expectRefusedOnTheSlot(guard('Your model already has Senior developers at 9 senior developers.', blockersFor(graph).blockers, graph), ['9']);
  });

  it("attribution: another factor's raw 9 never grounds a 9 claimed for Senior developers", () => {
    const graph = graphWith(developers, contractors);
    expectRefusedOnTheSlot(guard('Your model already has Senior developers at 9 senior developers.', blockersFor(graph).blockers, graph), ['9']);
  });

  it("ownership: the option claimed to hold the baseline's 4 is refused (the option holds no value)", () => {
    const graph = graphWith(developers);
    expectRefusedOnTheSlot(guard('The Hire option is modelled using 4 senior developers.', blockersFor(graph).blockers, graph), ['4']);
  });

  it.each([['£4'], ['400%'], ['4k senior developers']])('units: %s is not the factor\'s 4 senior developers and is refused', (claim) => {
    const graph = graphWith(developers);
    const out = guard(`Your model already has Senior developers at ${claim}.`, blockersFor(graph).blockers, graph);
    expect(out.changed).toBe(true);
    expect(out.slot?.factorId).toBe(FACTOR);
  });
});
