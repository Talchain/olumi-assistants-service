/**
 * ROADMAP 2.384 — THE WRITE SURFACE REFUSES THE VOCABULARY THE READ SURFACE TEACHES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (deployed build, 2026-08-26)
 *
 *   user    : "Set the UK inside-sales headcount expansion factor to high."
 *   product : "I couldn't use that as the value. Tell me the number you want
 *              and I'll set it."                            (nothing changed)
 *   the SAME product's read surface, same screen : "Moderate (0.5)"
 *   the SAME payload's readiness blocker         : 'Factor "…" is currently
 *              Moderate (0.5). What should option X set it to?'
 *
 * The product shows a band, asks its question in bands, and rejects a band.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE SYMPTOM (trap 13d)
 *
 * **A refusal of a qualitative value quotes the user's own word, states what
 * the factor holds now in the factor's own display authority, and asks for a
 * number.** Not "must contain the string high" — that is the failure mode in
 * hand. The spec form covers "moderate", "quite low", any word at all, because
 * the reading is SHAPE-based (`QUALITATIVE_ANSWER_PATTERN`) and never a word
 * list — a word list would be the hand-maintained mirror of trap 12.
 *
 * ⛔ AND THE NEGATIVE HALF OF THE SPEC, which is the more important half:
 * **the word is never mapped to a number.** "high" resolves to THREE different
 * numbers across the estate's six band ladders (CEE `qualitativeBand` 0.625,
 * UI `qualitativeTierLabel` 0.7, UI `FactorExternalPanel` 0.8), so mapping is a
 * choice among three, stamped `user_set`. Asserted directly below.
 *
 * BINDING IS BY IDENTITY (trap 19): the anchor is asserted for the factor whose
 * `target_id` the error carries. `fac_other` carries a DIFFERENT display string
 * and is deliberately never quoted, so a mutation that resolves "the first
 * factor" instead of "the named factor" turns this suite RED while a mutation
 * scoped to `fac_other` alone leaves it GREEN.
 */

import { describe, it, expect } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import { composeRecoverableValidationResponse } from '../recoverable-validation-response.js';
import { buildQualitativeValueRefusalText } from '../parameter-user-phrasing.js';
import { readMissingValueAnswer } from '../../routing/missing-value-answer.js';
import type { ComposeContext } from '../types.js';
import type {
  FactorObservedStateSnapshot,
  GraphLookup,
  HandlerValidationRegistry,
  ValidationError,
} from '../../routing/validator.js';

const TARGET_ID = 'fac_uk_inside_sales';
const OTHER_ID = 'fac_other';

/** The witnessed sentence, verbatim. */
const WITNESSED_MESSAGE = 'Set the UK inside-sales headcount expansion factor to high.';
/** The witnessed read-surface string, verbatim. */
const WITNESSED_DISPLAY = 'Moderate (0.5)';
const TARGET_LABEL = 'UK inside-sales headcount expansion';

const NODES: Record<string, { label: string; snapshot: FactorObservedStateSnapshot }> = {
  [TARGET_ID]: {
    label: TARGET_LABEL,
    snapshot: { value: 0.5, display_value: WITNESSED_DISPLAY },
  },
  // ⭐ THE DISCRIMINATING TWIN. Never asserted. Its presence is what makes
  // "resolve the named factor" distinguishable from "resolve a factor".
  [OTHER_ID]: {
    label: 'Leeds lease cost',
    snapshot: { value: 0.8, display_value: 'Very high (0.8)' },
  },
};

function graphWith(ids: readonly string[]): GraphLookup {
  return {
    findEntityById(id: string) {
      const n = NODES[id];
      return ids.includes(id) && n ? { id, kind: 'node' as const, label: n.label } : null;
    },
    listEntitiesByKind() {
      return ids.flatMap(id => {
        const n = NODES[id];
        return n ? [{ id, label: n.label }] : [];
      });
    },
    findFactorObservedState(id: string) {
      const n = NODES[id];
      return ids.includes(id) && n ? n.snapshot : null;
    },
  };
}

const REGISTRY: HandlerValidationRegistry = {};

