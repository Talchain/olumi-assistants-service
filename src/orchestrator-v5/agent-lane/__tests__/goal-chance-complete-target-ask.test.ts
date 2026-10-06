/** W5 DL round 2: never ask for only a subset of what the goal chance needs. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GOAL_CHANCE_WITHHELD_NOTE,
  PLACEHOLDER_PATH_NOTE,
  TARGET_ONLY_NOTE,
  goalChanceLineOwed,
  goalChanceSayFromThisTurn,
  goalChanceWithheldForAgent,
} from '../goal-chance-withheld.js';

interface Warning {
  code: string;
  message: string;
  say?: string;
  node_ids?: string[];
  option_ids?: string[];
  links?: { from: string; to: string }[];
  withheld_claims?: string[];
  win_shares_withheld?: boolean;
}
interface CapturedRun {
  analysis_result: { type: string; enrichment: { inference_warnings: Warning[] } };
}
const fixture = (file: string): CapturedRun => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as CapturedRun;
const OPENING = 'This run doesn’t show how often each option reaches the goal’s target.';
const PLACEHOLDER = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const TARGET = 'GOAL_FIGURES_TARGET_NOT_TESTABLE';
const rows = [
  { name: 'Run 1: two placeholder links, five target links', captured: fixture('served-item3-run1-placeholder-target.json'), placeholderCount: 2, more: 'and 2 more.' },
  { name: 'Run 2: one placeholder link, four target links', captured: fixture('served-item3-run2-placeholder-target.json'), placeholderCount: 1, more: 'and 1 more.' },
];

describe.each(rows)('W5 witnessed $name', ({ captured, placeholderCount, more }) => {
  const block = captured.analysis_result;
  const warnings = block.enrichment.inference_warnings;
  const placeholder = warnings.find((w) => w.code === PLACEHOLDER)!;
  const target = warnings.find((w) => w.code === TARGET)!;
  const complete = `${OPENING} ${target.say}`;

  it('PRECONDITION: the captured wire carries both warnings with distinct claim and option scopes', () => {
    expect(warnings.map((w) => w.code)).toEqual(['FACTOR_EVPPI_NOT_COMPUTED', PLACEHOLDER, TARGET]);
    expect(placeholder.links).toHaveLength(placeholderCount);
    expect(placeholder.win_shares_withheld).toBe(true);
    expect(placeholder.option_ids).toEqual(['online_booking_system']);
    expect(target.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'outcome', 'downside']);
    expect(target.option_ids).toEqual(['second_receptionist', 'extended_evening_hours', 'continue_current_operations']);
    expect(target.say).toContain(more);
  });

  it('RED at base: the mixed say names the complete target requirement and explicit remaining count', () => {
    const chance = goalChanceWithheldForAgent(block)!;
    expect(chance.say).toBe(complete);
    expect(chance.say).toContain('from Receptionist headcount to Monthly booked appointments');
    expect(chance.say).toContain('from Online booking availability to Monthly booked appointments');
    expect(chance.say).toContain('from Additional evening opening hours to Monthly booked appointments');
    expect(chance.say).toContain(more);
    // The target-only warning kept shares, but the mixed run did not. Keep the mixed licence and scope.
    expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
    expect(chance.option_ids).toBeUndefined();
    expect(chance.node_ids).toEqual(placeholder.node_ids);
  });

  it('CONTROL: placeholder alone keeps its own words, note and option scope', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [placeholder] } })).toEqual({
      withheld: true, say: placeholder.message, node_ids: placeholder.node_ids,
      note: PLACEHOLDER_PATH_NOTE, option_ids: placeholder.option_ids,
    });
  });

  it('CONTROL: target alone keeps its own words and target-only licence', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [target] } })).toEqual({
      withheld: true, say: target.say, node_ids: target.node_ids, note: TARGET_ONLY_NOTE,
    });
  });

  it('RED at base: warning order and the stored top-level holder keep the complete ask', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [...warnings].reverse() } })?.say).toBe(complete);
    expect(goalChanceWithheldForAgent({ inference_warnings: warnings })?.say).toBe(complete);
    expect(goalChanceWithheldForAgent({ ...block, inference_warnings: warnings })?.say).toBe(complete);
  });

  it('RED at base: speaking only the placeholder subset still owes the target requirement', () => {
    const run = { ran: true, goal_chance: goalChanceWithheldForAgent(block) };
    expect(goalChanceLineOwed([run], placeholder.message)).toBe(complete);
    expect(goalChanceLineOwed([run], `${OPENING} ${placeholder.message}`)).toBe(complete);
  });

  it('RED at base: the complete requirement is owed once, including a build first-pass holder', () => {
    const run = { ran: true, goal_chance: goalChanceWithheldForAgent(block) };
    expect(goalChanceLineOwed([run], complete)).toBeNull();
    expect(goalChanceLineOwed([run], target.say!)).toBe(OPENING);
    expect(goalChanceSayFromThisTurn([{ first_analysis: run }])).toBe(complete);
    expect(goalChanceSayFromThisTurn([run, { ran: true }])).toBeNull();
  });

  it('RED at base: older warning words without say still disclose the complete requirement via message', () => {
    const { say: _say, ...withoutSay } = target;
    const older = warnings.map((w) => w.code === TARGET ? withoutSay : w);
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: older } })?.say)
      .toBe(`${OPENING} ${target.message.replace(/^Not shown\.\s*/, '')}`);
  });
});

it('independent identity reasons remain beside the complete target ask, under the mixed licence', () => {
  const identityRun = fixture('served-416-draw6-b501eda4.json');
  const identity = identityRun.analysis_result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED')!;
  const warnings = rows[0]!.captured.analysis_result.enrichment.inference_warnings;
  const target = warnings.find((w) => w.code === TARGET)!;
  const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [...warnings, identity] } })!;
  expect(chance.say).toBe(`${OPENING} ${identity.message.replace(/^Not shown\.\s*/, '')} ${target.say}`);
  expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
  expect(chance.node_ids).toEqual([...new Set(warnings.concat(identity).flatMap((w) => w.node_ids ?? []))]);
});
