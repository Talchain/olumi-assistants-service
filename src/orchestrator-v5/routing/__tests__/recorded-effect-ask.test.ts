/**
 * ⭐⭐⭐ THE PRODUCT ASKED ABOUT EXACTLY ONE OPTION AND THEN SAID IT DID NOT KNOW
 * WHICH ONE THE USER MEANT — captured 1 Sep 2026 on deployed staging, turn 2 of
 * four.
 *
 *   CEE (turn 0)  asked for the missing effect value of ONE option on ONE factor
 *   USER (turn 2) "Let's make it 50% until I've had a chance to vet it more
 *                  thoroughly."
 *   CEE           "I haven't changed anything, because I'm not sure which option
 *                  you mean. <A> and <B> are both still missing their effect on
 *                  <factor> …"
 *
 * MECHANISM, derived at the bytes. `findOutstandingEffectAskCollision` builds
 * its candidate set from `deriveMissingEffectPairs(readiness)` — every option ×
 * factor pair the model has no value for — and `composeOutstandingEffectAskMisroute`
 * emits the "which option do you mean" copy whenever that set has more than one
 * member (`compose/validation-failure-responses.ts`). Nothing in that chain ever
 * consulted the `elicit_option_effect` PENDING, which records the exact
 * `(option_id, factor_id)` the product itself asked about one turn earlier. The
 * product held the answer to its own question and did not read it.
 *
 * `deriveAskedEffectPair` had the same shape one level down: it resolved "which
 * pair is the product asking about?" as `blockers.slice(0, 1)` — a POSITIONAL
 * heuristic over a list with no defined order.
 *
 * ── WHAT THIS FILE PINS
 * ONE new owner, `deriveRecordedEffectAsk`: *"which pair does the product's own
 * live recorded ask NAME, confirmed still missing by the readiness authority?"*
 * Two authorities, two questions, named apart (trap 21):
 *   · the PENDING answers "which cell did we ask about" — it is a record, not a
 *     guess, and it is the only thing that can answer it;
 *   · READINESS answers "is that cell still missing" — the pending must never
 *     outlive the fact, so a recorded pair that is no longer outstanding is
 *     refused and the caller falls back to today's behaviour.
 *
 * ── DIRECTION OF THE CHANGE, STATED
 * At the misroute the recorded ask can only NARROW an ALREADY-AMBIGUOUS set to
 * the one member the product itself named. A later current-turn option identity
 * outranks that older record; when the current turn points outside the collision
 * the record is suppressed rather than replayed. Neither authority can widen or
 * create a collision. Every direction is cased below.
 *
 * ── FIXTURE SCOPE, DECLARED (trap 16: a fixture I wrote is not evidence about
 * the wire). The identities are the 20 Aug 2026 fresh-guest capture's, verbatim,
 * as used by `outstanding-effect-ask-misroute.test.ts`. The AUTHORED delta is
 * one added blocker: a SECOND option outstanding on the SAME factor, which is
 * the shape the 1 Sep capture exhibited and which the 20 Aug fixture does not
 * contain. Nothing else here is invented.
 *
 * TRAP 19 — every assertion binds by IDENTITY (exact option_id, exact
 * factor_id), never by a value predicate another pair could satisfy.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  deriveAskedEffectPair,
  deriveRecordedEffectAsk,
} from '../repair-value-binding.js';
import {
  buildOutstandingEffectAskDetails,
  buildVerifiedCorrectionReplay,
  findOutstandingEffectAskCollision,
} from '../outstanding-effect-ask-misroute.js';
import { detectConfigureOptionIntent } from '../configure-option-intent.js';
import type { PendingAction } from '../../session/pending-action.js';

// ---------------------------------------------------------------------------
// Identities — 20 Aug 2026 fresh-guest capture, verbatim.
// ---------------------------------------------------------------------------
const OPT_SELF_SERVE = '15637f46';
const OPT_SELF_SERVE_LABEL = 'double down on mid-market with a lower-priced self-serve tier';
const FAC_SELF_SERVE = '0ebfde36';
const FAC_SELF_SERVE_LABEL = 'Self-serve product investment';

const OPT_ENTERPRISE = 'ba9895d6';
const OPT_ENTERPRISE_LABEL = 'move upmarket to enterprise banks';

const OPT_ACQUIRE = 'bf7a78bc';
const OPT_ACQUIRE_LABEL = 'acquire a smaller competitor to buy market share';
const FAC_ACQUIRE = '8d6a7335';
const FAC_ACQUIRE_LABEL = 'Acquisition spend';

const OPTION_LABELS: readonly string[] = [
  OPT_SELF_SERVE_LABEL,
  OPT_ENTERPRISE_LABEL,
  OPT_ACQUIRE_LABEL,
  'Continue current mid-market motion (Status Quo)',
];

const SCENARIO_ID = 'a05fefcd-3956-4700-879f-6fc8b09e3905';

/**
 * The blocker list. `blockers[0]` is the ACQUISITION pair — deliberately NOT the
 * pair the recorded ask names, so a test that passed by reading the head would
 * be reading the wrong pair and would say so.
 *
 * Blockers 1 and 2 are TWO options outstanding on the SAME factor: the shape
 * that produces "I'm not sure which option you mean".
 */
