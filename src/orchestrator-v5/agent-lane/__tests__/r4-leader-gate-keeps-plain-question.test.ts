/**
 * ⭐ R4 (DL ruling 12 Oct; score run 3, hiring step 12; §7.3 C: stop the filter deleting the product's own explanation).
 *
 * Served (CEE 3fdf0f38, `live/runs/2026-10-12T153555Z/hiring/turns/13.json`): "I need one clarification before I can
 * prepare a faithful update." reached the user with no question. The served log shows this gate dropped one sentence
 * first (`agent_lane.withheld_leader_ranking_dropped`: dropped_sentences 1, goal_path_unsized, 494 → 585 characters with
 * its closing, so about 74 characters removed). Its words are not stored anywhere (UNVERIFIED).
 *
 * The rule: a QUESTION holding no digit, percentage, currency, comparator or leader word cannot carry a figure or a leader
 * claim, so it passes the gate unchanged. Everything else still goes. The question below is CONSTRUCTED to the served
 * shape (about 74 characters, goal_path_unsized; the reply around it is the served reply), not the served words.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { enforceAgentLaneLeaderClaimsAtWire, questionCarriesNoClaim, rankingCodesIn } from '../withheld-leader-fail-closed.js';
import { log } from '../../../utils/telemetry.js';

/** The served hiring-12 reply as it reached the composer (the gate's closing aside). */
const SERVED = 'I need one clarification before I can prepare a faithful update.\n\n'
  + '- Keep “Delivery capacity” at today’s relative baseline.\n- Add non-development time as a separate factor.\n'
  + '- Leave hiring effects and quality measures unresolved.\n\n'
  + 'The available update stores one starting percentage, not your full **20–30% range**. I shouldn’t silently choose a '
  + 'midpoint or invent how either hire changes it. Nothing has been changed yet.';
/** CONSTRUCTED: a plain clarification question of the served dropped length. */
const QUESTION = 'Do you lean towards holding “Delivery capacity” at today’s baseline now?';

const link = { from: 'tech_leads_hired', to: 'leadership_capacity', from_label: 'Tech leads hired', to_label: 'Leadership capacity' };
const graph = { nodes: [
  { id: link.from, kind: 'factor', label: link.from_label },
  { id: link.to, kind: 'goal', label: link.to_label },
], edges: [{ from: link.from, to: link.to }] };
const analysisReady = { analysis_admission: { permitted_analysis_mode: 'comparative_leader', reasons: [] } };
const response = (text: string): OlumiResponse => ({
  assistant_text: text,
  blocks: [{ type: 'analysis_result', enrichment: {
    inference_warnings: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', links: [link], node_ids: [link.from, link.to] }],
  } }], suggested_actions: [],
  analysis_state: { leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
} as unknown as OlumiResponse);
const gate = (text: string) => enforceAgentLaneLeaderClaimsAtWire(response(text), { requestId: 'r4-h12', exitPath: 'agent_lane_v1',
  mayNameLeadingOption: false, leaderClaimWithheldReason: 'goal_path_unsized', graph, analysisReady });
const logged = (spy: ReturnType<typeof vi.spyOn>, event: string): Record<string, unknown>[] =>
  spy.mock.calls.map((c: unknown[]) => c[0] as Record<string, unknown>).filter((o) => o?.event === event);

afterEach(() => vi.restoreAllMocks());

describe('R4 hiring 12: a plain question passes the withheld-leader gate unchanged', () => {
  it('IDENTITY (constructed): the served dropped length, and today\'s classifier reads it as a leader phrase', () => {
    // 494 → 420 characters before the closing: the sentence and its separator were 74.
    expect(QUESTION.length + '\n\n'.length).toBe(494 - 420);
    expect(rankingCodesIn(QUESTION)).toEqual(['lean']);
  });
  it('the question reaches the user, byte for byte; nothing is dropped and no closing is added', () => {
    const text = `${SERVED}\n\n${QUESTION}`;
    const out = gate(text);
    expect(out.response.assistant_text).toBe(text);
  });
  it('the kept question is logged by its codes and length, never its words', () => {
    const spy = vi.spyOn(log, 'info');
    gate(`${SERVED}\n\n${QUESTION}`);
    const [row] = logged(spy, 'agent_lane.withheld_leader_question_kept');
    expect(row).toMatchObject({ withheld_reason: 'goal_path_unsized', questions_kept: [{ codes: ['lean'], interrogative: true, length: QUESTION.length }] });
    expect(JSON.stringify(row)).not.toContain('Delivery');
  });
});

describe('R4 controls: what can carry a figure or a leader claim still goes', () => {
  it.each([
    // One category each, so each check is pinned on its own.
    ['a figure', 'Do you lean towards keeping “Delivery capacity” at 25%?', ['lean']],
    ['a bare number', 'Do you lean towards holding “Delivery capacity” at 80 tickets now?', ['lean']],
    ['a percentage in words', 'Do you lean towards a per cent target for delivery?', ['lean']],
    ['currency', 'Do you lean towards stating the budget in pounds?', ['lean']],
    ['a comparator', 'Do you lean towards more developers than seniors?', ['lean']],
    ['a leader word', 'Do you lean towards whichever option leads?', ['lean', 'lead']],
  ] as const)('a question with %s is still dropped, and the log says why (codes, interrogative, length; no words)', (_name, question, codes) => {
    const spy = vi.spyOn(log, 'info');
    expect(questionCarriesNoClaim(question)).toBe(false);
    const out = gate(`${SERVED}\n\n${question}`);
    expect(String(out.response.assistant_text)).not.toContain(question);
    const [row] = logged(spy, 'agent_lane.withheld_leader_ranking_dropped');
    expect(row).toMatchObject({ dropped_sentences: 1, withheld_reason: 'goal_path_unsized', questions_kept: [] });
    expect(row!.dropped).toEqual([{ codes: expect.arrayContaining([...codes]), interrogative: true, length: question.length }]);
    expect(JSON.stringify(row)).not.toContain('lean towards');
  });
  it('a statement of the same lean is still dropped (not a question)', () => {
    const statement = 'The model leans towards keeping “Delivery capacity” at today’s relative baseline.';
    const spy = vi.spyOn(log, 'info');
    const out = gate(`${SERVED}\n\n${statement}`);
    expect(String(out.response.assistant_text)).not.toContain(statement);
    expect(logged(spy, 'agent_lane.withheld_leader_ranking_dropped')[0]!.dropped).toEqual([{ codes: ['lean'], interrogative: false, length: statement.length }]);
  });
});
