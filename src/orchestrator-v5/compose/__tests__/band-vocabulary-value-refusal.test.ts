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
