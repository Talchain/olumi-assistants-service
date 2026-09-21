/**
 * THE FREE-TEXT FLIP ANSWER GESTURES AT WHAT IT NAMED. Pillar P1/P3.
 *
 * The capability in one sentence: when a user asks "what would flip this?" in
 * their own words, CEE already answers deterministically and well — and now it
 * also opens the Model-tab section that answer is ABOUT, instead of pointing at
 * nothing.
 *
 * ⭐ WHY THERE WAS NOTHING TO FIX IN THE LADDER (measured 14 Aug 2026, base
 * `8ad6fa6b`). A free-text flip turn MATCHES the advice gate
 * (`advice_class: "what_would_flip_free_text"`, `deterministic: true`,
 * `copy_source: "fragile_edges"`) and the gate SHORT-CIRCUITS the turn: it
 * produces NO handler fact. The whole `ui_directive` ladder is fact-keyed —
 * rows 1-6 dispatch on `fact.fact_type` and row 7 is gated on
 * `facts.length > 0` (`compose.ts:610`) — so with zero facts EVERY row is
 * structurally unreachable. The measured result was `DIRECTIVES=[]`,
 * `BLOCKS=[]`. That is not a bug in row 4 or row 7; it is the ladder never being
 * consulted. So the gesture has to be emitted on the GATE path, which is what
 * `buildGateFlipSectionDirective` does — the same seam, and the same precedent,
 * as the readiness remedy directive.
 *
 * ⚠ WHERE THE EXPECTATIONS COME FROM (trap 13c — a mutant kit measures whether a
 * test can DETECT a change, never whether the EXPECTATION is right). Every
 * expectation below is derived from the PRODUCER's own bytes:
 *   - which subject the answer names — `composeWhatWouldFlip` beat 2, which
 *     writes `describeFragileAssumption(edge)` when a renderable fragile edge
 *     exists and otherwise names `nameableTopDrivers(a)[0]`;
 *   - which drivers may be named at all — `nameableTopDrivers` / DGAI #341,
 *     which omits any driver whose finite magnitude is below the shared
 *     near-zero threshold (0.05, `format/influence-bands.ts`);
 *   - the section vocabulary — `UiDirectiveModelSectionId` at schemas 0.40.0
 *     (`options | factors | relationships | risks | modelcard`).
 *
 * ⭐⭐ THE LOAD-BEARING TEST IS `AGREEMENT`, NOT THE TWO MAPPING ROWS. The defect
 * this row exists to prevent is not "no gesture" — it is a gesture that points
 * somewhere the sentence is not about (CLAUDE.md trap 21: two authorities
 * answering slightly different questions under similar names). The mapping rows
 * would still pass if the section were derived from a SECOND precedence list
 * that drifted from the composer's. `agreement` is the one that would not.
 */
import { describe, expect, it } from 'vitest';

import {
  UiDirectiveBlockSchema,
  type UiDirectiveBlock,
} from '@talchain/schemas/boundary';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
  type AdviceGateMatched,
} from '../post-analysis-advice-gate.js';
import { buildGateFlipSectionDirective } from '../../compose/ui-directive.js';
import { composeDirectAnswerResponse } from '../../compose.js';
import { sanitiseOlumiResponseForEgress } from '../../compose/output-safety.js';

// ===========================================================================
// Fixtures — shaped as the gate's OWN input contract (`AdviceGateAnalysis`),
// each clearing `CLASS_REQUIREMENTS` for `what_would_flip_free_text`
// (`needs_leading_option` + `needs_top_driver`). A fixture that did not clear
// them would fall through with `data_unavailable_for_class` and certify
// nothing — the failure mode a predecessor probe hit on this exact class.
// ===========================================================================

/** A renderable fragile edge exists → beat 2 names the LINK. */
const ANALYSIS_FRAGILE_EDGE: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [{ factor_label: 'Delivery risk' }],
  fragile_edges: [{ from_label: 'Delivery risk', to_label: 'Successful launch' }],
};

/** No renderable fragile edge → beat 2 falls back to the most influential FACTOR. */
const ANALYSIS_DRIVER_ONLY: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [{ factor_label: 'Cost overrun risk', sensitivity_value: 0.42 }],
  fragile_edges: [],
};

/**
 * DGAI #341 boundary. `top_drivers[0]` has a non-empty label, so the CLASS still
 * MATCHES — but its magnitude is below the near-zero threshold, so
 * `nameableTopDrivers` omits it and beat 2 writes NO sentence. The honest
 * gesture is therefore NO gesture.
 */
const ANALYSIS_IMMATERIAL_DRIVER: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally' },
  runner_up: { label: 'Hire one senior engineer overseas' },
  top_drivers: [{ factor_label: 'Office plant budget', sensitivity_value: 0.01 }],
  fragile_edges: [],
};

