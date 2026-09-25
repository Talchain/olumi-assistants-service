/**
 * ⛔ THE WITHHELD-LEADER GATE, THREE CLASSES (AI Quality corpus v6; policy #63 5824816357, challenge 5824757866).
 *
 * When `leader_may_be_named` is false:
 *   C1 FORBIDDEN — an overall leader, a ranking, a hint or recommendation, or win percentages used as ranking
 *      evidence ("favours", "strongest", "ahead", "performs better"…). The gate must REMOVE or replace it.
 *   C2 PERMISSIBLE SCOPED — a metric-specific comparison the supplied analysis directly supports, with the
 *      metric and scope named, provenance/limitation kept, and no implied overall preference. The gate must
 *      KEEP it: a gate that passes C1 by deleting C2 deletes honest science.
 *   C3 GROUNDING FAILURE — a comparison worded beyond its evidence (e.g. "higher distribution" when only the
 *      mean or median differ). Not the leader gate's defect to fix; the gate MAY drop it (fail-safe), and
 *      the test asserts nothing about it.
 * Every other sentence must survive (removal is over-suppression; an appended disclosure is allowed).
 *
 * ⭐ SCOPE — PAUL'S RULING (programme-docs#38 5576895511, 7 Sep): a run that SEPARATES its options and whose
 * admission is `quantified_provisional` is "caveat, not withhold". The gate's separable-provisional arm
 * implements it: a qualified claim is PERMITTED with `PROVISIONAL_FIGURES_CAVEAT` appended. So C1 is a
 * removal requirement ONLY in withhold states (entitlement withheld, near tie, or no separation). In a
 * separable-provisional state (paid search here) the requirement is: the caveat is appended and nothing is
 * removed. The Agent's own `claim_permissions` (first-analysis.ts `claimPermissionsFrom`) does not yet follow
 * this ruling — raised separately; this test pins the GATE.
 *
 * The 43 replies are v5's real gpt-5.6-terra replies with their SERVED states, relabelled by two independent
 * blind labellers against the policy text plus the typed option_comparison each reply was written from, and
 * adjudicated where they disagreed. v5's binary labels are kept in the fixture as history (`v5_label`).
 * The paired controls are AUTHORED, grounded in each state's own numbers: a C2 sentence that must be kept
 * beside a C1 sentence that must be removed, in the same reply.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PROVISIONAL_FIGURES_CAVEAT } from '../leading-option-wire-enforcement.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../../agent-lane/withheld-leader-fail-closed.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';

type LeaderClaim = { permitted?: boolean; separation?: string; withheld_reason?: string };
type State = { draft_graph: unknown; analysis_state: { leader_claim?: LeaderClaim }; analysis_ready: unknown };
interface Item { id: string; state: string; text: string; C1: string[]; C2: string[]; C3: string[]; v5_label?: string; authored?: boolean }
const fx = JSON.parse(readFileSync(new URL('./fixtures/leader-gate-v6.json', import.meta.url), 'utf8')) as { states: Record<string, State>; replies: Item[]; controls: Item[] };

const norm = (t: string): string => t.replace(/\*\*/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[-‐-—]/g, ' ').replace(/\s+/g, ' ').toLowerCase().trim();
const sentences = (t: string): string[] => t.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 0);

function gated(r: Item): string {
  const st = fx.states[r.state]!;
  const claim: LeaderClaim = st.analysis_state.leader_claim ?? {};
  const g = enforceAgentLaneLeaderClaimsAtWire(
    { assistant_text: r.text, blocks: [], suggested_actions: [], analysis_state: st.analysis_state } as unknown as OlumiResponse,
    {
      requestId: 'leader-gate-v6', exitPath: 'agent_lane_v1', mayNameLeadingOption: claim.permitted === true,
      separationEstablished: claim.separation === 'separated',
      ...(typeof claim.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
      graph: st.draft_graph, analysisReady: st.analysis_ready,
    },
  );
  return norm(String((g.response as { assistant_text?: unknown }).assistant_text ?? ''));
}
const all = [...fx.replies, ...fx.controls];
/** Paul's separable-provisional population: permitted, separated, admission `quantified_provisional`. */
const separableProvisional = (r: Item): boolean => {
  const st = fx.states[r.state]!; const c = st.analysis_state.leader_claim ?? {};
  const mode = (st.analysis_ready as { analysis_admission?: { permitted_analysis_mode?: string } } | null)?.analysis_admission?.permitted_analysis_mode;
  return c.permitted === true && c.separation === 'separated' && mode === 'quantified_provisional';
};
const withhold = all.filter((r) => !separableProvisional(r));
const caveat = all.filter(separableProvisional);

describe('the withheld-leader gate removes only C1, keeps C2 and every unlabelled sentence', () => {
  it('the fixture is what it claims: every span is in its own reply, and every control pairs a C1 with a C2', () => {
    for (const r of all) for (const s of [...r.C1, ...r.C2, ...r.C3]) expect(norm(r.text), `${r.id}: ${s}`).toContain(norm(s));
    for (const c of fx.controls) expect([c.C1.length > 0, c.C2.length > 0], c.id).toEqual([true, true]);
  });

  it('the fixture spans both populations (withhold and separable-provisional)', () => {
    expect([withhold.length > 0, caveat.length > 0]).toEqual([true, true]);
  });

  it.each(caveat.map((r) => [r.id, r] as const))('%s: separable provisional — the provisional caveat is appended, nothing removed', (_id, r) => {
    const out = gated(r);
    expect(out, 'the qualified claim carries the provisional caveat').toContain(norm(PROVISIONAL_FIGURES_CAVEAT));
    expect(sentences(r.text).filter((x) => !out.includes(norm(x))), 'caveat, not withhold').toEqual([]);
  });

  it.each(withhold.filter((r) => r.C1.length > 0).map((r) => [r.id, r] as const))('%s: withhold state — no C1 span survives', (_id, r) => {
    const out = gated(r);
    expect(r.C1.filter((s) => out.includes(norm(s))), 'a withheld overall leader reached the user').toEqual([]);
  });

  it.each(all.filter((r) => r.C2.length > 0).map((r) => [r.id, r] as const))('%s: every C2 scoped comparison survives', (_id, r) => {
    const out = gated(r);
    expect(r.C2.filter((s) => !out.includes(norm(s))), 'the gate deleted a supported, scoped comparison').toEqual([]);
  });

  it.each(withhold.map((r) => [r.id, r] as const))('%s: every sentence outside C1/C3 survives', (_id, r) => {
    const out = gated(r);
    const flagged = [...r.C1, ...r.C3].map(norm);
    const lost = sentences(r.text).filter((x) => !flagged.some((f) => norm(x).includes(f) || f.includes(norm(x))) && !out.includes(norm(x)));
    expect(lost, 'the gate removed part of a reply that is not a leader leak').toEqual([]);
  });
});
