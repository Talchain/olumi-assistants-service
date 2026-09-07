/**
 * draft-framing-blocks — RED-first spec.
 *
 * ⭐ FIXTURE PROVENANCE (CLAUDE.md trap 16 / trap 22). Stated precisely, because
 * an overstated provenance label is itself the defect this estate keeps paying
 * for: the `id`, `label` and `action_type` of every captured item below are
 * REPRODUCED EXACTLY from live draft responses in the estate's evidence
 * directories — those are the fields this module's logic keys on. The `detail`
 * strings are ABRIDGED from the same captures (shortened for readability) and
 * `bias_category` is omitted, so they are NOT verbatim and must not be cited as
 * evidence of what the drafter emits. What matters for these tests is that the
 * items are not invented by this lane: a self-authored fixture encodes the
 * author's model of the producer rather than the producer.
 *
 * `INJECTED_STATUS_QUO` is the exception and IS byte-exact, because it is copied
 * from CEE's own source rather than from a capture.
 * Sources (19 unique items, action_type distribution add_risk 7 / add_option 6 /
 * add_constraint 6 / reframe_goal 3):
 *   olumi-docs/witness-998-2026-08-16/c-a1-graph-response.json
 *   olumi-docs/witness-998-2026-08-16/c-a2-graph-response.json
 *   olumi-docs/witness-acceptance-2026-08-17/captures/j6-reload-J1R1.json
 *   olumi-docs/witness-acceptance-2026-08-17/captures/j6-reload-J4.json
 *   acceptance-evidence/constraint-route-verify/graph-{before,after}.json
 *
 * Assertions bind by IDENTITY (signal_id, action_type, claim_id, the item's own
 * label) and never by a value predicate another block could satisfy (trap 19).
 */
import { describe, expect, it } from 'vitest';

import {
  buildDraftFramingBlocks,
  DRAFT_FRAMING_SIGNAL_PREFIX,
  FRAMING_ACTION_TYPE_PRECEDENCE,
} from '../draft-framing-blocks.js';
import { deriveIntakeOptionReconciliation } from '../../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

const CREATED_AT = '2026-08-24T12:00:00.000Z';

// ── CAPTURED ITEMS (verbatim) ─────────────────────────────────────────────
const CAPTURED_REFRAME_GOAL = {
  id: 'define-success-goal',
  label: 'Agree what success looks like before comparing options',
  detail:
    "The brief explicitly states 'nobody has agreed what success actually looks like — keeping revenue flat, protecting margin, or something else'; until the goal is fixed, the causal chains from each option cannot be judged.",
  action_type: 'reframe_goal',
} as const;

const CAPTURED_ADD_OPTION = {
  id: 'add-hybrid-option',
  label: 'Consider whether a partial or phased combination of routes is in scope',
  detail:
    'The brief frames three mutually exclusive routes, but the subcontracting and electrification paths are not obviously incompatible — narrow framing may be closing off a hybrid that manages capex while still cutting emissions.',
  action_type: 'add_option',
} as const;

const CAPTURED_ADD_RISK = {
  id: 'stress-test-runway',
  label: "Map cash runway consumed before payback against each option's payback timeline",
  detail:
    'With only 14 months of runway, the path from each investment to positive cash contribution must be traced explicitly, because cash runway consumed before payback is a shared risk across all three actions.',
  action_type: 'add_risk',
} as const;

const CAPTURED_ADD_CONSTRAINT = {
  id: 'add-cash-constraint',
  label: 'Force finance to bound the cash constraint explicitly',
  detail:
    "Finance says 'cash is tight but will not put a number on it', yet cash runway pressure already appears as a risk flowing into the goal — leaving it unbounded means the acquisition price uncertainty cannot be sized.",
  action_type: 'add_constraint',
} as const;

// ── THE DETERMINISTIC INJECTION (verbatim from the producer, not a capture) ──
// CEE *hardcodes* this item at `src/cee/unified-pipeline/stages/package.ts:326-332`
// whenever a graph has options and no baseline. It is copied here byte-exact
// from that source, INCLUDING `bias_category`, because the whole point of the
// gate below is that these bytes are identical on every turn that fires it.
//
// ⚠ It is the DEGRADED-PATH DEFAULT, not an edge case: the Stage 4.5 coaching
// pass regenerates `ctx.coaching` wholesale and this append runs AFTER it, so
// when the pass is skipped under the latency budget or fails, `str_status_quo`
// is the ONLY surviving strengthen item. The worse the turn goes, the more
// likely it is the only qualifying item this emitter sees.
const INJECTED_STATUS_QUO = {
  id: 'str_status_quo',
  label: 'Add baseline option',
  detail:
    "No status quo option detected — add one to measure improvement. If one of your existing options is the baseline (e.g. 'Continue as-is', 'Maintain current approach'), rename it to make the baseline intent explicit.",
  action_type: 'add_option',
  bias_category: 'narrow_framing',
} as const;

const NOT_READY = { status: 'asking_effect_value' } as const;
const READY = { status: 'ready' } as const;

