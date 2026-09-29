/**
 * ⛔ THE WITHHELD-LEADER GATE AGAINST REAL MODEL WORDING (AI Quality corpus; #63 5823028488, Codex 5823210765).
 *
 * The fixture holds 17 real gpt-5.6-terra replies to one explicit Run with the leader WITHHELD, on the served
 * `57f903c` pricing state (`constraint_verdict_withheld`, admission mode `comparative_leader`). None of them
 * was written by a test author.
 * - Labels come from three sources: the deterministic reply scorer, the independent blind reviewer (#63
 *   5822982121) and a blind fresh-context classifier.
 * - Measured at `714677d5`, the gate caught 1 of the 13 that name a leader, because the model paraphrases
 *   option labels ("the £59-at-release path…").
 *
 * BOUND BY IDENTITY. Each named leak phrase must be ABSENT from the gated text, so a gate that edits
 * something else and leaves the leak still fails.
 * - Clean replies must come back unchanged.
 * - The permitted contrast shows the test does not simply reward suppressing everything.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// The Agent lane's wire gate — the fail-closed ranking drop, then the shared gate — which is what
// `routes/agent-v1-turn.ts` calls. (Retargeted from the shared gate by OpenAI Runtime; assertions unchanged.)
import { enforceAgentLaneLeaderClaimsAtWire } from '../../agent-lane/withheld-leader-fail-closed.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

type LeaderClaim = { permitted: boolean; separation?: string; withheld_reason?: string };
interface Reply { id: string; label: 'names_leader' | 'clean'; leak_phrases: string[]; text: string }
const fx = JSON.parse(readFileSync(new URL('./fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: LeaderClaim }; analysis_ready: unknown };
  replies: Reply[];
};
const { draft_graph: graph, analysis_state: withheldState, analysis_ready: analysisReady } = fx.state;
const permittedState = { ...withheldState, leader_claim: { permitted: true, separation: 'separated' } as LeaderClaim };

/** Case, markdown emphasis, quote style and hyphenation do not change what a sentence claims. */
const norm = (t: string): string => t.replace(/\*\*/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[-‐-—]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();

function gate(text: string, permitted: boolean) {
  const state = permitted ? permittedState : withheldState;
  const claim: LeaderClaim = state.leader_claim;
  return enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: text, blocks: [], suggested_actions: [], analysis_state: state } as unknown as OlumiResponse,
    {
      requestId: 'leader-gate-real-replies', exitPath: 'agent_lane_v1', mayNameLeadingOption: claim.permitted === true,
      separationEstablished: claim.separation === 'separated',
      ...(typeof claim.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
      graph, analysisReady,
    },
  );
}
const textOf = (r: ReturnType<typeof gate>): string => String((r.response as { assistant_text?: unknown }).assistant_text ?? '');
const leaking = fx.replies.filter((r) => r.label === 'names_leader');
const clean = fx.replies.filter((r) => r.label === 'clean');

describe('the withheld-leader wire gate on real model wording', () => {
  it('the fixture is what it claims: 13 leaking replies, 4 clean, and every leak phrase occurs in its own reply', () => {
    expect([leaking.length, clean.length]).toEqual([13, 4]);
    for (const r of leaking) {
      expect(r.leak_phrases.length, r.id).toBeGreaterThan(0);
      for (const p of r.leak_phrases) expect(norm(r.text), `${r.id}: ${p}`).toContain(norm(p).replace(/\.$/, ''));
    }
  });

  it('PRESENT CONTROL: an exact-label leader claim is rewritten on these inputs', () => {
    expect(gate('Raise Pro to £59 at release leads the comparison.', false).changed).toBe(true);
  });

  it.each(leaking.map((r) => [r.id, r] as const))('RED at 714677d5 — %s: no leak phrase survives the gate', (_id, r) => {
    const out = norm(textOf(gate(r.text, false)));
    const survivors = r.leak_phrases.filter((p) => out.includes(norm(p).replace(/\.$/, '')));
    expect(survivors, 'a leader claim reached the user while the typed claim withholds one').toEqual([]);
  });

  it.each(clean.map((r) => [r.id, r] as const))('%s: a clean reply is returned unchanged', (_id, r) => {
    const g = gate(r.text, false);
    expect(g.changed).toBe(false);
    expect(textOf(g)).toBe(r.text);
  });

  it('CONTRAST: with the leader PERMITTED, the same 13 replies pass through untouched (permit wins)', () => {
    expect(leaking.filter((r) => gate(r.text, true).changed).map((r) => r.id)).toEqual([]);
  });
});
