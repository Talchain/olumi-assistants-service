/**
 * ⭐ THE ADMISSION MODE IS A CONJUNCT AT THE PROSE CHOKEPOINT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, from the founder's 5 Sep session. ONE TURN shipped BOTH of these:
 *
 *   the admission, verbatim:
 *     "Every estimate this comparison rests on is Olumi's, not yours. Figures
 *      can be shown as provisional, but NO OPTION CAN BE CALLED THE LEADER and
 *      no result can be called stable or robust until you have set at least one
 *      of them."
 *
 *   the assistant prose, in the same payload:
 *     "Hire a Tech Lead currently performs best, leading in 46% of simulations."
 *
 * ⚠ THE MECHANISM IS NOT THE OBVIOUS ONE, and two earlier statements of it were
 * wrong. `permitted_analysis_mode` is NOT unread: the UI builds the conjunction
 * `schemas/analysis-ready.ts` asks for, on every surface it COMPOSES from
 * structured data. What it cannot do is unwrite a sentence CEE already authored
 * into `assistant_text`. ONE QUESTION, TWO CHANNELS, ONE GATED — the structured
 * channel gated, the prose channel not.
 *
 * ⚠ AND IT IS NOT `composeLeaderClaim`'s to fix. That function answers "did THIS
 * RESULT separate the arms?" and its refusal to conjoin the mode is deliberate
 * and documented (`compose/analysis-state-v1.ts`): making one authority call
 * another is how #709/#737 was created. The conjunction belongs where the
 * question is "may this PROSE name a leader on screen?" — the enforcement
 * chokepoint, and its alarm.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHY EVERY CASE HERE HAS AN OPPOSITE-DIRECTION TWIN (CLAUDE.md trap 22b).
 *
 * Two harms sit under one predicate and they pull opposite ways:
 *
 *   UNDER-suppression — the founder's defect. Prose names a leader the model
 *                       does not license.
 *   OVER-suppression  — the WORSE defect, in this repo's own words
 *                       (`leading-option-wire-enforcement.ts`): leader prose
 *                       silenced on turns that legitimately permit it.
 *
 * A suppression-only corpus cannot see the second, and a fix validated against
 * it would trade one silent failure for another while the suite applauded. So
 * every arm below is paired: the cell that must now suppress, and the adjacent
 * cell that must stay BYTE-IDENTICAL — asserted by object IDENTITY, which a
 * careful-enough copy cannot satisfy.
 *
 * ⚠ AND EVERY ARM PINS ITS OWN PRECONDITION (trap 13b). A suppression assertion
 * passes just as happily when the fixture stopped being actionable — wrong
 * roster, prose the vocabulary no longer sees — as when the gate did its job.
 * `describe('the fixture is actionable at all')` below asserts the payload WOULD
 * be edited on a plainly-withheld turn, so the discriminating arms are provably
 * about the mode and not about a fixture that quietly went inert.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTestSink } from '../../../utils/telemetry.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromAnalysisReady,
  textNamesAnOption,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';
import {
  guardLeadingOptionClaimsAtEgress,
  textAssertsLeadingOption,
} from '../leading-option-egress-guard.js';
import {
  analysisReadyPermitsLeaderNaming,
  permittedAnalysisModeFromAnalysisReady,
} from '../../admission/analysis-admission.js';

/** The founder's option label and the founder's sentence, verbatim. */
const LEADER_LABEL = 'Hire a Tech Lead';
const FOUNDER_CLAIM = `${LEADER_LABEL} currently performs best, leading in 46% of simulations.`;
/** An honest receipt that must survive every arm byte-identical. */
const RECEIPT = 'Added the risk.';
const ANSWER = `${RECEIPT} ${FOUNDER_CLAIM}`;