function ctxWith(message: string | undefined, graph?: GraphLookup): ComposeContext {
  return {
    handlerRegistry: REGISTRY,
    ...(graph !== undefined ? { graph } : {}),
    ...(message !== undefined ? { userMessage: message } : {}),
  };
}

/**
 * The error the VALIDATOR actually raises, transcribed from
 * `routing/validator.ts` — `parameter` / `issue` / `actual_value` /
 * `constraint_description` / `target_id`.
 *
 * ⚠ `actual_value` is the STRUCTURED shape, not a bare string, and that is
 * deliberate: on the witnessed turn no "You gave …" clause appeared, which
 * (given `echo_actual: true` for `value` and `isGenuineScalar` admitting a
 * non-empty string) proves the slot did NOT hold a bare word. Building the
 * fixture the other way would let a proposal-shaped implementation pass.
 */
function paramInvalid(overrides: Partial<Record<string, unknown>> = {}): ValidationError {
  return {
    code: 'PARAMETER_INVALID',
    message: 'Parameter "value" failed schema: Expected number, received string',
    details: {
      parameter: 'value',
      issue: 'Expected number, received string',
      actual_value: { value: 'high' },
      constraint_description: 'a valid value',
      target_id: TARGET_ID,
      ...overrides,
    },
  };
}

const EM_DASH = /[—–]/;
function countSentences(text: string): number {
  return (text.match(/[.!?](?=\s|$)/g) ?? []).length;
}
function assertStyle(text: string): void {
  expect(text).not.toMatch(EM_DASH);
  expect(countSentences(text)).toBeLessThanOrEqual(3);
}

// ---------------------------------------------------------------------------
// The reading — SHAPE-based, with both controls discriminating IN-SPEC.
// A probe whose positive and negative arms agree is a probe that is not
// discriminating (trap 20). These arms must disagree.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — the qualitative reading discriminates', () => {
  it('reads the witnessed band sentence as QUALITATIVE, term "high"', () => {
    const answer = readMissingValueAnswer(WITNESSED_MESSAGE);
    expect(answer).not.toBeNull();
    expect(answer?.kind).toBe('qualitative');
    expect(answer?.kind === 'qualitative' ? answer.term : null).toBe('high');
  });

  it('reads any band word, not a listed one — "moderate" too', () => {
    const answer = readMissingValueAnswer('Set the expansion factor to moderate.');
    expect(answer?.kind).toBe('qualitative');
  });

  it('NEGATIVE CONTROL — the numeric path is NOT qualitative', () => {
    const answer = readMissingValueAnswer(
      'Set the UK inside-sales headcount expansion factor to 0.83.',
    );
    expect(answer?.kind).not.toBe('qualitative');
  });

  it('NEGATIVE CONTROL — a question is not an answer', () => {
    expect(readMissingValueAnswer('What should I set the expansion factor to?')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The refusal itself.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — a band-valued factor edit is refused truthfully', () => {
  it('quotes the user word, names the factor, and states its CURRENT display string', () => {
    const { response, template_id } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_qualitative_value');
    // the user's own word, quoted back
    expect(response.assistant_text).toContain('"high"');
    // the factor, BY IDENTITY
    expect(response.assistant_text).toContain(TARGET_LABEL);
    // the anchor, in the product's own display authority
    expect(response.assistant_text).toContain(WITNESSED_DISPLAY);
    // and it still asks for the one outstanding thing
    expect(response.assistant_text).toContain("Tell me the number you want and I'll set it.");
    assertStyle(response.assistant_text);
  });

  it('⛔ NEVER maps the band to a number — no ladder value reaches the user', () => {
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    // The three numbers "high" resolves to across the estate's ladders.
    for (const fabricated of ['0.625', '0.7', '0.8']) {
      expect(response.assistant_text).not.toContain(fabricated);
    }
    // and no chip may carry one either (THE FABRICATION BOUNDARY)
    for (const action of response.suggested_actions) {
      expect(action.message).not.toMatch(/\d/);
    }
  });

  it('⭐ BINDS BY IDENTITY — never quotes a DIFFERENT factor\'s state', () => {
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    expect(response.assistant_text).not.toContain('Very high (0.8)');
    expect(response.assistant_text).not.toContain('Leeds lease cost');
  });

  it('does not repeat the witnessed bare demand', () => {
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID])),
      'frame',
    );
    expect(response.assistant_text).not.toBe(
      "I couldn't use that as the value. Tell me the number you want and I'll set it.",
    );
  });
});

