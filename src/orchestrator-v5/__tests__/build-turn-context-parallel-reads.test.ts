/**
 * ⭐ PJ-C1 (DL #70 5860578805, batch 5 A): THE CONTEXT'S INDEPENDENT READS RUN TOGETHER, NOT ONE AFTER ANOTHER.
 *
 * Served journey A (`pj-20260927T223136Z`, CEE a900c1e): the median turn is an approval, 6.4–7.3 s with no model
 * call, and 2.0–2.3 s of it passes in `/orchestrate/v2/turn` before `turn_executor.started`. `buildTurnContext` read
 * the prior turns, their count, the applied-mutation and run-analysis facts and the restore marker in ONE parallel
 * batch — then read the graph + brief, the pending actions and the prior coaching state one after another, after it.
 * None of those three depends on the batch: only on the scenario, the request and the store. Each is ~150–220 ms on
 * the served store, so they cost three round trips where they could cost none.
 *
 * The row binds ORDER, not a clock: every store read records which reads had already FINISHED when it started. The
 * three must start before the batch's own prior-turns read (`readRecent`) has finished — impossible while they are
 * awaited after the batch. A CONTROL row pins that what the turn reads is unchanged (the same graph, pending actions
 * and coaching state reach the context).
 */
import { describe, expect, it } from 'vitest';

import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';

const BASE = makeMessagePayload({ message: 'yes, add it' });
const MOVED = ['loadGraphAndBriefText', 'readMostRecentPendingActions', 'readMostRecentCoachingState'] as const;
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'MRR' }], edges: [] };
const PENDING = [{ kind: 'apply_proposed_change', chip_id: 'gmh_1' }];
const COACHING = { stage: 'evaluate', marker: 'prior-coaching-state' };

/** A store whose every read waits one macrotask and records which reads had finished when it STARTED. */
function recordingStore() {
  const finished = new Set<string>();
  const finishedAtStart = new Map<string, string[]>();
  const base = createNoopSessionStore({}) as unknown as Record<string, unknown>;
  const answers: Record<string, unknown> = {
    loadGraphAndBriefText: { graph: GRAPH, briefText: 'Grow MRR to £100k' },
    readMostRecentPendingActions: PENDING,
    readMostRecentCoachingState: COACHING,
  };
  const store: Record<string, unknown> = { ...base };
  for (const name of [...Object.keys(base), 'readMostRecentCoachingState']) {
    const inner = base[name];
    if (typeof inner !== 'function' && !(name in answers)) continue;
    store[name] = async (...args: unknown[]) => {
      if (!finishedAtStart.has(name)) finishedAtStart.set(name, [...finished]);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return name in answers ? answers[name] : await (inner as (...a: unknown[]) => unknown).apply(base, args);
      } finally {
        finished.add(name);
      }
    };
  }
  return { store, finishedAtStart };
}

describe('batch 5 A: the graph + brief, pending-actions and coaching reads join the parallel batch', () => {
  it('⭐ RED: each of the three STARTS before the batch’s prior-turns read has finished', async () => {
    const { store, finishedAtStart } = recordingStore();
    const ctx = await buildTurnContext(BASE, 'req-parallel-reads', { sessionStore: store as never });
    expect(ctx).toBeDefined();
    // PRECONDITION: the probe saw the batch's own read and all three moved reads.
    expect(finishedAtStart.has('readRecent')).toBe(true);
    for (const name of MOVED) {
      expect(finishedAtStart.has(name), `${name} was never read`).toBe(true);
      expect(finishedAtStart.get(name), `${name} started after ${finishedAtStart.get(name)!.join(', ')} had finished`).not.toContain('readRecent');
    }
  });

  it('CONTROL: what the turn reads is unchanged — the same graph, pending actions and coaching state reach the context', async () => {
    const { store } = recordingStore();
    const ctx = await buildTurnContext(BASE, 'req-parallel-reads-values', { sessionStore: store as never }) as unknown as Record<string, unknown>;
    const json = JSON.stringify(ctx);
    expect(json).toContain('gmh_1');
    expect(json).toContain('prior-coaching-state');
    expect(json).toContain('Grow MRR to £100k');
  });
});
