/**
 * ⭐ THE HOST TAIL A USER READS AT REST (DL #75 5923219186: a brief turn ≤160 words on screen, every truth kept; AIQ words
 * 5923232439: "Held fixed (no option changes them): <full labels>.", no dash, the ask behind More).
 *
 * What is ON SCREEN is not `assistant_text`: DGAI splits the build's open questions off at the producer's marker and shows
 * them behind a collapsed, counted toggle (`serverOpenQuestions.ts`, `MessageBubble.tsx`). Only the text BEFORE the marker,
 * plus any producer sentence AFTER the questions, stays at rest. The split below is DGAI's, copied VERBATIM from
 * DecisionGuideAI staging `69c05df1` `src/canvas/conversation/serverOpenQuestions.ts` (marker, PRODUCER_SENTENCE,
 * AFTER_THE_QUESTIONS, NO_QUESTION_FIRST): a consumer's predicate is a contract, so it is pinned, never paraphrased.
 *
 * Served paul-1 (`d23f5df1`, guest 86178df3): 194 words at rest, of which the held-fixed line was 34 ("No option changes
 * … — tell me if one of the options should change them."), AFTER the questions, so at rest, with its ask.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { narrateWriteOutcome, openQuestionsForReply, openQuestionsOf } from '../write-outcome.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/served-paul1-host-tail-d23f5df1.json', import.meta.url), 'utf8')) as {
  open_questions: string[]; treated_as_context: string[]; served_assistant_text: string;
};

// ── DGAI staging 69c05df1 serverOpenQuestions.ts, verbatim ──
const SERVER_OPEN_QUESTIONS_MARKER = 'Questions this model does not answer yet:';
const PRODUCER_SENTENCE =
  String.raw`(?:No option changes |Not included in this proposal: |Saved\b|Not saved\b|Partly saved\b|That change was already saved\b|The model was |This model had already been built\b)`;
const AFTER_THE_QUESTIONS = new RegExp(String.raw`[.?!)]\s+(?=${PRODUCER_SENTENCE})`);
const NO_QUESTION_FIRST = new RegExp(String.raw`^\s*${PRODUCER_SENTENCE}`);
function splitServerOpenQuestions(text: string): { lead: string; questions: string; after: string; atRest: string } | null {
  const at = text.indexOf(SERVER_OPEN_QUESTIONS_MARKER);
  if (at === -1 || text.indexOf(SERVER_OPEN_QUESTIONS_MARKER, at + 1) !== -1) return null;
  if (!/\s$/.test(text.slice(0, at))) return null;
  const lead = text.slice(0, at).trimEnd();
  const tail = text.slice(at + SERVER_OPEN_QUESTIONS_MARKER.length);
  if (NO_QUESTION_FIRST.test(tail)) return null;
  const end = tail.search(AFTER_THE_QUESTIONS);
  const questions = (end === -1 ? tail : tail.slice(0, end + 1)).trim();
  const after = end === -1 ? '' : tail.slice(end + 1).trim();
  if (lead.length === 0 || questions.length === 0) return null;
  return { lead, questions, after, atRest: after ? `${lead} ${after}` : lead };
}
// ──

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const built = (over: Record<string, unknown> = {}) => ({ ok: true, mutated: true, open_questions: FX.open_questions, treated_as_context: FX.treated_as_context, ...over });
/** The reply as the route sends it: the model's prose, then the host status line. */
const reply = (status: string): string => `The model's own words. ${status}`;

describe('served paul-1: the held-fixed fact stays at rest, short; its ask moves behind the questions toggle', () => {
  const status = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [built() as never]).status!;
  const split = splitServerOpenQuestions(reply(status));

  it('CONTROL (the served text, before this change): the held-fixed line sat AFTER the questions, at rest, with a dash and an ask', () => {
    const served = splitServerOpenQuestions(FX.served_assistant_text);
    expect(served, 'the UI split works on the served text').not.toBeNull();
    expect(served!.after.startsWith('No option changes ')).toBe(true);
    expect(served!.after).toContain('— tell me if one of the options should change them');
    expect(words(served!.after)).toBe(34);
  });

  it('RED: at rest the line reads "Held fixed (no option changes them): <labels>." — before the marker, no dash, no ask', () => {
    expect(split, 'the UI split still works').not.toBeNull();
    expect(split!.lead.endsWith('The model was saved. Held fixed (no option changes them): Cold emails to investment firms; Warm connections to investment….')).toBe(true);
    expect(split!.after, 'nothing after the questions is left at rest').toBe('');
    expect(split!.atRest).not.toContain('—');
    expect(split!.atRest).not.toMatch(/\?/);
    // The host's own words at rest: "The model was saved." + the held-fixed line — 19, was 4 + 34 = 38.
    expect(words(split!.atRest) - words("The model's own words.")).toBe(19);
  });

  it('RED: the ask is not lost — it is the last item of the toggle list (wire `_agent.open_questions`) and of the text', () => {
    const list = openQuestionsForReply(built() as never);
    expect(list.slice(0, FX.open_questions.length)).toEqual(FX.open_questions);
    expect(list.at(-1)).toBe('Should one of the options change Cold emails to investment firms or Warm connections to investment…?');
    expect(status).toContain(`(2 of ${FX.open_questions.length + 1} shown.)`);
  });

  it('CONTROL: no held-fixed factor → the toggle list is the build\'s own, unchanged, and no held-fixed line', () => {
    const r = built({ treated_as_context: undefined });
    expect(openQuestionsForReply(r as never)).toEqual(openQuestionsOf(r as never));
    expect(narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as never]).status).not.toContain('Held fixed');
  });

  it('CODEX smallest pair: a held-fixed factor with ZERO parked questions → ONE ask in the text AND the wire list; the fact at rest', () => {
    const r = built({ open_questions: [], treated_as_context: ['Recruitment fee'] });
    const s = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [r as never]).status!;
    const sp = splitServerOpenQuestions(reply(s));
    expect(sp).not.toBeNull();
    expect(sp!.atRest.endsWith('Held fixed (no option changes it): Recruitment fee.')).toBe(true);
    expect(sp!.questions).toBe('Should one of the options change Recruitment fee?');
    expect(openQuestionsForReply(r as never), 'the wire list the toggle renders').toEqual(['Should one of the options change Recruitment fee?']);
    expect(s.split('Should one of the options change').length - 1, 'said once in the text').toBe(1);
  });

  it('the ask is never repeated: once in the wire list, and the text count includes it once', () => {
    const list = openQuestionsForReply(built() as never);
    expect(list.filter((q) => q.startsWith('Should one of the options change')).length).toBe(1);
    expect(list).toHaveLength(FX.open_questions.length + 1);
  });
});

describe('the wire list the toggle renders is the same list', () => {
  it('the route builds `_agent.open_questions` from openQuestionsForReply (source pin)', () => {
    const src = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(src).toContain('openQuestionsForReply(result.tool_results[at]');
    expect(src).not.toMatch(/\bopenQuestionsOf\(/);
  });
});
