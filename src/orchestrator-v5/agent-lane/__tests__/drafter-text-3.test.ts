/**
 * ⭐ DRAFTER TEXT 3 (DL 14 Oct; the AIE's texts, packet 281e8b3d, #94 6162120876). Four drafter-side sources, each fixed where
 * the meaning is lost, with no host matcher:
 * 1. hiring raw 9d75b605 made the launch date the goal and the user's productivity target a constraint;
 * 2. T5 D1 asked the deadline twice (the drafter's `unknowns` beside the host's `chanceGoalDeadlineAsk`);
 * 3. capacity's drafter narrated how the model treats a figure ("The model does not treat … as … goal baseline");
 * 4. capacity's drafter left the goal's current level null although the brief states it as the existing team's capacity.
 *
 * The texts are bound by identity (`tests/fixtures/drafter-text-3/drafter-text-3.json`). The corpus is not the author's: served
 * hiring post3007's brief and drafter output, T5 D1's brief and recorded drafter answer, and the served capacity brief
 * (`_source`), through the real `buildModelFromBrief`.
 * Whether the drafter now behaves so is AI behaviour, measured on the served build and never claimed here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief } from '../runtime/build-model.js';
import { OLUMI_PURPOSE_CORE_LINES } from '../olumi-purpose.js';
import { chanceGoalDeadlineAsk } from '../../goal-target/goal-kind.js';

type Rec = Record<string, any>;
const TEXT = JSON.parse(readFileSync('tests/fixtures/drafter-text-3/drafter-text-3.json', 'utf8')) as
  { goal_is_the_aim: string; current_aim_not_later_ambition: string; date_not_asked: string; unknowns_description: string; goal_level_in_other_words: string };
/** AIE T1 (18 Oct): the hedged-goal clause follows the aim sentence's last clause. */
const T1_GOAL = (JSON.parse(readFileSync('tests/fixtures/sys2/aie-t1-producer-text-v1.json', 'utf8')) as { goal_changes: { old: string; replacement: string }[] }).goal_changes[0]!;
const HIRING_BRIEF = (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string;
const HIRING_DRAFT = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec;
const CAPACITY_BRIEF = (JSON.parse(readFileSync('tests/fixtures/drafter-text-3/served-capacity-brief.json', 'utf8')) as Rec).brief as string;
const D1 = JSON.parse(readFileSync('tests/fixtures/drafter-text-3/served-t5-d1-hiring-deadline.json', 'utf8')) as { brief: string; text: string };
/** T5 D1's drafter asked the date itself, beside the host's deadline ask: the served ×2. */
const DRAFTER_DATE_ASK = 'What is the feature-launch deadline date?';
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

/** The real build of T5 D1's brief, the drafter answering `text` (its one call): what it was sent, and the questions returned. */
async function buildD1(text: string): Promise<{ sent: Rec; questions: string[] }> {
  let sent: Rec | undefined;
  let calls = 0;
  const result = await buildModelFromBrief(sid, D1.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) return { status: 200, json: { registered: true, model_version: { version_number: 1 } } };
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => {
    calls += 1;
    if (calls > 1) throw new Error('D1: a call T5 never answered');
    sent = structuredClone(req);
    return { text, status: 'completed' };
  }) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 400)).toBe(true);
  return { sent: sent!, questions: (result.open_questions ?? []) as string[] };
}

