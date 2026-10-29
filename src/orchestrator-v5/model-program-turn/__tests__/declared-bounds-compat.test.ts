import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { CanonicalModel, withDeclaredTiming } from '../../model-program/canonical.js';
import { MODEL_PROGRAM, programReadOf, reopenProgram } from '../program-store.js';
import { ENGINE_VERSIONS, revisionDigest, type StoredRun } from '../run-receipt.js';
import { evaluateCanonical } from '../evaluate.js';

// Synthetic saved model in the format before physical bounds were declared.
const legacyModel = () => ({
  version: 'canonical.v1', question: 'How can the bakery grow?', period: 'week',
  quantities: [{
    id: 'net_loaves', label: 'Net change in loaves', unit: 'loaf',
    value: -2, low: null, high: null, range_kind: null, direction: null,
    kind: 'fact', status: 'known', question: null, basis: null,
    author: 'person', party: null, quote: 'Two fewer loaves', approval: 'approved', author_id: 'baker',
  }],
  relations: [], goals: [], limits: [], preferences: [], options: [], risks: [],
  claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
});
const words = ['Two fewer loaves'];
const priorVersions = { ...ENGINE_VERSIONS, engine: 'mp-synthetic-before-bounds' };

// The pre-change digest, independent of the new declaration-stripping implementation.
function legacyDigest(model: ReturnType<typeof legacyModel>): string {
  const quantities = model.quantities.map(({ direction: _direction, ...quantity }) => quantity);
  return createHash('sha256').update(stableStringify({ canonical: { ...model, quantities }, person_words: words }), 'utf8').digest('hex');
}

function savedBeforeBounds() {
  const canonical = legacyModel();
  const run: StoredRun = {
    run_id: 'mp_run_synthetic_before_bounds', computed_at: '2026-10-01T00:00:00.000Z',
    receipt: { revision_digest: legacyDigest(canonical), versions: priorVersions, seed: 7, draws: null },
    result: {
      canonical_analysis_view: {
        marker: 'stored result, never recomputed',
        run: { run_id: 'mp_run_synthetic_before_bounds', graph_hash_at_run: 'old-graph', computed_at: '2026-10-01T00:00:00.000Z' },
        staleness: { stale: false, reason: 'graph_hash_match' },
      },
      chances: null, compile: null,
    },
  };
  return { living_model: { model_program: MODEL_PROGRAM, canonical, person_words: words, seed: 7, runs: [run] } };
}

