import { describe, expect, it } from 'vitest';
import samples from './fixtures/prose-sanitation/samples.json' with { type: 'json' };
import { sanitiseAssistantTextProse } from '../numeric-prose-formatter.js';

interface Sample {
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly expectations: string;
}

interface SamplesFile {
  readonly _meta: unknown;
  readonly offending: readonly Sample[];
  readonly legitimate: readonly Sample[];
}

const corpus = samples as unknown as SamplesFile;

/**
 * Probability contexts must contain no bare decimals after sanitation.
 * We define "decimal in a probability context" as any of:
 *   - "{0?.dd[dd]} {probability|likelihood|chance}"
 *   - "{probability|likelihood|chance} {of|is|=|:} {0?.dd[dd]}"
 *   - "{goal|win|outcome} probability ... {0?.dd[dd]}"
 */
const PROB_CONTEXT_DECIMALS = [
  /\b0?\.\d{2,4}\s+(?:probability|likelihood|chance)\b/i,
  /\b(?:probability|likelihood|chance)\s+(?:of|is)\s+0?\.\d{2,4}\b/i,
  /\b(?:probability|likelihood|chance)\s*[:=]\s*0?\.\d{2,4}\b/i,
  /\b(?:goal|win|outcome)\s+probability\s+(?:of|is|[:=])\s*0?\.\d{2,4}\b/i,
];

const STRUCTURAL_PHRASES = [
  /\bcarries?\s+a\s+strength\s+of\s+\d?\.\d+\b/i,
  /\bedge\s+(?:strength|weight)\s+(?:of\s+)?\d?\.\d+\b/i,
  /\b(?:causal\s+)?strength\s+(?:value\s+)?(?:of\s+)?\d?\.\d+\b/i,
];

const SENSITIVITY_RAW = [
  /\bsensitivity\s+(?:value\s+)?(?:of|is)\s+-?\d?\.\d+\b/i,
  /\bsensitivity\s*[:=]\s*-?\d?\.\d+\b/i,
];

describe('prose-sanitation corpus — offending samples', () => {
  for (const sample of corpus.offending) {
    it(`[${sample.id}] sanitises cleanly`, () => {
      const result = sanitiseAssistantTextProse(sample.text);

      // No bare decimals in probability contexts.
      for (const pat of PROB_CONTEXT_DECIMALS) {
        expect(result.text, `expected no probability-context decimal — ${pat}`).not.toMatch(pat);
      }

      // No structural-strength phrases.
      for (const pat of STRUCTURAL_PHRASES) {
        expect(result.text, `expected no structural-strength phrase — ${pat}`).not.toMatch(pat);
      }

      // No raw sensitivity values.
      for (const pat of SENSITIVITY_RAW) {
        expect(result.text, `expected no raw sensitivity phrase — ${pat}`).not.toMatch(pat);
      }

      // At least one counter must have fired (we expect each offending
      // sample to actually trigger sanitation).
      const total =
        result.probability_rewrites +
        result.sensitivity_rewrites +
        result.structural_matches;
      expect(total, `expected at least one rewrite/match for ${sample.id}`).toBeGreaterThan(0);
    });
  }
});

describe('prose-sanitation corpus — legitimate samples', () => {
  for (const sample of corpus.legitimate) {
    it(`[${sample.id}] passes through unchanged`, () => {
      const result = sanitiseAssistantTextProse(sample.text);
      expect(result.text).toBe(sample.text);
      expect(result.probability_rewrites).toBe(0);
      expect(result.sensitivity_rewrites).toBe(0);
      expect(result.structural_suppressed).toBe(0);
    });
  }
});

describe('prose-sanitation corpus — grammar-breakage budget', () => {
  it('missed_grammar over the offending corpus is below 5%', () => {
    let totalMatches = 0;
    let totalMissed = 0;
    for (const sample of corpus.offending) {
      const r = sanitiseAssistantTextProse(sample.text);
      totalMatches += r.structural_matches;
      totalMissed += r.structural_missed_grammar;
    }
    if (totalMatches === 0) return;
    const ratio = totalMissed / totalMatches;
    expect(ratio).toBeLessThan(0.05);
  });
});
