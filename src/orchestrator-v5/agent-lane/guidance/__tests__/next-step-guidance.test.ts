/**
 * AI HARNESS G1 — the guidance record and the re-entry rule (pure). Paul's 1 Oct test: "Strengthen the model" came
 * back on the reply to its own press.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_AGENT_GUIDANCE,
  MAX_GUIDANCE_ENTRIES,
  parseAgentGuidanceSnapshot,
  stateKeyHash,
  toAgentGuidanceSnapshot,
  withEntry,
} from '../../../coaching/agent-guidance-snapshot.js';
import { nextStepStateKey, recordOffers, recordPress, withoutSettledNextSteps } from '../next-step-guidance.js';
import { NEXT_STEP_CHIPS } from '../../../../routes/agent-v1-turn.js';

const RUN = (computed_at: string) => ({ run_state: { kind: 'complete_current', computed_at }, usable_for_chips: true });
const S1 = nextStepStateKey({ graphHash: 'h1', analysisState: RUN('2026-10-01T12:00:00.000Z') });
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('the re-entry rule', () => {
  it('RED: a pressed next step is not offered again in the state it was pressed in', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1');
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, S1))).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change']);
  });

  it('it returns when the saved model changes, and when a new Run lands', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1');
    const edited = nextStepStateKey({ graphHash: 'h2', analysisState: RUN('2026-10-01T12:00:00.000Z') });
    const rerun = nextStepStateKey({ graphHash: 'h1', analysisState: RUN('2026-10-01T12:05:00.000Z') });
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, edited))).toContain('agent-next-strengthen');
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, rerun))).toContain('agent-next-strengthen');
  });

  it('CONTROL: an offered (not pressed) step stays eligible; a chip that is not a next step is never recorded', () => {
    const offered = recordOffers(EMPTY_AGENT_GUIDANCE, NEXT_STEP_CHIPS, S1, 't1');
    expect(Object.keys(offered.entries).sort()).toEqual(['RC-PREMORTEM', 'RC-STRENGTHEN-ITEM', 'RC-WHAT-CHANGES']);
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, offered, S1))).toEqual(ids(NEXT_STEP_CHIPS));
    expect(recordPress(EMPTY_AGENT_GUIDANCE, 'agent-run-offer', S1, 't1')).toBe(EMPTY_AGENT_GUIDANCE);
    expect(recordOffers(EMPTY_AGENT_GUIDANCE, [{ id: 'agent-run-offer' }], S1, 't1')).toBe(EMPTY_AGENT_GUIDANCE);
  });

  it('a press is not overwritten by an offer in the same state; an unchanged offer changes nothing', () => {
    const pressed = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1');
    expect(recordOffers(pressed, NEXT_STEP_CHIPS, S1, 't2').entries['RC-STRENGTHEN-ITEM']).toEqual({ status: 'pressed', state_key_hash: S1, turn_id: 't1' });
    const offered = recordOffers(EMPTY_AGENT_GUIDANCE, NEXT_STEP_CHIPS, S1, 't1');
    expect(recordOffers(offered, NEXT_STEP_CHIPS, S1, 't2')).toBe(offered);
  });
});

describe('the persisted record', () => {
  it('round-trips through its envelope, content-free', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1');
    const env = toAgentGuidanceSnapshot(g);
    expect(env.snapshot_timing).toBe('agent_guidance');
    expect(parseAgentGuidanceSnapshot(JSON.parse(JSON.stringify(env)))).toEqual(g);
    expect(JSON.stringify(env)).not.toMatch(/Strengthen the model|strengthen this model/);
  });

  it('any drift reads as empty; bad entries are skipped, good ones kept', () => {
    for (const raw of [null, 'x', [], {}, { snapshot_timing: 'pre_dispatch' }, { snapshot_timing: 'agent_guidance', agent_guidance: { v: 2, entries: {} } }]) {
      expect(parseAgentGuidanceSnapshot(raw)).toEqual(EMPTY_AGENT_GUIDANCE);
    }
    const mixed = { snapshot_timing: 'agent_guidance', agent_guidance: { v: 1, entries: {
      'RC-PREMORTEM': { status: 'pressed', state_key_hash: S1, turn_id: 't1' },
      'RC-BAD': { status: 'shouted', state_key_hash: S1 },
      'RC-HASH': { status: 'offered', state_key_hash: 'not-a-hash' },
    } } };
    expect(Object.keys(parseAgentGuidanceSnapshot(mixed).entries)).toEqual(['RC-PREMORTEM']);
  });

  it('the state hash ignores key order; the record is bounded, oldest dropped first', () => {
    expect(stateKeyHash({ a: 1, b: 2 })).toBe(stateKeyHash({ b: 2, a: 1 }));
    expect(stateKeyHash({ a: 1 })).toMatch(/^[0-9a-f]{12}$/);
    let g = EMPTY_AGENT_GUIDANCE;
    for (let i = 0; i < MAX_GUIDANCE_ENTRIES + 5; i += 1) g = withEntry(g, `RC-STRENGTHEN-ITEM:e${i}`, { status: 'offered', state_key_hash: S1, turn_id: null });
    const keys = Object.keys(g.entries);
    expect(keys).toHaveLength(MAX_GUIDANCE_ENTRIES);
    expect(keys[0]).toBe('RC-STRENGTHEN-ITEM:e5');
    expect(keys.at(-1)).toBe(`RC-STRENGTHEN-ITEM:e${MAX_GUIDANCE_ENTRIES + 4}`);
  });
});
