/**
 * WORDING BATCH (DL principle audit, #87 5992243567; DL ruling on W-HEAD: no "best", no guard change).
 *
 * Every changed sentence that names or ranks an option is a finding about THIS model, in CEE's own lead-clause
 * family ("scored highest"), never a verdict ("still be the best choice", "clearly ahead"). One row per changed
 * sentence binds the exact words; the budget rows prove the worst-case render still fits the contract's max_chars;
 * the guard rows prove the new words stay inside every existing defence without widening any of them.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { POLICY } from '../guidance/policy.js';
import { BODY_BY_RATIONALE } from '../../compose/lens-selector.js';
import { textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { FORBIDDEN_HEADLINE_VOCABULARY_REGEX } from '../../coaching/assistant-text-defences.js';
import { buildAnalysisResultHeadline, isAllowedRunAnalysisAssistantText } from '../../coaching/analysis-result-headline.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import { composeExplainResultsFallback, composeWhatWouldFlipFallback } from '../../tools/handlers/explanation-fallback.js';

type Copy = string | Readonly<Record<string, string>>;
const row = (id: string) => POLICY.rows.find(r => r.policy_id === id)! as unknown as {
  reasoning_question: Copy; short_copy: Copy; why_now: Copy;
};
const pick = (value: Copy, key: string): string => (value as Readonly<Record<string, string>>)[key];

const QUESTION = 'Would {leader_label} still score highest in this model if {factor_label} changed?';
const WHY_NOW = 'In this model, which option scores highest is sensitive to {factor_label}.';
const S2_TITLE = "This model's result turns on {factor_label}, Olumi's estimate.";

/** Worst case per `copy_rules`: every label at its 40-character cut, option labels in two curly quotes. */
function worstCaseLength(template: string): number {
  return template.replace(/\{([a-z_]+)\}/gu, (_m, key: string) =>
    ['option_label', 'plan_label', 'leader_label'].includes(key) ? `‘${'x'.repeat(40)}’` : 'x'.repeat(40)).length;
}

describe('RC guidance copy: model-relative, exact words', () => {
  it('RC-WHAT-CHANGES question (your range or unknown)', () => {
    expect(pick(row('RC-WHAT-CHANGES').reasoning_question, 'range_yours_or_unknown')).toBe(QUESTION);
  });
  it('RC-WHAT-CHANGES why-now', () => {
    expect(row('RC-WHAT-CHANGES').why_now).toBe(WHY_NOW);
  });
  it('RC-STRENGTHEN-ITEM S2 title', () => {
    expect(pick(row('RC-STRENGTHEN-ITEM').short_copy, 'S2')).toBe(S2_TITLE);
  });
  it('each fits its max_chars at the worst-case label length', () => {
    const max = POLICY.copy_rules.max_chars;
    expect(worstCaseLength(QUESTION)).toBeLessThanOrEqual(max.reasoning_question);
    expect(worstCaseLength(WHY_NOW)).toBeLessThanOrEqual(max.why_now);
    expect(worstCaseLength(S2_TITLE)).toBeLessThanOrEqual(max.short_copy);
    // CONTROL: the budget probe is not vacuous. The first draft ("…come out best in this model if … were
    // different?") rendered at 142 against 140.
    expect(worstCaseLength('Would {leader_label} still come out best in this model if {factor_label} were different?'))
      .toBeGreaterThan(max.reasoning_question);
  });
});

describe('lens bodies: model-relative, exact words', () => {
  it('the clear-separation disconfirmation opens with a finding about this model', () => {
    expect(BODY_BY_RATIONALE.CLEAR_WINNER_DISCONFIRMATION.startsWith(
      'In this model, one option scored highest by a wide margin. Before you commit,',
    )).toBe(true);
  });
  it('the flip-risk bodies ask what would flip the result, not the decision', () => {
    expect(BODY_BY_RATIONALE.FLIP_RISK_ISOLATED).toContain('Asking what would flip the result shows how much room for error you have.');
    expect(BODY_BY_RATIONALE.FLIP_RISK_CORRELATED).toContain('Asking what would flip the result shows which factors move together.');
    for (const body of Object.values(BODY_BY_RATIONALE)) expect(body).not.toContain('flip the decision');
  });
});

