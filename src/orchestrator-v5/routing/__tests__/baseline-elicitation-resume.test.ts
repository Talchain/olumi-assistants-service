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