/**
 * The readiness payload, shaped as the wire carries it: the option roster the
 * gate reads for "which options exist", plus the admission whose
 * `permitted_analysis_mode` is the new conjunct.
 *
 * `mode: null` builds a payload with NO `analysis_admission` key at all — the
 * pre-`analysis_admission` producer, which must fail OPEN.
 *
 * ⚠ `structurallyAnalysable` DEFAULTS TO `true` AND IS NOT DECORATION. A mode
 * below the floor caps a CLAIM only on a model that can actually run; when the
 * run itself is refused the field is answering a different question and this
 * gate stands down. Both directions are asserted below.
 *
 * ⚠⚠ AND THREE CELLS THIS HELPER CAN BUILD ARE PRODUCER-UNREACHABLE — NAMED HERE
 * SO THE NEXT READER DOES NOT INHERIT THEM AS REACHABILITY CLAIMS (CLAUDE.md
 * trap 20: a fixture proves what it was pointed at, and a row minted from it
 * must not generalise). `analysisAdmissionFrom` mints `structurally_analysable`
 * from the very `admission.willProceed` that `deriveMode` branches on, so
 * production can emit ONLY `{none, exploratory} × false` and
 * `{quantified_provisional, comparative_leader} × true`. These three arms are
 * UNIT-LEVEL BINDING PROOFS, not coverage of live cells:
 *
 *   `none` + `true`                     the discriminating twin — without it the
 *                                       gate could be a string match on 'none'
 *   `exploratory` + `true`              the below-floor rung, held analysable so
 *                                       that it reaches the mode reader at all
 *   `quantified_provisional` + `false`  proves the structural half governs a
 *                                       self-contradictory payload
 *
 * They are deliberate and the discriminating twin genuinely needs one. They are
 * simply not evidence about the wire.
 */
function analysisReady(
  mode: string | null,
  structurallyAnalysable = true,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    status: 'needs_user_input',
    goal_node_id: 'goal_1',
    options: [
      { option_id: 'opt_lead', label: LEADER_LABEL, status: 'ready', interventions: {} },
      { option_id: 'opt_hold', label: 'stay as we are', status: 'ready', interventions: {} },
    ],
  };
  if (mode === null) return base;
  return {
    ...base,
    analysis_admission: {
      structurally_analysable: structurallyAnalysable,
      missing_important_inputs: [],
      semantic_quality_sufficient: true,
      permitted_analysis_mode: mode,
      reasons: [],
    },
  };
}

function envelope(assistantText: string): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
  } as unknown as OlumiResponse;
}

/**
 * The gate reads a roster from `analysisReady` when no graph is in scope, which
 * is the majority path. `graph: null` is therefore the REALISTIC fixture here,
 * not a degenerate one.
 */
const WIRE_OPTS = { requestId: 'req-mode-conjunct', exitPath: 'edit_graph', graph: null };
const ALARM_OPTS = { requestId: 'req-mode-conjunct', exitPath: 'edit_graph' };

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  events = [];
  setTestSink((name, data) => events.push({ name, data: data as Record<string, unknown> }));
});
afterEach(() => setTestSink(null));

