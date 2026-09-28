/**
 * The per-limit ask is MG's producer (`limitCheckAsks`). If it ever throws, the run result keeps every limit row — how
 * each limit was checked — and only the asks are lost. Companion to `limit-checks-carry-the-ask.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { StoredLimitVerdicts } from '../../../orchestrator/context/constraint-feasibility.js';

vi.mock('../limited-level-ask.js', () => ({ limitCheckAsks: () => { throw new Error('boom'); } }));

const FX = JSON.parse(readFileSync(new URL('./fixtures/pj-c10-063347Z-limits-estimate-only.json', import.meta.url), 'utf8')) as {
  graph: Record<string, unknown>; limit_verdicts: StoredLimitVerdicts;
};

describe('a throwing ask producer never costs the run its limit rows', () => {
  it('every row stays, with its sentence and without an ask', async () => {
    const { limitChecksForAgent } = await import('../limit-checks.js');
    const rows = limitChecksForAgent(FX.graph, FX.limit_verdicts)!;
    expect(rows.map((r) => r.constraint_id)).toEqual(FX.limit_verdicts.per_limit.map((r) => r.constraint_id));
    for (const r of rows) {
      expect(r.say).toMatch(/was checked, but only against Olumi’s estimates/);
      expect(r).not.toHaveProperty('ask');
    }
  });
});
