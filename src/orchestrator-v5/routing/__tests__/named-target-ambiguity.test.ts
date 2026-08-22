/**
 * SENDABLE failure 2 — clarify-vs-guess on TWO NAMED ENTITIES IN ONE SENTENCE.
 *
 * Every case here carries its OPPOSITE-DIRECTION TWIN (CLAUDE.md trap 22b):
 * an unambiguous instruction must still execute silently, and a guard that
 * asks when the user was clear is its own defect. The twins are asserted in
 * the same `describe` as the positives so a widening cannot pass by fixing one
 * direction only.
 */

import { describe, it, expect } from 'vitest';

import {
  findNamedTargetAmbiguity,
  NAMED_TARGET_AMBIGUITY_KNOWN_DROPPED,
  type NamedTargetCandidate,
} from '../named-target-ambiguity.js';

const RENEWAL: NamedTargetCandidate = { id: 'fac_renewal', label: 'Key Account Renewal Risk' };
const CHURN: NamedTargetCandidate = { id: 'fac_churn', label: 'Key Account Churn Exposure' };
const FACTORS = [RENEWAL, CHURN];

/** Every other named entity in the graph — options, the goal, an outcome. */
const OTHER_LABELS = [
  'Invest in a dedicated success team',
  'Do nothing this quarter',
  'Protect recurring revenue',
  'Net revenue retention',
];

function ask(message: string, proposedEntityId = RENEWAL.id, targets = FACTORS) {
  return findNamedTargetAmbiguity({
    message,
    proposedEntityId,
    candidateTargets: targets,
    otherEntityLabels: OTHER_LABELS,
  });
}

describe('findNamedTargetAmbiguity — the witnessed sentence', () => {
  it('WITNESS: two full labels in one sentence, one value → AMBIGUOUS, both returned in message order', () => {
    const result = ask(
      'Key Account Renewal Risk and Key Account Churn Exposure both look off to me — set it to 0.8.',
    );
    expect(result).not.toBeNull();
    // Bound by IDENTITY, never by a value predicate another object could
    // satisfy (CLAUDE.md trap 19).
    expect(result?.candidates.map((c) => c.id)).toEqual(['fac_renewal', 'fac_churn']);
    expect(result?.candidates.map((c) => c.naming)).toEqual(['full_label', 'full_label']);
  });

  it('TWIN: ONE entity named, same value, same graph → SILENT (null), the write proceeds', () => {
    expect(
      ask('Key Account Renewal Risk looks off to me — set it to 0.8.'),
    ).toBeNull();
  });

  it('TWIN: the plainest unambiguous instruction → SILENT', () => {
    expect(ask('Set Key Account Renewal Risk to 0.8.')).toBeNull();
  });
});

describe('findNamedTargetAmbiguity — partial references (the LLM fall-through hole)', () => {
  // Measured at pristine 53eb8d03: `tryDeterministicValueUpdate` returns
  // SKIP `no_candidate_match` for both of these, so the turn reaches the LLM,
  // which resolves the partial reference and picks one silently.
  it('two PARTIAL cues in one sentence → AMBIGUOUS', () => {
    const result = ask('Renewal Risk and Churn Exposure both look off to me — set it to 0.8.');
    expect(result).not.toBeNull();
    expect(result?.candidates.map((c) => c.id)).toEqual(['fac_renewal', 'fac_churn']);
    expect(result?.candidates.map((c) => c.naming)).toEqual([
      'distinctive_token',
      'distinctive_token',
    ]);
  });

  it('TWIN: ONE partial cue → SILENT', () => {
    expect(ask('Renewal Risk looks off to me — set it to 0.8.')).toBeNull();
  });

  it('TWIN: a shared word alone is NOT a cue — subtraction removes it', () => {
    // "Key Account" is claimed by BOTH labels, so it identifies neither.
    // Without the subtraction step this sentence would cue both and ask.
    expect(ask('The key account numbers look off to me — set it to 0.8.')).toBeNull();
  });
});

describe('findNamedTargetAmbiguity — conjunct (c), a full label dominates a partial cue', () => {
  it('TWIN: contrastive framing with ONE full label → SILENT, the user was clear', () => {
    expect(
      ask('Unlike churn exposure, Key Account Renewal Risk should move — set it to 0.8.'),
    ).toBeNull();
  });

  it('TWO full labels are NOT separated by dominance → still AMBIGUOUS', () => {
    const result = ask(
      'Key Account Churn Exposure and Key Account Renewal Risk are both wrong — set it to 0.8.',
    );
    expect(result).not.toBeNull();
    // Message order, not graph order — churn is said first here.
    expect(result?.candidates.map((c) => c.id)).toEqual(['fac_churn', 'fac_renewal']);
  });
});

