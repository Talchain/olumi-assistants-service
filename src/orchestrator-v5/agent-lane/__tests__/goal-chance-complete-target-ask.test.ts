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
import { targetLevelOnlyQuestion, targetNotTestableWarning, targetTestabilityOf } from '../../admission/target-testability.js';

interface Warning {
  code: string;
  message: string;
  say?: string;
  node_ids?: string[];
  option_ids?: string[];
  links?: { from: string; to: string }[];
  acceptable_links?: { from: string; to: string }[];
  level_only_say?: string;
  withheld_claims?: string[];
  win_shares_withheld?: boolean;
}
interface CapturedRun {
  analysis_result: { type: string; enrichment: { inference_warnings: Warning[] } };
  graph?: unknown;
}
const fixture = (file: string): CapturedRun => {
  const captured = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8')) as CapturedRun;
  // Older captures predate this warning's acceptable_links carrier. Preserve the capture and project its list into
  // today's typed carrier in these composition-only rows; the current producer/ONE-LIST rows use served draw-2 below.
  for (const warning of captured.analysis_result.enrichment.inference_warnings) {
    if (warning.code === 'GOAL_FIGURES_PLACEHOLDER_PATH' && warning.acceptable_links === undefined) warning.acceptable_links = warning.links;
  }
  return captured;
};
const OPENING = 'This run doesn’t show how often each option reaches the goal’s target.';
const PLACEHOLDER = 'GOAL_FIGURES_PLACEHOLDER_PATH';
const TARGET = 'GOAL_FIGURES_TARGET_NOT_TESTABLE';
// Science §(i) 4 supersedes the W5 multi-placeholder words; exactly one keeps W5 byte for byte.
const GUIDED_TWO = "Not shown yet: 2 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.";
const rows = [
  { name: 'Run 1: two placeholder links, five target links', captured: fixture('served-item3-run1-placeholder-target.json'), placeholderCount: 2, more: 'and 2 more.' },
  { name: 'Run 2: one placeholder link, four target links', captured: fixture('served-item3-run2-placeholder-target.json'), placeholderCount: 1, more: 'and 1 more.' },
];

describe.each(rows)('W5 witnessed $name', ({ captured, placeholderCount, more }) => {
  const block = captured.analysis_result;
  const warnings = block.enrichment.inference_warnings;
  const placeholder = warnings.find((w) => w.code === PLACEHOLDER)!;
  const target = warnings.find((w) => w.code === TARGET)!;
  const complete = placeholderCount >= 2 ? GUIDED_TWO : `${OPENING} ${target.say}`;

  it('PRECONDITION: the captured wire carries both warnings with distinct claim and option scopes', () => {
    expect(warnings.map((w) => w.code)).toEqual(['FACTOR_EVPPI_NOT_COMPUTED', PLACEHOLDER, TARGET]);
    expect(placeholder.links).toHaveLength(placeholderCount);
    expect(placeholder.win_shares_withheld).toBe(true);
    expect(placeholder.option_ids).toEqual(['online_booking_system']);
    expect(target.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'outcome', 'downside']);
    expect(target.option_ids).toEqual(['second_receptionist', 'extended_evening_hours', 'continue_current_operations']);
    expect(target.say).toContain(more);
  });

  it('the mixed say follows Science §(i) 4 for 2 links; exactly 1 keeps the complete target requirement', () => {
    const chance = goalChanceWithheldForAgent(block)!;
    expect(chance.say).toBe(complete);
    if (placeholderCount === 1) {
      expect(chance.say).toContain('from Receptionist headcount to Monthly booked appointments');
      expect(chance.say).toContain('from Online booking availability to Monthly booked appointments');
      expect(chance.say).toContain('from Additional evening opening hours to Monthly booked appointments');
      expect(chance.say).toContain(more);
    }
    // The target-only warning kept shares, but the mixed run did not. Keep the mixed licence and scope.
    expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
    expect(chance.option_ids).toBeUndefined();
    expect(chance.node_ids).toEqual(placeholder.node_ids);
  });

  it('placeholder alone: Science §(i) 4 changes 2-link words; exactly 1 keeps its words, note and scope', () => {
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [placeholder] } })).toEqual({
      withheld: true, say: placeholderCount >= 2 ? GUIDED_TWO : placeholder.message, node_ids: placeholder.node_ids,
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
    expect(goalChanceLineOwed([run], target.say!)).toBe(placeholderCount >= 2 ? GUIDED_TWO : OPENING);
    expect(goalChanceSayFromThisTurn([{ first_analysis: run }])).toBe(complete);
    expect(goalChanceSayFromThisTurn([run, { ran: true }])).toBeNull();
  });

  it('RED at base: older warning words without say still disclose the complete requirement via message', () => {
    const { say: _say, ...withoutSay } = target;
    const older = warnings.map((w) => w.code === TARGET ? withoutSay : w);
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: older } })?.say)
      .toBe(placeholderCount >= 2 ? GUIDED_TWO : `${OPENING} ${target.message.replace(/^Not shown\.\s*/, '')}`);
  });
});