// ═══════════════════════════════════════════════════════════════════════════
// PRECONDITIONS. If any of these fails, every assertion below is vacuous and
// says nothing about the mode — it says the fixture went inert.
// ═══════════════════════════════════════════════════════════════════════════
describe('the fixture is actionable at all (else every arm below is vacuous)', () => {
  it("the founder's sentence trips the leader vocabulary", () => {
    expect(textAssertsLeadingOption(FOUNDER_CLAIM)).toBe(true);
  });

  it("the founder's sentence NAMES an option on this scenario's roster", () => {
    const roster = optionRosterFromAnalysisReady(analysisReady('comparative_leader'));
    expect(roster).toContain(LEADER_LABEL);
    expect(textNamesAnOption(FOUNDER_CLAIM, roster)).toBe(true);
  });

  it('the roster survives on the admission-less payload too (so absence is tested, not blindness)', () => {
    expect(optionRosterFromAnalysisReady(analysisReady(null))).toContain(LEADER_LABEL);
  });

  it('an UNENTITLED turn is edited on this exact payload — the gate can act here', () => {
    const { response, changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
      ...WIRE_OPTS,
      mayNameLeadingOption: false,
      analysisReady: analysisReady('comparative_leader'),
    });
    expect(changed).toBe(true);
    expect(response.assistant_text).toContain(RECEIPT);
    expect(response.assistant_text).not.toContain('performs best');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE THREE-ARM DISCRIMINATOR, on the founder's exact cell.
// ═══════════════════════════════════════════════════════════════════════════
describe('the enforcer conjoins permitted_analysis_mode', () => {
  it("SUPPRESSES the founder's cell: entitled, but the model licenses only quantified_provisional", () => {
    const input = envelope(ANSWER);
    const { response, changed, editedFields } = enforceLeadingOptionClaimsAtWire(input, {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('quantified_provisional'),
    });
    expect(changed).toBe(true);
    expect(editedFields).toEqual(['assistant_text']);
    // Bound by IDENTITY to the founder's sentence, not by a value predicate
    // another sentence could satisfy (trap 19).
    expect(response.assistant_text).not.toContain(FOUNDER_CLAIM);
    expect(response.assistant_text).not.toContain('performs best');
    expect(response.assistant_text).not.toContain('leading in 46%');
    // SURGICAL: the honest receipt survives byte-identical.
    expect(response.assistant_text).toContain(RECEIPT);
    expect(response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('TWIN — comparative_leader is BYTE-IDENTICAL, by reference', () => {
    const input = envelope(ANSWER);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('comparative_leader'),
    });
    expect(changed).toBe(false);
    // Identity, not deep-equality: the permitted path must not even rebuild the
    // envelope, so a careful-enough copy cannot pass this.
    expect(response).toBe(input);
    expect(response.assistant_text).toBe(ANSWER);
  });

  it('TWIN — ABSENCE fails OPEN and is BYTE-IDENTICAL, by reference', () => {
    // `schemas/analysis-ready.ts`: "ABSENCE means a pre-`analysis_admission`
    // producer, never 'no'." A producer that predates the field must be
    // untouched, or this change over-suppresses on every legacy exit.
    const input = envelope(ANSWER);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady(null),
    });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE LATTICE, and the two ways fail-open can be got wrong.
// ═══════════════════════════════════════════════════════════════════════════
describe('the conjunct reads the RANK, and fails open on anything it cannot read', () => {
  const suppressing = ['none', 'exploratory', 'quantified_provisional'];
  for (const mode of suppressing) {
    it(`SUPPRESSES below the floor: ${mode}`, () => {
      const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
        ...WIRE_OPTS,
        mayNameLeadingOption: true,
        analysisReady: analysisReady(mode),
      });
      expect(changed).toBe(true);
    });
  }

  // The opposite-direction twins: every shape that is NOT a readable mode below
  // the floor must leave the turn alone. An over-eager reader that treated
  // "unrecognised" as "no" would silence legitimate prose everywhere.
  const failOpen: Array<[string, unknown]> = [
    ['no analysis_ready at all', undefined],
    ['a null analysis_ready', null],
    ['an admission that is null', { ...analysisReady(null), analysis_admission: null }],
    // A PARTIAL admission with no `structurally_analysable` at all. Absent is not
    // `false` and is not `true`: we cannot establish that the run was admitted,
    // so we do not delete the user's prose. Pins `!== true`, not `=== false`.
    [
      'an admission carrying a capped mode but NO structurally_analysable field',
      {
        ...analysisReady(null),
        analysis_admission: { permitted_analysis_mode: 'quantified_provisional' },
      },
    ],
    // ⚠ THESE THREE CARRY `structurally_analysable: true` ON PURPOSE. Without it
    // they would fail open at the structural gate and never reach the mode
    // reader at all — passing for a reason that has nothing to do with what they
    // are named for (CLAUDE.md trap 13b, a guard agreeing with itself).
    [
      'an unrecognised mode string',
      {
        ...analysisReady(null),
        analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'wat' },
      },
    ],
    [
      'a non-string mode',
      {
        ...analysisReady(null),
        analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 3 },
      },
    ],
    [
      'an INHERITED key, not an own one (hasOwnProperty, not `in`)',
      {
        ...analysisReady(null),
        analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'toString' },
      },
    ],
  ];
  for (const [name, payload] of failOpen) {
    it(`TWIN — fails OPEN on ${name}`, () => {
      const input = envelope(ANSWER);
      const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
        ...WIRE_OPTS,
        mayNameLeadingOption: true,
        analysisReady: payload,
      });
      expect(changed).toBe(false);
      expect(response).toBe(input);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ `structurally_analysable: false` FAILS OPEN — the narrowing, and the
// discriminating pair that proves it binds to the FIELD and not to a string.
//
// MEASURED, NOT ASSUMED. The first cut of this change conjoined the mode alone
// and turned three of the estate's own PERMIT-WINS controls red, plus the real
// post-analysis advice-gate answer. Instrumenting the reader showed the mode on
// those turns is `'none'` — "the model has blockers, nothing may RUN" — which
// says nothing about a result that already completed. Readiness is recomputed
// per turn, so an explain turn whose graph has drifted reads `'none'` while its
// prose is legitimate. Suppressing there is the WORSE defect.
// ═══════════════════════════════════════════════════════════════════════════
describe('a REFUSED RUN is not a capped CLAIM — the narrowing', () => {
  it('fails OPEN when the run is refused (none + structurally_analysable:false)', () => {
    const input = envelope(ANSWER);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('none', false),
    });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });

  it('fails OPEN on a refused run even if the mode field says otherwise', () => {
    // A contradictory payload: the run is refused, yet the mode names a cap.
    // The structural half governs, so this stands down.
    const input = envelope(ANSWER);
    const { changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('quantified_provisional', false),
    });
    expect(changed).toBe(false);
  });

  /**
   * ⭐ THE DISCRIMINATING TWIN. The pair above could be satisfied by a predicate
   * that merely string-matched `'none'`. This arm holds the mode at `'none'` and
   * flips ONLY `structurally_analysable` — so it must SUPPRESS, proving the gate
   * reads the field and not the string. Neither arm alone shows the binding.
   */
  it('TWIN — the SAME mode SUPPRESSES when the model IS analysable', () => {
    const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('none', true),
    });
    expect(changed).toBe(true);
  });

  it("the founder's cell is UNAFFECTED by the narrowing — her run proceeded", () => {
    // "Figures can be shown as provisional" ⇒ structurally_analysable: true.
    // The narrowing must not buy its green by weakening the fix.
    const { response, changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('quantified_provisional', true),
    });
    expect(changed).toBe(true);
    expect(response.assistant_text).not.toContain('performs best');
  });

  it('the alarm mirrors the narrowing — silent on a refused run', () => {
    const res = envelope(ANSWER);
    expect(
      guardLeadingOptionClaimsAtEgress(res, {
        ...ALARM_OPTS,
        mayNameLeadingOption: true,
        analysisReady: analysisReady('none', false),
      }),
    ).toBe(res);
    expect(events).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ THE CONJUNCTION IS A CONJUNCTION — not a swap, and not a disjunction.
// Without this pair, replacing `mayNameLeadingOption` outright with the mode
// would pass every arm above.
// ═══════════════════════════════════════════════════════════════════════════
describe('BOTH halves bind — neither authority was replaced by the other', () => {
  it('the ENTITLEMENT half still suppresses even at comparative_leader', () => {
    const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
      ...WIRE_OPTS,
      mayNameLeadingOption: false,
      analysisReady: analysisReady('comparative_leader'),
    });
    expect(changed).toBe(true);
  });

  it('the MODE half still suppresses even when entitled', () => {
    const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
      ...WIRE_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('quantified_provisional'),
    });
    expect(changed).toBe(true);
  });

  it('and permitting takes BOTH — the only byte-identical cell of the four', () => {
    const cells: Array<[boolean, string, boolean]> = [
      [true, 'comparative_leader', false],
      [true, 'quantified_provisional', true],
      [false, 'comparative_leader', true],
      [false, 'quantified_provisional', true],
    ];
    for (const [entitled, mode, expectedChanged] of cells) {
      const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
        ...WIRE_OPTS,
        mayNameLeadingOption: entitled,
        analysisReady: analysisReady(mode),
      });
      expect(changed, `entitled=${entitled} mode=${mode}`).toBe(expectedChanged);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ALARM MIRRORS THE ENFORCER. A detector narrower than the thing it
// measures is how the estate goes quiet.
// ═══════════════════════════════════════════════════════════════════════════
describe('the alarm cannot go quiet on the population the enforcer now acts on', () => {
  const EVENT = 'v5.egress.leading_option_claim_withheld_violated';

  it("REPORTS the founder's cell: entitled, quantified_provisional, leader prose", () => {
    const res = envelope(ANSWER);
    const out = guardLeadingOptionClaimsAtEgress(res, {
      ...ALARM_OPTS,
      mayNameLeadingOption: true,
      analysisReady: analysisReady('quantified_provisional'),
    });
    // Observe-only stays observe-only: it reports, it does not edit.
    expect(out).toBe(res);
    expect(events.map((e) => e.name)).toContain(EVENT);
  });

  it('TWIN — silent at comparative_leader', () => {
    const res = envelope(ANSWER);
    expect(
      guardLeadingOptionClaimsAtEgress(res, {
        ...ALARM_OPTS,
        mayNameLeadingOption: true,
        analysisReady: analysisReady('comparative_leader'),
      }),
    ).toBe(res);
    expect(events).toEqual([]);
  });

  it('TWIN — silent on ABSENCE (fails open, exactly as the enforcer does)', () => {
    const res = envelope(ANSWER);
    expect(
      guardLeadingOptionClaimsAtEgress(res, {
        ...ALARM_OPTS,
        mayNameLeadingOption: true,
        analysisReady: analysisReady(null),
      }),
    ).toBe(res);
    expect(events).toEqual([]);
  });

  it('TWIN — silent on absence with NO analysisReady member at all (every existing caller)', () => {
    const res = envelope(ANSWER);
    expect(
      guardLeadingOptionClaimsAtEgress(res, { ...ALARM_OPTS, mayNameLeadingOption: true }),
    ).toBe(res);
    expect(events).toEqual([]);
  });

  /**
   * ⚠ THIS ARM IS AN AGREEMENT INVARIANT, NOT A DISCRIMINATING ONE, AND IT
   * PASSED AT PRISTINE — measured, not assumed. Two rails that are equally
   * blind agree perfectly, so this can never be the evidence that the conjunct
   * exists; the arms above are. Its value is FORWARD-facing: it REDs the day
   * someone moves one rail's scope without the other, which is the failure this
   * change's own shape makes newly possible. Kept, and labelled, rather than
   * presented as a RED-first signature it is not (CLAUDE.md trap 13b).
   */
  it('the two rails agree cell for cell — neither is wider than the other', () => {
    const cells: Array<[boolean, string | null]> = [
      [true, 'comparative_leader'],
      [true, 'quantified_provisional'],
      [true, 'exploratory'],
      [true, null],
      [false, 'comparative_leader'],
      [false, 'quantified_provisional'],
    ];
    for (const [entitled, mode] of cells) {
      const payload = analysisReady(mode);

      const { changed } = enforceLeadingOptionClaimsAtWire(envelope(ANSWER), {
        ...WIRE_OPTS,
        mayNameLeadingOption: entitled,
        analysisReady: payload,
      });

      events = [];
      guardLeadingOptionClaimsAtEgress(envelope(ANSWER), {
        ...ALARM_OPTS,
        mayNameLeadingOption: entitled,
        analysisReady: payload,
      });
      const alarmed = events.some((e) => e.name === EVENT);

      // The enforcer edits only when the prose is actionable; the alarm reports
      // on the same population because this fixture IS actionable (pinned
      // above). Equality of the two is the invariant that matters.
      expect(alarmed, `entitled=${entitled} mode=${String(mode)}`).toBe(changed);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ROUTE THREADS IT. Behaviour alone would fix the fixtures; this closes the
// class, at the ONE call site every exit funnels through.
// ═══════════════════════════════════════════════════════════════════════════
describe('the route threads the admission to BOTH rails', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));

  it('the alarm call site receives analysisReady', () => {
    const source = readFileSync(resolve(HERE, '../../../orchestrator/route-v2.ts'), 'utf8');
    // Positive control first: a probe that read an empty or wrong file would
    // "prove" absence just as convincingly (trap 13).
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain('guardLeadingOptionClaimsAtEgress(wireBody, {');

    const at = source.indexOf('guardLeadingOptionClaimsAtEgress(wireBody, {');
    const args = source.slice(at, source.indexOf('});', at) + 3);
    expect(args).toContain('mayNameLeadingOption: ctx.mayNameLeadingOption');
    expect(args).toContain('analysisReady: ctx.analysisReady');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE SHARED READER, DIRECTLY.
//
// ⚠ ADDED AFTER THE RED-FIRST CAPTURE, and deliberately so — these arms could
// not exist at pristine (the symbols do not). They are here because a mutation
// run found a SURVIVOR the rails could not reach: with
// `analysisReadyPermitsLeaderNaming` guarding a null admission itself, deleting
// the null check INSIDE `permittedAnalysisModeFromAnalysisReady` changed nothing
// observable through either rail. That check is not dead code — the function is
// exported, and a future caller reaching it with `analysis_admission: null`
// would get a TypeError, not a `null`. So it is closed by a discriminating arm
// rather than declared equivalent (CLAUDE.md trap 13c: a survivor is a claim
// either way, and must be demonstrated).
// ═══════════════════════════════════════════════════════════════════════════
describe('permittedAnalysisModeFromAnalysisReady — the field reader', () => {
  it('returns null WITHOUT THROWING on a null admission', () => {
    // The mutation-found gap: this must not throw, and the throw is what a
    // deleted null-check produces.
    expect(() =>
      permittedAnalysisModeFromAnalysisReady({ analysis_admission: null }),
    ).not.toThrow();
    expect(permittedAnalysisModeFromAnalysisReady({ analysis_admission: null })).toBeNull();
  });

  it('reads the mode when one is there, and null when it is not', () => {
    expect(
      permittedAnalysisModeFromAnalysisReady({
        analysis_admission: { permitted_analysis_mode: 'comparative_leader' },
      }),
    ).toBe('comparative_leader');
    expect(permittedAnalysisModeFromAnalysisReady(undefined)).toBeNull();
    expect(permittedAnalysisModeFromAnalysisReady({})).toBeNull();
  });

  it('the predicate fails open on a null admission too', () => {
    expect(analysisReadyPermitsLeaderNaming({ analysis_admission: null })).toBe(true);
  });
});
