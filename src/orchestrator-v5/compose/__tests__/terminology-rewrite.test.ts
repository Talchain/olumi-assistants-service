/**
 * Unit tests for the RC4 proportionate-remedy rewriters
 * (`terminology-rewrite.ts`).
 *
 * Two deterministic, pure rewriters:
 *
 *   - `applyTerminologyRewrite` — the prescriptive-lexicon substitution map
 *     mirroring the served prompt's TERMINOLOGY rules ("recommendation" →
 *     "leading option", never "winner", …). Used rewrite-first by the
 *     phase-3 prose guard and the egress forbidden-phrase guard so a
 *     REWRITABLE offence no longer costs the user the whole block/response.
 *
 *   - `rewriteEmDashes` — the style rewriter for em/en dashes (the served
 *     prompt bans them; the copy-quality gate previously DROPPED whole
 *     coaching candidates over one dash — the 2026-07-15 session RCA RC4
 *     evidence).
 *
 * SAFETY INVARIANT pinned here: the map must never contain a substitution
 * for a FATAL-class phrase (mutation denial, false success, staleness,
 * internal jargon). That is enforced structurally by consumers re-scanning
 * after rewrite, and pinned in this file by asserting fatal phrases pass
 * through the rewriter UNCHANGED.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTerminologyRewrite,
  rewriteEmDashes,
} from '../terminology-rewrite.js';
import { findForbiddenPhraseHit } from '../forbidden-user-facing-phrases.js';

describe('applyTerminologyRewrite — prescriptive lexicon substitutions', () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    [
      'The recommendation is robust across scenarios.',
      'The leading option is robust across scenarios.',
      'recommendation → leading option (sentence-initial case preserved)',
    ],
    [
      'Our recommendation is to launch immediately.',
      'Our leading option is to launch immediately.',
      'mid-sentence recommendation',
    ],
    [
      'These recommendations may shift.',
      'These leading options may shift.',
      'plural recommendations',
    ],
    [
      'Recommended next step: re-run the analysis.',
      'Suggested next step: re-run the analysis.',
      'leading Recommended → Suggested (case preserved)',
    ],
    [
      'The recommended option is X.',
      'The suggested option is X.',
      'mid-sentence recommended',
    ],
    [
      'The winner is Option A.',
      'The leading option is Option A.',
      'the winner → the leading option',
    ],
    [
      'These are the winners after re-analysis.',
      'These are the leading options after re-analysis.',
      'the winners → the leading options',
    ],
    [
      'Option A has the winning probability.',
      'Option A has the win probability.',
      'winning probability → win probability',
    ],
    [
      'The winning option leads at 72%.',
      'The leading option leads at 72%.',
      'winning option → leading option',
    ],
    [
      'Robust analysis points to the winning side.',
      'Robust analysis points to the leading side.',
      'winning side → leading side',
    ],
  ];

  for (const [input, expected, label] of cases) {
    it(`rewrites: ${label}`, () => {
      const result = applyTerminologyRewrite(input);
      expect(result.text).toBe(expected);
      expect(result.applied.length).toBeGreaterThan(0);
      // The rewritten output must be clean against the central forbidden list
      // — this is the property the rewrite-first consumers depend on.
      expect(findForbiddenPhraseHit(result.text)).toBeNull();
    });
  }

  it('is idempotent — a second pass changes nothing', () => {
    const once = applyTerminologyRewrite('The recommendation is to expand.');
    const twice = applyTerminologyRewrite(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.applied).toEqual([]);
  });

  it('reports applied terms for telemetry', () => {
    const result = applyTerminologyRewrite(
      'The recommendation names the winning option.',
    );
    expect(result.applied.length).toBe(2);
  });

  it('leaves clean text byte-identical with no allocation of applied terms', () => {
    const clean = 'Hire two senior engineers locally leads at 72% probability.';
    const result = applyTerminologyRewrite(clean);
    expect(result.text).toBe(clean);
    expect(result.applied).toEqual([]);
  });

  // ── SAFETY: fatal-class phrases must pass through UNCHANGED so the
  //    consumer's re-scan still fires the fatal remedy. Weakening this is
  //    weakening the mutation-denial / staleness / jargon guarantees.
  const fatalClassPhrases: readonly string[] = [
    "I haven't applied any changes to the model.",
    'Nothing changed on the model since the last analysis.',
    'No changes were made.',
    'The wire reports unknown freshness.',
    'These results were loaded from a prior run.',
    'Showing a cached result for the same query.',
    'The previous analysis still holds.',
    'The validator rejected the change.',
    'The orchestrator dropped the request.',
  ];
  for (const phrase of fatalClassPhrases) {
    it(`does NOT rewrite fatal-class phrase: "${phrase.slice(0, 40)}…"`, () => {
      const result = applyTerminologyRewrite(phrase);
      expect(result.text).toBe(phrase);
      expect(result.applied).toEqual([]);
      // Still detected by the central list — the fatal remedy stays reachable.
      expect(findForbiddenPhraseHit(phrase)).not.toBeNull();
    });
  }
});

describe('rewriteEmDashes — deterministic style rewriter', () => {
  it('rewrites a spaced em dash to a comma join', () => {
    const r = rewriteEmDashes('Updating salary cost — this affects both options.');
    expect(r.text).toBe('Updating salary cost, this affects both options.');
    expect(r.rewritten).toBe(true);
  });

  it('rewrites an unspaced em dash between words', () => {
    const r = rewriteEmDashes('delivery speed—quality risk');
    expect(r.text).toBe('delivery speed, quality risk');
  });

  it('rewrites an en dash the same way', () => {
    const r = rewriteEmDashes('capacity – review headcount');
    expect(r.text).toBe('capacity, review headcount');
  });

  it('turns a numeric-range en dash into "to"', () => {
    const r = rewriteEmDashes('expect 5–10 months of runway');
    expect(r.text).toBe('expect 5 to 10 months of runway');
  });

  it('drops a trailing dash instead of leaving dangling punctuation', () => {
    const r = rewriteEmDashes('check the budget —');
    expect(r.text).toBe('check the budget');
  });

  it('drops a dash that follows sentence punctuation', () => {
    const r = rewriteEmDashes('That is done. — next, the timeline.');
    expect(r.text).toBe('That is done. next, the timeline.');
  });

  it('never leaves an em/en dash in the output', () => {
    const r = rewriteEmDashes('a — b–c — d—e 1–2');
    expect(r.text).not.toMatch(/[–—]/);
  });

  it('is a no-op on dash-free text', () => {
    const clean = 'The trade-off is between speed and quality.';
    const r = rewriteEmDashes(clean);
    expect(r.text).toBe(clean);
    expect(r.rewritten).toBe(false);
  });

  it('is idempotent', () => {
    const once = rewriteEmDashes('a — b');
    const twice = rewriteEmDashes(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.rewritten).toBe(false);
  });
});
