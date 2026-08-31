/**
 * RECORDED-ASK LIFETIME — the two-dial guard.
 *
 * The defect this pins, measured from CEE staging Render logs on 2026-08-31
 * (scenario `528e00b0-9946-4990-86cf-aca2e11da290`, build `87f3e43e`):
 *
 *   13:13:36.221Z  v5.pending_action.created  kind=elicit_option_effect
 *                  expires_at_turn_count=2  expires_at_iso=13:23:36.221Z
 *   13:14:29Z      turn (direct_answer)   — carried, 2 → 1
 *   13:15:20Z      turn (direct_answer)   — 1 → 0, DROPPED at the 13:15:30 commit
 *   13:17:37Z      turn (direct_answer)
 *   13:32:02Z      turn (edit_graph, no_op)
 *   13:33:30Z      turn (handler)
 *   13:38:45Z      turn — the user's first bare-numeric answer attempt
 *   13:39:07Z      turn — a three-character message, cqe_quantity_count=1
 *
 * The question died 114 seconds after being asked, on the turn-count leg,
 * having never seen an answer attempt — and `current_graph_hash` held at
 * `dcc8b4d17edd76a9` across every one of those turns, so the world had NOT
 * moved. The user's answer, 25 minutes and six turns later, found no live
 * claimant and fell through to the LLM, which refused it.
 *
 * THE TWO DIALS, and every test below belongs to exactly one of them:
 *
 *   · DIAL A — the WINDOW (`PENDING_ACTION_ASK_TURN_TTL` /
 *     `PENDING_ACTION_ASK_WALL_TTL_MS`). Guards "the window closed too early".
 *   · DIAL B — the RELEVANCE PRECONDITION at bind time. Guards "a stale action
 *     hijacked a later turn". Not a clock: it asks whether the WORLD has moved.
 *
 * Every dial-A case here has its OPPOSITE-DIRECTION TWIN: for each answer that
 * must now bind, a paired case at the SAME distance that must still refuse.
 * A widening whose twins were not written would trade one silent failure for
 * another and this suite would applaud.
 */
import { describe, expect, it } from 'vitest';

import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeSurvivingPriorPendings } from '../../commit.js';
import {
  deriveMissingEffectPairs,
  resolveRecordedOptionEffectAnswer,
} from '../../routing/repair-value-binding.js';
import { tryShortConfirmResume } from '../../routing/deterministic-short-confirm.js';
import {
  applyRecordedAskLifetimes,
  enforceSymmetricClaimWindow,
  isPendingActionExpired,
  isShortWindowBareNumberClaimant,
  PENDING_ACTION_ASK_TURN_TTL,
  PENDING_ACTION_ASK_WALL_TTL_MS,
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  PENDING_KIND_CLAIMS_BARE_NUMBER,
  PENDING_KIND_IS_RECORDED_ASK,
  recordedAskWindowMustClamp,
  withRecordedAskLifetime,
  type PendingAction,
  type PendingActionAction,
  type PendingActionKind,
} from '../pending-action.js';

// ── The measured sequence, to the second. ────────────────────────────────────
const ASKED_AT_ISO = '2026-08-31T13:13:36.221Z';
const ASKED_AT_MS = Date.parse(ASKED_AT_ISO);
/** The turns that ran between the ask and the answer, from the log above. */
const INTERVENING_TURN_ISOS = [
  '2026-08-31T13:14:29Z',
  '2026-08-31T13:15:20Z',
  '2026-08-31T13:17:37Z',
  '2026-08-31T13:32:02Z',
  '2026-08-31T13:33:30Z',
  '2026-08-31T13:38:45Z',
] as const;
/** The bare-numeric answer. 25m31s after the ask. */
const ANSWERED_AT_MS = Date.parse('2026-08-31T13:39:07Z');

