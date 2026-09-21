/**
 * P0 pin — `tryDeterministicValueUpdate` / `tryDeicticValueUpdate` must
 * REFUSE to deterministically apply a value when CQE reported the
 * extraction degraded.
 *
 * The property: either the extraction completed faithfully, or the turn
 * must not deterministically apply a value from it. Falling through to
 * LLM/clarify costs a round trip; applying a silently-substituted value
 * costs the user's graph.
 */

import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
} from '../deterministic-value-update.js';

function makeGraph(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const byId = new Map(factors.map((f) => [f.id, f]));
  return {
    findEntityById: (id) => {
      const f = byId.get(id);
      return f ? { id: f.id, kind: 'node', label: f.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind !== 'node') return [];
      return factors.map((f) => ({ id: f.id, label: f.label }));
    },
  };
}

function quantity(value: number, raw_text: string): QuantityExtractionResult {
  return {
    raw_text,
    value,
    unit: null,
    direction: null,
    multiplier: null,
    operator: null,
    comparator: null,
    range_min: null,
    range_max: null,
    approximate: false,
    source: 'cqe',
  };
}

const GRAPH = makeGraph([{ id: 'f1', label: 'Migration Cost' }]);
const PARSED = [quantity(250000, '£250k')];
const MESSAGE = 'Set migration cost to £250k.';

describe('deterministic value update — degraded-extraction refusal', () => {
  // POSITIVE CONTROL FIRST. An assertion that a dispatch is SUPPRESSED is
  // worthless unless the same call demonstrably PRODUCES that dispatch when
  // the extraction is sound. This is that proof.
  it('POSITIVE CONTROL: a sound extraction still dispatches set_factor_value', () => {
    const result = tryDeterministicValueUpdate(
      MESSAGE,
      PARSED,
      GRAPH,
      [],
      undefined,
      false, // not degraded
    );
    expect(result.matched).toBe(true);
    if (result.matched) {
      expect(result.dispatch).toBe('set_factor_value');
      expect(result.quantity.value).toBe(250000);
    }
  });

  it('omitting the degraded argument preserves existing behaviour (default false)', () => {
    const result = tryDeterministicValueUpdate(MESSAGE, PARSED, GRAPH, []);
    expect(result.matched).toBe(true);
  });

  it('REFUSES to dispatch when the extraction was degraded', () => {
    const result = tryDeterministicValueUpdate(
      MESSAGE,
      PARSED,
      GRAPH,
      [],
      undefined,
      true, // degraded
    );
    expect(result.matched).toBe(false);
    if (!result.matched) {
      expect(result.skip_reason).toBe('degraded_extraction');
    }
  });

  it('refuses even when every other gate would have passed cleanly', () => {
    // Same inputs as the positive control above — the ONLY difference is
    // the degraded flag. This isolates the guard from every other reason a
    // dispatch might not happen.
    const sound = tryDeterministicValueUpdate(MESSAGE, PARSED, GRAPH, [], undefined, false);
    const degraded = tryDeterministicValueUpdate(MESSAGE, PARSED, GRAPH, [], undefined, true);
    expect(sound.matched).toBe(true);
    expect(degraded.matched).toBe(false);
  });

  describe('deictic path carries the same guard', () => {
    const DEICTIC_MESSAGE = 'Set that factor to £250k.';
    const resolveLabel = (id: string): string | null =>
      id === 'f1' ? 'Migration Cost' : null;

    it('POSITIVE CONTROL: sound extraction dispatches on the deictic path', () => {
      const result = tryDeicticValueUpdate(
        DEICTIC_MESSAGE,
        PARSED,
        GRAPH,
        ['f1'],
        resolveLabel,
        false,
      );
      expect(result.matched).toBe(true);
      if (result.matched) {
        expect(result.dispatch).toBe('set_factor_value');
      }
    });

    it('REFUSES on the deictic path when degraded', () => {
      const result = tryDeicticValueUpdate(
        DEICTIC_MESSAGE,
        PARSED,
        GRAPH,
        ['f1'],
        resolveLabel,
        true,
      );
      expect(result.matched).toBe(false);
      if (!result.matched) {
        expect(result.skip_reason).toBe('degraded_extraction');
      }
    });
  });
});