describe('the new words sit inside the existing defences (no guard widened)', () => {
  const NEW_COPY = [QUESTION, WHY_NOW, S2_TITLE, BODY_BY_RATIONALE.CLEAR_WINNER_DISCONFIRMATION];

  it('none carries the serve-time banned vocabulary ("best" and friends)', () => {
    for (const copy of NEW_COPY) expect(copy).not.toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
  });
  it('a withheld turn still sees the ranking claim: the leader vocabulary reads "scored highest" as a leader claim', () => {
    expect(textNamesLeadingOption('In this model, one option scored highest by a wide margin.')).toBe(true);
    expect(textNamesLeadingOption('Would ‘Switch to GCP’ still score highest in this model if cost changed?')).toBe(true);
  });
  it('CONTROL: the retired words were the ones the audit flagged', () => {
    expect('Would ‘Switch to GCP’ still be the best choice if cost turned out different?').toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
  });
});

describe('W-HEAD: the Run headline names the option only in this model, and is never swapped for the locked template', () => {
  const FALLBACK = 'Ran analysis on your current scenario.';
  const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  const forward = (text: string): string => {
    if (typeof template !== 'function') throw new Error('expected function-form confirmation_template');
    return template({ assistant_text: text });
  };
  const SHAPES: ReadonlyArray<[string, string]> = [
    ['Case C (caution, no margin)', 'Hire A was supported by the most runs of this model, but treat this as provisional: the result is sensitive to Quality.'],
    ['Case C (link caution)', 'Hire A was supported by the most runs of this model, but treat this as provisional: it rests heavily on how much Price changes Revenue.'],
    ['Case B (driver, no margin)', 'Hire A was supported by the most runs of this model because Cost is the strongest driver.'],
    ['Case E (floor)', 'Hire A was supported by the most runs of this model.'],
  ];

  it('Case E, built by the real builder, is the new floor and reaches the wire verbatim', () => {
    const text = buildAnalysisResultHeadline({
      enrichment: {
        results: [
          { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.29 },
          { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.2 },
          { option_id: 'opt_c', option_label: 'Option C', win_probability: 0.2 },
          { option_id: 'opt_d', option_label: 'Option D', win_probability: 0.23 },
        ],
      },
      leading_option_id: 'opt_a',
      status_kind: 'ok',
    });
    expect(text).toBe('Option A was supported by 29% of runs of this model.');
    expect(forward(text!)).toBe(text);
  });

  it.each(SHAPES)('%s passes the allowlist and is forwarded verbatim, never the locked template', (_name, text) => {
    expect(isAllowedRunAnalysisAssistantText(text)).toBe(true);
    expect(forward(text)).toBe(text);
    expect(text).not.toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
    // A withheld turn still sees the claim (no guard widened).
    expect(textNamesLeadingOption(text)).toBe(true);
  });

  it('CONTROL: the retired words are no longer in the grammar, so they fall back', () => {
    expect(forward('Hire A currently leads.')).toBe(FALLBACK);
    expect(forward('Hire A currently leads, but treat this as provisional: the link between Price and Revenue is fragile.')).toBe(FALLBACK);
  });
});