function readiness(): { blockers: unknown[] } {
  return {
    blockers: [
      {
        code: 'MISSING_OPTION_VALUE',
        option_id: OPT_ACQUIRE,
        option_label: OPT_ACQUIRE_LABEL,
        factor_id: FAC_ACQUIRE,
        factor_label: FAC_ACQUIRE_LABEL,
      },
      {
        code: 'MISSING_OPTION_VALUE',
        option_id: OPT_SELF_SERVE,
        option_label: OPT_SELF_SERVE_LABEL,
        factor_id: FAC_SELF_SERVE,
        factor_label: FAC_SELF_SERVE_LABEL,
      },
      {
        code: 'MISSING_OPTION_VALUE',
        option_id: OPT_ENTERPRISE,
        option_label: OPT_ENTERPRISE_LABEL,
        factor_id: FAC_SELF_SERVE,
        factor_label: FAC_SELF_SERVE_LABEL,
      },
    ],
  };
}

const NOW_MS = Date.parse('2026-09-01T12:00:00.000Z');

function elicit(
  optionId: string,
  optionLabel: string,
  factorId: string,
  factorLabel: string,
  overrides?: Partial<PendingAction>,
): PendingAction {
  return {
    id: `pa-${optionId}`,
    scenario_id: SCENARIO_ID,
    chip_id: 'chip_configure_option_clarify',
    action: {
      kind: 'elicit_option_effect',
      option_id: optionId,
      option_label: optionLabel,
      factor_id: factorId,
      factor_label: factorLabel,
      attempt: 1,
    },
    preconditions: {},
    expires_at_turn_count: 6,
    expires_at_iso: '2026-09-01T13:00:00.000Z',
    emitted_at_iso: '2026-09-01T11:59:00.000Z',
    ...overrides,
  } as PendingAction;
}

const ASKED_SELF_SERVE = (): readonly PendingAction[] => [
  elicit(OPT_SELF_SERVE, OPT_SELF_SERVE_LABEL, FAC_SELF_SERVE, FAC_SELF_SERVE_LABEL),
];
const ASKED_ENTERPRISE = (): readonly PendingAction[] => [
  elicit(OPT_ENTERPRISE, OPT_ENTERPRISE_LABEL, FAC_SELF_SERVE, FAC_SELF_SERVE_LABEL),
];

const identity = (p: { optionId: string; factorId: string } | null): string | null =>
  p === null ? null : `${p.optionId}::${p.factorId}`;

const REPLAY_CAPTURE = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-18/model-compiler-option-effect.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  draft_graph: {
    nodes: Array<{ id: string; kind: string; label: string }>;
    edges: Array<Record<string, unknown>>;
  };
  ids: Record<string, string>;
};