describe('declared physical bounds on saved models', () => {
  it('opens an old model with null bounds, the same revision digest and the same stored Run, without changing its saved bytes', () => {
    const saved = savedBeforeBounds();
    const before = JSON.stringify(saved);
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    expect(opened).toBeDefined();
    expect(opened.program.canonical.quantities[0]).toMatchObject({ value: -2, floor: null, ceiling: null, author: 'person', quote: words[0] });
    expect(revisionDigest(opened.program.canonical, words)).toBe(legacyDigest(saved.living_model.canonical));
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    expect(opened.run).toEqual(saved.living_model.runs[0]);
    // The stored result as stored, its Run named by the revision its receipt binds (inventory F7), not the old stamp.
    const stored = saved.living_model.runs[0]!.result.canonical_analysis_view as { run: object };
    expect(opened.view).toEqual({ ...stored, run: { ...stored.run, graph_hash_at_run: legacyDigest(saved.living_model.canonical) } });
    expect(JSON.stringify(cold)).toBe(before);
  });

  it('defaults only missing declarations and preserves zero, signed bounds and the person\'s own figure and words', () => {
    const old = legacyModel();
    const withFloor = { ...old, quantities: [{ ...old.quantities[0]!, floor: 0 }] };
    const withCeiling = { ...old, quantities: [{ ...old.quantities[0]!, ceiling: -1 }] };
    expect(CanonicalModel.parse(withDeclaredTiming(withFloor)).quantities[0]).toMatchObject({ floor: 0, ceiling: null, value: -2, author: 'person', quote: words[0] });
    expect(CanonicalModel.parse(withDeclaredTiming(withCeiling)).quantities[0]).toMatchObject({ floor: null, ceiling: -1 });
    const read = withDeclaredTiming(withFloor);
    expect(withDeclaredTiming(read)).toEqual(read);
    expect(old.quantities[0]).not.toHaveProperty('floor');
  });

  it.each(['floor', 'ceiling'] as const)('includes a declared %s in revision identity, including zero, and keeps null equivalent to absent', (field) => {
    const old = legacyModel();
    const read = CanonicalModel.parse(withDeclaredTiming(old));
    expect(revisionDigest(read, words)).toBe(legacyDigest(old));
    const bounded = { ...read, quantities: [{ ...read.quantities[0]!, [field]: 0 }] };
    expect(revisionDigest(bounded, words)).not.toBe(revisionDigest(read, words));
    expect(revisionDigest({ ...bounded, quantities: [{ ...bounded.quantities[0]!, [field]: -1 }] }, words)).not.toBe(revisionDigest(bounded, words));
  });

  it('TIME-AND-DECIDE-BY (29 Oct): includes a stated time and a decide-by date in revision identity, and keeps null equivalent to absent', () => {
    const old = legacyModel();
    const read = CanonicalModel.parse(withDeclaredTiming(old));
    expect([read.decide_by, read.quantities[0]!.stated_time]).toEqual([null, null]);
    expect(revisionDigest(read, words)).toBe(legacyDigest(old));
    const stated = { ...read, quantities: [{ ...read.quantities[0]!, stated_time: { date: '2027-03-31', span: null, unit: null, said_on: null } }] };
    const spanned = { ...read, quantities: [{ ...read.quantities[0]!, stated_time: { date: null, span: 6, unit: 'week' as const, said_on: null } }] };
    const dated = { ...read, decide_by: { date: '2026-11-05', quote: 'the board meets on the 5th' } };
    const digests = [read, stated, spanned, dated, { ...dated, decide_by: { date: '2026-11-12', quote: 'the board meets on the 5th' } }].map((m) => revisionDigest(m, words));
    expect(new Set(digests).size).toBe(5);
    // PL G: a model saved before them, with its Run, reopens with that Run current, the Run and the saved bytes exactly as stored.
    const saved = savedBeforeBounds();
    const before = JSON.stringify(saved);
    expect(before).not.toMatch(/stated_time|decide_by/);
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    expect([opened.program.canonical.decide_by, opened.program.canonical.quantities[0]!.stated_time]).toEqual([null, null]);
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    expect(JSON.stringify(opened.run)).toBe(JSON.stringify(saved.living_model.runs[0]));
    expect(JSON.stringify(cold)).toBe(before);
  });

  it('PL 14:12Z (e): a stated time saved before said_on reads it as null, its revision digest unchanged; a said_on is part of the revision', () => {
    const old = legacyModel();
    const stated = { ...old, quantities: [{ ...old.quantities[0]!, stated_time: { date: null, span: 6, unit: 'week' } }] };
    const read = CanonicalModel.parse(withDeclaredTiming(stated));
    expect(read.quantities[0]!.stated_time).toEqual({ date: null, span: 6, unit: 'week', said_on: null });
    expect(revisionDigest(read, words)).toBe(legacyDigest(stated));
    const said = { ...read, quantities: [{ ...read.quantities[0]!, stated_time: { ...read.quantities[0]!.stated_time!, said_on: '2026-10-29' } }] };
    expect(revisionDigest(said, words)).not.toBe(revisionDigest(read, words));
  });

  it.each([{ floor: Infinity }, { ceiling: '10' }])('leaves an invalid declaration for the saved-model schema to refuse: %j', (bad) => {
    const saved = savedBeforeBounds();
    const malformed = { living_model: { ...saved.living_model, canonical: {
      ...saved.living_model.canonical, quantities: [{ ...saved.living_model.canonical.quantities[0]!, ...bad }],
    } } };
    expect(programReadOf(malformed).kind).toBe('unreadable');
  });

  it('numbers#2 (d): a model saved with Olumi\'s floor on a worked-out stock opens with its stored Run read as stored; only an explicit new Run applies the floor', () => {
    // Synthetic, saved after floors were declared (25 Oct) and before they were applied: 300 members, 25 join and 80 leave a
    // month (−30 at month 6), the stock declared never below 0, and a Run that gave the chance then.
    const at = { party: null, approval: 'approved', author_id: 'owner' };
    const fig = (id: string, unit: string, value: number, quote: string) => ({ id, label: id.replace(/_/g, ' '), unit, value, low: null, high: null, range_kind: null,
      direction: null, floor: null, ceiling: null, kind: 'fact', status: 'known', question: null, basis: null, author: 'person', quote, ...at });
    const said = ['300 members today', '25 join a month', '80 leave a month', 'at least 50 members on average', 'over the next year'];
    const canonical = {
      version: 'canonical.v1', question: 'How does the club keep its members?', period: 'month',
      quantities: [fig('members_now', 'member', 300, said[0]!), fig('joins', 'member/month', 25, said[1]!), fig('leavers', 'member/month', 80, said[2]!),
        { ...fig('members', 'member', 0, ''), value: null, kind: 'derived', status: 'derived', author: 'olumi', quote: null, floor: 0 },
        fig('fifty', 'member', 50, said[3]!), fig('year', 'month', 12, said[4]!)],
      relations: [{ form: 'stock', id: 'members_rel', defines: 'members', start: 'members_now', inflows: ['joins'], outflows: ['leavers'], author: 'olumi', quote: null, ...at }],
      goals: [{ id: 'keep_fifty', label: 'At least 50 members on average', measure: { quantity: 'members', per: null, cmp: '>=', target: 'fifty', frame: 'level', reference: null,
        aggregation: 'mean', window: { origin_event: null, origin_offset: null, start: 0, periods: 'year' }, measure_by: 'person', assumptions: [], exclusions: [] },
        question: null, author: 'person', quote: said[3]!, ...at }],
      limits: [], preferences: [], options: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [], history: [],
    };
    // Its digest as stored then, independent of the code: null declarations left out, the floor kept.
    const quantities = canonical.quantities.map(({ direction: _d, floor, ceiling: _c, ...q }) => ({ ...q, ...(floor === null ? {} : { floor }) }));
    const digest = createHash('sha256').update(stableStringify({ canonical: { ...canonical, quantities }, person_words: said }), 'utf8').digest('hex');
    const run: StoredRun = {
      run_id: 'mp_run_synthetic_floor_unapplied', computed_at: '2026-10-25T12:00:00.000Z',
      receipt: { revision_digest: digest, versions: priorVersions, seed: 7, draws: 200 },
      result: { canonical_analysis_view: { marker: 'stored chance 0 %, never recomputed',
        run: { run_id: 'mp_run_synthetic_floor_unapplied', graph_hash_at_run: 'old-graph', computed_at: '2026-10-25T12:00:00.000Z' }, staleness: { stale: false, reason: 'graph_hash_match' } },
        chances: { marker: 'stored', keep_fifty: 0 }, compile: null },
    };
    const saved = { living_model: { model_program: MODEL_PROGRAM, canonical, person_words: said, seed: 7, runs: [run] } };
    const before = JSON.stringify(saved);
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    expect(opened.program.canonical.quantities.find((q) => q.id === 'members')).toMatchObject({ floor: 0, ceiling: null });
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    expect(opened.run).toEqual(run);
    const stored = run.result.canonical_analysis_view as { run: object };
    expect(opened.view).toEqual({ ...stored, run: { ...stored.run, graph_hash_at_run: digest } });
    expect(JSON.stringify(cold)).toBe(before);
    // On today's engine the same stored Run is read unchanged, marked as from before an update; nothing is recomputed.
    const now = reopenProgram(JSON.parse(before))!;
    expect([now.current, now.engine_current]).toEqual([true, false]);
    expect(now.run).toEqual(run);
    expect(now.view).toMatchObject({ marker: 'stored chance 0 %, never recomputed', staleness: { stale: true, reason: 'engine_or_format_updated' } });
    // Contrast: an explicit new Run of the same saved model applies the floor: every draw leaves it, so the chance is withheld.
    const fresh = evaluateCanonical(opened.program.canonical, { sourceText: said.join('\n'), seed: 7, draws: 200 });
    expect(fresh.sim!.options[0]!.per_goal).toEqual([{ goal_id: 'keep_fifty', withheld: { reason: 'invalid_domain', count: 200, quantities: ['members'] } }]);
  });

  it('keeps model currency separate from an engine update and preserves the historical Run', () => {
    const saved = savedBeforeBounds();
    const opened = reopenProgram(JSON.parse(JSON.stringify(saved)))!;
    expect([opened.current, opened.engine_current]).toEqual([true, false]);
    expect(opened.view).toMatchObject({ marker: 'stored result, never recomputed', staleness: { stale: true, reason: 'engine_or_format_updated' } });
    expect(opened.run).toEqual(saved.living_model.runs[0]);
  });
});

