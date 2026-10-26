import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { CanonicalModel, withDeclaredTiming } from '../../model-program/canonical.js';
import { MODEL_PROGRAM, programReadOf, reopenProgram } from '../program-store.js';
import { ENGINE_VERSIONS, revisionDigest, type StoredRun } from '../run-receipt.js';

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

  it('keeps model currency separate from an engine update and preserves the historical Run', () => {
    const saved = savedBeforeBounds();
    const opened = reopenProgram(JSON.parse(JSON.stringify(saved)))!;
    expect([opened.current, opened.engine_current]).toEqual([true, false]);
    expect(opened.view).toMatchObject({ marker: 'stored result, never recomputed', staleness: { stale: true, reason: 'engine_or_format_updated' } });
    expect(opened.run).toEqual(saved.living_model.runs[0]);
  });
});
