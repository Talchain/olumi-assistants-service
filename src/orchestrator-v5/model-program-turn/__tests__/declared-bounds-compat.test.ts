import { createHash } from 'node:crypto';
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
    expect(opened.view).toEqual(saved.living_model.runs[0]!.result.canonical_analysis_view);
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
    expect(opened.view).toEqual(run.result.canonical_analysis_view);
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
