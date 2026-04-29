/**
 * Side-band answer-text validator — unit tests.
 *
 * Floor per brief §Task 5: 9 tests.
 */

import { describe, expect, it } from 'vitest';

import {
  validateExplanationAnswer,
  type SideBandPriorFact,
} from '../validator-explanation.js';

const RUN_ANALYSIS_FACT: SideBandPriorFact = { fact_type: 'run_analysis', noop: false };
const NOOP_RUN_ANALYSIS_FACT: SideBandPriorFact = { fact_type: 'run_analysis', noop: true };

const VALID_LONG_ANSWER =
  'Engineering Capacity is the leading driver of your Q3 throughput goal because it has the strongest causal footprint across the model at 0.65 strength.';

describe('validateExplanationAnswer', () => {
  it('returns skip:true for non-explanation handlers (e.g. run_analysis)', () => {
    const verdict = validateExplanationAnswer(
      'run_analysis',
      { answer_text: 'irrelevant payload that should be ignored' },
      [],
    );
    expect(verdict.skip).toBe(true);
    expect(verdict.payload).toBeUndefined();
  });

  it('marks valid: explain_from_structure with a >= 80-char clean answer', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: VALID_LONG_ANSWER,
        evidence_used: ['graph.nodes'],
        cited_fields: ['Engineering Capacity'],
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
    expect(verdict.payload?.answer_validation_error).toBeUndefined();
    expect(verdict.payload?.answer_text).toBe(VALID_LONG_ANSWER);
    expect(verdict.payload?.evidence_used).toEqual(['graph.nodes']);
    expect(verdict.payload?.cited_fields).toEqual(['Engineering Capacity']);
  });

  it('marks invalid (missing) when explanation field is absent on an explanation handler', () => {
    // Reproduces the v40 staging Tests D/E/F shape: bare tool_use with no
    // explanation payload.
    const verdict = validateExplanationAnswer('explain_results', undefined, [
      RUN_ANALYSIS_FACT,
    ]);
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('missing');
    expect(verdict.payload?.answer_text).toBe('');
  });

  it('marks invalid (too_short) when answer_text is < 80 chars', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: 'Engineering Capacity drives your goal.' },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('too_short');
  });

  it('marks invalid (forbidden_internal_term) when answer_text references "node"/"edge"/"handler"', () => {
    const verdicts = [
      validateExplanationAnswer(
        'explain_from_structure',
        {
          answer_text:
            'Looking at the strongest edge in the graph, Engineering Capacity drives Throughput at 0.65 strength.',
        },
        [],
      ),
      validateExplanationAnswer(
        'explain_results',
        {
          answer_text:
            'The handler is reading the projection: Engineering Capacity has the largest sensitivity at 0.65.',
        },
        [RUN_ANALYSIS_FACT],
      ),
      validateExplanationAnswer(
        'explain_from_structure',
        {
          answer_text:
            'Analysing the goal node and traversing each connection shows Engineering Capacity dominates the structure.',
        },
        [],
      ),
    ];
    for (const v of verdicts) {
      expect(v.payload?.answer_text_valid).toBe(false);
      expect(v.payload?.answer_validation_error).toBe('forbidden_internal_term');
    }
  });

  it('marks invalid (mutation_language_detected) when answer_text reads as an edit', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text:
          'Proposing to add a competitive response risk factor to capture market dynamics across the model.',
      },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.answer_validation_error).toBe('mutation_language_detected');
  });

  it('returns skip:true (precondition bypass) for explain_results with no analysis fact', () => {
    // Handler renders its existing "no analysis yet" template; side-band
    // validation does not run.
    const verdict = validateExplanationAnswer(
      'explain_results',
      { answer_text: VALID_LONG_ANSWER },
      [],
    );
    expect(verdict.skip).toBe(true);
    expect(verdict.payload).toBeUndefined();
  });

  it('returns skip:true (precondition bypass) for what_would_flip with only a noop run_analysis fact', () => {
    // A noop run_analysis fact (e.g. one persisted by a prior explain turn)
    // does NOT count — only a real PLoT-backed analysis run satisfies the
    // precondition. Mirrors the handler's existing prior_facts filter.
    const verdict = validateExplanationAnswer(
      'what_would_flip',
      { answer_text: VALID_LONG_ANSWER },
      [NOOP_RUN_ANALYSIS_FACT],
    );
    expect(verdict.skip).toBe(true);
  });

  it('does NOT bypass for explain_from_structure (no analysis precondition)', () => {
    // explain_from_structure has no analysis precondition; even with no
    // facts, the side-band check runs.
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: VALID_LONG_ANSWER },
      [],
    );
    expect(verdict.skip).toBe(false);
    expect(verdict.payload?.answer_text_valid).toBe(true);
  });

  it('preserves evidence_used and cited_fields when present even on invalid answers', () => {
    // Telemetry should still see what Sonnet *tried* to cite even when the
    // answer text itself is unusable.
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      {
        answer_text: 'too short',
        evidence_used: ['analysis.leading_option'],
        cited_fields: ['Engineering Capacity'],
      },
      [],
    );
    expect(verdict.payload?.answer_text_valid).toBe(false);
    expect(verdict.payload?.evidence_used).toEqual(['analysis.leading_option']);
    expect(verdict.payload?.cited_fields).toEqual(['Engineering Capacity']);
  });
});
