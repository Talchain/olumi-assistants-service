/**
 * P02 (7 Oct): the pre-mortem worksheet is complete. Rows on the served A2-ELIG draw 2 (elig-3, staging d738949,
 * scenario f4b544a6, req 3be98169): Render withheld the whole worksheet because story 1 rests on the model's own risk
 * 'Customers lost from price rise' (`dropped:[{story_index:1, reason:"risk_label"}]`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../../context/graph-hash.js';
import { readStoredOptionParticipation } from '../../../../tools/handlers/option-participation.js';
import {
  fallbackReply, methodTurnForReadback, PREMORTEM_PRESS_ID, settleMethodTurn, type RunMethodTurn,
} from '../../../method-turn/method-turn.js';
import { PremortemWorksheetV1Schema, premortemWorksheetDiagnosticsFor, type PremortemRead } from '../premortem.js';

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
const ELIG3 = JSON.parse(readFileSync(new URL('./fixtures/premortem-elig3-served.json', import.meta.url), 'utf8')) as {
  scenario_id: string; turn_id: string; assistant_text: string;
  read: { graph: Graph; graph_hash: string; analysis_state: unknown; analysis_result: Record<string, unknown>; analysis_option_participation: unknown };
};
const RISK = 'customers_lost_from_price_rise';
const PRICE = 'raise_prices_10';
const STARTER = 'launch_starter_tier';

/** The read as `readBackState` projects it; the hash is re-derived on today's code, as `b9Read` does. */
function read(mutate: (g: Graph) => void = () => {}): PremortemRead {
  const r = structuredClone(ELIG3.read);
  mutate(r.graph);
  const graphHash = computeAnalysisAffectingGraphHash(r.graph as never)!;
  return { graph: r.graph, graphHash, analysisState: r.analysis_state,
    analysisResult: { ...r.analysis_result, computed_against_hash: graphHash },
    optionParticipation: readStoredOptionParticipation(r.analysis_option_participation) };
}
function turnOf(r: PremortemRead): RunMethodTurn {
  const turn = methodTurnForReadback(PREMORTEM_PRESS_ID, r);
  if (turn?.kind !== 'run') throw new Error(`elig-3 must run: ${JSON.stringify(turn)}`);
  return turn;
}
const story = (n: 1 | 2) => {
  const lines = ELIG3.assistant_text.split('\n');
  const at = lines.findIndex(l => l.startsWith(`${n}. `));
  return { failure: lines[at].slice(3), watch: lines[at + 1].trim().slice('Watch for: '.length), mitigate: lines[at + 2].trim().slice('Mitigate: '.length) };
};
/** Reconstructed appendix (stripped server-side): prose copied verbatim from the reply; ids from the turn's items. */
const candidates = (riskGrounded = false) => [
  { option_id: PRICE, story_index: 1, failure_way: story(1).failure, early_warning: story(1).watch, mitigation: story(1).mitigate,
    grounding: riskGrounded ? { kind: 'risk', ids: [RISK] } : { kind: 'factor', ids: ['price_rise_from_current_price'] },
    risk: { label: 'Customers lost from price rise', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' } },
  { option_id: STARTER, story_index: 2, failure_way: story(2).failure, early_warning: story(2).watch, mitigation: story(2).mitigate,
    grounding: { kind: 'factor', ids: ['starter_tier_launched'] },
    risk: { label: 'weak starter uptake', affected_node_id: 'monthly_recurring_revenue', direction: 'negative' } },
];
const diagnose = (reply: string, cands: unknown, r = read()) => premortemWorksheetDiagnosticsFor({
  scenarioId: ELIG3.scenario_id, turnId: ELIG3.turn_id, turn: turnOf(r), passed: true, reply, candidates: cands, initial: r, final: r,
});

describe('P02 ROW 1: a story about an EXISTING risk names it by id (already on your map), never a new Add', () => {
  it('served elig-3: story 1 with the existing risk label keeps its row, bound to the risk by id', () => {
    const out = diagnose(ELIG3.assistant_text, candidates());
    expect(out.dropped).toEqual([]);
    expect(out.worksheet).toBeDefined();
    const [row1, row2] = out.worksheet!.rows;
    expect(row1.on_map).toEqual({ node_id: RISK, label: 'Customers lost from price rise' });
    expect(row1.risk_request).toBeUndefined();
    // CONTROL: the new risk in story 2 is still offered as an Add.
    expect(row2.on_map).toBeUndefined();
    expect(row2.risk_request?.message).toContain('"weak starter uptake"');
    expect(PremortemWorksheetV1Schema.safeParse(out.worksheet).success).toBe(true);
  });
  it('the same story grounded on the risk itself names that risk', () => {
    const r = read();
    if (!turnOf(r).context.supplied_items.some(i => i.id === RISK)) return; // only when the risk is a supplied item
    expect(diagnose(ELIG3.assistant_text, candidates(true)).worksheet?.rows[0].on_map?.node_id).toBe(RISK);
  });
  it('NEGATIVE: an existing FACTOR label is still not a new risk (drop risk_label)', () => {
    const c = candidates();
    c[0].risk = { ...c[0].risk, label: 'Price rise from current price' };
    expect(diagnose(ELIG3.assistant_text, c).dropped).toContainEqual(expect.objectContaining({ story_index: 1, reason: 'risk_label' }));
  });
  it('the schema refuses a row with both an Add and an on-map reference', () => {
    const ws = structuredClone(diagnose(ELIG3.assistant_text, candidates()).worksheet!);
    ws.rows[0].risk_request = ws.rows[1].risk_request;
    expect(PremortemWorksheetV1Schema.safeParse(ws).success).toBe(false);
  });
});

describe('P02 ROW 2: every numbered row carries its Mitigate line', () => {
  it('row mitigation is the chat\'s Mitigate text, byte for byte', () => {
    const rows = diagnose(ELIG3.assistant_text, candidates()).worksheet!.rows;
    expect(rows.map(r => r.mitigation)).toEqual([story(1).mitigate, story(2).mitigate]);
    expect(rows.map(r => r.source)).toEqual(['olumi_drafted', 'olumi_drafted']);
  });
  it('the schema refuses a numbered row without Mitigate', () => {
    const ws = structuredClone(diagnose(ELIG3.assistant_text, candidates()).worksheet!);
    delete ws.rows[0].mitigation;
    expect(PremortemWorksheetV1Schema.safeParse(ws).success).toBe(false);
  });
});

describe('P02 ROW 4: the directive carries the goal\'s approved horizon, never "a year"', () => {
  const withHorizon = (h: unknown) => turnOf(read(g => { g.nodes.find(n => n.kind === 'goal')!.goal_horizon = h; }));
  it('a deadline is said as the user\'s date; months as months; none assumes nothing', () => {
    const deadline = withHorizon({ deadline: '2027-03-31' });
    expect(deadline.context.horizon).toEqual({ deadline: '2027-03-31' });
    expect(deadline.directive).toContain('It is 31 March 2027 and');
    expect(deadline.directive).not.toMatch(/a year/u);
    expect(withHorizon({ months: 9 }).directive).toContain('It is 9 months later and');
    const none = turnOf(read());
    expect(none.context.horizon).toBeUndefined();
    expect(none.directive).not.toMatch(/a year/u);
    expect(none.directive).toContain('set no date or period of your own');
  });
  it('the horizon date is the user\'s figure: a composed story at it passes the decision figure ban', () => {
    const turn = withHorizon({ deadline: '2027-03-31' });
    const settled = settleMethodTurn(turn, ELIG3.assistant_text.replace('It is a year later and this decision', 'This decision'));
    expect(settled.passed).toBe(true);
    const composed = settleMethodTurn(turn, ELIG3.assistant_text.replace('Outside the model: Could', 'Outside the model: The best? Could'));
    expect(composed.reply.split('\n')[0]).toBe('Imagine it is 31 March 2027 and this decision has gone badly. Failure stories to test:');
    expect(composed.passed).toBe(true);
  });
});

describe('P02 ROW 5: a refused story is replaced by the server-built story, never the whole reply', () => {
  // 041f494f's second press: one gate (PM-NO-WINNER, Render 10:29Z) discarded the whole draft for fallbackReply.
  const winner = (text: string) => text.replace('eroded the revenue gain.', 'eroded the revenue gain, and the starter tier came out ahead.');
  it('served elig-3 with story 1 tripping PM-NO-WINNER: story 2 is sent verbatim, story 1 is server-built, and the worksheet is emitted', () => {
    const r = read();
    const turn = turnOf(r);
    const draft = winner(ELIG3.assistant_text);
    const settled = settleMethodTurn(turn, draft);
    expect(settled.failed).toContain('PM-NO-WINNER');
    expect(settled.reply).not.toBe(fallbackReply(turn.context));
    expect(settled.passed).toBe(true);
    expect(settled.server_stories).toEqual([1]);
    expect(settled.reply).toContain(`2. ${story(2).failure} Watch for: ${story(2).watch} Mitigate: ${story(2).mitigate}`);
    expect(settled.reply).not.toMatch(/came out ahead/u);
    const c = candidates();
    c[0] = { ...c[0], failure_way: winner(c[0].failure_way) };
    const out = diagnose(settled.reply, c, r);
    expect(out.worksheet).toBeDefined();
    expect(out.worksheet!.rows.map(row => row.source)).toEqual(['server_built', 'olumi_drafted']);
    expect(out.worksheet!.rows[0].risk_request).toBeUndefined();
    expect(out.worksheet!.rows[0].mitigation).toBeTruthy();
  });
  it('CONTROL: a passing draft is sent as written; an all-refused draft still gets RC\'s fallback', () => {
    const turn = turnOf(read());
    expect(settleMethodTurn(turn, ELIG3.assistant_text)).toMatchObject({ reply: ELIG3.assistant_text, passed: true, failed: [] });
    const allBad = ELIG3.assistant_text.replaceAll('eroded the revenue gain.', 'came out ahead.').replace('short of the goal.', 'short of the goal and lost: the price rise wins.');
    expect(settleMethodTurn(turn, allBad).reply).toBe(fallbackReply(turn.context));
  });
  it('a dropped candidate keeps option_id only when it IS a model option (#2740 Codex P2-1)', () => {
    const out = diagnose(ELIG3.assistant_text, [{ ...candidates()[0], option_id: 'my private words', grounding: { kind: 'bogus' } }, candidates()[1]]);
    expect(out.dropped).toContainEqual({ story_index: 1, option_id: null, reason: 'schema' });
    const known = diagnose(ELIG3.assistant_text, [{ ...candidates()[0], grounding: { kind: 'bogus' } }, candidates()[1]]);
    expect(known.dropped).toContainEqual({ story_index: 1, option_id: PRICE, reason: 'schema' });
  });
});