describe('explain and flip fallbacks: the leader and runner-up are said in this model, never "performs best" / "currently leads" / "second place"', () => {
  const ANALYSIS: AnalysisProjectionSummary = {
    status: 'complete',
    leading_option: { label: 'Hire Senior Engineer', probability: 0.62 },
    runner_up: { label: 'Hire Two Mid-Level', probability: 0.27 },
    margin_pp: 35,
    robustness_band: 'stable',
    top_drivers: [{ factor_label: 'Engineering Capacity', sensitivity_value: 0.65 }],
  };

  it('explain fallback: exact leader sentence and the runner-up in its own share', () => {
    const text = composeExplainResultsFallback(ANALYSIS, null, null);
    expect(text).toContain('In this model, Hire Senior Engineer was supported by 62% of runs.');
    expect(text).toContain("'Hire Two Mid-Level' was supported by 27% of runs");
    expect(text).not.toMatch(/performs best|currently leads|second place/);
  });

  it('flip fallback: exact leader sentence', () => {
    const text = composeWhatWouldFlipFallback(ANALYSIS, null, null, null);
    expect(text).toContain("In this model, 'Hire Senior Engineer' was supported by 62% of runs.");
    expect(text).not.toMatch(/performs best|currently leads/);
  });
});

describe('SERVED BYTES (DL Review Desk on #2588): the served rerun capture (CEE c74a432) through the real builder reaches the wire verbatim', () => {
  type Json = Record<string, unknown>;
  const FIXTURE = JSON.parse(
    readFileSync(new URL('../../coaching/__tests__/fixtures/rerun-c74a432.analysis-result-block.trimmed.json', import.meta.url), 'utf8'),
  ) as { blocks: Json[] };
  const BLOCK = FIXTURE.blocks[0] as Json;
  const ENRICHMENT = BLOCK['enrichment'] as Json;
  const SERVED_SUMMARY = BLOCK['summary'] as string;
  /** As served by CEE c74a432, in the RETIRED caution words. */
  const SERVED_HEADLINE =
    'Raise Price to £50 scored highest against your goal in 84% of runs of this model,' +
    ' but treat this as provisional: the link between Price per seat and Monthly revenue is fragile.';
  /** The scaffold sentence run-analysis.ts appended after the headline, byte for byte from the capture. */
  const SCAFFOLD = SERVED_SUMMARY.slice(SERVED_HEADLINE.length);
  const FALLBACK = 'Ran analysis on your current scenario.';
  const template = HANDLER_VALIDATION_REGISTRY.run_analysis.confirmation_template;
  const forward = (text: string): string => {
    if (typeof template !== 'function') throw new Error('expected function-form confirmation_template');
    return template({ assistant_text: text });
  };
  const built = buildAnalysisResultHeadline({
    enrichment: ENRICHMENT,
    leading_option_id: BLOCK['leading_option_id'] as string,
    status_kind: 'ok',
  });

  it('PRECONDITION: the capture is the served bytes, and its served summary carried the retired caution', () => {
    expect(SERVED_SUMMARY.startsWith(SERVED_HEADLINE)).toBe(true);
    expect(SCAFFOLD.length).toBeGreaterThan(0);
  });

  it("today's builder on the served envelope says the caution in the new words, and the served-shape summary is forwarded verbatim", () => {
    expect(built).not.toBeNull();
    expect(built).toContain('it rests heavily on how much Price per seat changes Monthly revenue');
    expect(built).toContain('was supported by 84% of runs of this model');
    expect(built).not.toContain('is fragile');
    const summary = `${built}${SCAFFOLD}`;
    expect(forward(summary)).toBe(summary);
    expect(forward(summary)).not.toBe(FALLBACK);
  });

  it('CONTROL: the served summary in the retired words is no longer in the grammar, so the probe sees the change', () => {
    // The headline is replaced by the locked template; the registry's salvage may keep the scaffold disclosure after
    // it (Codex round 4), so bind the replacement, not the salvage.
    const out = forward(SERVED_SUMMARY);
    expect(out).not.toBe(SERVED_SUMMARY);
    expect(out.startsWith(FALLBACK)).toBe(true);
    expect(out).not.toContain('is fragile');
    expect(out).not.toContain('Raise Price to £50');
  });
});
