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
    const chances = { options: [{ label: 'Hire a tech lead', figures: [38] }], periodMonths: 3 };
    const labels = ['Hire a tech lead', 'Hire two developers'];
    expect(isLicensedChanceLine('By month three, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('Within 3 months, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(true);
    expect(isLicensedChanceLine('By month six, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(false);
    expect(isLicensedChanceLine('By 14 January 2027, Hire a tech lead has about 38% chance of meeting the goal.', chances, labels)).toBe(false);
    expect(isLicensedChanceLine('Hire a tech lead has about 38% chance, and Hire two developers too.', chances, labels)).toBe(false);
  });
});
