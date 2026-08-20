/**
 * ⭐⭐ THE PRODUCT OFFERED — AND APPLIED — A WRITE TO A DIFFERENT FIELD OF THE
 * PAIR IT WAS ASKING ABOUT. Fresh-guest browser witness, 20 Aug 2026
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/golden-journey-runs/
 *   2026-08-20-fresh-guest-browser-witness/`), deployed CEE `65445df`,
 * UI `7153fbd7`.
 *
 * ── DEFECT A (captured verbatim on screen, `shots/07-adjust-this-link-chip.png`)
 * Olumi asked: *"Next, choose the missing effect value for "double down on
 * mid-market…" on "Self-serve product investment"…"*. The user answered
 * *"I would say it drives self-serve product investment fairly strongly, about
 * 0.6."* and the product replied:
 *
 *   "Nothing has been changed. You did not ask me to edit the model, so I have
 *    not - but changing the strength of "double down on mid-market with a
 *    lower-priced self-serve tier→Self-serve product investment" to 0.6 looks
 *    like it would help. Say the word and I will make it."   [chip: Adjust this link]
 *
 * The chip wrote edge STRENGTH (1 → 0.6), reported "Applied", and readiness did
 * not move (`options_ready` 0/4). The edge it names IS the option × factor pair
 * of the blocker the product had just put on screen.
 *
 * ── DEFECT B (`PLAIN-LANGUAGE-TESTS.txt` test C)
 * *"Set its effect on Enterprise sales investment to 0.7"* wrote the FACTOR's
 * own value (0.5 → 0.7) and reported "Applied". Measured at this tip:
 * `detectConfigureOptionIntent` returns `{matched:false, labelAnchorWouldDecide:
 * true}` — the classifier's own report that an option ANCHOR, and nothing else,
 * is what it is missing. `impliesOptionInterventionEdit` returns false for the
 * same reason (its header names the pronoun gap at
 * `option-intervention-guard.ts:282-285`).
 *
 * ── WHAT THIS MODULE ASSERTS
 * ONE question: *would this proposal write a DIFFERENT FIELD of an option ×
 * factor pair the product is CURRENTLY asking for an effect value on?* It adds
 * NO natural-language predicate of its own — the effect framing comes from the
 * shipped classifier's own `labelAnchorWouldDecideTrigger`, and the pair set
 * comes from `deriveMissingEffectPairs`, the estate's ONE owner of "which pairs
 * is the product saying it has no value for" (`repair-value-binding.ts`).
 *
 * TRAP 19 — every assertion binds by IDENTITY: the blocker code, the option id,
 * the factor id, the handler id. Never by a value predicate.
 * TRAP 22b — every claimed case carries its OPPOSITE-DIRECTION TWIN: a
 * legitimate factor-baseline edit on the SAME factor must still write.
 */
import { describe, it, expect } from 'vitest';

import { findOutstandingEffectAskCollision } from '../outstanding-effect-ask-misroute.js';

// ---------------------------------------------------------------------------
// THE WITNESSED GRAPH IDENTITIES, copied from the capture's readiness payload
// (`turns/002-200-…graph_readiness.json`). Ids and labels verbatim.
// ---------------------------------------------------------------------------
const OPT_SELF_SERVE = '15637f46';
const OPT_SELF_SERVE_LABEL = 'double down on mid-market with a lower-priced self-serve tier';
const FAC_SELF_SERVE = '0ebfde36';
const FAC_SELF_SERVE_LABEL = 'Self-serve product investment';

const OPT_ENTERPRISE = 'ba9895d6';
const OPT_ENTERPRISE_LABEL = 'move upmarket to enterprise banks';
const FAC_ENTERPRISE = '7abdf56c';
const FAC_ENTERPRISE_LABEL = 'Enterprise sales investment';

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

/**
 * The readiness payload's blocker list, in the `code` spelling the witnessed
 * capture carries. `deriveMissingEffectPairs` reads BOTH spellings; a case
 * below pins the other one so this module cannot become sensitive to which
 * projection it was handed.
 */
