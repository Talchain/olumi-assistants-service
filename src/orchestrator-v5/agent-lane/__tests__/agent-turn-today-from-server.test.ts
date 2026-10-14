/**
 * ⭐ TODAY FROM THE SERVER CLOCK (DL 15 Oct 23:08Z). HIRING's legacy capture (Paul's legacy-code brief, served 14 Oct 2026)
 * turn 02 said "Six months from today, 9 March 2026, is 9 September 2026": the ordinary turn's input held no date, so the
 * Agent guessed one. Each turn now carries the server's own day in Europe/London, once, and never hands it on to history.
 */
import { describe, expect, it, vi } from 'vitest';
import { runAgentTurn, TODAY_PREFIX } from '../runtime/agent-loop.js';

const ctx = { scenario_id: '11111111-1111-1111-1111-111111111111', authenticated_user_id: 'user-a', request_id: 'req-1' };
const base = { ctx, history: [], message: 'When would six months from today be?', instructions: 'be precise', maxOutputTokens: 256 };
const texts = (items: readonly unknown[] | undefined): string[] => (items ?? []).flatMap((i) =>
  ((i as { content?: { text?: unknown }[] }).content ?? []).flatMap((c) => (typeof c?.text === 'string' ? [c.text] : [])));

function captureModel() {
  const seen: (readonly unknown[])[] = [];
  const callModel = vi.fn(async (req: { input?: readonly unknown[] }) => {
    seen.push([...(req.input ?? [])]);
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'That would be in April.' }] }] } as never;
  });
  return { seen, callModel: callModel as never };
}

describe('the Agent is told today\'s date from the server clock', () => {
  it('RED: the SENT input carries the server\'s London day once (00:30 BST on 15 Oct, though UTC still says 14 Oct)', async () => {
    const { seen, callModel } = captureModel();
    const at = Date.parse('2026-10-14T23:30:00Z');
    await runAgentTurn({ ...base, now: () => at }, {} as never, callModel);
    const days = texts(seen[0]).filter((t) => t.startsWith(TODAY_PREFIX));
    expect(days).toEqual([`${TODAY_PREFIX}15 October 2026. Count every date, and anything “from today”, from this day; never assume another date.`]);
    // The user's message is still the last thing the model reads.
    expect(texts(seen[0]).at(-1)).toBe(base.message);
  });

  it('CONTRAST: a different server day is a different line (the date is read, not fixed)', async () => {
    const { seen, callModel } = captureModel();
    await runAgentTurn({ ...base, now: () => Date.parse('2026-03-09T12:00:00Z') }, {} as never, callModel);
    expect(texts(seen[0]).filter((t) => t.startsWith(TODAY_PREFIX))).toEqual([expect.stringContaining('9 March 2026.')]);
  });

  it('the day never enters the history the turn hands on, so a later turn never reads a stale day', async () => {
    const { callModel } = captureModel();
    const r = await runAgentTurn({ ...base, now: () => Date.parse('2026-10-14T12:00:00Z') }, {} as never, callModel);
    expect(texts(r.items).some((t) => t.startsWith(TODAY_PREFIX))).toBe(false);
    expect(texts(r.items)).toContain(base.message);
  });
});
