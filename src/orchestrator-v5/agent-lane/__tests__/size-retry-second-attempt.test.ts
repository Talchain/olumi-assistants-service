/**
 * ⭐ A SECOND BOUNDED SIZE RETRY (DL ruling 14 Oct; T5 D2 r1, `recovery/outbox/PROMPT.md`). With ONE retry, Paul's marketing
 * brief registered nothing 1 time in 2. Told its own links budget, the drafter came back within the limit 9/10. But a retry
 * adopted as smaller yet still over (rep 7: 31 links) or refused for cutting what a kept option needs (rep 8) ended the
 * build. When the first retry is ADOPTED and the model is still over the limit, one more edits that model under the same
 * gates; a gate's rejection (rep 8) is never retried away (DL rulings 04:00Z/04:07Z).
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
  // drafts[0] is the first pass's answer; each later entry answers one retry, in order.
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

  it('RED: rep 8 (refused by a gate: it cut a factor a kept option acts on) is NEVER retried away: refused as before', async () => {
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep8, R.retry_rep6]);
    expect(sent, 'no second retry after a rejection').toHaveLength(2);
    expect(trace).toMatchObject({ retried: true, outcome: 'kept_first' });
    expect(trace).not.toHaveProperty('second');
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 32 });
    expect(registered).toBe(0);
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

  // Codex FAIL 3011 r1 (`codex/CHECK-3011-b61aaf1a-codex.md`): the second retry is held to the FIRST retry's gates. Rep 7's
  // own model, edited the two ways Codex found registering, must be refused exactly as the first retry would refuse them.
  it.each<[string, (d: Rec) => void]>([
    ['cuts a kept option\'s link into the kept risk (Agency campaign effort → Unknown conversion lift)', (d) => {
      const before = (d.links as Rec[]).length;
      d.links = (d.links as Rec[]).filter((l) => !(l.from === 'Agency campaign effort' && l.to === 'Unknown conversion lift'));
      expect((d.links as Rec[]).length, 'PRECONDITION: rep 7 drew that link').toBe(before - 1);
    }],
    ['reverses the kept risk\'s link to the goal path (Unknown conversion lift → Conversion rate)', (d) => {
      const l = (d.links as Rec[]).find((x) => x.from === 'Unknown conversion lift' && x.to === 'Conversion rate')!;
      expect(l.direction, 'PRECONDITION: rep 7 drew it negative').toBe('negative');
      l.direction = 'positive';
    }],
  ])('RED: a second retry that %s is refused, as the first would be; nothing registers', async (_case, edit) => {
    const second = structuredClone(R.retry_rep7) as Rec;
    edit(second);
    const { sent, result, registered, trace } = await construct([FIRST.draft_call1, R.retry_rep7, second]);
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

/**
 * ⭐ THE CLASS (Codex FAIL 3011 r2, `codex/CHECK-3011-590ab704-codex.md`; DL class ruling 14 Oct). Each round found one more gate
 * keyed on the moving state (r1 the risk gate on the issues still asked, r2 `compactionKeepsWhatOptionsDo` on the adopted
 * candidate). Every retry draft is now judged by ONE function against the first draft (`judgeRetry`), so a draft's verdict
 * cannot depend on which attempt returned it.
 */
describe('a retry draft gets the same verdict whichever attempt returns it', () => {
  /** Codex r2's first draft: the Agency campaign also acts on "Current-team delivery duration". */
  const agencyOnDuration = (): Rec => {
    const d = structuredClone(FIRST.draft_call1) as Rec;
    (d.options as Rec[]).find((o) => o.label === 'Agency campaign')!.interventions.push({ factor_label: 'Current-team delivery duration',
      value: 4, value_kind: 'absolute', unit: 'months', provenance: 'ai_proposed', stated_evidence: null });
    return d;
  };
  /** Codex r2's final draft: rep 7 with that factor and its outgoing link restored, "Qualified launch visitors" and its links gone. */
  const codexR2Final = (): Rec => {
    const d = structuredClone(R.retry_rep7) as Rec;
    const first = FIRST.draft_call1 as Rec;
    d.factors.push(structuredClone((first.factors as Rec[]).find((f) => f.label === 'Current-team delivery duration')));
    d.links.push(...structuredClone((first.links as Rec[]).filter((l) => l.from === 'Current-team delivery duration')));
    d.outcomes = (d.outcomes as Rec[]).filter((o) => o.label !== 'Qualified launch visitors');
    d.links = (d.links as Rec[]).filter((l) => l.from !== 'Qualified launch visitors' && l.to !== 'Qualified launch visitors');
    return d;
  };

  it('RED (Codex r2 repro): the final draft refused at retry 1 is refused at retry 2 too; nothing registers (before: 27 links registered)', async () => {
    const atOne = await construct([agencyOnDuration(), codexR2Final()]);
    expect(atOne.trace, 'PRECONDITION: refused when it is the first retry').toMatchObject({ outcome: 'kept_first' });
    const atTwo = await construct([agencyOnDuration(), R.retry_rep7, codexR2Final()]);
    expect(atTwo.trace, 'retry 1 (rep 7) is adopted and still over, so retry 2 runs').toMatchObject({ outcome: 'adopted', second: 'kept_first' });
    expect(atTwo.result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 31 });
    expect(atTwo.registered).toBe(0);
  });

  /** Every recorded real retry, and Codex's three repros, as the final draft. */
  const finals = (): [string, () => Rec, () => Rec][] => {
    const cut = (): Rec => { const d = structuredClone(R.retry_rep7) as Rec; d.links = (d.links as Rec[]).filter((l) => !(l.from === 'Agency campaign effort' && l.to === 'Unknown conversion lift')); return d; };
    const flip = (): Rec => { const d = structuredClone(R.retry_rep7) as Rec; (d.links as Rec[]).find((l) => l.from === 'Unknown conversion lift' && l.to === 'Conversion rate')!.direction = 'positive'; return d; };
    const firstDraft = (): Rec => FIRST.draft_call1 as Rec;
    return [
      ['rep 6 (within the limit)', firstDraft, () => R.retry_rep6],
      ['rep 8 (cuts a factor a kept option acts on)', firstDraft, () => R.retry_rep8],
      ['rep 9', firstDraft, () => R.retry_rep9],
      ['rep 7 again (still over)', firstDraft, () => R.retry_rep7],
      ['the served retry (draft_call2)', firstDraft, () => FIRST.draft_call2],
      ['Codex r1: a kept option\'s link into the kept risk cut', firstDraft, cut],
      ['Codex r1: the kept risk\'s link reversed', firstDraft, flip],
      ['Codex r2: the option\'s action dropped while its factor is kept', agencyOnDuration, codexR2Final],
    ];
  };
  it.each(finals())('PROPERTY: %s — the verdict at retry 2 equals the verdict at retry 1', async (_name, firstDraft, final) => {
    const atOne = await construct([firstDraft(), final()]);
    const atTwo = await construct([firstDraft(), R.retry_rep7, final()]);
    expect(atTwo.trace.outcome, 'PRECONDITION: rep 7 is adopted, still over, so retry 2 runs').toBe('adopted');
    expect(atTwo.trace.second).toBe(atOne.trace.outcome);
  });
});
