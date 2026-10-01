/**
 * AI HARNESS G1 — the guidance record and the re-entry rule (pure). Paul's 1 Oct test: "Strengthen the model" came
 * back on the reply to its own press.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_AGENT_GUIDANCE,
  MAX_GUIDANCE_ENTRIES,
  mergeAgentGuidance,
  parseAgentGuidanceSnapshot,
  stateKeyHash,
  toAgentGuidanceSnapshot,
  withEntry,
} from '../../../coaching/agent-guidance-snapshot.js';
import { nextStepStateKey, recordOffers, recordPress, withoutSettledNextSteps } from '../next-step-guidance.js';
import { NEXT_STEP_CHIPS } from '../../../../routes/agent-v1-turn.js';

const RUN = (computed_at: string) => ({ run_state: { kind: 'complete_current', computed_at }, usable_for_chips: true });
const G = { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size', description: 'Engineers on the sprint' }], edges: [] };
const S1 = nextStepStateKey({ graph: G, analysisState: RUN('2026-10-01T12:00:00.000Z') });
const T1 = '2026-10-01T12:01:00.000Z';
const T2 = '2026-10-01T12:02:00.000Z';
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);

describe('the re-entry rule', () => {
  it('RED: a pressed next step is not offered again in the state it was pressed in', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1', T1);
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, S1))).toEqual(['agent-next-pre-mortem', 'agent-next-what-would-change']);
  });

  it('it returns when the saved model changes (a description edit too, which the analysis hash ignores), and when a new Run lands', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1', T1);
    const described = nextStepStateKey({ graph: { ...G, nodes: [{ ...G.nodes[0]!, description: 'Engineers and the PM' }] }, analysisState: RUN('2026-10-01T12:00:00.000Z') });
    const rerun = nextStepStateKey({ graph: G, analysisState: RUN('2026-10-01T12:05:00.000Z') });
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, described))).toContain('agent-next-strengthen');
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, g, rerun))).toContain('agent-next-strengthen');
  });

  it('CONTROL: an offered (not pressed) step stays eligible; a chip that is not a next step is never recorded', () => {
    const offered = recordOffers(EMPTY_AGENT_GUIDANCE, NEXT_STEP_CHIPS, S1, 't1', T1);
    expect(Object.keys(offered.entries).sort()).toEqual(['RC-PREMORTEM', 'RC-STRENGTHEN-ITEM', 'RC-WHAT-CHANGES']);
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, offered, S1))).toEqual(ids(NEXT_STEP_CHIPS));
    expect(recordPress(EMPTY_AGENT_GUIDANCE, 'agent-run-offer', S1, 't1', T1)).toBe(EMPTY_AGENT_GUIDANCE);
    expect(recordOffers(EMPTY_AGENT_GUIDANCE, [{ id: 'agent-run-offer' }], S1, 't1', T1)).toBe(EMPTY_AGENT_GUIDANCE);
  });

  it('a press is not overwritten by an offer in the same state; an unchanged offer changes nothing', () => {
    const pressed = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1', T1);
    expect(recordOffers(pressed, NEXT_STEP_CHIPS, S1, 't2', T2).entries['RC-STRENGTHEN-ITEM']).toEqual({ status: 'pressed', state_key_hash: S1, turn_id: 't1', at: T1 });
    const offered = recordOffers(EMPTY_AGENT_GUIDANCE, NEXT_STEP_CHIPS, S1, 't1', T1);
    expect(recordOffers(offered, NEXT_STEP_CHIPS, S1, 't2', T2)).toBe(offered);
  });
});

describe('the persisted record', () => {
  it('round-trips through its envelope, content-free', () => {
    const g = recordPress(EMPTY_AGENT_GUIDANCE, 'agent-next-strengthen', S1, 't1', T1);
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
      'RC-PREMORTEM': { status: 'pressed', state_key_hash: S1, turn_id: 't1', at: T1 },
      'RC-BAD': { status: 'shouted', state_key_hash: S1 },
      'RC-HASH': { status: 'offered', state_key_hash: 'not-a-hash' },
    } } };
    expect(Object.keys(parseAgentGuidanceSnapshot(mixed).entries)).toEqual(['RC-PREMORTEM']);
  });

  it('the state hash ignores key order; the record is bounded by `at`, never by key position (JSONB reorders keys)', () => {
    expect(stateKeyHash({ a: 1, b: 2 })).toBe(stateKeyHash({ b: 2, a: 1 }));
    expect(stateKeyHash({ a: 1 })).toMatch(/^[0-9a-f]{12}$/);
    let g = EMPTY_AGENT_GUIDANCE;
    const at = (i: number) => `2026-10-01T12:${String(i).padStart(2, '0')}:00.000Z`;
    for (let i = 0; i < MAX_GUIDANCE_ENTRIES + 5; i += 1) g = withEntry(g, `RC-STRENGTHEN-ITEM:e${i}`, { status: 'offered', state_key_hash: S1, turn_id: null, at: at(i) });
    // As JSONB returns it: keys in another order. The bound still drops by `at`.
    const reordered = { v: 1 as const, entries: Object.fromEntries(Object.entries(g.entries).sort(([a], [b]) => (a < b ? -1 : 1))) };
    const next = withEntry(reordered, 'RC-PREMORTEM', { status: 'pressed', state_key_hash: S1, turn_id: null, at: at(59) });
    const keys = Object.keys(next.entries);
    expect(keys).toHaveLength(MAX_GUIDANCE_ENTRIES);
    expect(keys).toContain('RC-PREMORTEM');
    expect(keys).not.toContain('RC-STRENGTHEN-ITEM:e5');
    expect(keys).toContain(`RC-STRENGTHEN-ITEM:e${MAX_GUIDANCE_ENTRIES + 4}`);
  });

  it('RED (CODEX_CLI_OVERFLOW P1): two tabs that read the same record and press different steps lose neither press once merged', () => {
    const prior = recordOffers(EMPTY_AGENT_GUIDANCE, NEXT_STEP_CHIPS, S1, 't0', '2026-10-01T12:00:00.000Z');
    const tabA = recordPress(prior, 'agent-next-strengthen', S1, 'tA', T1);
    const tabB = recordPress(prior, 'agent-next-pre-mortem', S1, 'tB', T2);
    const merged = mergeAgentGuidance([tabB, tabA]);
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, merged, S1))).toEqual(['agent-next-what-would-change']);
    // CONTROL: the newest snapshot alone (the old reader) loses tab A's press.
    expect(ids(withoutSettledNextSteps(NEXT_STEP_CHIPS, tabB, S1))).toContain('agent-next-strengthen');
  });
});