function witnessedReadiness(): { blockers: unknown[] } {
  return {
    blockers: [
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
        factor_id: FAC_ENTERPRISE,
        factor_label: FAC_ENTERPRISE_LABEL,
      },
      {
        code: 'MISSING_OPTION_VALUE',
        option_id: OPT_ACQUIRE,
        option_label: OPT_ACQUIRE_LABEL,
        factor_id: FAC_ACQUIRE,
        factor_label: FAC_ACQUIRE_LABEL,
      },
      // Full-identity is REQUIRED: this one names no option and must never
      // become a candidate (it is a blocker this module cannot name).
      {
        code: 'MISSING_OPTION_VALUE',
        factor_id: 'e7aa3a5d',
        factor_label: 'Cash runway',
      },
    ],
  };
}

const WITNESSED_A = 'I would say it drives self-serve product investment fairly strongly, about 0.6.';
const WITNESSED_B = 'Set its effect on Enterprise sales investment to 0.7';

describe('DEFECT A — an adjust_edge_strength proposal on the pair the product is asking about', () => {
  it('⭐ THE WITNESSED OFFER: the edge 15637f46→0ebfde36 IS the outstanding pair, so the write is refused', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });

    expect(hit).not.toBeNull();
    // Bound by IDENTITY to the pair the blocker named — not to "a pair".
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_SELF_SERVE}::${FAC_SELF_SERVE}`,
    ]);
    expect(hit?.refusedField).toBe('edge_strength');
  });

  it('accepts the ASCII arrow spelling, because the handler’s own parser does', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}->${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit?.pairs).toHaveLength(1);
  });

  it('⭐ OPPOSITE DIRECTION — an edge that is NOT an outstanding pair still writes', () => {
    // A factor → outcome link. Nothing is outstanding on it, so the proposal
    // must pass through untouched.
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${FAC_SELF_SERVE}→out_arr_growth`,
      message: 'Weaken that link to 0.3.',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — the SAME endpoints in the reverse order are a different edge and still write', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${FAC_SELF_SERVE}→${OPT_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('⭐⭐ A DIFFERENT OPTION’S LINK INTO AN OUTSTANDING FACTOR IS NOT THIS PAIR — and still writes', () => {
    // ⚠ ADDED AFTER A SURVIVING MUTANT (trap 22 — a corpus that omits a value
    // class cannot certify the code over it). Deleting the `optionId ===
    // parsed.from` half of the match left the whole battery GREEN, because every
    // negative case above also failed the FACTOR half. This is the class where
    // the option half is the ONLY thing standing: `0ebfde36` IS outstanding, but
    // it is outstanding on `15637f46`, not on the acquisition option. Without
    // the conjunct the guard would refuse a perfectly ordinary link edit on a
    // pair the product never asked about.
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_ACQUIRE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('a malformed edge id claims nothing (the handler would refuse it anyway)', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: 'not-an-edge-id',
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('nothing outstanding ⇒ nothing refused (the guard cannot fire on a ready model)', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: { blockers: [] },
    });
    expect(hit).toBeNull();
  });
});

describe('DEFECT B — a set_factor_value proposal on a factor the product is asking an EFFECT value for', () => {
  it('⭐ THE WITNESSED WRITE: effect-framed prose + the outstanding factor 7abdf56c ⇒ refused', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: WITNESSED_B,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });

    expect(hit).not.toBeNull();
    expect(hit?.pairs.map((p) => `${p.optionId}::${p.factorId}`)).toEqual([
      `${OPT_ENTERPRISE}::${FAC_ENTERPRISE}`,
    ]);
    expect(hit?.refusedField).toBe('factor_value');
  });

  it('⭐⭐ OPPOSITE DIRECTION — the SAME factor, the SAME value, WITHOUT effect framing, still writes', () => {
    // This is the load-bearing twin. `Enterprise sales investment` is in the
    // outstanding set, so a guard keyed on the factor ALONE would refuse an
    // ordinary factor-baseline edit forever while the model is blocked.
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: 'Set Enterprise sales investment to 0.7',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — `baseline` framing names the factor’s own value and is never claimed', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: 'Set its effect on the Enterprise sales investment baseline to 0.7',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — a message that NAMES the option already routes to the effect writer, so this guard stands down', () => {
    // `detectConfigureOptionIntent` MATCHES this one (trigger `effect_vocab`),
    // so `labelAnchorWouldDecideTrigger` is null and the collision is not this
    // module's to claim — `resolveOptionEffectWrite` owns it.
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: `Set the ${OPT_ENTERPRISE_LABEL} option's effect on ${FAC_ENTERPRISE_LABEL} to 0.7`,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — a factor with NO outstanding effect ask still writes even when effect-framed', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: 'e7aa3a5d', // Cash runway — a blocker with no option identity
      message: 'Set its effect on Cash runway to 0.7',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });

  it('a question is never claimed — the classifier suppresses question shapes and this module inherits that', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: 'What is its effect on Enterprise sales investment?',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).toBeNull();
  });
});