it('independent identity reasons remain beside the complete target ask, under the mixed licence', () => {
  const identityRun = fixture('served-416-draw6-b501eda4.json');
  const identity = identityRun.analysis_result.enrichment.inference_warnings.find((w) => w.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED')!;
  const warnings = rows[0]!.captured.analysis_result.enrichment.inference_warnings;
  const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: [...warnings, identity] } })!;
  // The independent reason stays verbatim beside the new §(i) 4 sentence.
  expect(chance.say).toBe(`${identity.message.replace(/^Not shown\.\s*/, '')} ${GUIDED_TWO}`);
  expect(chance.note).toBe(GOAL_CHANCE_WITHHELD_NOTE);
  expect(chance.node_ids).toEqual([...new Set(warnings.concat(identity).flatMap((w) => w.node_ids ?? []))]);
});

describe('R2 DL composition: draw-2 level ask before the ONE guided list', () => {
  const draw2 = fixture('guided-sizing-draw2.json');
  const warnings = draw2.analysis_result.enrichment.inference_warnings.filter(w => [PLACEHOLDER, TARGET].includes(w.code));
  const target = warnings.find(w => w.code === TARGET)!;
  const LEVEL_ONLY = "What's today's level of MRR?";
  const COMPLETE = `${LEVEL_ONLY} ${GUIDED_TWO}`;

  it('R2 RED: both typed codes → the exact existing level question FIRST, then guided words, with no target link clause', () => {
    expect(warnings.map(w => w.code)).toEqual([PLACEHOLDER, TARGET]);
    expect(target.say).toContain(LEVEL_ONLY);
    expect(target.say).toContain('a size for the links from');
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: warnings } }, draw2.graph)!;
    expect(chance.say).toBe(COMPLETE);
    expect(chance.say).not.toContain('a size for the links from');
    expect(goalChanceLineOwed([{ ran: true, goal_chance: chance }], GUIDED_TWO)).toBe(COMPLETE);
  });

  it('R2 RED: current target producer carries level_only_say from its existing parts, minus its link clause', () => {
    // r9 class (ii) setup repair: the confirmed draw-2 graph already holds both operand levels.
    // Remove one level only in this missing-level scenario; preserve both exact wording assertions.
    const graph = structuredClone(draw2.graph) as { nodes: { id: string; observed_state?: unknown }[] };
    graph.nodes.find(n => n.id === 'paying_pro_subscribers')!.observed_state = null;
    const warning = targetNotTestableWarning(graph, targetTestabilityOf(graph), [], TARGET) as Warning;
    expect(warning.level_only_say).toBe(LEVEL_ONLY);
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [warnings[0], warning] } }, graph)?.say).toBe(COMPLETE);
  });

  it('r9 CONTROL: the original confirmed draw-2 product derives its level and asks only for its unsized links', () => {
    const warning = targetNotTestableWarning(draw2.graph, targetTestabilityOf(draw2.graph), [], TARGET) as Warning;
    expect(warning.level_only_say).toBeUndefined();
    expect(goalChanceWithheldForAgent({ enrichment: { inference_warnings: [warnings[0], warning] } }, draw2.graph)?.say).toBe(GUIDED_TWO);
  });

  it('R2 producer: target-derived scale keeps the existing unit-qualified level-only question verbatim', () => {
    expect(targetLevelOnlyQuestion(draw2.graph, { kind: 'not_testable', goal_id: 'mrr',
      failures: [{ precondition: 'P4', case: 'd', code: 'threshold_off_scale' }] }))
      .toBe("What's today's level of MRR, in £/month?");
  });

  it('R2 CONTROL: derived level/no TARGET_NOT_TESTABLE → only guided words, with no level ask', () => {
    const placeholder = warnings.filter(w => w.code === PLACEHOLDER);
    const chance = goalChanceWithheldForAgent({ enrichment: { inference_warnings: placeholder } }, draw2.graph)!;
    expect(chance.say).toBe(GUIDED_TWO);
    expect(chance.say).not.toContain("What's today's level");
  });
});