function graphWith(optionLabels: readonly string[]): GraphV3T {
  return {
    nodes: optionLabels.map((label, i) => ({
      id: `opt-${i}`,
      kind: 'option',
      label,
    })),
    edges: [],
  } as unknown as GraphV3T;
}

const GRAPH = graphWith(['Electrify the fleet', 'Subcontract the routes']);

function build(overrides: Record<string, unknown> = {}) {
  return buildDraftFramingBlocks({
    analysisReady: NOT_READY,
    strengthenItems: [CAPTURED_REFRAME_GOAL],
    graph: GRAPH,
    briefText: null,
    createdAt: CREATED_AT,
    ...overrides,
  });
}

describe('buildDraftFramingBlocks — the FRAME/IDEATE complement', () => {
  // ── 1. FIRES on a NOT-ready draft ──────────────────────────────────────
  it('T1 emits exactly one block on a not-ready draft carrying a reframe_goal item, titled with the drafter own label', () => {
    const out = build();
    expect(out).toHaveLength(1);
    const block = out[0]!;
    expect(block.type).toBe('coaching');
    // Identity: the block must carry the CAPTURED item's own label as title.
    expect(block.title).toBe(CAPTURED_REFRAME_GOAL.label);
    expect(block.body).toBe(CAPTURED_REFRAME_GOAL.detail);
    expect(block.signal_id).toBe(
      `${DRAFT_FRAMING_SIGNAL_PREFIX}reframe_goal:${CAPTURED_REFRAME_GOAL.id}`,
    );
    expect(block.source).toBe('draft_graph');
    expect(block.priority_rank).toBe(1);
  });

  // ── 2. THE INVERTED GATE — the whole point of the module ───────────────
  it('T2 is SILENT on an analysis-ready draft (positive-control twin: the same fixture at not-ready fires)', () => {
    // Positive control FIRST — prove the probe can see a presence (trap 13).
    expect(build({ analysisReady: NOT_READY })).toHaveLength(1);
    // The absence claim.
    expect(build({ analysisReady: READY })).toEqual([]);
  });

  // ── 3. FRAME PRECEDES IDEATE ───────────────────────────────────────────
  it('T3 picks reframe_goal over add_option when both are present, regardless of engine order', () => {
    const out = build({ strengthenItems: [CAPTURED_ADD_OPTION, CAPTURED_REFRAME_GOAL] });
    expect(out).toHaveLength(1);
    expect(out[0]!.signal_id).toBe(
      `${DRAFT_FRAMING_SIGNAL_PREFIX}reframe_goal:${CAPTURED_REFRAME_GOAL.id}`,
    );
    // Bind the precedence to its exported declaration, not to a coincidence.
    expect(FRAMING_ACTION_TYPE_PRECEDENCE).toEqual(['reframe_goal', 'add_option']);
  });

  // ── 4. ACTION-TYPE SELECTION, both directions (trap 22b twin) ──────────
  it('T4 emits for add_option when it is the only qualifying item', () => {
    const out = build({ strengthenItems: [CAPTURED_ADD_OPTION] });
    expect(out).toHaveLength(1);
    expect(out[0]!.signal_id).toBe(
      `${DRAFT_FRAMING_SIGNAL_PREFIX}add_option:${CAPTURED_ADD_OPTION.id}`,
    );
    expect(out[0]!.coaching_kind).toBe('widening');
  });

  it('T5 is SILENT when only non-frame/ideate action types are present (add_risk, add_constraint)', () => {
    // Opposite-direction twin of T4: these are real captured items that must
    // NOT produce a framing card — they are model-completion work, not FRAME
    // or IDEATE work, and the post-draft narrative owns them when ready.
    expect(build({ strengthenItems: [CAPTURED_ADD_RISK, CAPTURED_ADD_CONSTRAINT] })).toEqual([]);
  });

  // ── 5. P8 + the §0d generic-prompt ruling — NO chip on either arm ──────
  it('T6 never ships an inert chip: action_label is never present without action_prompt, on either arm', () => {
    // The inert-span defect (V5CoachingBlock renders `action_label` alone as a
    // dead `<span>`). Asserted over BOTH arms so a later edit cannot reopen it
    // on the arm this lane happened not to think about.
    for (const items of [[CAPTURED_REFRAME_GOAL], [CAPTURED_ADD_OPTION]]) {
      const block = build({ strengthenItems: items })[0]!;
      expect(block).toBeDefined();
      if (block.action_label !== undefined) {
        expect((block.action_prompt ?? '').length).toBeGreaterThan(0);
      }
    }
  });

  it('T7 gives NEITHER card an action chip — P8 on the frame arm, the generic-prompt ruling on the ideate arm', () => {
    // reframe_goal: no route accepts a goal reframe, so advising one would be
    // the product advertising an action that terminates in refusal (P8).
    const frame = build()[0]!;
    expect(frame.action_prompt).toBeUndefined();
    expect(frame.action_label).toBeUndefined();

    // add_option: the captured items designate NO concrete option name, so the
    // only constructible chip is a generic "widen your options" prompt — the
    // product already has four of those and each is a prompt with nothing
    // behind it. This card's value is the specific brief-grounded observation.
    const ideate = build({ strengthenItems: [CAPTURED_ADD_OPTION] })[0]!;
    expect(ideate.action_prompt).toBeUndefined();
    expect(ideate.action_label).toBeUndefined();
  });

  // ── 6. PROVENANCE — asymmetric, and the asymmetry is the claim ─────────
  it('T8 carries DSK-B-007 on the add_option card and NO provenance on the reframe_goal card', () => {
    const ideate = build({ strengthenItems: [CAPTURED_ADD_OPTION] })[0]!;
    expect(ideate.dsk_claim_provenance?.claim_id).toBe('DSK-B-007');

    // No bundle claim grounds goal-vs-outcome framing. Inventing one is
    // forbidden; the honest shape is the field's absence.
    const frame = build()[0]!;
    expect(frame.dsk_claim_provenance).toBeUndefined();
  });

  // ── 7. ANTI-COLLISION (§6 / trap 21) ───────────────────────────────────
  it('T9 is SILENT while the intake reconciler reports options_missing', () => {
    const brief =
      'We are choosing between three routes: electrify the fleet, subcontract the routes, or buy a rival depot.';
    const graph = graphWith(['Electrify the fleet', 'Subcontract the routes']);
    const optionLabels = ['Electrify the fleet', 'Subcontract the routes'];

    // PIN THE PRECONDITION IN-TEST (trap 13b third face): assert the reconciler
    // really is in options_missing on this fixture BEFORE asserting suppression,
    // so the silence is provably the gate's doing and not the fixture's failure.
    expect(deriveIntakeOptionReconciliation(brief, optionLabels).state).toBe('options_missing');

    expect(
      build({ strengthenItems: [CAPTURED_ADD_OPTION], graph, briefText: brief }),
    ).toEqual([]);
  });

  // ── 8. FAIL-CLOSED ─────────────────────────────────────────────────────
  it('T10 returns [] and never throws on every malformed or absent input', () => {
    expect(build({ strengthenItems: [] })).toEqual([]);
    expect(build({ strengthenItems: null })).toEqual([]);
    expect(build({ strengthenItems: undefined })).toEqual([]);
    expect(build({ strengthenItems: [null, 42, 'x', {}] })).toEqual([]);
    expect(build({ analysisReady: null })).toHaveLength(1); // null !== ready → fires
    expect(build({ graph: null })).toHaveLength(1); // graph optional
    expect(
      build({ strengthenItems: [{ ...CAPTURED_REFRAME_GOAL, label: '   ' }] }),
    ).toEqual([]);
    expect(
      build({ strengthenItems: [{ ...CAPTURED_REFRAME_GOAL, detail: '' }] }),
    ).toEqual([]);
  });

  // ── 9. THE DETERMINISTIC INJECTION, both directions ────────────────────
  // The class the rest of this corpus structurally EXCLUDES: every other
  // fixture here is model-authored, so none of them can observe what happens
  // when the only qualifying item is one CEE wrote itself. Its copy is
  // identical on every turn, which makes it furniture rather than information
  // — and it says the one thing this emitter exists NOT to say to a team that
  // is still framing: go and finish your option set.
  it('T11 is SILENT when the deterministically injected str_status_quo is the only qualifying item', () => {
    expect(build({ strengthenItems: [INJECTED_STATUS_QUO] })).toEqual([]);
    // Bind by IDENTITY to the producer's own dedup key, not to the copy: the
    // label/detail may be reworded at the injection site without this gate
    // changing meaning.
    expect(INJECTED_STATUS_QUO.id).toBe('str_status_quo');
    // Pin the precondition (trap 13b): absent the gate this item WOULD qualify
    // — same action_type as T4's card, non-empty label and detail. Without
    // this the test could pass because the fixture stopped qualifying at all.
    expect(INJECTED_STATUS_QUO.action_type).toBe('add_option');
    expect(FRAMING_ACTION_TYPE_PRECEDENCE).toContain(INJECTED_STATUS_QUO.action_type);
    expect(INJECTED_STATUS_QUO.label.length).toBeGreaterThan(0);
    expect(INJECTED_STATUS_QUO.detail.length).toBeGreaterThan(0);
  });

  it('T12 SKIPS the injected item without silencing the arm: a model-authored add_option alongside it still ships', () => {
    // Opposite-direction twin of T11. The gate must drop one ITEM, not the
    // whole IDEATE arm — otherwise a real drafted suggestion is lost whenever
    // the baseline injection happens to fire on the same turn.
    const out = build({ strengthenItems: [INJECTED_STATUS_QUO, CAPTURED_ADD_OPTION] });
    expect(out).toHaveLength(1);
    expect(out[0]!.signal_id).toBe(
      `${DRAFT_FRAMING_SIGNAL_PREFIX}add_option:${CAPTURED_ADD_OPTION.id}`,
    );
    // And never the injected one, by identity.
    expect(out[0]!.signal_id).not.toContain('str_status_quo');
    expect(out[0]!.title).toBe(CAPTURED_ADD_OPTION.label);
  });
});