describe('findNamedTargetAmbiguity — conjunct (a), only plausible targets count', () => {
  it('TWIN: an OPTION named alongside a factor does not make a factor write ambiguous', () => {
    // The option is not in `candidateTargets`, so `set_factor_value` has
    // exactly one plausible referent. This is the brief's "naming two where
    // only one is a plausible target for the stated field".
    expect(
      ask(
        'Under Invest in a dedicated success team, Key Account Renewal Risk looks off — set it to 0.8.',
      ),
    ).toBeNull();
  });

  it('TWIN: fewer than two candidate targets can never be ambiguous', () => {
    expect(
      ask(
        'Key Account Renewal Risk and Key Account Churn Exposure both look off — set it to 0.8.',
        RENEWAL.id,
        [RENEWAL],
      ),
    ).toBeNull();
  });
});

describe('findNamedTargetAmbiguity — conjunct (b), the proposal must be aimed at a named entity', () => {
  it('TWIN: a write aimed at an entity the sentence never named → SILENT (wrong-entity class, owned elsewhere)', () => {
    const other: NamedTargetCandidate = { id: 'fac_nps', label: 'Support responsiveness' };
    expect(
      ask(
        'Key Account Renewal Risk and Key Account Churn Exposure both look off — set it to 0.8.',
        other.id,
        [...FACTORS, other],
      ),
    ).toBeNull();
  });
});

describe('findNamedTargetAmbiguity — the honest-gap pin', () => {
  it('KNOWN-DROPPED set is EXACTLY these four shapes (REDs if it grows OR shrinks)', () => {
    expect(NAMED_TARGET_AMBIGUITY_KNOWN_DROPPED.map((k) => k.shape)).toEqual([
      'two candidates named by PARTIAL cue only, one of them contrastively — '
        + '"unlike Churn Exposure, set Renewal Risk to 0.8"',
      'a candidate named only by an INFLECTION of a distinctive word ("renewals", "churned")',
      'two candidates whose labels share every distinctive word — a PARTIAL cue can then name neither',
      'the proposal targets an entity the sentence never named',
    ]);
  });

  it('KNOWN-DROPPED shape 1 is REACHABLE and behaves as pinned — the guard asks', () => {
    // The residual is VISIBLE, not silent: a contrastive sentence with two
    // PARTIAL cues does ask. Pinned so a later widening is a deliberate act.
    expect(ask('Unlike churn exposure, renewal risk should move — set it to 0.8.')).not.toBeNull();
  });

  it('KNOWN-DROPPED shape 2 is REACHABLE and fails toward SILENCE', () => {
    // "renewals"/"churned" are inflections; exact-token cue matching misses
    // them, so the guard does not fire and today's behaviour stands.
    expect(ask('Renewals and churned accounts both look off — set it to 0.8.')).toBeNull();
  });

  it('KNOWN-DROPPED shape 3 is REACHABLE — identical labels ASK, they do not fall silent', () => {
    const twinA: NamedTargetCandidate = { id: 'a', label: 'Key Account Renewal Risk' };
    const twinB: NamedTargetCandidate = { id: 'b', label: 'Key Account Renewal Risk' };
    // Identical labels: neither has a distinctive token after subtraction,
    // and BOTH full-label-match, so dominance cannot separate them either.
    // Assert the pinned outcome rather than assuming it.
    const result = findNamedTargetAmbiguity({
      message: 'Key Account Renewal Risk looks off — set it to 0.8.',
      proposedEntityId: 'a',
      candidateTargets: [twinA, twinB],
      otherEntityLabels: OTHER_LABELS,
    });
    // Two full-label hits ⇒ dominance does not fire ⇒ the guard DOES ask.
    // Recorded because a reader would otherwise expect silence from the prose.
    expect(result?.candidates.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('findNamedTargetAmbiguity — degenerate inputs never throw and never ask', () => {
  it.each([
    ['empty message', ''],
    ['whitespace only', '   '],
  ])('%s → null', (_name, message) => {
    expect(ask(message)).toBeNull();
  });

  it('empty proposedEntityId → null', () => {
    expect(
      findNamedTargetAmbiguity({
        message: 'Key Account Renewal Risk and Key Account Churn Exposure — set it to 0.8.',
        proposedEntityId: '',
        candidateTargets: FACTORS,
        otherEntityLabels: OTHER_LABELS,
      }),
    ).toBeNull();
  });
});