// ---------------------------------------------------------------------------
// Graceful degrade — better to lose the anchor than to invent one.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — the anchor degrades, it is never synthesised', () => {
  it('no graph: still quotes the word, states no value', () => {
    const { response, template_id } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_qualitative_value');
    expect(response.assistant_text).toContain('"high"');
    expect(response.assistant_text).not.toContain('just now');
    expect(response.assistant_text).not.toContain('0.5');
    assertStyle(response.assistant_text);
  });

  it('graph present but the factor carries NO display_value: no band is derived', () => {
    const bare: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: TARGET_LABEL }),
      listEntitiesByKind: () => [],
      // value present, display_value absent — the exact input from which a
      // re-derivation would produce "Moderate (0.5)". It must not.
      findFactorObservedState: () => ({ value: 0.5 }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, bare),
      'frame',
    );
    expect(response.assistant_text).not.toContain('Moderate');
    expect(response.assistant_text).not.toContain('0.5');
    expect(response.assistant_text).toContain('"high"');
  });

  it('no target_id: no anchor, and no other factor is substituted for it', () => {
    const { response } = composeValidationFailure(
      paramInvalid({ target_id: undefined }),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    expect(response.assistant_text).not.toContain(WITNESSED_DISPLAY);
    expect(response.assistant_text).not.toContain('Very high (0.8)');
    expect(response.assistant_text).toContain('"high"');
  });

  it('builder: label without display (and vice versa) yields NEITHER half', () => {
    const noDisplay = buildQualitativeValueRefusalText({
      term: 'high',
      factorLabel: TARGET_LABEL,
      currentDisplay: null,
    });
    expect(noDisplay).not.toContain(TARGET_LABEL);
    const noLabel = buildQualitativeValueRefusalText({
      term: 'high',
      factorLabel: null,
      currentDisplay: WITNESSED_DISPLAY,
    });
    expect(noLabel).not.toContain(WITNESSED_DISPLAY);
  });
});

