import { describe, expect, it } from 'vitest';
import served from './fixtures/m1-s1-served-graphs.json';
import { entryKey, type GuidanceState } from '../guidance/index.js';
import { turnGuidanceFor, type TurnGuidanceInputs } from '../turn-context/guidance-wire.js';

const graph = served.cases.find(c => c.id === 'D1-sprint-run')!.graph;
const input = (): TurnGuidanceInputs => ({
  request: 'turn', offeredSpecific: [], assistantText: 'Here is where the comparison stands.', licence: 'withheld',
  state: { graph: structuredClone(graph),
    analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-01T11:52:22.669Z' } },
    optionParticipation: [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }] },
});

// Consumer contract only. The persistence producer and bounded read are separate required evidence.
const withHistory = (guidance: GuidanceState | null): TurnGuidanceInputs & { readonly guidance: GuidanceState | null } =>
  ({ ...input(), guidance });

describe('Context guidance history consumer', () => {
  it.each(['pressed', 'completed', 'dismissed'] as const)('honours the existing selector cooldown for a %s entry', status => {
    const prior = turnGuidanceFor(input())!.slot1!;
    const key = entryKey(prior.policy_id, prior.item);
    const next = turnGuidanceFor(withHistory({ [key]: { status, state_key_hash: prior.state_key_hash, turn_id: 'prior-turn' } }));
    expect(next?.slot1?.policy_id === prior.policy_id && next?.slot1?.item === prior.item
      && next?.slot1?.state_key_hash === prior.state_key_hash, 'the settled row must not be reoffered unchanged').toBe(false);
  });

  it('retains an offered row: offered is not a settled status in the existing policy', () => {
    const prior = turnGuidanceFor(input())!;
    const row = prior.slot1!;
    expect(turnGuidanceFor(withHistory({ [entryKey(row.policy_id, row.item)]: {
      status: 'offered', state_key_hash: row.state_key_hash, turn_id: 'prior-turn',
    } }))).toEqual(prior);
  });

  it('reoffers when the recorded state key differs', () => {
    const prior = turnGuidanceFor(input())!;
    const row = prior.slot1!;
    expect(turnGuidanceFor(withHistory({ [entryKey(row.policy_id, row.item)]: {
      status: 'dismissed', state_key_hash: 'a-different-state-key', turn_id: 'prior-turn',
    } }))).toEqual(prior);
  });

  it('does not treat an unreadable history as an empty one', () => {
    expect(turnGuidanceFor(withHistory(null))).toBeUndefined();
  });
});
