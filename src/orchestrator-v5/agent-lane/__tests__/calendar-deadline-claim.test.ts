/**
 * ⭐ GEN D4 ITEM B, THE CONSUMER (DL GO 14 Oct): A CALENDAR DEADLINE IS ASKED, NEVER COUNTED, AND NEVER LOST.
 *
 * T5-integrated D4 r2 (staging 14b1e544) drafted "…by the end of that quarter" as horizon_months 3, and the build asked
 * "within 3 months?" (a count that needs today's date and a fiscal calendar to be true). The AIE's D4_B text tells the
 * drafter to leave the count null. Alone that LOSES the deadline: null also means "no deadline", `attestHorizon` misses
 * "that quarter" (CALENDAR_POINT stays as it is), and nothing is asked. So the drafter claims the point
 * (`goal.deadline_words`) and the host asks it, checked inside the goal's own verified statement, never stored.
 *
 * Corpus: T5-integrated D4 r2's registered brief and recorded drafter answer (`tests/fixtures/calendar-deadline-text/
 * t5-integrated-d4-r2.json`, `_source`). `asTheTextAsks` changes four goal fields of that answer to the shape the D4_B text
 * and the field ask for: a constructed answer, not the drafter's behaviour, which is measured on the served build.
 * Texts by identity: `tests/fixtures/calendar-deadline-text/deadline-words.json` (the AIE's exact texts, #94 6164650110).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, DEADLINE_CLAIM_QUESTION } from '../runtime/build-model.js';
import { calendarDeadlineClaim } from '../calendar-deadline-claim.js';

type Rec = Record<string, any>;
const D4 = JSON.parse(readFileSync('tests/fixtures/calendar-deadline-text/t5-integrated-d4-r2.json', 'utf8')) as { brief: string; text: string };
const TEXTS = JSON.parse(readFileSync('tests/fixtures/calendar-deadline-text/deadline-words.json', 'utf8')) as { field_description: string; claim_question: string };
const sid = '6d6d6d6d-6d6d-4d6d-8d6d-6d6d6d6d6d6d';
/** The goal's complete statement, verbatim from the brief, with the earlier words that identify "that quarter". */
const QUOTE = 'Without a change, we expect it to reach 10 weeks next quarter. We want to reduce it by at least 15% relative to today\'s 8-week level by the end of that quarter.';
const WORDS = 'by the end of that quarter';
/** Olumi's reading, never "the deadline your brief sets": the claim is Olumi's interpretation of the source (AIE). */
const ASKED = `Olumi reads "${WORDS}" as a calendar deadline for "median delivery cycle". Which date does that mean? The model does not yet hold a confirmed date for this reading. Retained wording: "${QUOTE}"`;

/** The recorded D4 answer with its goal as the D4_B text and the field ask: no count, the full quote, the claimed point. */
const asTheTextAsks = (goal: Rec = {}): Rec => {
  const d = JSON.parse(D4.text) as Rec;
  d.goal = { ...d.goal, horizon_months: null, basis: { ...d.goal.basis, period_months: null }, source_quote: QUOTE, deadline_words: WORDS, ...goal };
  return d;
};

/** The real build path: the drafter returns `draft`; the sent request, the registered graph and the open questions. */
async function construct(draft: Rec, brief = D4.brief): Promise<{ sent: Rec; graph: Rec; asked: string[] }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft), status: 'completed' }; }) as never) as Rec;
  if (result.ok !== true || graph === undefined || sent === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph, asked: (result.open_questions ?? []) as string[] };
}
const goalNode = (graph: Rec): Rec => (graph.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const deadlineAsks = (asked: readonly string[]): string[] => asked.filter((q) => /^Which date does |^Olumi reads |get there within \d+ months\?/.test(q));

describe('GEN D4 item B: a calendar deadline the drafter claims is asked with its words and their statement', () => {
  it('PRECONDITION: the recorded answer counts the quarter as 3 months, and the build asks that count', async () => {
    const { asked } = await construct(JSON.parse(D4.text) as Rec);
    expect(deadlineAsks(asked)).toEqual(['Does "median delivery cycle" get there within 3 months? The model holds no deadline yet, so no result answers that.']);
  });

  it('PRECONDITION: the text alone (no count, no claim) loses the deadline: nothing is asked', async () => {
    const { asked } = await construct(asTheTextAsks({ deadline_words: null }));
    expect(deadlineAsks(asked)).toEqual([]);
  });

  it('RED: the claimed point is asked once, with the goal\'s statement that identifies "that quarter"; nothing is stored', async () => {
    const { asked, graph } = await construct(asTheTextAsks());
    expect(deadlineAsks(asked)).toEqual([ASKED]);
    const goal = goalNode(graph);
    expect(goal.goal_deadline_as_stated).toBeUndefined();
    expect(goal.goal_horizon_months).toBeUndefined();
  });

  it('ADVERSARIAL (identity, not a value): words in the brief but outside the goal\'s own statement are not its deadline', async () => {
    const elsewhere = 'Automation may initially slow delivery';
    expect(D4.brief).toContain(elsewhere);
    expect(QUOTE).not.toContain(elsewhere);
    const { asked } = await construct(asTheTextAsks({ deadline_words: elsewhere }));
    expect(deadlineAsks(asked)).toEqual([]);
  });

  it('CONTRAST: a quote that is not a whole statement of the brief verifies nothing; nothing is asked', async () => {
    const cut = 'reduce it by at least 15% relative to today\'s 8-week level by the end of that quarter.';
    expect(D4.brief).toContain(cut);
    const { asked } = await construct(asTheTextAsks({ source_quote: cut }));
    expect(deadlineAsks(asked)).toEqual([]);
  });

  it('CONTRAST: a claim beside a month count is incoherent; the count path stays as today', async () => {
    const { asked } = await construct(asTheTextAsks({ horizon_months: 3 }));
    expect(deadlineAsks(asked)).toEqual(['Does "median delivery cycle" get there within 3 months? The model holds no deadline yet, so no result answers that.']);
  });

  it('the SENT request carries the field\'s text, and the question is the fixture\'s, by identity', async () => {
    const { sent } = await construct(asTheTextAsks());
    const goal = (sent.schema as Rec).properties.goal.properties as Rec;
    expect(goal.deadline_words.description).toBe(TEXTS.field_description);
    expect(DEADLINE_CLAIM_QUESTION).toBe(TEXTS.claim_question);
  });

  it('BOUND TO THE ADOPTED GOAL (AIE): a retry that re-chose the goal is never asked the first draft\'s quote', () => {
    const first = { ...(JSON.parse(D4.text) as Rec).goal, horizon_months: null, source_quote: QUOTE, deadline_words: WORDS };
    expect(calendarDeadlineClaim(D4.brief, first, { ...first, source_quote: null, deadline_words: null }), 'contrast: the same goal, retried')
      .toEqual({ words: WORDS, quote: QUOTE, goal: 'median delivery cycle' });
    expect(calendarDeadlineClaim(D4.brief, first, { ...first, metric: 'Delivery throughput' })).toBeUndefined();
    expect(calendarDeadlineClaim(D4.brief, first, { ...first, value: (first.value as number) + 5 })).toBeUndefined();
  });
});