describe('C6: a model saved before approved_by (27 Oct 2026)', () => {
  it('opens with its stored Run current: approved_by reads null on its record, its link and its history entry, author_id is never rewritten on read, and its saved bytes are untouched', () => {
    // Synthetic, in the format before approved_by: an approved figure, an approved link inside Olumi's relation, and a history
    // entry, each with author_id holding the person who approved it then.
    const at = { party: null, approval: 'approved', author_id: 'owner' };
    const fig = (id: string, unit: string, value: number | null, quote: string | null, f: Record<string, unknown> = {}) => ({ id, label: id.replace(/_/g, ' '), unit, value, low: null, high: null,
      range_kind: null, direction: null, floor: null, ceiling: null, kind: 'fact', status: 'known', question: null, basis: null, author: 'person', quote, ...at, ...f });
    const said = ['300 loaves a week', 'one oven', 'each oven adds 100 loaves'];
    const canonical = {
      version: 'canonical.v1', question: 'Should the bakery buy a second oven?', period: 'week',
      quantities: [fig('base_loaves', 'loaf/week', 300, said[0]!), fig('ovens', 'oven', 1, said[1]!), fig('per_oven', 'loaf/week/oven', 100, said[2]!, { kind: 'coefficient' }),
        fig('loaves', 'loaf/week', null, null, { kind: 'derived', status: 'derived', author: 'olumi' })],
      relations: [{ form: 'effect', id: 'loaves_rel', defines: 'loaves', base: 'base_loaves', terms: [{ driver: 'ovens', coefficient: 'per_oven', author: 'person', quote: said[2]!, ...at }],
        author: 'olumi', quote: null, ...at }],
      goals: [], limits: [], preferences: [], options: [], risks: [], claims: [], evidence: [], assumptions: [], dissent: [], conditions: [], left_out: [],
      history: [{ id: 'base_loaves', change: 'superseded', old: '{"id":"base_loaves","value":280}', quote: said[0]!, author_id: 'owner' }],
    };
    // Its digest as stored then, independent of the code: null declarations left out.
    const quantities = canonical.quantities.map(({ direction: _d, floor: _f, ceiling: _c, ...q }) => q);
    const digest = createHash('sha256').update(stableStringify({ canonical: { ...canonical, quantities }, person_words: said }), 'utf8').digest('hex');
    const run: StoredRun = {
      run_id: 'mp_run_synthetic_before_c6', computed_at: '2026-10-26T12:00:00.000Z',
      receipt: { revision_digest: digest, versions: priorVersions, seed: 7, draws: null },
      result: { canonical_analysis_view: { marker: 'stored result, never recomputed',
        run: { run_id: 'mp_run_synthetic_before_c6', graph_hash_at_run: 'old-graph', computed_at: '2026-10-26T12:00:00.000Z' }, staleness: { stale: false, reason: 'graph_hash_match' } },
        chances: null, compile: null },
    };
    const before = JSON.stringify({ living_model: { model_program: MODEL_PROGRAM, canonical, person_words: said, seed: 7, runs: [run] } });
    expect(before).not.toContain('approved_by');
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    expect(opened).toBeDefined();
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    expect(opened.run).toEqual(run);
    const m = opened.program.canonical;
    const who = (r: { author_id: string | null; approved_by: string | null }) => [r.author_id, r.approved_by];
    const rel = m.relations.find((r) => r.id === 'loaves_rel')!;
    expect([who(m.quantities.find((q) => q.id === 'base_loaves')!), who(rel), rel.form === 'effect' ? who(rel.terms[0]!) : null, who(m.history[0]!)])
      .toEqual([['owner', null], ['owner', null], ['owner', null], ['owner', null]]);
    expect(JSON.stringify(cold)).toBe(before);
    // Contrast: a named approver is part of the revision.
    const named = { ...m, quantities: m.quantities.map((q) => (q.id === 'base_loaves' ? { ...q, approved_by: 'owner' } : q)) };
    expect(revisionDigest(named, said)).not.toBe(digest);
  });
});