// ---------------------------------------------------------------------------
// THE GREEN HALF OF THE MUTANT PAIR. These must stay GREEN under a mutation
// scoped to the qualitative branch — otherwise the branch is not bound to the
// case it claims and is silently rewriting neighbouring refusals.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — neighbouring refusals are untouched', () => {
  it('a NUMERIC out-of-range value keeps the historical copy', () => {
    const { response, template_id } = composeValidationFailure(
      paramInvalid({ actual_value: 1.5 }),
      ctxWith('Set the UK inside-sales headcount expansion factor to 1.5.', graphWith([TARGET_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toBe(
      "I couldn't use that as the value. You gave 1.5. Tell me the number you want and I'll set it.",
    );
  });

  it('a DIFFERENT parameter (strength) is never band-handled, even on a band message', () => {
    const { response, template_id } = composeValidationFailure(
      {
        code: 'PARAMETER_INVALID',
        message: 'Parameter "strength" failed schema',
        details: {
          parameter: 'strength',
          issue: 'Expected number, received string',
          // ⚠ PRESENT DELIBERATELY, AND THE OMISSION WAS A REAL FIXTURE DEFECT
          // caught by this suite's first run: without it the error diverts to
          // the `parameter_invalid_issue` branch (`constraint_description ===
          // undefined && issue !== undefined`) and never reaches the parameter
          // phrasing at all — so the test would have "passed" the strength case
          // by exercising a different branch entirely. The VALIDATOR always
          // sets both fields (`routing/validator.ts`: `issue` +
          // `constraint_description: describeSchema(schema)`), so a fixture
          // omitting it is not a shape the live wire produces.
          constraint_description: 'a valid strength',
          actual_value: { value: 'high' },
          target_id: TARGET_ID,
        },
      },
      ctxWith('Set the link from A to B to high.', graphWith([TARGET_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toContain("I couldn't use that as the strength of that link.");
    // ⭐ AND IT STILL DOES NOT SUGGEST WORDS. 2.384's own standing rule: the
    // adjective→number path does not exist for strengths either.
    expect(response.assistant_text).not.toContain('"high"');
  });

  it('a system-event path with no userMessage keeps the historical copy', () => {
    const { template_id } = composeValidationFailure(
      paramInvalid({ actual_value: 1.5 }),
      ctxWith(undefined, graphWith([TARGET_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid');
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ THE REACHABILITY PIN — the half that goes dark if nobody asserts it.
//
// `composeValidationFailure` (asserted above) is the turn-executor's
// IMPOSSIBLE-STATE 500 SAFETY NET (`turn-executor.ts:9214`). The path a real
// user takes is the RECOVERABLE 200 one: PARAMETER_INVALID is one of the seven
// codes that "recover as 200 + coaching" via
// `composeRecoverableValidationResponse` (`turn-executor.ts:9181`).
//
// Both call the same `composeBody`, and the turn-executor hands BOTH the same
// `composeCtx` — built at `turn-executor.ts:9138-9146` with `graph:
// graphLookupForValidate` AND `userMessage: payload.message`. So the branch is
// live. But "they share a helper today" is a fact about this tip, not a
// guarantee: a suite that only ever drives the 500 net would stay green while
// the 200 path stopped carrying the copy, and the user only ever sees the 200.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — reachable on the RECOVERABLE 200 path, not just the 500 net', () => {
  it('the recoverable composer emits the same band-aware refusal', () => {
    const { response, template_id } = composeRecoverableValidationResponse(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_qualitative_value');
    expect(response.assistant_text).toContain('"high"');
    expect(response.assistant_text).toContain(TARGET_LABEL);
    expect(response.assistant_text).toContain(WITNESSED_DISPLAY);
    // and the 200 envelope's own contract still holds
    expect(response.blocks).toEqual([]);
    expect(response.suggested_actions.length).toBeGreaterThan(0);
  });

  it('the two entry points agree, so neither can drift dark unnoticed', () => {
    const ctx = ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID]));
    const net = composeValidationFailure(paramInvalid(), ctx, 'frame');
    const live = composeRecoverableValidationResponse(paramInvalid(), ctx, 'frame');
    expect(live.response.assistant_text).toBe(net.response.assistant_text);
    expect(live.template_id).toBe(net.template_id);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ GATE 1 — THE CLAIM THIS PR WAS APPROVED ON WAS REFUTED, AND THIS IS THE PIN.
//
// "The reply quotes the same field the blocker quotes, so the two cannot
// diverge" is FALSE as stated. The blocker's rung 1 (`analysis-ready.ts:485`)
// requires THREE things, not one: the field, that it is NOT a label echo, and
// that it is reached at all — which happens only when the quoted level came
// from `observed_state` (`:829`). Reading the same FIELD past both conditions
// is not the same READ.
//
// ⚠ THE ORIGINAL CORPUS EXCLUDED THIS ENTIRE CLASS, so the suite was green
// WITH AND WITHOUT the remedy — the shape every defect this estate has paid for
// takes. A remedy whose absence the suite cannot detect is not pinned, so each
// case below names the conjunct it kills and must RED if that conjunct is
// removed.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — the anchor obeys BOTH of the blocker\'s conditions', () => {
  const ECHO_LABEL = 'CRM Annual Licence Cost';

  it('CONJUNCT 1 (isLabelEcho): never quotes the label back as its own value', () => {
    const echoGraph: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: ECHO_LABEL }),
      listEntitiesByKind: () => [{ id: TARGET_ID, label: ECHO_LABEL }],
      // The witnessed shape: a display string that IS the label.
      findFactorObservedState: () => ({ value: 0.5, display_value: ECHO_LABEL }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, echoGraph),
      'frame',
    );
    // the exact sentence measured on the first version of this branch
    expect(response.assistant_text).not.toContain(`is ${ECHO_LABEL} just now`);
    expect(response.assistant_text).not.toContain('just now');
    // and it still does its job
    expect(response.assistant_text).toContain('"high"');
    assertStyle(response.assistant_text);
  });

  it('CONJUNCT 1 catches a display string that CONTAINS the label, not just equals it', () => {
    // ⚠ ADDED AFTER A MUTANT CAUGHT THE GAP: weakening `isLabelEcho` to
    // `lowered === factorLabelLower` SURVIVED the first version of this suite,
    // because the only echo case here was an EXACT match. The realistic shape
    // is the enricher appending to the label — `"CRM Annual Licence Cost
    // (0.5)"` — which equality-only lets straight through, putting the label
    // back in front of the user with a number stapled on. The `includes` half
    // of the predicate is the half that does the work, and it was unpinned.
    const echoGraph: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: ECHO_LABEL }),
      listEntitiesByKind: () => [{ id: TARGET_ID, label: ECHO_LABEL }],
      findFactorObservedState: () => ({ value: 0.5, display_value: `${ECHO_LABEL} (0.5)` }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, echoGraph),
      'frame',
    );
    expect(response.assistant_text).not.toContain(ECHO_LABEL);
    expect(response.assistant_text).not.toContain('just now');
    expect(response.assistant_text).toContain('"high"');
  });

  it('CONJUNCT 1 still ADMITS a band whose text merely sits inside the label', () => {
    // "High (0.7)" for a factor labelled "High Risk" is NOT an echo — the rule
    // strips only when the candidate contains the LABEL, never the reverse.
    // Pinned because the cheap over-broad fix (either string containing the
    // other) would silently delete every legitimate band on such a factor.
    const riskGraph: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: 'High Risk' }),
      listEntitiesByKind: () => [{ id: TARGET_ID, label: 'High Risk' }],
      findFactorObservedState: () => ({ value: 0.7, display_value: 'High (0.7)' }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, riskGraph),
      'frame',
    );
    expect(response.assistant_text).toContain('High (0.7)');
    expect(response.assistant_text).toContain('just now');
  });

  it('CONJUNCT 1 is NOT symmetric — a label CONTAINING the display is not an echo', () => {
    // ⚠ ADDED AFTER A MUTANT CAUGHT THE GAP: making `isLabelEcho` symmetric
    // (either string containing the other) SURVIVED the suite, even though the
    // predicate's own header names this exact hazard — "never when the label
    // contains the candidate, which would discard valid qualitative band
    // output". A documented hazard with no test is not guarded.
    //
    // Label "High Risk", display "High": the candidate does NOT contain the
    // label, so it is a legitimate band and must survive. The symmetric
    // version would strip it and silently delete the anchor on every factor
    // whose label happens to start with a band word.
    const bandInsideLabel: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: 'High Risk' }),
      listEntitiesByKind: () => [{ id: TARGET_ID, label: 'High Risk' }],
      findFactorObservedState: () => ({ value: 0.7, display_value: 'High' }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, bandInsideLabel),
      'frame',
    );
    expect(response.assistant_text).toContain('is High just now');
  });

  it('CONJUNCT 2 (levelCameFromObservedState): declines when there is no observed value', () => {
    // {raw_value, display_value} but NO observed `value`. The blocker returns
    // the bare level here; the first version of this branch quoted "50,000",
    // i.e. the two surfaces disagreed — the exact divergence this PR promised
    // could not happen.
    const rawOnly: GraphLookup = {
      findEntityById: () => ({ id: TARGET_ID, kind: 'node', label: TARGET_LABEL }),
      listEntitiesByKind: () => [{ id: TARGET_ID, label: TARGET_LABEL }],
      findFactorObservedState: () => ({ raw_value: 50000, display_value: '50,000' }),
    };
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, rawOnly),
      'frame',
    );
    expect(response.assistant_text).not.toContain('50,000');
    expect(response.assistant_text).not.toContain('just now');
    expect(response.assistant_text).toContain('"high"');
  });

  it('⭐ the ordinary case is UNCHANGED by both conjuncts', () => {
    const { response } = composeValidationFailure(
      paramInvalid(),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID, OTHER_ID])),
      'frame',
    );
    expect(response.assistant_text).toContain(WITNESSED_DISPLAY);
    expect(response.assistant_text).toContain(TARGET_LABEL);
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐ GATE 2 — THE LOAD-BEARING CHOICE, PINNED BY A TEST RATHER THAN A COMMENT.
//
// Reading the USER'S MESSAGE rather than the PROPOSAL is the deliberate choice
// this branch rests on, made because the wire question could not be settled:
// the witness showed NO "You gave …" clause, so whatever the router put in
// `value` was not a bare scalar string, and a proposal-shaped guard would break
// the first time the router wrapped the word differently.
//
// ⚠ REVIEW MEASURED THAT THE CHOICE WAS UNENFORCED. A mutant reading
// `actual_value.value` SURVIVED the whole suite — because every fixture made
// the two sources carry the SAME word, so no test could tell them apart. The
// reasoning was in a comment and nothing else, and a comment does not fail.
//
// Every fixture below makes the message and the proposal DISAGREE, so the
// quoted word names its own source. That is what stops a later lane
// "simplifying" this to read the proposal.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.384 — the quoted word comes from the MESSAGE, provably', () => {
  it('structured-inner proposal disagrees with the message: the MESSAGE wins', () => {
    const { response } = composeValidationFailure(
      // the router's own re-wording, NOT what the user typed
      paramInvalid({ actual_value: { value: 'elevated' } }),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID])),
      'frame',
    );
    expect(response.assistant_text).toContain('"high"');
    expect(response.assistant_text).not.toContain('elevated');
  });

  it('BARE-STRING proposal disagrees with the message: the MESSAGE still wins', () => {
    const { response } = composeValidationFailure(
      paramInvalid({ actual_value: 'elevated' }),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID])),
      'frame',
    );
    expect(response.assistant_text).toContain('"high"');
    expect(response.assistant_text).not.toContain('elevated');
  });

  it('the proposal carries NO usable word at all and the branch still fires', () => {
    // The witnessed shape, as far as it could be established: no "You gave …"
    // clause appeared, so `actual_value` was not a bare scalar string. A
    // proposal-shaped guard has nothing to read here; the message does.
    const { response, template_id } = composeValidationFailure(
      paramInvalid({ actual_value: { magnitude: 0.2, effects: ['cost'] } }),
      ctxWith(WITNESSED_MESSAGE, graphWith([TARGET_ID])),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_qualitative_value');
    expect(response.assistant_text).toContain('"high"');
  });

  it('a band in the PROPOSAL but not the MESSAGE does NOT trigger the branch', () => {
    // The opposite direction, and the one that matters for honesty: the router
    // inventing a word the user never said must not put that word in quotes as
    // though they had. Only the user's own sentence can.
    const { response, template_id } = composeValidationFailure(
      paramInvalid({ actual_value: { value: 'high' } }),
      ctxWith('Make it 1.5.', graphWith([TARGET_ID])),
      'frame',
    );
    expect(template_id).not.toBe('parameter_invalid_qualitative_value');
    expect(response.assistant_text).not.toContain('"high"');
  });
});

