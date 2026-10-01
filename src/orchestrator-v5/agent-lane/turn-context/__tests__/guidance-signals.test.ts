/**
 * AI HARNESS T2: the Reasoning Coach's signals, assembled from the OWNERS' readers, checked against the contract's
 * SERVED cases (programme-docs `rc/reasoning-coach-20261001` @d9d9e340: "for served cases also derive the signals from
 * `source.capture` with your own readers and compare to `state`"). The captures are served Agent responses from R3's
 * F5 runs on 1 Oct, so the corpus comes from the wire, not from this author.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleGuidanceSignals, type GuidanceSignalInputs } from '../guidance-signals.js';
import { detectSameLeverOptions } from '../../../../cee/structure/index.js';

type Case = { id: string; capture: string; capture_sha256: string; capture_sha_matches_case: boolean; body: Record<string, any>; expected_state: Record<string, unknown> };
const F = JSON.parse(readFileSync(new URL('./fixtures/rc-served-signal-cases.json', import.meta.url), 'utf8')) as { cases: Case[] };

/** Inputs, not derivations: the request kind, the persisted guidance and the explicit request come from the turn. */
const INPUT_KEYS = new Set(['turn.request', 'guidance', 'user.explicit_request']);

const inputsOf = (c: Case): GuidanceSignalInputs => ({
  request: c.expected_state['turn.request'] as GuidanceSignalInputs['request'],
  // The decision point is the reply's specific controls: every chip but the static next steps (as served).
  offeredSpecific: (c.body.suggested_action_ids as string[]).filter((id) => !id.startsWith('agent-next-')).map((id) => ({ id })),
  graph: c.body.draft_graph,
  analysisState: c.body.analysis_state,
  analysisResult: c.body.analysis_result,
  optionParticipation: c.body.option_participation,
});

describe('guidance signals from served captures (RC derivation check)', () => {
  it('the corpus is the contract\'s: 9 served cases, each capture byte-identical to the one the case names', () => {
    expect(F.cases).toHaveLength(9);
    expect(F.cases.every((c) => c.capture_sha_matches_case)).toBe(true);
  });

  for (const c of F.cases) {
    it(`RED ${c.id}: every derived signal equals the case's state`, () => {
      const got = assembleGuidanceSignals(inputsOf(c)) as unknown as Record<string, unknown>;
      const derived = Object.keys(c.expected_state).filter((k) => !INPUT_KEYS.has(k));
      expect(derived.length, 'vacuity: the case states derived signals').toBeGreaterThan(15);
      for (const k of derived) expect(got[k], k).toEqual(c.expected_state[k]);
    });
  }

  it('CONTRAST: F1\'s same-lever detector on the canonical shape as stored sees no levers; the projection is what makes it true', () => {
    const d2 = F.cases.find((c) => c.id === 'A-D2-RUN2-WIDEN-P1')!;
    expect(detectSameLeverOptions(d2.body.draft_graph, 0.6).detected).toBe(false);
    expect(assembleGuidanceSignals(inputsOf(d2))['model.same_lever']).toBe(true);
  });

  it('the ONE licence wins when the caller has it: a withheld licence names no leader even if leader_claim says permitted', () => {
    const c = F.cases.find((x) => x.id === 'A-WHAT-CHANGES-NONE-MEASURABLE-SILENT')!;
    const permitted = { ...c.body.analysis_state, leader_claim: { ...(c.body.analysis_state.leader_claim ?? {}), permitted: true } };
    const out = assembleGuidanceSignals({ ...inputsOf(c), analysisState: permitted, leaderLicensed: false });
    expect(out['run.leader_licensed']).toBe(false);
    expect(out['run.leader_option_id']).toBeNull();
  });

  it('TOTAL: no model, a malformed graph or a missing run reads as nothing to coach, never a throw', () => {
    for (const graph of [undefined, null, 'x', { nodes: 'x' }, { nodes: [{ kind: 'goal' }], edges: [{}] }]) {
      const out = assembleGuidanceSignals({ request: 'turn', offeredSpecific: [], graph, analysisState: undefined, analysisResult: undefined });
      expect(out['model.goal_present']).toBe(false);
      expect(out['model.goal_path_links']).toEqual([]);
      expect(out['run.decision_sensitivity']).toEqual({ status: 'not_measured' });
    }
  });
});
