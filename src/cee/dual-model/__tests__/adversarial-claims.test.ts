/**
 * Adversarial pins — G14 engine-boundary claim scan: coverage + evasion.
 *
 * CONTRACT PINS, not endorsements: the MISS cases assert what the live regex
 * set does NOT catch today, both at the guard level and end-to-end (the text
 * merges into a canvas-visible label). Tightening ANALYSIS_CLAIM_PATTERNS is
 * a guards-lane / prompt-doctrine decision — widening the live regex on this
 * branch is out of scope. Findings tracked in
 * Docs/v6/dual-model-adversarial-findings.md. Complements the hit-list in
 * dual-draft/__tests__/guards.test.ts (no repeats).
 */
import { describe, it, expect } from 'vitest';
import { findAnalysisClaim } from '../../dual-draft/guards.js';
import { mergeProposals } from '../../dual-draft/merge.js';
import { baseGraph, riskProposal } from './adversarial-fixtures.js';

describe('G14 hits — boundary variants the patterns DO catch', () => {
  const HITS: Array<[string, string]> = [
    ['lowercase evpi', 'the evpi here is decisive'],
    ['hyphenated flip-point', 'the flip-point sits near the threshold'],
    ['concatenated flippoints', 'several flippoints were identified'],
    ['plural sensitivity analyses', 'sensitivity analyses were run on price'],
    ['expected value of perfect information', 'the expected value of perfect information is high'],
    ['expected value of information (no "perfect")', 'the expected value of information favours waiting'],
    ['plural win probabilities', 'the win probabilities favour option A'],
    ['percent-symbol likelihood', 'there is a 72% likely outcome here'],
  ];
  for (const [label, text] of HITS) {
    it(`flags: ${label}`, () => {
      expect(findAnalysisClaim(text)).not.toBeNull();
    });
  }
});

describe('FINDING: G14 misses — evasion variants the patterns do NOT catch', () => {
  // Each miss is pinned twice: the guard returns null, AND the text merges
  // end-to-end into a committed, canvas-visible node label.
  const MISSES: Array<[string, string]> = [
    ['letter-spaced E V P I', 'the E V P I of this choice is enormous'],
    ['word "percent" instead of % symbol', 'this is 60 percent likely to succeed'],
    ['adjective "robust" (only \\brobustness\\b is scanned)', 'this plan is robust to assumptions'],
    ['value of information without "expected"', 'the value of information is high here'],
    ['hyphenated sensitivity-analysis (pattern requires whitespace)', 'a sensitivity-analysis was suggested by the team'],
    ['"the analysis suggests" (verb not in shows|indicates|computed|will show)', 'the analysis suggests option A'],
    ['Cyrillic-Е homoglyph ЕVPI', 'the ЕVPI is decisive'],
  ];
  MISSES.forEach(([label, text], i) => {
    it(`FINDING: not flagged — ${label}`, () => {
      expect(findAnalysisClaim(text)).toBeNull();
    });

    it(`FINDING: merges into a committed label — ${label}`, () => {
      const out = mergeProposals(baseGraph(), [riskProposal(`risk_evade_${i}`, text)]);
      expect(out.report.applied).toBe(1);
      expect(out.merged.nodes.find((n) => n.id === `risk_evade_${i}`)?.label).toBe(text);
    });
  });
});

describe('unsafe deferred options — G14 runs BEFORE the D1 defer branch', () => {
  it('an added_option label carrying EVPI is REJECTED (engine_boundary_violation), never deferred', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'added_option',
        delta: { node: { id: 'opt_claim', kind: 'option', label: 'Pick the high-EVPI route' } },
        evidence_pointer: 'brief: alternative mentioned',
      },
    ]);
    expect(out.report.artifacts).toBe(0);
    expect(out.report.failures.map((f) => f.reason_code)).toEqual(['engine_boundary_violation']);
  });

  it('an artifact question carrying a quantified probability is REJECTED, never recorded', () => {
    const out = mergeProposals(baseGraph(), [
      {
        type: 'uncertainty_flag',
        delta: { question: 'Is the 85% probability of approval realistic?' },
        evidence_pointer: 'brief: approval mentioned',
      },
    ]);
    expect(out.report.artifacts).toBe(0);
    expect(out.report.failures.map((f) => f.reason_code)).toEqual(['engine_boundary_violation']);
  });
});