describe('titles and coaching questions (Paul, approved 27 Oct 2026): a model saved before them', () => {
  // Paul's saved hiring model, stored before titles (no title, no coaching_questions).
  const stored = () => JSON.parse(readFileSync(new URL('./hiring-paul-1027.saved.json', import.meta.url), 'utf8')) as { brief: string; canonical: Record<string, unknown> };
  /** The revision digest as it was computed before this change, written out independently of run-receipt.ts. */
  const digestBefore = (canonical: Record<string, any>, personWords: readonly string[]): string => {
    const quantities = (canonical['quantities'] as Record<string, unknown>[]).map(({ direction, floor, ceiling, ...q }) => ({ ...q,
      ...(direction == null ? {} : { direction }), ...(floor == null ? {} : { floor }), ...(ceiling == null ? {} : { ceiling }) }));
    const lean = (v: unknown): unknown => (Array.isArray(v) ? v.map(lean) : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).filter(([k, x]) => !(k === 'approved_by' && x == null)).map(([k, x]) => [k, lean(x)])) : v);
    return createHash('sha256').update(stableStringify({ canonical: lean({ ...canonical, quantities }), person_words: personWords }), 'utf8').digest('hex');
  };

  it('opens with title null and no coaching questions, its revision digest unchanged and its stored Run current, without changing its saved bytes', () => {
    const s = stored();
    expect(['title' in s.canonical, 'coaching_questions' in s.canonical]).toEqual([false, false]);
    const said = [s.brief];
    // The model as it read before this change: today's reading, less the two new fields,
    // and less Box 1a's read-time defaults (carry_on, risk direction) and the later stated time and decide-by (29 Oct).
    const { title: _t, coaching_questions: _c, decide_by: _d, ...readToday } = CanonicalModel.parse(withDeclaredTiming(s.canonical));
    const readBefore = { ...readToday, options: readToday.options.map(({ carry_on: _carry, ...o }) => o), risks: readToday.risks.map(({ direction: _direction, ...k }) => k),
      quantities: readToday.quantities.map(({ stated_time: _st, ...q }) => q) };
    const digest = digestBefore(readBefore, said);
    const run: StoredRun = {
      run_id: 'mp_run_saved_before_titles', computed_at: '2026-10-27T10:00:00.000Z',
      receipt: { revision_digest: digest, versions: priorVersions, seed: 7, draws: 200 },
      result: { canonical_analysis_view: { marker: 'stored result, never recomputed',
        run: { run_id: 'mp_run_saved_before_titles', graph_hash_at_run: 'old-graph', computed_at: '2026-10-27T10:00:00.000Z' }, staleness: { stale: false, reason: 'graph_hash_match' } },
        chances: null, compile: null },
    };
    const before = JSON.stringify({ living_model: { model_program: MODEL_PROGRAM, canonical: s.canonical, person_words: said, seed: 7, runs: [run] } });
    const cold = JSON.parse(before);
    const opened = reopenProgram(cold, priorVersions)!;
    expect(opened).toBeDefined();
    expect([opened.program.canonical.title, opened.program.canonical.coaching_questions]).toEqual([null, []]);
    expect(revisionDigest(opened.program.canonical, said)).toBe(digest);
    expect([opened.current, opened.engine_current]).toEqual([true, true]);
    expect(opened.run).toEqual(run);
    expect(JSON.stringify(cold)).toBe(before);
  });

  it('invariance: title null and coaching questions [] digest byte-equal to the model without the fields; a title or a question is part of the revision', () => {
    const s = stored();
    const read = CanonicalModel.parse(withDeclaredTiming(s.canonical));
    const { title: _t, coaching_questions: _c, ...without } = read;
    const said = [s.brief];
    expect([read.title, read.coaching_questions]).toEqual([null, []]);
    expect(revisionDigest(read, said)).toBe(revisionDigest(without as typeof read, said));
    // Contrast: each named field changes the revision, and so does a different one.
    const titled = { ...read, title: 'Tech lead or two developers?' };
    const coached = { ...read, coaching_questions: ['What would a 10% gain in productivity let the team do?'] };
    const digests = [revisionDigest(read, said), revisionDigest(titled, said), revisionDigest(coached, said), revisionDigest({ ...titled, title: 'Hire for the launch?' }, said)];
    expect(new Set(digests).size).toBe(4);
  });
});