// Canonical overnight acceptance phrase. This demonstrative form was the
// independent review's discriminator: the older grammar admitted "the result"
// but fell through `no_advice_signal` on "this result".
const FLIP_QUESTION = 'What would change this result?';

function askFlip(analysis: AdviceGateAnalysis): AdviceGateMatched {
  const out = tryPostAnalysisAdviceGate({
    message: FLIP_QUESTION,
    analysis,
    freshness: 'fresh',
  });
  // Assert the PRECONDITION in-test (trap 13b): every expectation below is only
  // meaningful if the gate actually matched this class. A fixture that silently
  // stopped matching would otherwise make these rows pass by testing nothing.
  expect(out.matched).toBe(true);
  const matched = out as AdviceGateMatched;
  expect(matched.advice_class).toBe('what_would_flip_free_text');
  return matched;
}

describe('advice gate — the free-text flip answer gestures at what it named', () => {
  describe('the gesture tracks the subject the sentence names', () => {
    it('a named fragile LINK opens relationships — and the sentence names that same link', () => {
      const matched = askFlip(ANALYSIS_FRAGILE_EDGE);

      expect(matched.flip_focus_section).toBe('relationships');
      // Bound by IDENTITY (the exact endpoint labels of the exact selected row),
      // never by a predicate another edge could satisfy (trap 19).
      expect(matched.assistant_text).toContain(
        "the link from 'Delivery risk' to 'Successful launch'",
      );
    });

    it('no renderable fragile edge opens factors — and the sentence names that same factor', () => {
      const matched = askFlip(ANALYSIS_DRIVER_ONLY);

      expect(matched.flip_focus_section).toBe('factors');
      expect(matched.assistant_text).toContain(
        "The factor with the most influence on the result is 'Cost overrun risk'.",
      );
    });

    it('an immaterial-only driver names nothing and gestures at nothing (DGAI #341)', () => {
      const matched = askFlip(ANALYSIS_IMMATERIAL_DRIVER);

      // ABSENCE, not `undefined` — the gate uses a conditional spread and callers
      // distinguish "no gesture" by the key being absent.
      expect('flip_focus_section' in matched).toBe(false);
      // And the prose agrees: no beat-2 sentence naming it.
      expect(matched.assistant_text).not.toContain('Office plant budget');
      // The answer still ships. The gesture is additive, never a precondition.
      expect(matched.assistant_text.length).toBeGreaterThan(0);
    });
  });

  describe('discrimination', () => {
    /**
     * ⭐ THE DISCRIMINATING TWIN. Same analysis, same fragile edge, same gate — a
     * question that is NOT the flip question. The gesture must not appear.
     *
     * Without this row, a mutant that emitted the section for EVERY matched class
     * would pass every mapping row above. This is what proves the emission is
     * bound to the flip class rather than merely correlated with it.
     */
    it('a non-flip free-text turn on the SAME analysis carries no gesture', () => {
      const out = tryPostAnalysisAdviceGate({
        message: 'Explain the results.',
        analysis: ANALYSIS_FRAGILE_EDGE,
        freshness: 'fresh',
      });
      expect(out.matched).toBe(true);
      const matched = out as AdviceGateMatched;
      // Precondition pinned: this really is a DIFFERENT class on the same input.
      expect(matched.advice_class).toBe('explain_results_free_text');
      expect('flip_focus_section' in matched).toBe(false);
    });

    it('an unmatched turn cannot carry a gesture at all', () => {
      const out = tryPostAnalysisAdviceGate({
        message: FLIP_QUESTION,
        analysis: ANALYSIS_FRAGILE_EDGE,
        // Stale analysis → the gate must yield control entirely.
        freshness: 'stale',
      });
      expect(out.matched).toBe(false);
      expect('flip_focus_section' in out).toBe(false);
    });
  });

  /**
   * ⭐⭐ THE INVARIANT THE ROW EXISTS FOR. Written against the SPEC ("the section
   * is the surface of the subject the sentence names"), not against the failure
   * mode in hand (trap 13d) — so a future change that keeps both mapping rows
   * green while introducing a second precedence list still REDs here.
   */
  describe('agreement — the sentence and the gesture cannot disagree', () => {
    const CORPUS: ReadonlyArray<{
      readonly label: string;
      readonly analysis: AdviceGateAnalysis;
    }> = [
      { label: 'fragile edge present', analysis: ANALYSIS_FRAGILE_EDGE },
      { label: 'driver only', analysis: ANALYSIS_DRIVER_ONLY },
      { label: 'immaterial driver only', analysis: ANALYSIS_IMMATERIAL_DRIVER },
      {
        label: 'fragile edge AND a material driver — the edge must win, both ways',
        analysis: {
          status: 'success',
          leading_option: { label: 'Ship in Q3' },
          runner_up: { label: 'Ship in Q4' },
          top_drivers: [{ factor_label: 'Engineering capacity', sensitivity_value: 0.8 }],
          fragile_edges: [{ from_label: 'Engineering capacity', to_label: 'Launch date' }],
        },
      },
      {
        label: 'blank-labelled fragile edge is not renderable — falls back to the factor',
        analysis: {
          status: 'success',
          leading_option: { label: 'Ship in Q3' },
          runner_up: { label: 'Ship in Q4' },
          top_drivers: [{ factor_label: 'Engineering capacity', sensitivity_value: 0.8 }],
          fragile_edges: [{ from_label: '   ', to_label: 'Launch date' }],
        },
      },
    ];

    it.each(CORPUS)('$label', ({ analysis }) => {
      const matched = askFlip(analysis);
      const section = matched.flip_focus_section;

      if (section === 'relationships') {
        const edge = analysis.fragile_edges!.find(
          (e) => e.from_label.trim().length > 0 && e.to_label.trim().length > 0,
        )!;
        expect(matched.assistant_text).toContain(
          `the link from '${edge.from_label}' to '${edge.to_label}'`,
        );
      } else if (section === 'factors') {
        const driver = analysis.top_drivers.find(
          (d) => d.sensitivity_value === undefined || Math.abs(d.sensitivity_value) >= 0.05,
        )!;
        expect(matched.assistant_text).toContain(
          `The factor with the most influence on the result is '${driver.factor_label}'.`,
        );
        // …and it did NOT quietly name a link while pointing at the factor list.
        expect(matched.assistant_text).not.toContain('the link from');
      } else {
        // No gesture ⇒ the answer named no subject in beat 2 either.
        expect(matched.assistant_text).not.toContain('the link from');
        expect(matched.assistant_text).not.toContain(
          'The factor with the most influence on the result is',
        );
      }
    });
  });

  describe('the directive the gesture ships as', () => {
    it.each(['relationships', 'factors'] as const)(
      '%s → a strict-valid, gate-stamped open_section directive',
      (section) => {
        const block = buildGateFlipSectionDirective(section);
        expect(block).not.toBeNull();
        const directive = block as UiDirectiveBlock;

        expect(directive.verb).toBe('open_section');
        expect(directive.ui_target).toEqual({ kind: 'model_section', id: section });
        // `source: 'gate'` is what lets a capture tell a gesture that followed an
        // ENQUIRY from one that followed an ACTION. Several dashboards bind on it.
        expect(directive.source).toBe('gate');
        // Opening a section is not a graph mutation: no node targets.
        expect(directive.targets).toEqual([]);
        expect(UiDirectiveBlockSchema.safeParse(directive).success).toBe(true);
      },
    );
  });

  /**
   * The acceptance test for the whole row: gate → section → directive → composed
   * response → egress, with nothing hand-fed in the middle. This mirrors exactly
   * what the turn-executor's advice-gate arm does with the readiness remedy
   * directive, so a change that neuters the emission REDs here rather than only
   * in a unit row.
   */
  it('END TO END — a natural "what would change this result?" ships an answer AND the section it is about', () => {
    const matched = askFlip(ANALYSIS_FRAGILE_EDGE);
    expect(matched.flip_focus_section).toBeDefined();

    const directive = buildGateFlipSectionDirective(matched.flip_focus_section!);
    expect(directive).not.toBeNull();

    const response = composeDirectAnswerResponse({
      assistant_text: matched.assistant_text,
      stage: 'analyse',
      answerKind: 'substantive',
      blocks: [directive as UiDirectiveBlock],
    } as unknown as Parameters<typeof composeDirectAnswerResponse>[0]);

    const egressed = sanitiseOlumiResponseForEgress(response, {
      graph: null,
      requestId: 'req-gate-flip',
      exitPath: 'test',
      userMessage: FLIP_QUESTION,
      mayNameLeadingOption: true,
    });

    const directives = egressed.blocks.filter(
      (b): b is UiDirectiveBlock => b.type === 'ui_directive',
    );
    expect(directives).toHaveLength(1);
    expect(directives[0].verb).toBe('open_section');
    expect(directives[0].ui_target).toEqual({
      kind: 'model_section',
      id: 'relationships',
    });
    expect(directives[0].source).toBe('gate');
    // The user still gets the reasoning, in words — the gesture never replaces it.
    expect(egressed.assistant_text).toContain(
      "the link from 'Delivery risk' to 'Successful launch'",
    );
  });
});
