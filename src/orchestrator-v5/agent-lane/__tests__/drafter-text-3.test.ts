/**
 * ⭐ DRAFTER TEXT 3 (DL 14 Oct; AIE_TEXT_PENDING, `recovery/prompt/DRAFTER-TEXT-3-DRAFT.txt`). Four drafter-side sources, each
 * fixed where the meaning is lost, with no host matcher:
 * 1. hiring raw 9d75b605 made the launch date the goal and the user's productivity target a constraint;
 * 2. T5 D1 asked the deadline twice (the drafter's `unknowns` beside the host's `chanceGoalDeadlineAsk`);
 * 3. capacity's drafter narrated how the model treats a figure ("The model does not treat … as … goal baseline");
 * 4. capacity's drafter left the goal's current level null although the brief states it as the existing team's capacity.
 *
 * The texts are bound by identity (`tests/fixtures/drafter-text-3/drafter-text-3.json`). The corpus is not the author's: served
 * hiring post3007's brief and drafter output, and the served capacity brief (`_source`), through the real `buildModelFromBrief`.
 * Whether the drafter now behaves so is AI behaviour, measured on the served build and never claimed here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief } from '../runtime/build-model.js';
import { chanceGoalDeadlineAsk } from '../../goal-target/goal-kind.js';

type Rec = Record<string, any>;
const TEXT = JSON.parse(readFileSync('tests/fixtures/drafter-text-3/drafter-text-3.json', 'utf8')) as
  { goal_is_the_aim: string; date_not_asked: string; unknowns_description: string; goal_level_in_other_words: string };
const HIRING_BRIEF = (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string;
const HIRING_DRAFT = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec;
const CAPACITY_BRIEF = (JSON.parse(readFileSync('tests/fixtures/drafter-text-3/served-capacity-brief.json', 'utf8')) as Rec).brief as string;
const sid = '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';

/** The first request the real build path sends the drafter for `brief` (the drafter answers with `draft`). */
async function firstRequest(brief: string, draft: Rec = HIRING_DRAFT): Promise<Rec> {
  let sent: Rec | undefined;
  await buildModelFromBrief(sid, brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) return { status: 200, json: { model_version: { version_number: 1 } } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'drafter-text-3' } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft) }; }) as never);
  if (sent === undefined) throw new Error('the drafter was never called');
  return sent;
}

describe('what the drafter is sent', () => {
  it('1. hiring: the instructions open with the goal as the user\'s governing aim, before the event-by-date rule', async () => {
    // The instructions are one joined string: the aim sentence opens it, before the event-by-date rule.
    expect(BUILD_INSTRUCTIONS.startsWith(`${TEXT.goal_is_the_aim} For an EVENT by a date`)).toBe(true);
    const sent = await firstRequest(HIRING_BRIEF);
    expect(sent.instructions as string).toContain(TEXT.goal_is_the_aim);
    // Contrast in the same request: the event-by-date rule it now governs is still sent.
    expect(sent.instructions as string).toContain('For an EVENT by a date (meet the deadline, launch by, deliver on time, ship by Q2)');
  });

  it('2. the drafter is never asked to ask for the date; the host keeps its one deadline ask', async () => {
    const sent = await firstRequest(HIRING_BRIEF);
    expect(sent.instructions as string).not.toContain('Ask for the date first');
    expect(sent.instructions as string).toContain(TEXT.date_not_asked);
    // The host's own ask is unchanged (the one `isDecisionInputAsk` reads).
    expect(chanceGoalDeadlineAsk('the feature launch')).toMatch(/feature launch/);
  });

  it('3. `unknowns` is described: questions and uncertainties, never how the model treats a figure', async () => {
    const sent = await firstRequest(CAPACITY_BRIEF);
    const p = sent.schema.properties as Rec;
    expect(p.unknowns.description).toBe(TEXT.unknowns_description);
    expect(p.unknowns.items).toEqual({ type: 'string' });
  });

  it('4. capacity: the goal\'s current level stated in other words is its level, said right after the goal-level rule', async () => {
    expect(CAPACITY_BRIEF).toContain('Our existing team resolves 80 tickets per week.');
    const sent = await firstRequest(CAPACITY_BRIEF);
    const instructions = sent.instructions as string;
    const rule = instructions.indexOf('It is where things stand today, never the target.');
    expect(rule, 'contrast: the goal-level rule is sent').toBeGreaterThan(-1);
    expect(instructions.indexOf(TEXT.goal_level_in_other_words)).toBe(rule + 'It is where things stand today, never the target. '.length);
  });
});
