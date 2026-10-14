/**
 * ⭐ A SECOND BOUNDED SIZE RETRY (DL ruling 14 Oct; T5 D2 r1, `recovery/outbox/PROMPT.md`). With ONE retry, Paul's marketing
 * brief registered nothing 1 time in 2. Told its own links budget, the drafter came back within the limit 9/10. But a retry
 * adopted as smaller yet still over (rep 7: 31 links) or refused for cutting what a kept option needs (rep 8) ended the
 * build. While the model is STILL over the limit after the first retry, one more edits the current model under the same gates.
 *
 * The corpus is not the author's: T5's served brief and first drafts, and five REAL provider retries sent the v3 text
 * (`tests/fixtures/size-retry/t5-d2-v3-retries.json`, `_source`). The rows run the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const FIRST = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
const R = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-v3-retries.json', 'utf8')) as Rec;
const sid = '5d2d2d2d-5d2d-4d2d-8d2d-5d2d2d2d2d2f';

/** The real build path: the drafter answers with `drafts` in turn; what it was sent, the result and its trace come back. */
async function construct(drafts: Rec[]): Promise<{ sent: Rec[]; result: Rec; registered: number; trace: Rec }> {
  const sent: Rec[] = [];
  let registered = 0;
  let trace: Rec = {};
  const result = await buildModelFromBrief(sid, FIRST.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) { registered += 1; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'second-retry' } };
  }) as never, (async (req: Rec) => {
    sent.push(structuredClone(req));
    return { text: JSON.stringify(drafts[Math.min(sent.length - 1, drafts.length - 1)]) };
  }) as never, (t: Rec) => { trace = t; });
  return { sent, result: result as Rec, registered, trace };
}
const SIZE = 'Your previous model was too large';

describe('the served D2 r1 failures, through the 2-retry path', () => {
  it('rep 7 (adopted at 31 links, still over): a second retry edits THAT model, and a within-limit answer registers', async () => {
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep7, R.retry_rep9]);
    expect(sent, 'the first pass and two size retries').toHaveLength(3);
    expect(sent[2]!.instructions as string).toContain(`${SIZE}: 16 nodes and 31 links, 1 links over the limit.`);
    // The model handed to the second retry is the one the first retry left, not the first draft again.
    expect(sent[2]!.input as string).toContain(JSON.stringify(R.retry_rep7.links[0]).slice(0, 40));
    expect(sent[2]!.input as string).not.toContain('"Current-team delivery duration"');
    expect(trace).toMatchObject({ retried: true, outcome: 'adopted', second: 'adopted' });
    expect(result).toMatchObject({ ok: true, within_compact_limits: true, size_retried: true });
    expect(registered).toBe(1);
  });

  it('rep 8 (refused: cut a factor a kept option acts on): the first draft is still over, so a second retry runs, and registers', async () => {
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep8, R.retry_rep6]);
    expect(sent).toHaveLength(3);
    expect(sent[2]!.instructions as string).toContain(`${SIZE}: 17 nodes and 32 links, 2 links over the limit.`);
    expect(trace).toMatchObject({ retried: true, outcome: 'kept_first', second: 'adopted' });
    expect(result).toMatchObject({ ok: true, within_compact_limits: true });
    expect(registered).toBe(1);
  });
  it('NEVER SILENTLY: what BOTH retries shed is said against the first draft (rep 7 shed one factor, rep 6 then an outcome)', async () => {
    const { result } = await construct([FIRST.draft_call1, R.retry_rep7, R.retry_rep6]);
    expect(result).toMatchObject({ ok: true, size_retried: true });
    const said = (result.left_out_to_stay_compact as Rec[]).map((n) => n.label);
    // Shed by the FIRST retry (rep 7), and absent from the second's model too: still said.
    expect(said).toContain('Current-team delivery duration');
    // Shed by the SECOND retry (rep 6) from what rep 7 kept.
    expect(said).toContain('Commercial launch readiness');
  });
});

describe('the gates still hold on the second retry, and there is never a third', () => {
  it('RED: a second retry still over the limit is refused, nothing is written, and no third call is made', async () => {
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep7, R.retry_rep7, R.retry_rep9]);
    expect(sent, 'never a third retry').toHaveLength(3);
    expect(trace).toMatchObject({ outcome: 'adopted', second: 'adopted' });
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 31 });
    expect(registered).toBe(0);
  });

  it('RED: a second retry that drops a USER-stated option is refused (keepsEveryUserStatedIdentity); the over-limit model is refused', async () => {
    // Rep 7's own model with the brief's "Partner launch" option and its actions taken out: what the gate must never adopt.
    const dropped = structuredClone(R.retry_rep7) as Rec;
    dropped.options = (dropped.options as Rec[]).filter((o) => o.label !== 'Partner launch');
    expect((R.retry_rep7.options as Rec[]).some((o) => o.label === 'Partner launch' && o.provenance === 'explicit'), 'PRECONDITION: the user stated it').toBe(true);
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep7, dropped]);
    expect(sent).toHaveLength(3);
    expect(trace).toMatchObject({ outcome: 'adopted', second: 'kept_first' });
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 31 });
    expect(registered).toBe(0);
  });

  it('CONTRAST: a first retry within the limit (rep 6) ends it: no second retry, no `second` on the trace', async () => {
    const { sent, result, trace } = await construct([FIRST.draft_call1, R.retry_rep6, R.retry_rep9]);
    expect(sent).toHaveLength(2);
    expect(trace).toEqual(expect.objectContaining({ outcome: 'adopted' }));
    expect(trace).not.toHaveProperty('second');
    expect(result).toMatchObject({ ok: true, within_compact_limits: true });
  });

  it('r2 is unchanged: its one retry (rep 10) registers, with no second', async () => {
    const { sent, result, trace } = await construct([R.r2_first_draft, R.retry_rep10]);
    expect([sent.length, sent.filter((r) => String(r.instructions).includes(SIZE)).length]).toEqual([2, 1]);
    expect(trace).not.toHaveProperty('second');
    expect(result).toMatchObject({ ok: true, within_compact_limits: true });
  });
});