// ---------------------------------------------------------------------------
// ⭐⭐⭐ GATE 3 — PREDICATE BREADTH, PINNED AS DATA. NOT ANSWERED WITH ANOTHER RULE.
//
// `QUALITATIVE_ANSWER_PATTERN` is shape-based ("<verb> … to <words>") and by
// design carries NO word list — a list would be the hand-maintained mirror of
// trap 12. The cost of that choice is breadth, and review measured it: over an
// independent corpus the predicate fires on messages where the tail after "to"
// is NOT a band offered as a value, so the product quotes e.g. "sarah" back as
// though it had understood it — the SAME honesty class as the defect this
// branch fixes.
//
// ⛔ THE EXIT IS NOT A FIFTH RULE. This estate burned FOUR consecutive rounds on
// one natural-language predicate (CEE #888), each round fixing one direction and
// re-opening the other, and a reviewer proved round five oscillated too. The
// ruling (trap 22f) is: where direction cannot be determined, make the AMBIGUITY
// explicit rather than guess — and pin the known gap as data, in BOTH
// directions, so the suite REDs if the set GROWS or SHRINKS.
//
// Re-measured independently at this tip rather than inherited from the review:
// 14 of these 23 fire; 6 are a band genuinely offered as a value and 8 are not.
// (The review's own corpus gave 19/13 — different corpus, same conclusion. The
// numbers are not copied between them, deliberately.)
//
// ⚠ WHAT THIS SET DOES NOT ESTABLISH, stated because it bounds the harm and I
// could not measure it: these are RAW MESSAGES. This branch is reached only
// when a `value` parameter on a `set_factor_value` proposal failed validation,
// and several rows below would never produce that error at all. Bounding the
// over-firing by what the router can actually emit needs a wire capture this
// lane does not have (trap 16-inverse: a predicate's reach is not the system's
// reach). Until that exists the over-firing is REAL and pinned, not excused.
// ---------------------------------------------------------------------------

