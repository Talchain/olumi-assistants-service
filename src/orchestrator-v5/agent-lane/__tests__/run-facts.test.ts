/**
 * ⭐ S7 STEP 1 — the ONE Run-facts packet (arch12/7; DL 15 Oct): every AI call after a Run reads `run_facts` in canonical state,
 * built once from the owners' readers, typed, with the AIE's exact disclosures as `must_say`. Through the REAL
 * `get_canonical_state` on two served reads: capacity post3010 (a level goal) and marketing 7f5659fd (reopen).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { runFactsOf } from '../run-facts.js';
import { goalChanceFactsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { decisionSensitivityOf } from '../decision-sensitivity.js';

type Rec = Record<string, any>;
const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'user-a', request_id: 'req-1' };
const BRIEFS: readonly [string, Rec][] = [
  ['capacity post3010', (JSON.parse(readFileSync('tests/fixtures/zero-spread/served-capacity-post3010-read01-20261014.json', 'utf8')) as Rec).body],
  ['marketing 7f5659fd', JSON.parse(readFileSync('tests/fixtures/reply-face-p2/marketing-7f5659fd-reopen.json', 'utf8')) as Rec],
];
const read = async (body: Rec): Promise<Rec> => {
  const caps = createAgentCapabilities((async () => ({ status: 200, json: structuredClone(body) })) as never, new ProposalStore());
  const r = (await dispatchTool('get_canonical_state', '{}', ctx, caps)) as Rec;
  expect(r.ok).toBe(true);
  return r;
};
const warningsOf = (result: Rec): Rec[] => [...(result.enrichment?.inference_warnings ?? []), ...(result.inference_warnings ?? [])];

describe('S7 step 1: ONE Run-facts packet in canonical state, built from the owners’ readers', () => {
  it.each(BRIEFS)('%s: run_facts is THIS current Run’s chances, typed withheld reasons, sensitivity and the AIE’s disclosures', async (_n, body) => {
    const r = await read(body);
    const facts = r.run_facts as Rec;
    expect(facts.current).toBe(true);
    // The chances are the licence's own facts (the same builder both Agent doors read), never a second derivation.
    expect(facts.chances).toEqual(goalChanceFactsForAgent(body.analysis_result, body.graph, true));
    // Every GOAL_FIGURES_* record, typed: its code and options, and nothing invented.
    const recorded = warningsOf(body.analysis_result).filter((w) => String(w.code).startsWith('GOAL_FIGURES_'));
    expect((facts.withheld as Rec[]).map((w) => [w.code, w.option_ids])).toEqual(recorded.map((w) => [w.code, w.option_ids ?? []]));
    expect(facts.sensitivity.measured).toBe(decisionSensitivityOf(body.analysis_result.enrichment).status === 'measured');
    expect(facts.must_say).toEqual(facts.chances.goal_chance_notes ?? []);
    // Contrast: the packet carries something on each served Run.
    expect(Object.keys(facts.chances).length + facts.withheld.length).toBeGreaterThan(0);
  });

  it('a Run that is not current gives no current facts (never read as this model’s result)', () => {
    const [, body] = BRIEFS[0]!;
    const stale = runFactsOf(body.analysis_result, body.graph, false);
    expect(stale).toMatchObject({ current: false, chances: {}, withheld: [], sensitivity: { measured: false }, must_say: [] });
  });

  it('the user’s recorded statements ride in the packet, verbatim', () => {
    const [, body] = BRIEFS[0]!;
    const g = structuredClone(body.graph);
    const goal = (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
    const quote = 'We measure capacity as tickets closed per week.';
    goal.user_statements = [{ subject_key: `goal|${goal.id}|||measure`, field: 'measure', recorded_at: '2026-10-15T01:00:00Z',
      statements: [{ speaker: 'user', quote, source: quote, subject: { quantity: 'measure', node_id: goal.id }, form: 'describes', reading: 'olumi' }] }];
    expect(runFactsOf(body.analysis_result, g, true).user_statements).toEqual([{ node_id: goal.id, field: 'measure', said: [quote] }]);
  });
});
