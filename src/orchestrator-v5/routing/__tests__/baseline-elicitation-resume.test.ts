/**
 * ROADMAP 2.918 — unit pins for `tryBaselineElicitationResume`, the
 * answer-turn pre-route for the pending baseline question. Route-level
 * mounting is pinned in `__tests__/baseline-elicitation-route-level.test.ts`;
 * this file pins the gate ORDER and each skip reason in isolation.
 * Every non-match is a SILENT fall-through by contract (the elicitation is
 * additive), so the skip reasons here are telemetry vocabulary, not UX.
 */

import { describe, expect, it } from 'vitest';

import { tryBaselineElicitationResume } from '../clarification-resume.js';
import { deriveElicitedBaselineAnswerPercent } from '../../../cee/factor-extraction/stated-level.js';
import type { PendingAction } from '../../session/pending-action.js';

const NOW_MS = Date.parse('2026-08-08T12:00:00.000Z');
const HASH = 'sha256:live';

const NODES = [
  { id: 'g-revenue', label: 'Revenue' },
  { id: 'o-churn-rate', label: 'Churn rate' },
  { id: 'f-quality', label: 'Product quality' },
];

function pending(overrides?: {
  id?: string;
  target_id?: string;
  target_label?: string;
  graph_hash?: string;
  expires_at_iso?: string;
  expires_at_turn_count?: number;
}): PendingAction {
  return {
    id: overrides?.id ?? 'pa-1',
    scenario_id: 'scn-1',
    chip_id: 'chip_elicit_target_baseline',
    action: {
      kind: 'elicit_target_baseline',
      target_id: overrides?.target_id ?? 'o-churn-rate',
      target_label: overrides?.target_label ?? 'Churn rate',
      constraint_type: 'at_most',
      value: 10,
      unit: '%',
      label: 'Churn rate',
    },
    preconditions: { graph_hash: overrides?.graph_hash ?? HASH },
    expires_at_turn_count: overrides?.expires_at_turn_count ?? 2,
    expires_at_iso: overrides?.expires_at_iso ?? '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-08-08T00:00:00.000Z',
  } as PendingAction;
}

function run(input?: {
  message?: string;
  pendings?: readonly PendingAction[];
  currentGraphHash?: string | undefined;
  nodes?: ReadonlyArray<{ id?: unknown; label?: unknown }>;
}) {
  return tryBaselineElicitationResume({
    message: input?.message ?? 'about 12%',
    pendingActions: input?.pendings ?? [pending()],
    nowMs: NOW_MS,
    ...(input && 'currentGraphHash' in input
      ? input.currentGraphHash !== undefined
        ? { currentGraphHash: input.currentGraphHash }
        : {}
      : { currentGraphHash: HASH }),
    graphNodes: input?.nodes ?? NODES,
  });
}

describe('2.918 resume — the matched path', () => {
  it('sole live question + matching hash + live target + bare answer → matched, by identity', () => {
    const r = run();
    expect(r.matched).toBe(true);
    if (r.matched) {
      expect(r.pending.action.target_id).toBe('o-churn-rate');
      expect(r.targetLabel).toBe('Churn rate');
    }
  });

  it('a full-sentence answer for the target also matches (the #868 grammar limb)', () => {
    const r = run({ message: 'Churn rate is about 12% today.' });
    expect(r.matched).toBe(true);
  });

  it('the LIVE label is used, so a renamed-but-hash-stable target still binds elliptically', () => {
    const r = run({
      nodes: [
        { id: 'o-churn-rate', label: 'Monthly churn rate' },
        { id: 'g-revenue', label: 'Revenue' },
      ],
    });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.targetLabel).toBe('Monthly churn rate');
  });
});