// ---------------------------------------------------------------------------
describe('deriveRecordedEffectAsk — the product’s own record of what it asked', () => {
  it('⭐ THE FIX: returns the pair the live elicit_option_effect NAMES, not the head blocker', () => {
    const asked = deriveRecordedEffectAsk({
      readiness: readiness(),
      pendings: ASKED_SELF_SERVE(),
      nowMs: NOW_MS,
    });
    expect(identity(asked)).toBe(`${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`);
    // Labels come from READINESS, not from the frozen pending, so the copy the
    // user reads cannot disagree with the blocker on screen.
    expect(asked?.optionLabel).toBe(OPT_SELF_SERVE_LABEL);
    expect(asked?.factorLabel).toBe(FAC_SELF_SERVE_LABEL);
  });

  it('⭐ THE DISCRIMINATING TWIN: a record naming the OTHER option resolves to the OTHER pair', () => {
    // Same readiness, same head blocker, different record. If the reader were
    // returning "a pair" rather than "the recorded pair", these two cases could
    // not disagree — and they must.
    const asked = deriveRecordedEffectAsk({
      readiness: readiness(),
      pendings: ASKED_ENTERPRISE(),
      nowMs: NOW_MS,
    });
    expect(identity(asked)).toBe(`${OPT_ENTERPRISE}::${FAC_SELF_SERVE}`);
  });

  it('⭐ OPPOSITE DIRECTION — no pendings at all: nothing is recorded, so nothing is claimed', () => {
    expect(deriveRecordedEffectAsk({ readiness: readiness(), pendings: [], nowMs: NOW_MS })).toBeNull();
    expect(deriveRecordedEffectAsk({ readiness: readiness(), pendings: null, nowMs: NOW_MS })).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — an EXPIRED ask is not a live ask', () => {
    const expired = [
      elicit(OPT_SELF_SERVE, OPT_SELF_SERVE_LABEL, FAC_SELF_SERVE, FAC_SELF_SERVE_LABEL, {
        expires_at_iso: '2026-09-01T11:00:00.000Z',
      }),
    ];
    expect(
      deriveRecordedEffectAsk({ readiness: readiness(), pendings: expired, nowMs: NOW_MS }),
    ).toBeNull();
    // POSITIVE CONTROL for the clock: the identical row, unexpired, IS read.
    expect(
      identity(deriveRecordedEffectAsk({
        readiness: readiness(),
        pendings: ASKED_SELF_SERVE(),
        nowMs: NOW_MS,
      })),
    ).toBe(`${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`);
  });

  it('⭐ OPPOSITE DIRECTION — TWO live asks are genuinely ambiguous, so it refuses rather than picks', () => {
    expect(
      deriveRecordedEffectAsk({
        readiness: readiness(),
        pendings: [...ASKED_SELF_SERVE(), ...ASKED_ENTERPRISE()],
        nowMs: NOW_MS,
      }),
    ).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — READINESS still governs: a recorded pair that is no longer missing is refused', () => {
    // The value was written between the ask and this turn. The record is stale
    // as a claim about the MODEL even though it is a true record of the ask.
    const filled = {
      blockers: readiness().blockers.filter(
        (b) => (b as { option_id?: string }).option_id !== OPT_SELF_SERVE,
      ),
    };
    expect(
      deriveRecordedEffectAsk({ readiness: filled, pendings: ASKED_SELF_SERVE(), nowMs: NOW_MS }),
    ).toBeNull();
    // CONTRAST CONTROL in the same run: the untouched readiness still resolves,
    // so the null above is the filter and not a blind reader.
    expect(
      deriveRecordedEffectAsk({ readiness: readiness(), pendings: ASKED_SELF_SERVE(), nowMs: NOW_MS }),
    ).not.toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — a live pending of a DIFFERENT KIND records no effect ask', () => {
    const other = [
      {
        ...elicit(OPT_SELF_SERVE, OPT_SELF_SERVE_LABEL, FAC_SELF_SERVE, FAC_SELF_SERVE_LABEL),
        action: { kind: 'elicit_target_baseline' },
      } as unknown as PendingAction,
    ];
    expect(
      deriveRecordedEffectAsk({ readiness: readiness(), pendings: other, nowMs: NOW_MS }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('deriveAskedEffectPair — the record outranks the positional heuristic', () => {
  it('⭐ THE FIX: with a live record it returns the RECORDED pair, not blockers[0]', () => {
    const pair = deriveAskedEffectPair(readiness(), {
      pendings: ASKED_SELF_SERVE(),
      nowMs: NOW_MS,
    });
    expect(identity(pair)).toBe(`${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`);
    // The head is a DIFFERENT pair — so this assertion could not pass by
    // accident on the old path.
    expect(identity(deriveAskedEffectPair(readiness()))).toBe(`${OPT_ACQUIRE}::${FAC_ACQUIRE}`);
  });

  it('⭐ THE DISCRIMINATING TWIN: the other record yields the other pair', () => {
    const pair = deriveAskedEffectPair(readiness(), {
      pendings: ASKED_ENTERPRISE(),
      nowMs: NOW_MS,
    });
    expect(identity(pair)).toBe(`${OPT_ENTERPRISE}::${FAC_SELF_SERVE}`);
  });

  it('⭐ OPPOSITE DIRECTION — NO record argument is byte-identical to today: the head blocker', () => {
    expect(identity(deriveAskedEffectPair(readiness()))).toBe(`${OPT_ACQUIRE}::${FAC_ACQUIRE}`);
    expect(deriveAskedEffectPair({ blockers: [] })).toBeNull();
    expect(deriveAskedEffectPair(null)).toBeNull();
    // A head that is not a missing-effect blocker still claims nothing.
    expect(
      deriveAskedEffectPair({ blockers: [{ code: 'ORPHAN_NODE' }, ...readiness().blockers] }),
    ).toBeNull();
  });

  it('⭐ THE AUTHORITY BOUNDARY — an inspected empty / expired / ambiguous record never guesses blockers[0]', () => {
    expect(deriveAskedEffectPair(readiness(), { pendings: [], nowMs: NOW_MS })).toBeNull();
    expect(
      deriveAskedEffectPair(readiness(), {
        pendings: [
          elicit(OPT_SELF_SERVE, OPT_SELF_SERVE_LABEL, FAC_SELF_SERVE, FAC_SELF_SERVE_LABEL, {
            expires_at_iso: '2026-09-01T11:00:00.000Z',
          }),
        ],
        nowMs: NOW_MS,
      }),
    ).toBeNull();
    expect(
      deriveAskedEffectPair(readiness(), {
        pendings: [...ASKED_SELF_SERVE(), ...ASKED_ENTERPRISE()],
        nowMs: NOW_MS,
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('the misroute refusal names the option the product asked about', () => {
  const TYPED = `Set its effect on ${FAC_SELF_SERVE_LABEL} to 0.5`;

  function collide(recordedAsk: ReturnType<typeof deriveRecordedEffectAsk>, opts?: {
    readonly message?: string;
    readonly chipOriginated?: boolean;
    readonly entityId?: string;
  }): ReturnType<typeof findOutstandingEffectAskCollision> {
    return findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: opts?.entityId ?? FAC_SELF_SERVE,
      message: opts?.message ?? TYPED,
      optionLabels: OPTION_LABELS,
      nonOptionLabels: [FAC_SELF_SERVE_LABEL, FAC_ACQUIRE_LABEL],
      readiness: readiness(),
      chipOriginated: opts?.chipOriginated ?? false,
      recordedAsk,
    });
  }

  const recorded = (pendings: readonly PendingAction[]): ReturnType<typeof deriveRecordedEffectAsk> =>
    deriveRecordedEffectAsk({ readiness: readiness(), pendings, nowMs: NOW_MS });

  it('⭐ THE CAPTURED DEFECT: two options outstanding on one factor collapse to the RECORDED one', () => {
    const hit = collide(recorded(ASKED_SELF_SERVE()));
    expect(hit).not.toBeNull();
    expect(hit!.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`,
    ]);
    // The refusal copy reads `effect_ask_option_labels`; ONE label is what stops
    // "I'm not sure which option you mean" being composed at all.
    expect(buildOutstandingEffectAskDetails(hit, null).effect_ask_option_labels).toEqual([
      OPT_SELF_SERVE_LABEL,
    ]);
  });

  it('⭐ THE DISCRIMINATING TWIN: the OTHER record collapses to the OTHER option', () => {
    const hit = collide(recorded(ASKED_ENTERPRISE()));
    expect(hit!.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_ENTERPRISE}::${FAC_SELF_SERVE}`,
    ]);
    expect(buildOutstandingEffectAskDetails(hit, null).effect_ask_option_labels).toEqual([
      OPT_ENTERPRISE_LABEL,
    ]);
  });

  it('⭐ P1 — a current turn explicitly naming option B outranks the stale recorded ask for A', () => {
    const hit = collide(recorded(ASKED_SELF_SERVE()), {
      message:
        `For ${OPT_ENTERPRISE_LABEL}, let's make it 50% until I've had a chance to vet it more thoroughly.`,
    });
    expect(hit).not.toBeNull();
    expect(hit!.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_ENTERPRISE}::${FAC_SELF_SERVE}`,
    ]);
    expect(buildOutstandingEffectAskDetails(hit, null).effect_ask_option_labels).toEqual([
      OPT_ENTERPRISE_LABEL,
    ]);
  });

  it('⭐ OPPOSITE TWIN — the genuinely elliptical answer still narrows to recorded option A', () => {
    const hit = collide(recorded(ASKED_SELF_SERVE()), {
      message: "Let's make it 50% until I've had a chance to vet it more thoroughly.",
    });
    expect(hit).not.toBeNull();
    expect(hit!.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`,
    ]);
  });

  it('⭐ REPLAY CONSEQUENCE — explicit B can never produce a verified correction payload for stale A', () => {
    const graph = JSON.parse(
      JSON.stringify(REPLAY_CAPTURE.draft_graph),
    ) as typeof REPLAY_CAPTURE.draft_graph;
    const factorId = REPLAY_CAPTURE.ids.factor_id!;
    const factorLabel = REPLAY_CAPTURE.ids.factor_label!;
    const optionA = graph.nodes.find((n) => n.id === 'e755ec33')!;
    const optionB = graph.nodes.find((n) => n.id === REPLAY_CAPTURE.ids.option_id)!;
    optionA.label = 'Invest in self-serve product';
    const replayReadiness = {
      blockers: [optionA, optionB].map((option) => ({
        code: 'MISSING_OPTION_VALUE',
        option_id: option.id,
        option_label: option.label,
        factor_id: factorId,
        factor_label: factorLabel,
      })),
    };
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: factorId,
      message: `For ${optionB.label}, set it to 0.5.`,
      optionLabels: graph.nodes.filter((n) => n.kind === 'option').map((n) => n.label),
      nonOptionLabels: graph.nodes.filter((n) => n.kind !== 'option').map((n) => n.label),
      readiness: replayReadiness,
      chipOriginated: false,
      recordedAsk: {
        optionId: optionA.id,
        optionLabel: optionA.label,
        factorId,
        factorLabel,
      },
    });
    expect(hit).not.toBeNull();
    expect(hit!.pairs.map((p) => p.optionId)).toEqual([optionB.id]);

    const replay = buildVerifiedCorrectionReplay(hit!, graph);
    expect(replay).not.toBeNull();
    expect(replay).toContain(optionB.label);
    expect(replay).not.toContain(optionA.label);
    expect(buildOutstandingEffectAskDetails(hit, replay).effect_ask_replay_message).toBe(replay);
  });

  it('⭐ the same narrowing on a CHIP-ORIGINATED turn, where identity is the only conjunct', () => {
    const hit = collide(recorded(ASKED_SELF_SERVE()), {
      message: 'Set that value in my model.',
      chipOriginated: true,
    });
    expect(hit!.pairs.map((p) => p.optionId)).toEqual([OPT_SELF_SERVE]);
  });

  it('⭐ OPPOSITE DIRECTION — with NO record the ambiguity survives and the product still asks', () => {
    const hit = collide(null);
    expect(hit!.pairs.map((p) => p.optionId)).toEqual([OPT_SELF_SERVE, OPT_ENTERPRISE]);
    expect(buildOutstandingEffectAskDetails(hit, null).effect_ask_option_labels).toEqual([
      OPT_SELF_SERVE_LABEL,
      OPT_ENTERPRISE_LABEL,
    ]);
  });

  it('⭐ OPPOSITE DIRECTION — a record for a pair that is NOT in the collision cannot narrow it away', () => {
    // The acquisition pair is outstanding, but on a DIFFERENT factor, so it is
    // not a member of this collision. Narrowing to it would delete a real
    // refusal; narrowing to nothing would let the wrong-field write through.
    const hit = collide(recorded([
      elicit(OPT_ACQUIRE, OPT_ACQUIRE_LABEL, FAC_ACQUIRE, FAC_ACQUIRE_LABEL),
    ]));
    expect(hit!.pairs.map((p) => p.optionId)).toEqual([OPT_SELF_SERVE, OPT_ENTERPRISE]);
  });

  it('⭐ OPPOSITE DIRECTION — a record cannot CREATE a collision where none exists', () => {
    // No outstanding pair on this entity at all.
    expect(collide(recorded(ASKED_SELF_SERVE()), { entityId: 'no_such_factor' })).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — an already-unambiguous collision is untouched by a record for another pair', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ACQUIRE,
      message: `Set its effect on ${FAC_ACQUIRE_LABEL} to 0.5`,
      optionLabels: OPTION_LABELS,
      nonOptionLabels: [FAC_SELF_SERVE_LABEL, FAC_ACQUIRE_LABEL],
      readiness: readiness(),
      chipOriginated: false,
      recordedAsk: recorded(ASKED_SELF_SERVE()),
    });
    expect(hit!.pairs.map((p) => p.optionId)).toEqual([OPT_ACQUIRE]);
  });
});

// ---------------------------------------------------------------------------
describe('adjust_edge_strength — current option identity cannot release a stale-pair proposal', () => {
  const explicitEnterpriseOpinion =
    `I would say ${OPT_ENTERPRISE_LABEL} drives ${FAC_SELF_SERVE_LABEL} fairly strongly, about 0.6.`;
  const ellipticalSelfServeOpinion =
    `I would say it drives ${FAC_SELF_SERVE_LABEL} fairly strongly, about 0.6.`;
  const recordedSelfServe = deriveRecordedEffectAsk({
    readiness: readiness(),
    pendings: ASKED_SELF_SERVE(),
    nowMs: NOW_MS,
  });

  function edgeCollision(optionId: string, message: string) {
    return findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${optionId}→${FAC_SELF_SERVE}`,
      message,
      optionLabels: OPTION_LABELS,
      nonOptionLabels: [FAC_SELF_SERVE_LABEL, FAC_ACQUIRE_LABEL],
      readiness: readiness(),
      chipOriginated: false,
      recordedAsk: recordedSelfServe,
    });
  }

  it('RED — stale A + proposed A + explicit B remains a generic fail-closed refusal', () => {
    // This is the review counterexample's load-bearing precondition: the broad
    // configure classifier does NOT rescue the turn. Identity must do it.
    expect(detectConfigureOptionIntent(explicitEnterpriseOpinion, OPTION_LABELS).matched).toBe(false);

    const mismatch = edgeCollision(OPT_SELF_SERVE, explicitEnterpriseOpinion);
    expect(mismatch, 'the identity mismatch must refuse rather than release the proposal').not.toBeNull();
    expect(mismatch!.pairs, 'no stale A pair may reach pair-specific copy or replay').toEqual([]);
    expect(buildVerifiedCorrectionReplay(mismatch!, {})).toBeNull();
    expect(buildOutstandingEffectAskDetails(mismatch, null)).toEqual({
      effect_ask_refused_field: 'edge_strength',
    });
  });

  it('OPPOSITE — current B plus proposed B still yields the current B pair', () => {
    const current = edgeCollision(OPT_ENTERPRISE, explicitEnterpriseOpinion);
    expect(current).not.toBeNull();
    expect(current!.pairs.map((pair) => `${pair.optionId}::${pair.factorId}`)).toEqual([
      `${OPT_ENTERPRISE}::${FAC_SELF_SERVE}`,
    ]);
    expect(buildOutstandingEffectAskDetails(current, null).effect_ask_option_labels).toEqual([
      OPT_ENTERPRISE_LABEL,
    ]);
  });

  it('OPPOSITE — a genuinely elliptical answer plus proposed A still uses recorded A', () => {
    const elliptical = edgeCollision(OPT_SELF_SERVE, ellipticalSelfServeOpinion);
    expect(elliptical).not.toBeNull();
    expect(elliptical!.pairs.map((pair) => `${pair.optionId}::${pair.factorId}`)).toEqual([
      `${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`,
    ]);
  });
});
