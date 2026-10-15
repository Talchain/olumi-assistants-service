/**
 * ⭐ S7 PR-B (B1): the leader gate keeps the AI's OWN chance line for one option when every figure in it is THAT option's
 * licensed goal-chance display on the same current Run (DL 15 Oct ~02:4xZ; PL contract: figure type, option, window, licence,
 * Run). Through the REAL wire gate, on two served Runs whose leader is withheld: B3 (ranges, goal path unsized) and B5 T1b
 * (points on the `each` licence, near tie). Before this, both lines were deleted as "rankings" and the host inserted its own.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { enforceAgentLaneLeaderClaimsAtWire } from '../withheld-leader-fail-closed.js';
import { goalChanceFactsForAgent } from '../../goal-target/goal-chance-range-agent.js';
import { isLicensedChanceLine, licensedChancesOf } from '../licensed-chance-lines.js';

type Json = Record<string, any>;
const read = (name: string): Json => (JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as { j: Json }).j;
const B3 = read('waveB3-unseen2-7addf05-readback-run1.json');
const T1B = read('waveB5-t1b-3fce64f-readback-run1.json');

const gate = (j: Json, text: string): string => {
  const claim = j.analysis_state.leader_claim;
  return String(enforceAgentLaneLeaderClaimsAtWire({ assistant_text: text, blocks: [j.analysis_result], suggested_actions: [],
    analysis_state: j.analysis_state } as never, { requestId: 'b1', exitPath: 'agent_lane_v1', mayNameLeadingOption: false,
    separationEstablished: claim.separation === 'separated', leaderClaimWithheldReason: claim.withheld_reason, graph: j.graph,
    analysisReady: j.analysis_ready, sayWhyWithheld: false } as never).response.assistant_text);
};
/** The AI's own words for an option's licensed chance, built from the Run's own display (never typed by hand). */
const ownLine = (j: Json, optionId: string): string => {
  const f = goalChanceFactsForAgent(j.analysis_result, j.graph, true);
  const shown = f.goal_chance_range_display?.[optionId]?.range ?? f.goal_chance_display?.[optionId];
  const label = (j.graph.nodes as Json[]).find((n) => n.id === optionId)!.label;
  expect(shown, `${optionId} is licensed`).toBeDefined();
  return `In this model, ${label} has ${shown} chance of meeting the goal.`;
};
const licensedIds = (j: Json): string[] => {
  const f = goalChanceFactsForAgent(j.analysis_result, j.graph, true);
  return [...new Set([...Object.keys(f.goal_chance_display ?? {}), ...Object.keys(f.goal_chance_range_display ?? {})])];
};

