/**
 * The scope of a comparative claim — and the four absences that are NOT each other.
 *
 * The whole value of this field is that a consumer can tell "we ranked all five"
 * from "we ranked three of five". Every case below exists because one of those
 * two sentences could otherwise be told when the other was true.
 */
import { describe, expect, it } from 'vitest';

import { deriveComparisonScope } from '../comparison-scope.js';

const graph = (ids: readonly string[]): unknown => ({
  nodes: ids.map((id) => ({ id, kind: 'option', label: `Option ${id}` })),
  options: ids.map((id) => ({ id })),
  edges: [],
});

// ⚠ `option_comparison` is the CURRENT PLoT V2 key, read first by
// `readOptionResultSources`. My first draft of this helper invented
// `option_results` at the top level — which that reader does not look at — and
// every case below returned `undefined` and would have "passed" any assertion
// written as a negative. The shape is derived from the reader, not from me.
const enrichment = (
  entries: ReadonlyArray<{ option_id?: unknown; win_probability?: unknown }>,
): unknown => ({ option_comparison: entries });

describe('deriveComparisonScope — what the claim is about, and what was left out', () => {
  it('INSTRUMENT: the fixture actually reaches the reader', () => {
    // The precondition for every case below. Without it, a change to the
    // envelope keys `readOptionResultSources` recognises would make this whole
    // file pass by testing nothing — which is exactly what happened on the
    // first draft, silently, until a positive assertion caught it.
    expect(
      deriveComparisonScope(
        enrichment([{ option_id: 'opt_probe', win_probability: 0.5 }]),
        graph(['opt_probe']),
      )?.ranked_option_ids,
    ).toEqual(['opt_probe']);
  });

  it('⭐ names the ranked set AND what it left out', () => {
    const scope = deriveComparisonScope(
      enrichment([
        { option_id: 'opt_a', win_probability: 0.6 },
        { option_id: 'opt_b', win_probability: 0.4 },
      ]),
      graph(['opt_a', 'opt_b', 'opt_c']),
    );
    expect(scope?.ranked_option_ids).toEqual(['opt_a', 'opt_b']);
    // The decisive assertion: a comparative claim here covers 2 of 3, and the
    // consumer can SAY so rather than silently narrowing.
    expect(scope?.unranked_option_ids).toEqual(['opt_c']);
  });

  it('⭐ nothing left out is an EMPTY ARRAY, never an absent field', () => {
    const scope = deriveComparisonScope(
      enrichment([{ option_id: 'opt_a', win_probability: 0.9 }]),
      graph(['opt_a']),
    );
    expect(scope?.unranked_option_ids).toEqual([]);
    expect(scope?.unranked_option_ids).toBeDefined();
  });

  it('⛔ no options source on the graph ⇒ the difference is ABSENT, not empty', () => {
    // "We could not work out what was left out" and "nothing was left out" are
    // different sentences. Conflating them is how a subset claim gets narrated
    // as a complete one.
    const scope = deriveComparisonScope(
      enrichment([{ option_id: 'opt_a', win_probability: 0.9 }]),
      { nodes: [], edges: [] },
    );
    expect(scope?.ranked_option_ids).toEqual(['opt_a']);
    expect(scope?.unranked_option_ids).toBeUndefined();
  });

  it('⛔ a DUPLICATE id drops BOTH entries — fail-closed, never a guess', () => {
    const scope = deriveComparisonScope(
      enrichment([
        { option_id: 'opt_dup', win_probability: 0.5 },
        { option_id: 'opt_dup', win_probability: 0.7 },
        { option_id: 'opt_ok', win_probability: 0.3 },
      ]),
      graph(['opt_dup', 'opt_ok']),
    );
    // Keeping either would attach a rank to an option by guess.
    expect(scope?.ranked_option_ids).toEqual(['opt_ok']);
    // And it reappears as UNRANKED, which is the honest place for it.
    expect(scope?.unranked_option_ids).toEqual(['opt_dup']);
  });

  it('⛔ a record with NO usable probability was present, not ranked', () => {
    const scope = deriveComparisonScope(
      enrichment([
        { option_id: 'opt_a', win_probability: 0.8 },
        { option_id: 'opt_b' },
        { option_id: 'opt_c', win_probability: 1.4 },
      ]),
      graph(['opt_a', 'opt_b', 'opt_c']),
    );
    expect(scope?.ranked_option_ids).toEqual(['opt_a']);
    expect(scope?.unranked_option_ids).toEqual(['opt_b', 'opt_c']);
  });

  it('⛔ nothing ranked ⇒ UNDEFINED, which must not be read as "all of them"', () => {
    expect(deriveComparisonScope(enrichment([]), graph(['opt_a']))).toBeUndefined();
    expect(deriveComparisonScope(null, graph(['opt_a']))).toBeUndefined();
    expect(deriveComparisonScope(undefined, graph(['opt_a']))).toBeUndefined();
  });

  it('⛔ an option id that is NOT a non-empty string is not an option', () => {
    const scope = deriveComparisonScope(
      enrichment([
        { option_id: '', win_probability: 0.5 },
        { option_id: 42, win_probability: 0.5 },
        { option_id: 'opt_real', win_probability: 0.5 },
      ]),
      graph(['opt_real']),
    );
    expect(scope?.ranked_option_ids).toEqual(['opt_real']);
  });
});
