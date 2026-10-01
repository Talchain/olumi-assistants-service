/**
 * ⭐ F1b B8 — THE AGENT'S IN-PROCESS GRAPH WRITES TAKE THEIR PLACE IN THE TURN FENCE (DL v2 §2: "the batch door has no
 * fence handle"; L4 trace 5929778726 (b)).
 *
 * `POST /agent/v1/turn` never passes `turnFencePreHandler`, so its in-process doors (`commitOptionLevelsInProcess`,
 * `commitLimitEditInProcess`, `commitOlumiOptionAdoptionInProcess`) reached the store with NO slot and wrote through
 * `no_ingress_fence`, UNFENCED. `runFencedInProcessWrite` binds the slot for the door's OWN identity and claims, as the
 * register route does; a conflict refusal is the door's `stale`, and an infrastructure refusal still throws.
 *
 * Pinned here: (1) the mechanics — inside the door the handle is claimed for the door's identity; (2) a superseded or
 * stopped refusal is `stale`, nothing else is swallowed; (3) a failed claim binds the UNCLAIMED handle, which the store
 * refuses fail-closed; (4) the Agent route wraps exactly the three graph doors (the hold doors write no graph).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { runFencedInProcessWrite } from '../turn-fence-prehandler.js';
import { currentTurnFence, TurnFenceRejectedError } from '../../orchestrator-v5/session/turn-fence.js';

const SCENARIO = '22222222-2222-4222-8222-222222222222';
const TURN = 'agent-approval-turn';

let claimThrows = false;
const claimTurnFence = vi.fn(async (scenarioId: string, turnId: string) => {
  if (claimThrows) throw new Error('db blip');
  return { scenarioId, turnId, generation: 7 };
});
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => ({ claimTurnFence }) }));

type DoorOutcome = { readonly status: 'stale' } | { readonly status: 'refused'; readonly reason: string };
const STALE: DoorOutcome = { status: 'stale' };
const REFUSED = (verdict: 'unclaimed' | 'unavailable'): DoorOutcome => ({ status: 'refused', reason: `turn_fence_${verdict}` });
const refusal = (verdict: 'superseded' | 'stopped' | 'unclaimed' | 'unavailable') =>
  new TurnFenceRejectedError(`fence ${verdict}`, { verdict, generation: 7, maxGeneration: 8 } as never);

beforeEach(() => { claimTurnFence.mockClear(); claimThrows = false; });

describe('B8: an in-process graph write is fenced for its own identity', () => {
  it('RED: the write runs with a CLAIMED handle for (scenario, turn) — never the unfenced no-slot path', async () => {
    expect(currentTurnFence(), 'PRECONDITION: outside any request there is no fence').toBeUndefined();
    const seen = await runFencedInProcessWrite(SCENARIO, TURN, async () => {
      await Promise.resolve();
      return currentTurnFence();
    }, () => undefined, () => undefined);
    expect(claimTurnFence).toHaveBeenCalledWith(SCENARIO, TURN);
    expect(seen).toEqual({ scenarioId: SCENARIO, turnId: TURN, generation: 7 });
  });

  it('a claim that throws binds the UNCLAIMED handle (generation null): the store refuses the write fail-closed', async () => {
    claimThrows = true;
    const seen = await runFencedInProcessWrite(SCENARIO, TURN, async () => currentTurnFence(), () => undefined, () => undefined);
    expect(seen).toEqual({ scenarioId: SCENARIO, turnId: TURN, generation: null });
  });

  it.each(['superseded', 'stopped'] as const)('a %s refusal is the door\'s stale — nothing was written', async (verdict) => {
    const out = await runFencedInProcessWrite(SCENARIO, TURN, async () => { throw refusal(verdict); }, () => STALE, REFUSED);
    expect(out).toBe(STALE);
  });

  // CODEX CR 5934133792: an infrastructure refusal also wrote NOTHING, so it is the door's typed refusal — never thrown
  // past the door (where a consumer could report "may have been saved").
  it.each(['unclaimed', 'unavailable'] as const)('an infrastructure refusal (%s) is the door\'s typed refusal — nothing was written', async (verdict) => {
    expect(await runFencedInProcessWrite(SCENARIO, TURN, async () => { throw refusal(verdict); }, () => STALE, REFUSED)).toEqual(REFUSED(verdict));
  });

  it('CONTROL: any other error is never swallowed as stale', async () => {
    await expect(runFencedInProcessWrite(SCENARIO, TURN, async () => { throw new Error('boom'); }, () => STALE, REFUSED)).rejects.toThrow('boom');
  });
});

describe('B8: the Agent route fences exactly its three graph doors', () => {
  const src = readFileSync(new URL('../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
  it.each(['commitOptionLevelsInProcess', 'commitLimitEditInProcess', 'commitOlumiOptionAdoptionInProcess'])('RED: %s is called only inside runFencedInProcessWrite', (door) => {
    const calls = src.split('\n').filter((l) => l.includes(`${door}(input`));
    expect(calls.length, 'PRECONDITION: the door is wired').toBeGreaterThan(0);
    for (const l of calls) expect(l).toMatch(/runFencedInProcessWrite\(input\.scenario_id, input\.turn_id, \(\) => /);
  });
  it('CONTROL: the hold doors (no graph write) are not fenced', () => {
    for (const door of ['holdAddRiskInProcess', 'holdAddFactorInProcess']) {
      const calls = src.split('\n').filter((l) => l.includes(`${door}(input`));
      expect(calls.length).toBeGreaterThan(0);
      for (const l of calls) expect(l).not.toMatch(/runFencedInProcessWrite/);
    }
  });
});