describe('what the drafter is sent', () => {
  it('1. hiring: the instructions open with the goal as the user\'s governing aim, before the event-by-date rule', async () => {
    // The instructions are one joined string: Olumi's purpose lines open it (#3045, Paul's principle), then the aim sentence,
    // before the event-by-date rule.
    expect(TEXT.goal_is_the_aim.endsWith(T1_GOAL.old)).toBe(true);
    const aimLine = TEXT.goal_is_the_aim.slice(0, -T1_GOAL.old.length) + T1_GOAL.replacement;
    expect(BUILD_INSTRUCTIONS.startsWith(`${OLUMI_PURPOSE_CORE_LINES.join(' ')} ${aimLine} For an EVENT by a date`)).toBe(true);
    const sent = await firstRequest(HIRING_BRIEF);
    expect(sent.instructions as string).toContain(TEXT.goal_is_the_aim);
    // Contrast in the same request: the event-by-date rule it now governs is still sent.
    expect(sent.instructions as string).toContain('For an EVENT by a date (meet the deadline, launch by, deliver on time, ship by Q2)');
  });

  it('2. D1 (recorded): the drafter is not asked for the date, and the host\'s deadline ask is returned exactly once', async () => {
    const draft = JSON.parse(D1.text) as Rec & { goal: { deliverable: string }; unknowns: string[] };
    expect(draft.unknowns, 'PRECONDITION: the recorded drafter asked the date itself').toContain(DRAFTER_DATE_ASK);
    const hostAsk = chanceGoalDeadlineAsk(draft.goal.deliverable);
    const asServed = await buildD1(D1.text);
    expect(asServed.sent.instructions as string).not.toContain('Ask for the date first');
    expect(asServed.sent.instructions as string).toContain(TEXT.date_not_asked);
    expect(asServed.questions.filter((q) => q === hostAsk)).toHaveLength(1);
    // What the text asks of the drafter: the same recorded answer without its own date ask. The host still asks once, and
    // the drafter's date ask is absent from the returned questions.
    const asked = { ...draft, unknowns: draft.unknowns.filter((u) => u !== DRAFTER_DATE_ASK) };
    const fixed = await buildD1(JSON.stringify(asked));
    expect(fixed.questions.filter((q) => q === hostAsk)).toHaveLength(1);
    expect(fixed.questions).not.toContain(DRAFTER_DATE_ASK);
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

  // ⭐ G1 (AIE AMEND 17 Oct on Lane A 6229024284): the build framed its goal on a later ambition's figure. The AIE's sentence
  // replaces the old ambition sentence inside the same goal paragraph. Whether the drafter now behaves so is AI behaviour,
  // judged on the served build, never here. SYNTHETIC brief: neither a journey's brief nor the AIE's own example.
  it('5. a current aim and a later one: the AIE\'s sentence is sent once, in place of the old ambition sentence, the paragraph\'s other rules kept', async () => {
    const brief = 'Our current aim is to reach 40 paying clinics by the end of next year; one day we would like to serve 500. '
      + 'Should we hire a second sales lead or a partnerships manager?';
    const sent = (await firstRequest(brief)).instructions as string;
    expect(sent.split(TEXT.current_aim_not_later_ambition)).toHaveLength(2);
    expect(TEXT.goal_is_the_aim).toContain(TEXT.current_aim_not_later_ambition);
    expect(sent).not.toContain('Preserve an eventual ambition separately from the current task');
    // Contrasts in the same request: the rules beside it in that paragraph are still sent.
    for (const kept of ['explicit later framing supersedes earlier framing where they conflict', 'preserve their AND meaning, common reference and window',
      'A date is not automatically the goal', 'If the governing meaning is unclear, retain the original words and ask']) expect(sent).toContain(kept);
  });
});
describe('AIE-10 (prompt/AIE-REVIEW-20261015.md): the first-draft default no longer revives carrying on as now', () => {
  it('the drafter is told to propose feasible alternatives as Olumi\'s, and to keep a rejected or infeasible status quo only as a separated reference', async () => {
    const sent = await firstRequest(HIRING_BRIEF);
    const instructions = sent.instructions as string;
    expect(instructions).toContain('when further alternatives would help, propose materially different feasible alternatives, labelled as Olumi\'s. '
      + 'Include carrying on as an actionable option only where consistent with the user\'s current constraints and explicit corrections; if it is '
      + 'infeasible or rejected, retain it only as a clearly separated reference when useful, not as a revived feasible choice.');
    // Founder turn 04 ("I cannot carry on as I am now") still drafted it: the unconditional default is gone.
    expect(instructions).not.toContain('add carrying on as now if they did not state it');
  });
});