describe('the user\'s own value rides on the collision — read by the WRITER\'s reader', () => {
  it('an explicit `to 0.7` is carried, so a repair chip can replay the user\'s figure', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: WITNESSED_B,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit?.userValue).toBe(0.7);
  });

  it('⭐ OPPOSITE DIRECTION — a HEDGE carries no value, so nothing is put in the user\'s mouth', () => {
    // "…fairly strongly, about 0.6" is an approximation. `readOptionEffectValue`
    // is anchored on `to <number>` and declines it, and that decline is the
    // product behaviour: ask for the number, never launder the hedge.
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit).not.toBeNull();
    expect(hit?.userValue).toBeNull();
  });

  it('⭐ OPPOSITE DIRECTION — a value outside the 0-1 model scale carries nothing', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: 'Set its effect on Enterprise sales investment to 70',
      optionLabels: OPTION_LABELS,
      readiness: witnessedReadiness(),
    });
    expect(hit?.userValue).toBeNull();
  });
});

describe('the pair set is read from ONE owner, in both of its spellings', () => {
  it('the `blocker_type: "missing_value"` spelling yields the same refusal as `code: "MISSING_OPTION_VALUE"`', () => {
    const byType = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: {
        blockers: [
          {
            blocker_type: 'missing_value',
            option_id: OPT_SELF_SERVE,
            option_label: OPT_SELF_SERVE_LABEL,
            factor_id: FAC_SELF_SERVE,
            factor_label: FAC_SELF_SERVE_LABEL,
          },
        ],
      },
    });
    expect(byType?.pairs).toHaveLength(1);
  });

  it('a blocker of some OTHER code on the same pair is not an effect ask and refuses nothing', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'adjust_edge_strength',
      entityId: `${OPT_SELF_SERVE}→${FAC_SELF_SERVE}`,
      message: WITNESSED_A,
      optionLabels: OPTION_LABELS,
      readiness: {
        blockers: [
          {
            code: 'OPTION_NEEDS_MAPPING',
            option_id: OPT_SELF_SERVE,
            option_label: OPT_SELF_SERVE_LABEL,
            factor_id: FAC_SELF_SERVE,
            factor_label: FAC_SELF_SERVE_LABEL,
          },
        ],
      },
    });
    expect(hit).toBeNull();
  });
});

describe('AMBIGUITY IS THE PRODUCT — two outstanding options on one factor are reported, never chosen between', () => {
  it('returns BOTH candidate pairs so the composer can ask which option is meant', () => {
    const hit = findOutstandingEffectAskCollision({
      handlerId: 'set_factor_value',
      entityId: FAC_ENTERPRISE,
      message: WITNESSED_B,
      optionLabels: OPTION_LABELS,
      readiness: {
        blockers: [
          {
            code: 'MISSING_OPTION_VALUE',
            option_id: OPT_ENTERPRISE,
            option_label: OPT_ENTERPRISE_LABEL,
            factor_id: FAC_ENTERPRISE,
            factor_label: FAC_ENTERPRISE_LABEL,
          },
          {
            code: 'MISSING_OPTION_VALUE',
            option_id: OPT_ACQUIRE,
            option_label: OPT_ACQUIRE_LABEL,
            factor_id: FAC_ENTERPRISE,
            factor_label: FAC_ENTERPRISE_LABEL,
          },
        ],
      },
    });
    expect(hit?.pairs.map((p) => p.optionId)).toEqual([OPT_ENTERPRISE, OPT_ACQUIRE]);
  });
});