describe('2.918 resume — every gate fails closed, in order', () => {
  it('no pending question', () => {
    expect(run({ pendings: [] })).toEqual({
      matched: false,
      skip_reason: 'no_pending_question',
    });
  });

  it('TWO live questions are ambiguous for a bare number — neither is claimed', () => {
    expect(
      run({
        pendings: [
          pending(),
          pending({ id: 'pa-2', target_id: 'g-revenue', target_label: 'Revenue' }),
        ],
      }),
    ).toEqual({ matched: false, skip_reason: 'no_pending_question' });
  });

  it('an expired question (wall clock) is no question', () => {
    expect(
      run({ pendings: [pending({ expires_at_iso: '2020-01-01T00:00:00.000Z' })] }),
    ).toEqual({ matched: false, skip_reason: 'no_pending_question' });
  });

  it('an expired question (turn count) is no question', () => {
    expect(run({ pendings: [pending({ expires_at_turn_count: 0 })] })).toEqual({
      matched: false,
      skip_reason: 'no_pending_question',
    });
  });

  it('graph hash divergence (mutating kind: the replay carries a persisted value)', () => {
    expect(run({ currentGraphHash: 'sha256:diverged' })).toEqual({
      matched: false,
      skip_reason: 'graph_diverged',
    });
  });

  it('MISSING live hash is a divergence, not a pass (fail closed on either side)', () => {
    expect(run({ currentGraphHash: undefined })).toEqual({
      matched: false,
      skip_reason: 'graph_diverged',
    });
  });

  it('the target has left the graph', () => {
    expect(
      run({ nodes: [{ id: 'g-revenue', label: 'Revenue' }] }),
    ).toEqual({ matched: false, skip_reason: 'target_missing' });
  });

  it('a message that does not parse as a level answer is not claimed', () => {
    expect(run({ message: 'what do you mean by that?' })).toEqual({
      matched: false,
      skip_reason: 'not_an_answer',
    });
  });

  it('an answer that binds a COMPETING live label is ambiguous — not claimed (2.960 R2 population)', () => {
    expect(
      run({
        message: 'The rate is 12% today.',
        nodes: [
          { id: 'o-churn-rate', label: 'Churn rate' },
          { id: 'o-win', label: 'Win rate' },
        ],
      }),
    ).toEqual({ matched: false, skip_reason: 'not_an_answer' });
  });

  it('a full sentence about a DIFFERENT metric is not an answer for this target', () => {
    expect(
      run({
        message: 'Win rate is 12% today.',
        nodes: [
          { id: 'o-churn-rate', label: 'Churn rate' },
          { id: 'o-win', label: 'Win rate' },
        ],
      }),
    ).toEqual({ matched: false, skip_reason: 'not_an_answer' });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ROADMAP 2.1361
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⭐⭐ THE DISCRIMINATING CONTROL THE EXTRACTOR SUITE CANNOT PROVIDE.
 *
 * `deriveElicitedBaselineAnswerPercent('about 12%', <any non-empty label>)`
 * returns 12 — the elliptical limb is referent-blind by contract, and that is
 * pinned as fixture rot in `stated-level-elicited-answer.test.ts`. So the
 * extractor suite's old self-declared "POSITIVE CONTROL" (pass the real label,
 * assert it binds) was a guard agreeing with itself: it passes identically
 * whether or not the referent is the one the question asked about.
 *
 * The referent is supplied HERE, by the pending. These tests are a
 * DISCRIMINATING PAIR in the CLAUDE.md trap-19 sense: the same message is sent
 * three times with the pending's target MOVED, and the bound referent must
 * move with it. A gate that bound "any label" — or that read the referent from
 * the node list rather than from the question — returns the same answer all
 * three times and fails.
 */
describe('2.1361 — the gate, not the grammar, supplies the referent', () => {
  const TWO_NODES = [
    { id: 'o-churn-rate', label: 'Churn rate' },
    { id: 'o-win', label: 'Win rate' },
  ];

  it('ROT MUTANT A: move the pending to the OTHER node and the SAME message binds the OTHER referent', () => {
    const asked = run({ message: '30', pendings: [pending()], nodes: TWO_NODES });
    const rotted = run({
      message: '30',
      pendings: [pending({ target_id: 'o-win', target_label: 'Win rate' })],
      nodes: TWO_NODES,
    });
    expect(asked.matched).toBe(true);
    expect(rotted.matched).toBe(true);
    if (asked.matched && rotted.matched) {
      expect(asked.targetLabel).toBe('Churn rate');
      expect(rotted.targetLabel).toBe('Win rate');
      // The discrimination itself. Without this the pair proves nothing: two
      // matches are consistent with a gate that binds anything.
      expect(rotted.targetLabel).not.toBe(asked.targetLabel);
      expect(rotted.pending.action.target_id).not.toBe(asked.pending.action.target_id);
    }
  });

  it('ROT MUTANT B: point the pending at a node that is not in the graph and NOTHING binds', () => {
    expect(
      run({
        message: '30',
        pendings: [pending({ target_id: 'o-not-in-graph', target_label: 'Churn rate' })],
        nodes: TWO_NODES,
      }),
    ).toEqual({ matched: false, skip_reason: 'target_missing' });
  });

  it('PRECONDITION PIN: the message alone carries no referent, so the pair above is the gate’s doing', () => {
    // Trap 13b — a discriminator must pin its own precondition in-test. If
    // '30' ever became label-sensitive, the pair above would be measuring the
    // grammar rather than the gate, and this assertion goes red first.
    expect(deriveElicitedBaselineAnswerPercent('30', 'Churn rate')).toBe(30);
    expect(deriveElicitedBaselineAnswerPercent('30', 'Win rate')).toBe(30);
    expect(deriveElicitedBaselineAnswerPercent('30', 'Zzz Unrelated Metric')).toBe(30);
  });
});

/**
 * ROADMAP 2.1361 change 4 — CROSS-KIND AMBIGUITY.
 *
 * `findSoleLiveElicitBaselinePending` used to filter to kind FIRST and only
 * then check that exactly one survived, so a different-kind ask sitting
 * alongside did not block anything and a bare "12%" bound to the baseline
 * question regardless of which question the user meant. With bare numbers now
 * binding, "12" is a plausible reply to either.
 */
describe('2.1361 — a live ask that also wants a number blocks the bare-number bind', () => {
  function otherElicit(kind: 'elicit_option_effect' | 'run_analysis'): PendingAction {
    const base = pending({ id: 'pa-other' });
    return {
      ...base,
      action:
        kind === 'elicit_option_effect'
          ? {
              kind: 'elicit_option_effect',
              option_id: 'opt-1',
              option_label: 'Option A',
              factor_id: 'f-quality',
              factor_label: 'Product quality',
            }
          : { kind: 'run_analysis' },
    } as PendingAction;
  }

  it('a live elicit_option_effect ("a number from 0 to 1") makes a bare number ambiguous — neither is claimed', () => {
    expect(
      run({ message: '30', pendings: [pending(), otherElicit('elicit_option_effect')] }),
    ).toEqual({ matched: false, skip_reason: 'no_pending_question' });
  });

  it('CONTRAST CONTROL: a co-resident run_analysis chip does NOT block — otherwise the feature is dark', () => {
    // The ask turn's own commit merges the baseline pending with chip-derived
    // pendings, so co-residence is the NORMAL case. A gate widened to "sole
    // among ALL live pendings" would never open, and would read as green.
    const r = run({ message: '30', pendings: [pending(), otherElicit('run_analysis')] });
    expect(r.matched).toBe(true);
    if (r.matched) expect(r.targetLabel).toBe('Churn rate');
  });
});

/**
 * ROADMAP 2.1361 change 5 — the answer that must be ANSWERED, not ignored.
 * `unusable_answer` is the ONLY non-match that speaks; every other one keeps
 * its pre-2.1361 silence so a user who has moved on is never hijacked.
 */
describe('2.1361 — unusable answers re-ask; everything else stays silent', () => {
  const unusable = ['maybe 12%', '10-15%', '12% or 15%', '120%', 'about 12%, I think', '12 or 15'];

  it.each(unusable.map((m) => [m] as const))('"%s" → unusable_answer, carrying the referent', (message) => {
    const r = run({ message });
    expect(r.matched).toBe(false);
    if (!r.matched && r.skip_reason === 'unusable_answer') {
      // The re-ask must be able to NAME the target and RE-PERSIST the
      // question; a reason without these two would be a dead end.
      expect(r.targetLabel).toBe('Churn rate');
      expect(r.pending.action.target_id).toBe('o-churn-rate');
    } else {
      expect(r).toMatchObject({ skip_reason: 'unusable_answer' });
    }
  });

  it('ANTI-HIJACK: a changed subject is still SILENT, not a re-ask', () => {
    for (const message of [
      'Actually, can we talk about pricing instead?',
      'Please add 3 more factors',
      'what do you mean by that?',
    ]) {
      expect(run({ message })).toEqual({ matched: false, skip_reason: 'not_an_answer' });
    }
  });

  it('a LAPSED or DIVERGED question never re-asks, whatever the message looks like', () => {
    // The pending is unsafe to replay, so speaking about it would promise
    // something the product cannot then honour.
    expect(run({ message: '10-15%', currentGraphHash: 'sha256:diverged' })).toEqual({
      matched: false,
      skip_reason: 'graph_diverged',
    });
    expect(
      run({ message: '10-15%', pendings: [pending({ expires_at_turn_count: 0 })] }),
    ).toEqual({ matched: false, skip_reason: 'no_pending_question' });
  });
});