const graph = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Approach' },
    { id: 'goal', kind: 'goal', label: 'Retention' },
    { id: 'keep', kind: 'option', label: 'Keep the current pricing' },
    { id: 'factor', kind: 'factor', label: 'Completion' },
  ],
  edges: [
    ['decision', 'keep'],
    ['keep', 'factor'],
    ['factor', 'goal'],
  ].map(([from, to]) => ({
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  })),
};
// ⚠ NARROWED ONCE, INTO ITS OWN BINDING — fixed at source after `Typecheck
// Drift (ratchet)` went RED on this file at `db895427`. `computeAnalysisAffectingGraphHash`
// returns `string | null`, and TypeScript does not carry the module-level
// null-check narrowing INTO A CLOSURE (`ageThroughRealTurns` below), so the
// call there saw `string | null` against a `string | undefined` parameter.
// `tsconfig.build.json` excludes tests, which is why `pnpm build` was exit 0
// and blind to it — CLAUDE.md trap 2's refinement exactly. Absorbing this into
// `typecheck-baseline.txt` was not an option: the baseline records
// pre-existing debt, and this file is new in this PR.
const GRAPH_HASH_OR_NULL = computeAnalysisAffectingGraphHash(graph);
if (GRAPH_HASH_OR_NULL === null) throw new Error('Fixture graph must have a canonical hash');
const GRAPH_HASH: string = GRAPH_HASH_OR_NULL;