/** Fires AND is a band genuinely offered as the value — the class this serves. */
const BREADTH_HANDLED: readonly string[] = [
  'Set the UK inside-sales headcount expansion factor to high.',
  'Set it to high.',
  'Change the expansion factor to moderate.',
  'Update the churn factor to low.',
  'Set the factor to quite low.',
  'Put it to about a third.',
];

/**
 * Fires but is NOT a band offered as a value. KNOWN, pinned, and not silently
 * tolerated: each is a message where the tail after "to" names an entity, a
 * date, a unit or a name. Shrinking this set is as much a RED as growing it —
 * a narrowing rule that quietly fixes some of these would also be re-opening
 * the gap direction in the others, which is the oscillation trap 22f names.
 */
const BREADTH_KNOWN_OVER_FIRING: readonly string[] = [
  'Set the headcount to 5 people and change the owner to sarah.',
  'Change the owner to sarah.',
  'Set the deadline to next friday.',
  'Set the goal to launch in europe.',
  'Change the label to marketing spend.',
  'Set the unit to percent.',
  'Change the currency to euros.',
  'Set the option name to plan b.',
];

/**
 * Does NOT fire. Includes two KNOWN FALSE NEGATIVES on the very class this
 * branch serves — "Make it very high." carries no "to", so the shape misses it,
 * and "Rename the factor to headcount growth." is correctly missed for a
 * different reason. Pinned so a later widening cannot claim to have closed a
 * gap it never measured.
 */
