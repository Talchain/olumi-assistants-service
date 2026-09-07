/**
 * The instruments, and what happens when one of them goes blind.
 *
 * Four of the six criteria are ABSENCE claims — no narration, no leader
 * designation, no contradiction, no misroute. A blind detector returns a
 * confident zero for all four, and the run reads clean. CLAUDE.md trap 13 is
 * the whole reason this file exists: "Any test proving an ABSENCE must first
 * prove it can SEE a PRESENCE."
 *
 * So this file pins two things:
 *   1. each detector's controls really do discriminate (positive fires,
 *      negative stays silent);
 *   2. when a detector is unavailable, the criterion that reads it goes
 *      NOT_ASSESSED and NEVER PASS. That second one is the safety property —
 *      an instrument failure must never look like a clean bill of health.
 */

import { describe, expect, it } from 'vitest';

import {
  CLAIM_VOCAB_NEGATIVE_CONTROL,
  CLAIM_VOCAB_POSITIVE_CONTROL,
  LEADER_NEGATIVE_CONTROL,
  LEADER_POSITIVE_CONTROL,
  NARRATION_NEGATIVE_CONTROL,
  NARRATION_POSITIVE_CONTROL,
  buildDetectors,
  loadCoherence,
  type DetectorBundle,
} from '../../../tools/founder-fixture-harness/detectors.js';
import { evaluateCriteria } from '../../../tools/founder-fixture-harness/criteria.js';
import { fixtureToCaptures } from '../../../tools/founder-fixture-harness/index.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(process.cwd(), 'tools/founder-fixture-harness/fixtures');
const noFailures = () =>
  fixtureToCaptures(JSON.parse(readFileSync(join(FIXTURES, 'no-failures.json'), 'utf8')));

describe('detector controls', () => {
  it('every in-repo detector discriminates: positive fires, negative is silent', async () => {
    const d = await buildDetectors(undefined);
    for (const status of [d.narration.status, d.leaderClaim.status, d.claimVocabulary.status]) {
      expect(status.positiveControl, `${status.id} positive control`).toBe('fired');
      expect(status.negativeControl, `${status.id} negative control`).toBe('silent');
      expect(status.available, `${status.id} availability`).toBe(true);
    }
  });

  it('the narration positive control is the live 3 Sep capture, not an invention', async () => {
    const d = await buildDetectors(undefined);
    // Pinned to the HISTORICAL artefact, never to "whatever the module emits
    // now" — CLAUDE.md trap 12b: a control pinned to current decays into a
    // tautology the first time current changes.
    expect(NARRATION_POSITIVE_CONTROL).toContain('not a model edit request');
    expect(d.narration.findHit(NARRATION_POSITIVE_CONTROL)).not.toBeNull();
    expect(d.narration.findHit(NARRATION_NEGATIVE_CONTROL)).toBeNull();
  });

  it('the claim-vocabulary control pins the producer\'s own false-positive boundary', async () => {
    const d = await buildDetectors(undefined);
    // `blocked-claim-fields.ts` states it: `robustness` matches the metric noun
    // but not the adjective. If a widening ever starts eating ordinary English,
    // it surfaces here rather than as a mystery C1 failure.
    expect(d.claimVocabulary.findMatches(CLAIM_VOCAB_POSITIVE_CONTROL).length).toBeGreaterThan(0);
    expect(d.claimVocabulary.findMatches(CLAIM_VOCAB_NEGATIVE_CONTROL)).toEqual([]);
  });

  it('the leader detector sees the prose claim and not the honest no-separation sentence', async () => {
    const d = await buildDetectors(undefined);
    expect(d.leaderClaim.findClaims({ assistant_text: LEADER_POSITIVE_CONTROL, blocks: [] } as never).length).toBeGreaterThan(0);
    expect(d.leaderClaim.findClaims({ assistant_text: LEADER_NEGATIVE_CONTROL, blocks: [] } as never)).toEqual([]);
  });

  it('the key predicates are a DISCRIMINATING pair, not a one-way alarm', async () => {
    const d = await buildDetectors(undefined);
    // Positive: keys the producer's projections drop.
    expect(d.leaderClaim.keyDesignatesLeader('leading_option_id')).toBe(true);
    expect(d.leaderClaim.keyDesignatesOrdinal('rank')).toBe(true);
    expect(d.leaderClaim.keyStatesRobustness('robustness')).toBe(true);
    // Negative, and the anchors are load-bearing: `priority_rank` ranks CARDS,
    // not options, and `win_probability` is a number the withheld projection
    // deliberately KEEPS. A widened pattern would suppress real science.
    expect(d.leaderClaim.keyDesignatesOrdinal('priority_rank')).toBe(false);
    expect(d.leaderClaim.keyDesignatesLeader('win_probability')).toBe(false);
  });

  it('an absent UI checkout leaves the coherence detector unavailable with an actionable reason', async () => {
    const absent = await loadCoherence('/private/tmp/definitely-not-a-ui-checkout-founder-fixture');
    expect(absent.module).toBeUndefined();
    expect(absent.status.available).toBe(false);
    expect(absent.status.reason ?? '').toContain('could not import');
  });
});

describe('a blind instrument never reads as a clean bill of health', () => {
  function blind(base: DetectorBundle, which: 'narration' | 'leaderClaim' | 'claimVocabulary'): DetectorBundle {
    const broken = {
      ...base[which].status,
      available: false,
      positiveControl: 'did-not-fire' as const,
      reason: 'positive control neutered by the test',
    };
    if (which === 'narration') {
      return { ...base, narration: { findHit: () => null, status: broken } };
    }
    if (which === 'leaderClaim') {
      return { ...base, leaderClaim: { ...base.leaderClaim, status: broken } };
    }
    return { ...base, claimVocabulary: { ...base.claimVocabulary, status: broken } };
  }

  it('C3 goes NOT_ASSESSED when the narration detector cannot see', async () => {
    const base = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({ turns: noFailures(), detectors: blind(base, 'narration') });
    const c3 = criteria.find((c) => c.id === 'C3');
    expect(c3?.verdict).toBe('NOT_ASSESSED');
    // and the reason is stated, not swallowed
    expect(c3?.limbs[0].evidence.join(' ')).toContain('neutered');
  });

  it('C1 goes NOT_ASSESSED when either claim detector cannot see', async () => {
    const base = await buildDetectors(undefined);
    for (const which of ['leaderClaim', 'claimVocabulary'] as const) {
      const { criteria } = evaluateCriteria({ turns: noFailures(), detectors: blind(base, which) });
      expect(criteria.find((c) => c.id === 'C1')?.verdict, which).toBe('NOT_ASSESSED');
    }
  });

  it('the same fixture reads PASS on C3 with a working detector — so the NOT_ASSESSED above is the detector, not the data', async () => {
    // Without this pair, "C3 is NOT_ASSESSED when blinded" proves nothing: the
    // fixture might simply be undecidable. The pair is what makes it evidence.
    const base = await buildDetectors(undefined);
    const { criteria } = evaluateCriteria({ turns: noFailures(), detectors: base });
    expect(criteria.find((c) => c.id === 'C3')?.verdict).toBe('PASS');
  });
});
