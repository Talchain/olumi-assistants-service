/**
 * ⭐ A REPLY QUOTING THE BLOCKER'S OWN "is currently …" FIGURE IS TRUE, AND THE GUARD LEAVES IT (CEE-ECHO-F1; DL 0df0e1).
 *
 * The guard's own spec (`GROUNDED_VALUE_EXEMPTION`, carrier 2): the FACTOR's persisted value is a legitimate ground,
 * because "the blocker's own message states it … so a reply quoting it is telling the truth about the model". P3.
 *
 * MEASURED (b09849d5): on an Olumi-estimate count factor (`{ value: 4/30, raw_value: 4, unit: 'developers' }`) the
 * blocker said "is currently 0.13", and the guard REFUSED a reply quoting that 0.13: it grounded the exact level
 * 0.1333…, never a figure a user is shown. CEE-ECHO-F1 makes the blocker say "is currently 4 developers"; the guard
 * grounded only the level, so the truthful quote was refused there too. The guard now also grounds the factor's own
 * raw figure — attributed to THAT factor, never to a number found elsewhere in the graph.
 *
 * WHAT THE GUARD READS (the head-vs-base question): reply text, the blockers' ids + labels, the persisted graph. Never
 * `display_value`, never the blocker's message — pinned below by running one reply against both messages.
 *
 * FIXTURES are the writer's shapes (admit-model), and the blocker is the real one from `buildAnalysisReadyPayload`.
 * The quoted figure is lifted from that blocker's own message, so the row follows whatever the producer says.
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
 * guard binds a unit to a label only on ≥2 matched tokens (`MIN_MATCHED_TOKENS`) — a one-word "Developers" never
 * anchors at all, which is that suite's own pinned gap, not this row's.
 */
const developers = {
  id: FACTOR,
  kind: 'factor',
  label: 'Senior developers',
  observed_state: { value: 4 / FRAME, raw_value: 4, unit: 'senior developers', source: 'cee_inference' },
  scale_frame: FRAME,
};
/** A second count factor whose raw figure is 9 — a number the graph holds, but not for the blocked slot. */
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

const guard = (assistantText: string, blockers: unknown, persistedGraph: unknown) =>
  applyBlockedSlotClaimGuard({ assistantText, blockers, persistedGraph });

describe("⭐ the blocker's own current figure, quoted back, survives the guard (P3)", () => {
  it("⭐ 'Your model already has Senior developers at <the blocker\'s figure>' is left exactly as written", () => {
    const graph = graphWith(developers);
    const { blockers, mine } = blockersFor(graph);
    const figure = statedFigure(mine.message);
    expect(figure).toBe('4 senior developers');
    const reply = `Your model already has Senior developers at ${figure}.`;
    const out = guard(reply, blockers, graph);
    expect(out.changed).toBe(false);
    expect(out.text).toBe(reply);
  });

  it("the guard does not read the blocker's message: one reply, either message, the same result", () => {
    const graph = graphWith(developers);
    const { blockers, mine } = blockersFor(graph);
    const baseWorded = blockers.map((b) =>
      b === mine ? { ...b, message: `Factor "Senior developers" is currently 0.13 (Olumi's estimate). What should option "Hire" set it to?` } : b,
    );
    for (const reply of ['Your model already has Senior developers at 4 senior developers.', 'Your model already has Senior developers at 9 senior developers.']) {
      expect(guard(reply, baseWorded, graph)).toEqual(guard(reply, blockers, graph));
    }
  });
});

describe('the catch direction is unchanged: a figure the slot does not hold is still refused', () => {
  it('twin: "9 senior developers" on the blocked factor is refused, bound to opt_hire × fac_dev', () => {
    const graph = graphWith(developers);
    const { blockers } = blockersFor(graph);
    const out = guard('Your model already has Senior developers at 9 senior developers.', blockers, graph);
    expect(out.changed).toBe(true);
    expect(out.slot?.optionId).toBe(OPTION);
    expect(out.slot?.factorId).toBe(FACTOR);
    expect(out.ungroundedValues).toEqual(['9']);
  });

  it("attribution twin: another factor's raw 9 never grounds a 9 claimed for Senior developers", () => {
    const graph = graphWith(developers, contractors);
    const { blockers } = blockersFor(graph);
    const out = guard('Your model already has Senior developers at 9 senior developers.', blockers, graph);
    expect(out.changed).toBe(true);
    expect(out.slot?.factorId).toBe(FACTOR);
    expect(out.ungroundedValues).toEqual(['9']);
  });
});