const BREADTH_SILENT: readonly string[] = [
  'Make it very high.',
  'Rename the factor to headcount growth.',
  'Move the option to the top.',
  'Switch it to the other option.',
  'Assign the risk to the finance team.',
  'Set the UK inside-sales headcount expansion factor to 0.83.',
  'What should I set the expansion factor to?',
  'Why is it set to moderate?',
  'It seems high to me.',
];

describe('ROADMAP 2.384 — predicate breadth is PINNED, in both directions', () => {
  const fires = (m: string): boolean => readMissingValueAnswer(m)?.kind === 'qualitative';

  it('the corpus is partitioned with no overlap and no omission', () => {
    const all = [...BREADTH_HANDLED, ...BREADTH_KNOWN_OVER_FIRING, ...BREADTH_SILENT];
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(23);
  });

  it('every HANDLED message fires — shrinking this set REDs', () => {
    expect(BREADTH_HANDLED.filter(m => !fires(m))).toEqual([]);
  });

  it('⛔ the KNOWN OVER-FIRING set is EXACTLY these — growing OR shrinking REDs', () => {
    // Written as a set equality, not "every member fires", so a rule that
    // narrowed the predicate would RED here rather than pass quietly.
    expect(BREADTH_KNOWN_OVER_FIRING.filter(m => fires(m)).sort()).toEqual(
      [...BREADTH_KNOWN_OVER_FIRING].sort(),
    );
  });

  it('no SILENT message fires — growing the predicate into these REDs', () => {
    expect(BREADTH_SILENT.filter(m => fires(m))).toEqual([]);
  });

  it('the measured split is 14 firing / 9 silent at this tip', () => {
    const all = [...BREADTH_HANDLED, ...BREADTH_KNOWN_OVER_FIRING, ...BREADTH_SILENT];
    expect(all.filter(fires).length).toBe(14);
    expect(all.filter(m => !fires(m)).length).toBe(9);
  });
});