/** The ask exactly as `route-v2`'s configure-option clarify arms it. */
const ASK_ID = '00000000-0000-4000-8000-0000000000a1';
const askAsShipped: PendingAction = {
  id: ASK_ID,
  scenario_id: 'scenario',
  chip_id: 'chip_configure_option_clarify',
  action: {
    kind: 'elicit_option_effect',
    option_id: 'keep',
    option_label: 'Keep the current pricing',
    factor_id: 'factor',
    factor_label: 'Completion',
  },
  preconditions: { graph_hash: GRAPH_HASH },
  emitted_at_iso: ASKED_AT_ISO,
  expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
  expires_at_iso: new Date(ASKED_AT_MS + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
};

/** As the commit chokepoint now persists it. */
const askAsPersisted = (): PendingAction => {
  const [only] = applyRecordedAskLifetimes([askAsShipped], ASKED_AT_MS);
  if (only === undefined) throw new Error('applyRecordedAskLifetimes must preserve arity');
  return only;
};

/**
 * Age a pending through the REAL carry-forward authority at the REAL
 * intervening timestamps. Deliberately not a hand-decremented number: the
 * turn-count leg is `computeSurvivingPriorPendings`'s to decrement, and a test
 * that did the arithmetic itself would pass while the authority disagreed.
 */
function ageThroughRealTurns(
  pa: PendingAction,
  turnIsos: readonly string[] = INTERVENING_TURN_ISOS,
): PendingAction | null {
  let carried: PendingAction | null = pa;
  for (const iso of turnIsos) {
    if (carried === null) return null;
    const survivors = computeSurvivingPriorPendings([carried], [], [], GRAPH_HASH, Date.parse(iso));
    carried = survivors.find((s) => s.id === pa.id) ?? null;
  }
  return carried;
}

const readiness = buildCanonicalAnalysisReadyFromGraph(graph);
const resolveAnswer = (
  message: string,
  pendings: readonly PendingAction[] | null,
  currentGraph: unknown = graph,
  readinessOverride?: unknown,
  nowMs: number = ANSWERED_AT_MS,
) =>
  resolveRecordedOptionEffectAnswer({
    message,
    pendings,
    graph: currentGraph as never,
    scenarioId: 'scenario',
    nowMs,
    readiness: (readinessOverride === undefined
      ? buildCanonicalAnalysisReadyFromGraph(currentGraph as never)
      : readinessOverride) as never,
  });

// ─────────────────────────────────────────────────────────────────────────────
// DIAL A — the window
// ─────────────────────────────────────────────────────────────────────────────
describe('dial A — the recorded-ask window', () => {
  it('widens every recorded-ask kind, by kind identity, to the ask bounds', () => {
    const askKinds = (Object.keys(PENDING_KIND_IS_RECORDED_ASK) as PendingActionKind[]).filter(
      (k) => PENDING_KIND_IS_RECORDED_ASK[k],
    );
    // The corpus half of trap 12d: derivation proves the consumers agree with
    // the map, only a written-out list notices the map itself is short.
    expect(askKinds.sort()).toEqual([
      'elicit_edit_target',
      'elicit_effect_target',
      'elicit_option_effect',
      'elicit_target_baseline',
    ]);
    for (const kind of askKinds) {
      const pa: PendingAction = { ...askAsShipped, action: { kind } as PendingActionAction };
      const out = withRecordedAskLifetime(pa, ASKED_AT_MS);
      expect(out.expires_at_turn_count, kind).toBe(PENDING_ACTION_ASK_TURN_TTL);
      expect(Date.parse(out.expires_at_iso) - ASKED_AT_MS, kind).toBe(
        PENDING_ACTION_ASK_WALL_TTL_MS,
      );
    }
  });

  it('TWIN — leaves every offer kind untouched, by object identity', () => {
    // Derived from the map so a newly-added offer kind cannot slip past this
    // twin, which is the direction that would reopen the stale-hijack harm.
    const offerKinds = (Object.keys(PENDING_KIND_IS_RECORDED_ASK) as PendingActionKind[]).filter(
      (k) => !PENDING_KIND_IS_RECORDED_ASK[k],
    );
    expect(offerKinds.sort()).toEqual([
      'apply_proposed_change',
      'clarify_v2_round',
      'draft_graph',
      'edit_graph_add_risk',
      'proposed_concept',
      'run_analysis',
      'set_factor_value',
      'what_would_flip',
    ]);
    for (const kind of offerKinds) {
      const pa: PendingAction = { ...askAsShipped, action: { kind } as PendingActionAction };
      // `toBe`, not `toEqual`: the offer must come back as the SAME object, so
      // a future normaliser that "helpfully" restamps it fails here.
      expect(withRecordedAskLifetime(pa, ASKED_AT_MS), kind).toBe(pa);
    }
  });

  it('is monotone — never shortens a window a caller opened wider', () => {
    const wider: PendingAction = {
      ...askAsShipped,
      expires_at_turn_count: PENDING_ACTION_ASK_TURN_TTL + 8,
      expires_at_iso: new Date(ASKED_AT_MS + PENDING_ACTION_ASK_WALL_TTL_MS * 2).toISOString(),
    };
    expect(withRecordedAskLifetime(wider, ASKED_AT_MS)).toBe(wider);
  });

  it('does not repair a malformed expiry into a live window (fail-closed)', () => {
    const malformed: PendingAction = { ...askAsShipped, expires_at_iso: 'not-a-timestamp' };
    const out = withRecordedAskLifetime(malformed, ASKED_AT_MS);
    expect(out.expires_at_iso).toBe('not-a-timestamp');
    expect(isPendingActionExpired(out, ASKED_AT_MS)).toBe(true);
  });

  it('is a longer window, not an immortal one — both legs still bound it', () => {
    const persisted = askAsPersisted();
    // Wall leg: alive at 29 minutes, expired at 31.
    expect(isPendingActionExpired(persisted, ASKED_AT_MS + 29 * 60_000)).toBe(false);
    expect(isPendingActionExpired(persisted, ASKED_AT_MS + 31 * 60_000)).toBe(true);
    // Turn leg: PENDING_ACTION_ASK_TURN_TTL carried turns exhaust it.
    const tooManyTurns = Array.from({ length: PENDING_ACTION_ASK_TURN_TTL }, (_, i) =>
      new Date(ASKED_AT_MS + (i + 1) * 1_000).toISOString(),
    );
    expect(ageThroughRealTurns(persisted, tooManyTurns)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MEASURED SEQUENCE
// ─────────────────────────────────────────────────────────────────────────────
describe("the 2026-08-31 session — the user's answer, 25 minutes and six turns late", () => {
  it('the shipped lifetime loses the question before the user ever answers', () => {
    // Not a claim about the fix. The pristine behaviour, pinned, so the case
    // this change exists to close cannot quietly stop being a case.
    expect(ageThroughRealTurns(askAsShipped)).toBeNull();
  });

  it('the recorded-ask lifetime keeps it live to the answer instant', () => {
    const carried = ageThroughRealTurns(askAsPersisted());
    expect(carried).not.toBeNull();
    // Bound by IDENTITY: it is THIS ask that survived, not some other pending
    // that happens to satisfy a liveness predicate.
    expect(carried?.id).toBe(ASK_ID);
    expect(isPendingActionExpired(carried as PendingAction, ANSWERED_AT_MS)).toBe(false);
  });

  it('and the bare number then binds to the recorded cell', () => {
    const carried = ageThroughRealTurns(askAsPersisted()) as PendingAction;
    const bound = resolveAnswer('0.3', [carried]);
    expect(bound.kind).toBe('bind');
    if (bound.kind === 'bind') {
      expect(bound.answer.pending.id).toBe(ASK_ID);
      expect(bound.answer.pair.optionId).toBe('keep');
      expect(bound.answer.pair.factorId).toBe('factor');
      expect(bound.answer.valueText).toBe('0.3');
    }
    // The same number against the shipped lifetime: no live claimant.
    expect(resolveAnswer('0.3', [{ ...askAsShipped, expires_at_turn_count: 0 }]).kind).toBe(
      'stale',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DIAL B — the twins. Same 25-minute distance, world moved, must NOT bind.
// ─────────────────────────────────────────────────────────────────────────────
describe('dial B — a user who has genuinely moved on, at the same distance', () => {
  const live = () => ageThroughRealTurns(askAsPersisted()) as PendingAction;

  it('TWIN — a moved graph refuses, though the ask is live', () => {
    const carried = live();
    expect(isPendingActionExpired(carried, ANSWERED_AT_MS)).toBe(false);
    const moved = {
      ...graph,
      nodes: [...graph.nodes, { id: 'risk', kind: 'factor', label: 'Churn risk' }],
    };
    expect(computeAnalysisAffectingGraphHash(moved)).not.toBe(GRAPH_HASH);
    expect(resolveAnswer('0.3', [carried], moved).kind).toBe('stale');
  });

  it('TWIN — a referent that has since gone refuses', () => {
    const carried = live();
    const withoutOption = {
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== 'keep'),
      edges: graph.edges.filter((e) => e.from !== 'keep' && e.to !== 'keep'),
    };
    expect(resolveAnswer('0.3', [carried], withoutOption).kind).toBe('stale');
  });

  it('TWIN — a cell the readiness no longer reports missing refuses', () => {
    const carried = live();
    // POSITIVE CONTROL: on the readiness as asked, the recorded cell IS among
    // the missing pairs, and the answer binds. So the refusal below is the cell
    // leaving that set, not the fixture never having been in it.
    expect(
      deriveMissingEffectPairs(readiness).some(
        (p) => p.optionId === 'keep' && p.factorId === 'factor',
      ),
    ).toBe(true);
    expect(resolveAnswer('0.3', [carried]).kind).toBe('bind');

    // The user has since supplied that value by another route, so the blocker
    // is gone. Same ask, same 25 minutes, same unchanged graph hash.
    const settled = {
      ...(readiness as { blockers?: unknown[] }),
      blockers: ((readiness as { blockers?: unknown[] }).blockers ?? []).filter((b) => {
        const o = b as Record<string, unknown>;
        return !(o.option_id === 'keep' && o.factor_id === 'factor');
      }),
    };
    expect(
      deriveMissingEffectPairs(settled).some(
        (p) => p.optionId === 'keep' && p.factorId === 'factor',
      ),
    ).toBe(false);
    expect(resolveAnswer('0.3', [carried], graph, settled).kind).toBe('stale');
  });

  it('TWIN — a second live bare-number ask makes it ambiguous, not a guess', () => {
    const carried = live();
    const competitor: PendingAction = {
      ...carried,
      id: '00000000-0000-4000-8000-0000000000b2',
      action: {
        kind: 'elicit_target_baseline',
        target_id: 'goal',
        target_label: 'Retention',
        constraint_type: 'at_most',
        value: 0.2,
      } as PendingActionAction,
    };
    expect(resolveAnswer('0.3', [carried, competitor]).kind).toBe('ambiguous');
  });

  it('TWIN — a bare "yes" never resolves a recorded ask, at any age', () => {
    const carried = live();
    const confirm = (pendingActions: readonly PendingAction[]) =>
      tryShortConfirmResume({
        message: 'yes',
        pendingActions,
        nowMs: ANSWERED_AT_MS,
        currentTurnIndex: 7,
      });

    // POSITIVE CONTROL FIRST, or the refusal below proves nothing: a live OFFER
    // in the same call, at the same instant, DOES resume. So the resumer is
    // reachable here and the refusal is about the KIND, not about an inert call.
    const liveOffer: PendingAction = {
      ...carried,
      id: '00000000-0000-4000-8000-0000000000d4',
      action: { kind: 'run_analysis' } as PendingActionAction,
    };
    const control = confirm([liveOffer]);
    expect(control.matched).toBe(true);
    if (control.matched && control.dispatch === 'pending_action') {
      expect(control.pending.id).toBe('00000000-0000-4000-8000-0000000000d4');
    } else {
      throw new Error('positive control: a live run_analysis offer must resume on "yes"');
    }

    // The recorded ask, live at 25 minutes, must NOT be what "yes" resolves.
    const refused = confirm([carried]);
    expect(isPendingActionExpired(carried, ANSWERED_AT_MS)).toBe(false);
    if (refused.matched && refused.dispatch === 'pending_action') {
      throw new Error('a recorded ask must never resolve through the bare-confirm resumer');
    }
  });

  it('TWIN — an offer at the same distance is still expired', () => {
    const offer: PendingAction = {
      ...askAsShipped,
      id: '00000000-0000-4000-8000-0000000000c3',
      action: { kind: 'what_would_flip' } as PendingActionAction,
    };
    const [persistedOffer] = applyRecordedAskLifetimes([offer], ASKED_AT_MS);
    expect(persistedOffer).toBe(offer);
    expect(ageThroughRealTurns(offer)).toBeNull();
    expect(isPendingActionExpired(offer, ANSWERED_AT_MS)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ⭐⭐ THE CLAIMANT SET MOVES AS ONE — the class this suite could not see.
//
// Added after an adversarial review found that the widening MANUFACTURED a new
// stale-hijack. `PENDING_KIND_CLAIMS_BARE_NUMBER` has SEVEN true members;
// `PENDING_KIND_IS_RECORDED_ASK` widens FOUR. The three left behind still claim
// a bare number and still expire at 2 turns — so the competitor vanishes from
// under the ambiguity gate at `repair-value-binding.ts:514-518`, and the older
// ask WINS a number the user typed for the newer, expired question.
//
// ⚠ WHY THE EXISTING AMBIGUITY TWIN COULD NOT CATCH IT — the reviewer's point,
// not a restatement of the fix. That twin uses `elicit_target_baseline`, which
// is a WIDENED kind: it is the SYMMETRIC case, where both claimants move
// together and the gate fires as designed. Nothing in the corpus paired a
// NON-widened claimant against a widened one, and no mutant reached the class
// either — M4/M5 remove `elicit_*` FROM the widened set, which probes the same
// symmetric axis from the other end. A corpus that varies only along the axis
// the author was thinking about cannot see the axis they were not.
// ─────────────────────────────────────────────────────────────────────────────
describe('the claimant set moves as one — a NON-widened competitor', () => {
  /** A numbered clarify menu. Claims a bare number; NOT a recorded ask. */
  const numberedMenu = (): PendingAction => ({
    ...askAsShipped,
    id: '00000000-0000-4000-8000-0000000000e5',
    chip_id: 'chip_clarify_v2_proceed',
    action: {
      kind: 'clarify_v2_round',
      brief: 'Pricing',
      asked_dimensions: [],
      round: 1,
    } as unknown as PendingActionAction,
  });

  /**
   * Age a WHOLE pending set through the real carry-forward authority, so the
   * competitor is visible to it on every turn — which is the entire point.
   * `ageThroughRealTurns` above carries ONE pending and therefore cannot
   * observe a claimant-set property at all.
   */
  function ageSetThroughRealTurns(
    set: readonly PendingAction[],
    turnIsos: readonly string[] = INTERVENING_TURN_ISOS,
  ): readonly PendingAction[] {
    let carried: readonly PendingAction[] = set;
    for (const iso of turnIsos) {
      carried = computeSurvivingPriorPendings(carried, [], [], GRAPH_HASH, Date.parse(iso));
    }
    return carried;
  }
  const findById = (set: readonly PendingAction[], id: string): PendingAction | null =>
    set.find((pa) => pa.id === id) ?? null;

  it('PREMISE: the claimant set is genuinely uneven — the menu claims a bare number and is NOT widened', () => {
    // Derived from the two maps rather than asserted from the fixture, so this
    // premise REDs loudly if either map moves. Both halves matter: a kind that
    // did not claim a bare number could not hijack, and a kind that WAS widened
    // would expire alongside the ask and create no asymmetry.
    expect(PENDING_KIND_CLAIMS_BARE_NUMBER.clarify_v2_round).toBe(true);
    expect(PENDING_KIND_IS_RECORDED_ASK.clarify_v2_round).toBe(false);
    expect(isShortWindowBareNumberClaimant('clarify_v2_round')).toBe(true);
    // CONTRAST CONTROL, in the same run: the kind the existing ambiguity twin
    // uses IS widened, so it is not a member of the uneven set. If this read
    // true as well, the predicate would not be discriminating.
    expect(isShortWindowBareNumberClaimant('elicit_target_baseline')).toBe(false);
    // And the uneven set is exactly the three the review named — written out,
    // because a derived assertion cannot notice the map itself is short.
    const uneven = (Object.keys(PENDING_KIND_CLAIMS_BARE_NUMBER) as PendingActionKind[])
      .filter((k) => isShortWindowBareNumberClaimant(k))
      .sort();
    expect(uneven).toEqual(['clarify_v2_round', 'proposed_concept', 'set_factor_value']);
  });

  it('THE MANUFACTURED HIJACK: a widened ask must not outlive a competing numbered menu', () => {
    const ask = askAsPersisted();
    const menu = numberedMenu();
    // POSITIVE CONTROL FIRST: both are genuinely live when they sit in the set
    // together, so what follows is about the WINDOW and not about an inert
    // fixture that was already dead.
    expect(isPendingActionExpired(ask, ASKED_AT_MS)).toBe(false);
    expect(isPendingActionExpired(menu, ASKED_AT_MS)).toBe(false);

    // Aged through the REAL carry-forward authority, with BOTH present on every
    // turn — the sequence the reviewer described.
    const carried = ageSetThroughRealTurns([ask, menu]);
    const carriedMenu = findById(carried, menu.id);
    const carriedAsk = findById(carried, ask.id);

    // ⭐ THE PROPERTY, stated as EXPIRY PARITY rather than as a number, so it
    // stays true if either TTL constant is retuned: the ask must not still be
    // claiming bare numbers at a moment its competitor is already gone.
    expect(carriedMenu).toBeNull();
    expect(carriedAsk).toBeNull();
  });

  it('THE HARM AT THE GATE: the menu index is never bound into the option/factor cell', () => {
    // Asserted separately from the expiry parity above so it bites on its own.
    // Before the fix the ask was the SOLE live claimant at
    // `repair-value-binding.ts:514-518` — the competitor having silently
    // expired out of the claimant set — so the ambiguity gate never fired and
    // `resolveRecordedOptionEffectAnswer` returned `bind`, writing the user's
    // MENU INDEX into the option/factor cell as an effect size.
    const carried = ageSetThroughRealTurns([askAsPersisted(), numberedMenu()]);
    const claimants = carried.filter((pa) => !isPendingActionExpired(pa, ANSWERED_AT_MS));
    expect(resolveAnswer('1', claimants).kind).not.toBe('bind');
  });

  it('DISCRIMINATING TWIN: with NO competitor the widened window survives, and the answer still binds', () => {
    // The other direction of the same harm, and this PR's whole value. A clamp
    // that fired unconditionally would silently revert the fix and send the
    // founder's 25-minute answer back to the LLM — and the test above would
    // still pass. Neither case alone shows the binding is right.
    const ask = askAsPersisted();
    const carried = ageSetThroughRealTurns([ask]);
    const carriedAsk = findById(carried, ask.id);
    expect(carriedAsk).not.toBeNull();
    expect(resolveAnswer('0.3', carriedAsk === null ? [] : [carriedAsk]).kind).toBe('bind');
  });

  it('TWIN: an EXPIRED competitor does not clamp — the gate reads liveness, not membership', () => {
    // A dead competitor cannot have its answer stolen, so it must not cost the
    // ask its window. Keyed on liveness rather than on presence in the array.
    const ask = askAsPersisted();
    const deadMenu: PendingAction = {
      ...numberedMenu(),
      expires_at_iso: new Date(ASKED_AT_MS - 1000).toISOString(),
    };
    expect(isPendingActionExpired(deadMenu, ASKED_AT_MS)).toBe(true);
    expect(recordedAskWindowMustClamp([ask, deadMenu], ASKED_AT_MS)).toBe(false);
    const input = [ask, deadMenu];
    expect(enforceSymmetricClaimWindow(input, ASKED_AT_MS)).toBe(input);
  });

  it('TWIN: the clamp only ever SHORTENS, lands exactly on the defaults, and never touches an offer', () => {
    // The safety argument, pinned. A one-directional transform cannot make any
    // binding reachable that was not reachable before the widening shipped.
    const menu = numberedMenu();
    const offer: PendingAction = {
      ...askAsShipped,
      id: '00000000-0000-4000-8000-0000000000f6',
      action: { kind: 'what_would_flip' } as PendingActionAction,
    };
    const [clampedOffer] = enforceSymmetricClaimWindow([offer, menu], ASKED_AT_MS);
    expect(clampedOffer).toBe(offer); // a non-ask, returned by identity

    const ask = askAsPersisted();
    const [clampedAsk] = enforceSymmetricClaimWindow([ask, menu], ASKED_AT_MS);
    if (clampedAsk === undefined) throw new Error('enforceSymmetricClaimWindow must preserve arity');
    expect(clampedAsk.expires_at_turn_count).toBeLessThanOrEqual(ask.expires_at_turn_count);
    expect(Date.parse(clampedAsk.expires_at_iso)).toBeLessThanOrEqual(
      Date.parse(ask.expires_at_iso),
    );
    // Exactly the defaults — not some third number invented by the clamp.
    expect(clampedAsk.expires_at_turn_count).toBe(PENDING_ACTION_DEFAULT_TURN_TTL);
    expect(Date.parse(clampedAsk.expires_at_iso)).toBe(
      ASKED_AT_MS + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
    );
  });

  it('TWIN: a malformed expiry is passed through untouched and stays fail-closed', () => {
    // Mirrors the same rule on `withRecordedAskLifetime`: rewriting an
    // unparseable stamp into a valid clamp would convert an expired verdict
    // into a live 10-minute window.
    const malformed: PendingAction = { ...askAsPersisted(), expires_at_iso: 'not-a-date' };
    const [out] = enforceSymmetricClaimWindow([malformed, numberedMenu()], ASKED_AT_MS);
    if (out === undefined) throw new Error('enforceSymmetricClaimWindow must preserve arity');
    expect(out.expires_at_iso).toBe('not-a-date');
    expect(isPendingActionExpired(out, ASKED_AT_MS)).toBe(true);
  });
});