describe('S7 B1: one option’s licensed chance line is not a ranking (the gate keeps the AI’s own words)', () => {
  it.each([['B3 ranges, goal path unsized', B3], ['B5 T1b points, near tie', T1B]] as const)('%s: each option’s own chance line survives the withheld-leader gate', (_n, j) => {
    const ids = licensedIds(j);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const line = ownLine(j, id);
      expect(gate(j, line)).toContain(line);
    }
  });

  it.each([['B3', B3], ['T1B', T1B]] as const)('%s CONTRASTS: a ranking word, another option, a win share, a wrong figure or a stated window still drop it', (_n, j) => {
    const [a] = licensedIds(j);
    const other = (j.graph.nodes as Json[]).find((n) => n.kind === 'option' && n.id !== a)!.label as string;
    const line = ownLine(j, a!);
    const figure = line.match(/(\d+(?:\.\d+)?)%/g)!.at(-1)!;
    for (const bad of [
      line.replace('has', 'has the highest,'),
      `${line.slice(0, -1)}, more than ${other}.`,
      line.replace('chance of meeting the goal', 'of runs, coming out on top'),
      line.replace(figure, `${Number.parseFloat(figure) + 7}%`),
      line.replace('In this model,', 'By month 3,'),
    ]) {
      expect(gate(j, bad), bad).not.toContain(bad);
    }
  });

  it('a Run that is not current licenses nothing, so its line is still dropped', () => {
    expect(licensedChancesOf(T1B.analysis_result, T1B.graph, false)).toBeUndefined();
    const stale = { ...T1B, analysis_state: { ...T1B.analysis_state, run_state: { kind: 'stale' } } };
    const line = ownLine(T1B, licensedIds(T1B)[0]!);
    expect(gate(stale, line)).not.toContain(line);
  });

  it('an option label holding a percentage ("Raise prices 10%") does not make its chance line an unlicensed figure', () => {
    const chances = licensedChancesOf(T1B.analysis_result, T1B.graph, true)!;
    const raise = chances.options.find((o) => o.label === 'Raise prices 10%')!;
    expect(raise).toBeDefined();
    expect(isLicensedChanceLine(`Raise prices 10% has about ${raise.figures[0]}% chance of meeting the goal.`, chances,
      chances.options.map((o) => o.label))).toBe(true);
  });

  it('a stated window is kept only when it is the goal’s own (month three kept at a three-month goal; month six dropped)', () => {
    const chances = { options: [{ label: 'Hire a tech lead', figures: [38], displays: ['about 38%'] }], periodMonths: 3 };
    const labels = ['Hire a tech lead', 'Hire two developers'];
    expect(isLicensedChanceLine('By month three, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('Within 3 months, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('By month six, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(false);
    expect(isLicensedChanceLine('By 14 January 2027, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(false);
    expect(isLicensedChanceLine('Hire a tech lead has about 38% chance, and Hire two developers too.', chances, labels)).toBe(false);
    // A win share is never a goal chance, even with the licensed figure and the word "chance" beside it.
    expect(isLicensedChanceLine('Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(true);
    for (const share of ['Hire a tech lead has about 38% chance, the share of simulations it won.',
      'Hire a tech lead wins about 38% of runs, its chance of meeting the goal.']) {
      expect(isLicensedChanceLine(share, chances, labels), share).toBe(false);
    }
  });

  // ⭐ PL 04:05Z on #3197: the exemption is bound to the licensed DISPLAY (point vs range) and to its event/target; one row
  // per counterexample, on the served Runs, through the REAL wire gate.
  it('B3 (a licensed RANGE): one endpoint said as a point is not the licensed chance, so the gate still drops it', () => {
    const [id] = licensedIds(B3);
    const label = (B3.graph.nodes as Json[]).find((n) => n.id === id)!.label as string;
    const ends = goalChanceFactsForAgent(B3.analysis_result, B3.graph, true).goal_chance_range_display![id!]!.range.match(/\d+%/g)!;
    expect(ends).toHaveLength(2);
    for (const end of ends) {
      const point = `In this model, ${label} has about ${end} chance of meeting your goal.`;
      expect(gate(B3, point), point).not.toContain(point);
    }
    const whole = ownLine(B3, id!);
    expect(gate(B3, whole)).toContain(whole);
  });

  it('T1B (a licensed POINT): the right figure beside the wrong event or the wrong target is not the licensed chance', () => {
    const [id] = licensedIds(T1B);
    const line = ownLine(T1B, id!);
    for (const wrong of [
      line.replace('meeting the goal', 'losing customers'),
      line.replace('meeting the goal', 'reaching 50 new subscribers'),
      line.replace('meeting the goal', 'reaching the goal of £20,000 MRR'),
    ]) {
      expect(gate(T1B, wrong), wrong).not.toContain(wrong);
    }
    expect(gate(T1B, line)).toContain(line);
  });

  it('the licence’s own chance words are a valid event; another number beside them is not', () => {
    const chances = { options: [{ label: 'Hire a tech lead', figures: [38], displays: ['about 38%'] }], periodMonths: 3,
      chanceWords: 'reaching at least 10% higher productivity' };
    const labels = ['Hire a tech lead', 'Hire two developers'];
    expect(isLicensedChanceLine('Hire a tech lead has about 38% chance of reaching at least 10% higher productivity.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('Hire a tech lead has about 38% chance of reaching at least 15% higher productivity.', chances, labels)).toBe(false);
  });
});

/**
 * ⭐ S9 (DL 07:1xZ; capacity e2e R2e, CEE c1e944a4, leader withheld for an unsized goal path): the AI may say how an option's
 * chance moved between the two Runs. The PRECEDING Run's figure passes the gate only inside a from→to comparison that states
 * it before this Run's display, equal to THAT Run's licensed display (`run_delta.goal_chances`), for the same option and goal.
 */
describe('S9: a from→to comparison of one option’s licensed chances survives the withheld-leader gate', () => {
  const R2E = (JSON.parse(readFileSync('tests/fixtures/s9-range-delta/R2e-automatic-50836bd2.json', 'utf8')) as Json).canonical_state as Json;
  const gateR2e = (text: string, delta: unknown = R2E.current_read.run_delta): string => { // null = no recorded pair
    const claim = R2E.analysis_state.leader_claim;
    return String(enforceAgentLaneLeaderClaimsAtWire({ assistant_text: text, blocks: [R2E.analysis_result], suggested_actions: [],
      analysis_state: R2E.analysis_state, ...(delta !== null ? { run_delta: delta } : {}) } as never, { requestId: 's9', exitPath: 'agent_lane_v1',
      mayNameLeadingOption: false, separationEstablished: claim.separation === 'separated', leaderClaimWithheldReason: claim.withheld_reason,
      graph: R2E.graph, analysisReady: R2E.analysis_ready, sayWhyWithheld: false } as never).response.assistant_text);
  };
  const SAID = '‘Add one specialist’ went from between about 30% and 36% to between about 54% and 59% chance of meeting your goal.';

  it('R2e (served): the comparison sentence is kept; with no recorded pair it is still dropped', () => {
    expect(R2E.analysis_state.leader_claim.permitted).toBe(false);
    expect(gateR2e(SAID)).toContain(SAID);
    expect(gateR2e(SAID, null), 'no run_delta: the earlier figures are unlicensed').not.toContain(SAID);
    const chances = licensedChancesOf(R2E.analysis_result, R2E.graph, true, R2E.current_read.run_delta)!;
    expect(chances.options.find((o) => o.label === 'Add one specialist')!.prior).toEqual({ display: 'between about 30% and 36%', figures: [30, 36] });
  });

  it('CONTRASTS: a wrong earlier figure, the earlier figure alone, the order reversed, or a pair not of this Run are dropped', () => {
    const notThisRun = structuredClone(R2E.current_read.run_delta);
    notThisRun.goal_chances.find((g: Json) => g.option_id === 'add_one_specialist').current = { kind: 'range', low_pct: 60, high_pct: 65, low_rounding: 'whole', high_rounding: 'whole' };
    for (const [bad, delta] of [
      [SAID.replace('between about 30% and 36%', 'between about 25% and 36%'), undefined],
      ['‘Add one specialist’ had between about 30% and 36% chance of meeting your goal.', undefined],
      ['‘Add one specialist’ went from between about 54% and 59% to between about 30% and 36% chance of meeting your goal.', undefined],
      [SAID, notThisRun],
    ] as const) {
      expect(gateR2e(bad, delta ?? R2E.current_read.run_delta), bad).not.toContain(bad);
    }
  });
});
