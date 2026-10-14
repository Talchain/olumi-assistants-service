/**
 * ⛔ A GOAL THE USER HELD AS "AT LEAST" POINTS UP: THE HEADLINE MUST NOT SAY THE DIRECTION WAS ASSUMED (AIQ ruling
 * #75 5901136155; DL #75 5902287038 item 2(a)).
 *
 * Served CEE `1f9d769`, journey A rep 1, run 2 (`a3-1f9d769/rep1/pj-20260930T012259Z/A16-run2-final.json`): the goal
 * `mrr` holds the USER's `goal_direction: ">="` (£100,000, level frame). PLoT still sent GOAL_DIRECTION_UNATTESTED,
 * because CEE never forwards `maximise` (`goal-direction.ts`: it is byte-identical to absent on ISL). The block's summary
 * therefore said "The analysis was not told which way your goal points, so it assumed a higher value is better". The
 * Agent repeated it: "It also assumed that higher MRR is better rather than having that objective direction formally
 * recorded". Both are FALSE by AIQ's ruling: with a held `>=` / `>`, the aim is the user's, and higher is better.
 *
 * Rule: GOAL_DIRECTION_UNATTESTED licenses the direction clause only when the goal does NOT hold a user floor
 * (`heldGoalPointsUp`: `>=` / `>`, and not a NEGATIVE typed change, where "at least a 20% cut" points down). A bare
 * goal keeps today's clause. The threshold clause is unaffected.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAnalysisResultHeadline, describeGoalFrame, type AnalysisResultHeadlineInput } from '../analysis-result-headline.js';
import { heldGoalPointsUp } from '../../goal-target/goal-direction.js';

type Json = Record<string, unknown>;
const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/a3-1f9d769-rep1-run2.analysis-result-block.json', import.meta.url), 'utf8'),
) as { _provenance: { goal_node: Json }; blocks: Json[] };
const BLOCK = FIXTURE.blocks[0] as Json;
const ENRICHMENT = BLOCK['enrichment'] as Json;
const LEADER = BLOCK['leading_option_id'] as string;
const DIRECTION = 'GOAL_DIRECTION_UNATTESTED';
const THRESHOLD = 'GOAL_THRESHOLD_NOT_CONVERTIBLE';
const DIRECTION_CLAUSE = 'In this model I’ve assumed a higher value is better for your goal';
const UNTESTED_CLAUSE = 'could not test whether any option reaches your goal';

/** The served enrichment with its goal codes reduced to `keep`, on both carriers. */
function withGoalCodes(keep: readonly string[]): Json {
  const copy = structuredClone(ENRICHMENT);
  const iw = copy['inference_warnings'];
  if (Array.isArray(iw)) copy['inference_warnings'] = iw.filter((w: Json) => ![DIRECTION, THRESHOLD].includes(w['code'] as string) || keep.includes(w['code'] as string));
  // The served A block carries DIRECTION only; a row that asks for THRESHOLD adds it (the cage reads the CODE alone).
  const arr = copy['inference_warnings'] as Json[];
  for (const code of keep) if (!arr.some((w) => w['code'] === code)) arr.push({ code, field: 'goal_threshold' });
  const brief = copy['decision_brief'] as Json | undefined;
  if (brief && Array.isArray(brief['warning_codes'])) brief['warning_codes'] = (brief['warning_codes'] as string[]).filter((c) => ![DIRECTION, THRESHOLD].includes(c) || keep.includes(c));
  return copy;
}
const input = (keep: readonly string[], extra: Partial<AnalysisResultHeadlineInput> = {}): AnalysisResultHeadlineInput =>
  ({ enrichment: withGoalCodes(keep), leading_option_id: LEADER, status_kind: 'ok', ...extra });

/** The served A rep 1 run-2 goal node (captured beside the block), in the fields the reader uses. */
const SERVED_A_GOAL = FIXTURE._provenance.goal_node;
const graphOf = (goal: Json): Json => ({ nodes: [goal], edges: [] });

describe('heldGoalPointsUp: a user-held floor points up; a negative typed change does not', () => {
  it('served A rep 1 (`mrr` >= £100,000, level) → points up', () => {
    expect(heldGoalPointsUp(graphOf(SERVED_A_GOAL), 'mrr')).toBe(true);
  });
  it('">" → points up', () => {
    expect(heldGoalPointsUp(graphOf({ ...SERVED_A_GOAL, goal_direction: '>' }), 'mrr')).toBe(true);
  });
  it('">=" on a NEGATIVE typed change ("at least a 20% cut", cloud-0) → does NOT point up', () => {
    expect(heldGoalPointsUp(graphOf({ ...SERVED_A_GOAL, goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2, goal_threshold: -0.2 }), 'mrr')).toBe(false);
  });
  it('a positive typed change held ">=" → points up', () => {
    expect(heldGoalPointsUp(graphOf({ ...SERVED_A_GOAL, goal_threshold_frame: 'change_rel', goal_threshold_raw: 0.1, goal_threshold: 0.1 }), 'mrr')).toBe(true);
  });
  it('"<=" / no comparator / another node → false', () => {
    expect(heldGoalPointsUp(graphOf({ ...SERVED_A_GOAL, goal_direction: '<=' }), 'mrr')).toBe(false);
    const { goal_direction: _d, ...bare } = SERVED_A_GOAL;
    expect(heldGoalPointsUp(graphOf(bare), 'mrr')).toBe(false);
    expect(heldGoalPointsUp(graphOf(SERVED_A_GOAL), 'other')).toBe(false);
  });
});

describe('the direction clause is not said when the user held the goal as a floor', () => {
  it('PREMISE: the served block carries DIRECTION (and not THRESHOLD), and today the clause is said', () => {
    const codes = (ENRICHMENT['inference_warnings'] as Json[]).map((w) => w['code']);
    expect(codes).toContain(DIRECTION);
    expect(codes).not.toContain(THRESHOLD);
    expect(describeGoalFrame(input([DIRECTION]))).toBe('direction_assumed');
    expect(buildAnalysisResultHeadline(input([DIRECTION]))).toContain(DIRECTION_CLAUSE);
  });

  it('ROW 1 (served A rep 1 shape): DIRECTION + a held floor → the goal frame stands; no direction clause', () => {
    const i = input([DIRECTION], { goal_points_up_as_held: true });
    expect(describeGoalFrame(i)).toBe('goal_framed');
    const text = buildAnalysisResultHeadline(i);
    expect(text).not.toBeNull();
    expect(text).not.toContain(DIRECTION_CLAUSE);
  });

  it('ROW 2: DIRECTION + THRESHOLD + a held floor → only the untested clause', () => {
    const i = input([DIRECTION, THRESHOLD], { goal_points_up_as_held: true });
    expect(describeGoalFrame(i)).toBe('attainment_untested');
    const text = buildAnalysisResultHeadline(i) ?? '';
    expect(text).toContain(UNTESTED_CLAUSE);
    expect(text).not.toContain(DIRECTION_CLAUSE);
  });

  it('CONTROL (a bare goal / not held): the clause stays, byte-identical to today', () => {
    expect(buildAnalysisResultHeadline(input([DIRECTION], { goal_points_up_as_held: false }))).toBe(buildAnalysisResultHeadline(input([DIRECTION])));
    expect(describeGoalFrame(input([DIRECTION], { goal_points_up_as_held: false }))).toBe('direction_assumed');
  });
});
