/**
 * Tier A #1 (edit-reliability, 2026-07-09) — FIX 2: option-intervention
 * edits unreachable via the disambiguator loop.
 *
 * Bug (reproduced from Brief-H F4's description — option-configuration
 * edits regress through the deterministic value-update pre-route):
 * `tryDeterministicValueUpdate` / `tryDeicticValueUpdate` build their
 * candidate pool ONLY from factor-kind nodes and have NO awareness of
 * option-intervention framing. A message like "Set the Outsource option's
 * Annual Support Cost to £135,000" substring-matches the SHARED factor
 * ("Annual Support Cost") and auto-dispatches `set_factor_value` on it —
 * exactly the silent misroute `option-intervention-guard.ts` was written
 * to catch (task_99f83f0d). That guard runs downstream at STEP 2 validate
 * and DOES refuse the proposal (`OPTION_INTERVENTION_MISROUTE`) — but the
 * refusal produces a clarify whose replay text re-enters this SAME
 * pre-route, which (still unaware of the option framing) synthesises the
 * identical misrouted proposal again. The user is stuck in a disambiguator
 * loop that can never actually reach an option-intervention edit: the
 * pre-route needs to recognise the option-intervention framing ITSELF and
 * step out of the way (skip to the LLM's option_configuration path, which
 * FIX 1 makes reliable) rather than confidently re-offering the wrong
 * factor-value dispatch turn after turn.
 *
 * FIX: gate both entry points on `impliesOptionInterventionEdit` (the
 * existing, already-tested detector from `option-intervention-guard.ts`)
 * BEFORE any candidate matching runs, returning `{ matched: false,
 * skip_reason: 'option_intervention_edit' }` so the message reaches the
 * LLM's edit_graph `option_configuration` routing untouched — breaking the
 * loop at its source instead of only catching the symptom downstream.
 */
import { describe, it, expect } from 'vitest';

import type { QuantityExtractionResult } from '../../context/cqe/schema-types.js';
import type { GraphLookup } from '../validator.js';
import {
  tryDeterministicValueUpdate,
  tryDeicticValueUpdate,
} from '../deterministic-value-update.js';

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

/**
 * Graph mock exposing BOTH 'node' (factor) and 'option' EntityKind
 * buckets, mirroring production `buildGraphLookup` (graph-lookup-adapter.ts
 * `toEntityKind`), unlike the plain `makeGraph` helper in the sibling test
 * file (which only ever returns 'node' — no existing test in that file
 * exercises the option-aware pool at all).
 */
function makeGraphWithOption(
  factors: ReadonlyArray<{ id: string; label: string | null }>,
  options: ReadonlyArray<{ id: string; label: string | null }>,
): GraphLookup {
  const factorById = new Map(factors.map((f) => [f.id, f]));
  const optionById = new Map(options.map((o) => [o.id, o]));
  return {
    findEntityById: (id) => {
      const f = factorById.get(id);
      if (f) return { id: f.id, kind: 'node', label: f.label };
      const o = optionById.get(id);
      if (o) return { id: o.id, kind: 'option', label: o.label };
      return null;
    },
    listEntitiesByKind: (kind) => {
      if (kind === 'node') return factors.map((f) => ({ id: f.id, label: f.label }));
      if (kind === 'option') return options.map((o) => ({ id: o.id, label: o.label }));
      return [];
    },
  };
}

const COST_FACTOR = [{ id: 'fac_cost', label: 'Annual Support Cost' }];
const OUTSOURCE_OPTION = [{ id: 'opt_outsource', label: 'Outsource' }];
const GRAPH_WITH_OPTION = makeGraphWithOption(COST_FACTOR, OUTSOURCE_OPTION);
const GRAPH_NO_OPTIONS = makeGraphWithOption(COST_FACTOR, []);

const PARSED_135K: QuantityExtractionResult[] = [quantity(135000, '£135,000')];

describe('FIX 2: tryDeterministicValueUpdate skips option-intervention framing', () => {
  it('BUG (pre-fix behaviour would auto-dispatch set_factor_value on the shared factor): skips when the message uses "option" vocabulary + names the option', () => {
    const result = tryDeterministicValueUpdate(
      "Set the Outsource option's Annual Support Cost to £135,000",
      PARSED_135K,
      GRAPH_WITH_OPTION,
      [],
      new Set(['fac_cost']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('expected matched: false');
    expect(result.skip_reason).toBe('option_intervention_edit');
  });

  it('skips when the message names the option label without the word "option"', () => {
    const result = tryDeterministicValueUpdate(
      'Change Outsource so Annual Support Cost is £135,000',
      PARSED_135K,
      GRAPH_WITH_OPTION,
      [],
      new Set(['fac_cost']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('expected matched: false');
    expect(result.skip_reason).toBe('option_intervention_edit');
  });

  it('skips when the message uses "intervention" vocabulary', () => {
    const result = tryDeterministicValueUpdate(
      'Change the Annual Support Cost intervention to £135,000',
      PARSED_135K,
      GRAPH_WITH_OPTION,
      [],
      new Set(['fac_cost']),
    );
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('expected matched: false');
    expect(result.skip_reason).toBe('option_intervention_edit');
  });

  it('does NOT skip a genuine factor-value edit on the same graph (no option vocabulary, no option label named)', () => {
    const result = tryDeterministicValueUpdate(
      'Set Annual Support Cost to £135,000',
      PARSED_135K,
      GRAPH_WITH_OPTION,
      [],
      new Set(['fac_cost']),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('expected matched: true');
    expect(result.dispatch).toBe('set_factor_value');
  });

  it('does NOT skip when the graph has no options at all, even if the message says "option" colloquially', () => {
    // Mirrors option-intervention-guard.ts's own gating: with no options in
    // the graph, "option" vocabulary is colloquial noise, not a genuine
    // option-intervention signal — there is nothing to misroute to.
    const result = tryDeterministicValueUpdate(
      'Set Annual Support Cost to £135,000 — that is my preferred option',
      PARSED_135K,
      GRAPH_NO_OPTIONS,
      [],
      new Set(['fac_cost']),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('expected matched: true');
    expect(result.dispatch).toBe('set_factor_value');
  });
});

describe('FIX 2: tryDeicticValueUpdate skips option-intervention framing', () => {
  it('skips a deictic factor reference combined with option-intervention vocabulary', () => {
    const result = tryDeicticValueUpdate(
      'Increase that factor within the Outsource option to £135,000',
      PARSED_135K,
      GRAPH_WITH_OPTION,
      ['fac_cost'],
      (id) => (id === 'fac_cost' ? 'Annual Support Cost' : null),
    );
    expect(result.matched).toBe(false);
    if (result.matched) throw new Error('expected matched: false');
    expect(result.skip_reason).toBe('option_intervention_edit');
  });

  it('does NOT skip a plain deictic factor update with no option framing', () => {
    const result = tryDeicticValueUpdate(
      'Increase that factor to £135,000',
      PARSED_135K,
      GRAPH_WITH_OPTION,
      ['fac_cost'],
      (id) => (id === 'fac_cost' ? 'Annual Support Cost' : null),
    );
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error('expected matched: true');
    expect(result.dispatch).toBe('set_factor_value');
  });
});
