/**
 * Spec §4.3, second paragraph — admit bare `it` / `this` / `that` in the value
 * path ONLY when the register yields exactly one candidate at the top populated
 * rank AND the binding is disclosed in the reply. Otherwise the refusal stands.
 *
 * `tryAnaphoricValueUpdate` is PURE and never reads the register: the CALLER
 * (turn-executor) resolves the binding through `resolveAnaphoricReferent` and
 * hands it in, or hands in null. So "the register is the only precondition"
 * is testable here as "no binding → never matches", and the resolver's own
 * spec covers what a binding is.
 *
 * Quantities come from the PRODUCTION extractor (`extractQuantities`), not
 * hand-written fixtures: a fixture I wrote myself is not evidence about the
 * wire (CLAUDE.md trap 16).
 */

import { describe, expect, it } from 'vitest';

import { extractQuantities } from '../../context/cqe/extract-quantities.js';
import type { GraphLookup } from '../validator.js';
import { EDIT_VERB_BASES } from '../mutation-warrant.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import { buildAnaphoricBindingDisclosure } from '../../compose/edit-clarify-response.js';
import {
  buildClarifyAssistantText,
  tryAnaphoricValueUpdate,
  tryDeicticValueUpdate,
  tryDeterministicValueUpdate,
  type AnaphoricValueBinding,
} from '../deterministic-value-update.js';

function makeLookup(
  nodes: ReadonlyArray<{ id: string; label: string; kind: 'factor' | 'option' | 'outcome' }>,
): GraphLookup {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    findEntityById: (id) => {
      const n = byId.get(id);
      return n ? { id: n.id, kind: n.kind === 'option' ? 'option' : 'node', label: n.label } : null;
    },
    listEntitiesByKind: (kind) => {
      if (kind === 'node') return nodes.filter((n) => n.kind !== 'option').map((n) => ({ id: n.id, label: n.label }));
      if (kind === 'option') return nodes.filter((n) => n.kind === 'option').map((n) => ({ id: n.id, label: n.label }));
      return [];
    },
  };
}

const GRAPH = makeLookup([
  { id: 'fac_shi', label: 'Sales Headcount Investment', kind: 'factor' },
  { id: 'fac_price', label: 'Price', kind: 'factor' },
  { id: 'out_mrr', label: 'MRR Growth', kind: 'outcome' },
  { id: 'opt_out', label: 'Outsource', kind: 'option' },
]);
const FACTOR_IDS = new Set(['fac_shi', 'fac_price']);

/** The founder's referent, bound by the register (spec §4.2, exactly one). */
const BOUND: AnaphoricValueBinding = {
  id: 'fac_shi',
  label: 'Sales Headcount Investment',
  kind: 'factor',
};
const BOUND_OPTION: AnaphoricValueBinding = { id: 'opt_out', label: 'Outsource', kind: 'option' };

function run(
  message: string,
  binding: AnaphoricValueBinding | null = BOUND,
  selected: readonly string[] = [],
  lookup: GraphLookup | undefined = GRAPH,
  degraded = false,
) {
  return tryAnaphoricValueUpdate(message, extractQuantities(message), lookup, binding, selected, degraded);
}

describe('REACHABILITY PRECONDITION — the label and deictic paths do NOT claim a bare-pronoun message', () => {
  // The executor runs the label path, then the deictic path, then this one.
  // If either claimed "Set it to 100000." this module would be dead code and
  // every assertion below would be about a path nothing reaches.
  it('the label path skips it (no label to match)', () => {
    const r = tryDeterministicValueUpdate('Set it to 100000.', extractQuantities('Set it to 100000.'), GRAPH, [], FACTOR_IDS, false);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_candidate_match');
  });
  it('the deictic path skips it (bare `it` is deliberately not deictic)', () => {
    const r = tryDeicticValueUpdate('Set it to 100000.', extractQuantities('Set it to 100000.'), GRAPH, ['fac_shi'], (id) => (id === 'fac_shi' ? 'Sales Headcount Investment' : null), false);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_deictic');
  });
});

describe('the value-bearing anaphoric edit BINDS under the register precondition and applies through set_factor_value', () => {
  const cases: readonly [string, number, string | null][] = [
    ['Set it to 100000.', 100000, null],
    ['Can you update it to 100000?', 100000, null],
    ['Raise it to £120,000', 120000, 'GBP'],
    ['Make it 500.', 500, null],
    ['Set it from 80000 to 100000.', 100000, null],
    ['Please set it to 100000', 100000, null],
    ['OK, set it to £100k', 100000, 'GBP'],
    ['Set it to 12%.', 0.12, 'percentage'],
  ];
  for (const [message, value, unit] of cases) {
    it(`"${message}" → set_factor_value on the BOUND referent, by identity`, () => {
      const r = run(message);
      expect(r.matched).toBe(true);
      if (!r.matched) return;
      expect(r.form).toBe('pronoun');
      expect(r.dispatch).toBe('set_factor_value');
      if (r.dispatch !== 'set_factor_value') return;
      expect(r.candidate.id).toBe('fac_shi');
      expect(r.candidate.label).toBe('Sales Headcount Investment');
      expect(r.quantity.value).toBe(value);
      expect(r.quantity.unit).toBe(unit);
      expect(r.disclosure).toBe('Taking that as Sales Headcount Investment.');
    });
  }

  it('the verb alternation is DERIVED from EDIT_VERB_BASES — every base verb admits the pronoun', () => {
    expect(EDIT_VERB_BASES.length).toBeGreaterThanOrEqual(5);
    for (const verb of EDIT_VERB_BASES) {
      const message = `${verb.charAt(0).toUpperCase()}${verb.slice(1)} it to 5.`;
      const r = run(message);
      expect(r.matched, message).toBe(true);
    }
  });

  it('a bound OPTION is handed to set_factor_value too — the executor\'s kind gate is the authority that refuses it', () => {
    // Deliberately NOT a second kind predicate here (trap 21): the executor
    // re-resolves `NodeV3.kind` on raw graph state and downgrades to the
    // honest `refuse_non_factor_kind` — the same gate the label path uses.
    const r = run('Set it to 100000.', BOUND_OPTION);
    expect(r.matched).toBe(true);
    if (r.matched && r.dispatch === 'set_factor_value') {
      expect(r.candidate.id).toBe('opt_out');
      expect(r.disclosure).toBe('Taking that as Outsource.');
    }
  });
});

describe('THE REGISTER IS THE ONLY PRECONDITION — no binding, no bind (the docstring\'s "set it to £30k" misfire stays refused)', () => {
  it('"Set it to £30k" with NO binding is skipped as no_binding', () => {
    const r = run('Set it to £30k', null);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_binding');
  });
  it('CONTRAST: the identical message WITH a binding applies', () => {
    const r = run('Set it to £30k', BOUND);
    expect(r.matched).toBe(true);
  });
  it('a bare quantity with no binding is skipped as no_binding too', () => {
    const r = run('100000', null);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_binding');
  });
});

describe('twins — messages that must NOT bind even with a binding', () => {
  it('a message naming a factor is not anaphoric (no_anaphor) — the label path owns it', () => {
    const r = run('Set Sales Headcount Investment to 100000');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_anaphor');
  });

  it('a NEGATED pronoun edit never binds: the pattern is anchored to an imperative or request opening, so "Don\'t set it to 5" cannot match', () => {
    // ⚠ The value path's own veto (`hasExplicitNoModelChangeIntent`) returns
    // FALSE for this sentence (measured); an anchored positive pattern is what
    // keeps it out, and its failure direction is a SKIP, never a write.
    for (const message of ["Don't set it to 5", 'Do not set it to 5.', 'Never set it to 5', "I wouldn't set it to 5"]) {
      const r = run(message);
      expect(r.matched, message).toBe(false);
      if (!r.matched) expect(r.skip_reason, message).toBe('no_anaphor');
    }
    // Positive control: the un-negated form matches.
    expect(run('Set it to 5').matched).toBe(true);
  });

  it('a pronoun that is not verb-adjacent does not match ("I think that we should raise the budget to 300k")', () => {
    const r = run('I think that we should raise the budget to 300k');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_anaphor');
  });

  it('a hypothetical is gated ("Please set it to 5, just to test")', () => {
    const r = run('Please set it to 5, just to test');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('hypothetical_gate');
  });

  it('two quantities are refused as ambiguous_quantity', () => {
    const r = run('Set it to 5 and 10');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('ambiguous_quantity');
  });

  it('no quantity is a skip, not a bind — the no-op recovery layer (#1362) still owns "Update it."', () => {
    for (const message of ['Update it.', 'Can you update it with the correct range?']) {
      const r = run(message);
      expect(r.matched, message).toBe(false);
      if (!r.matched) expect(r.skip_reason, message).toBe('no_quantity');
    }
  });

  it('a degraded extraction is refused first', () => {
    const r = run('Set it to 100000.', BOUND, [], GRAPH, true);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('degraded_extraction');
  });

  it('no graph → no_graph', () => {
    // Called directly: the `run` helper's `lookup = GRAPH` default would turn
    // an explicit `undefined` back into the graph and this case would measure
    // the wrong gate (it did, on the first run at this head).
    const r = tryAnaphoricValueUpdate(
      'Set it to 100000.',
      extractQuantities('Set it to 100000.'),
      undefined,
      BOUND,
      [],
      false,
    );
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_graph');
  });

  it('option-intervention framing reaches the LLM, not this path', () => {
    const r = run('Set it to 100000 under the Outsource option');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('option_intervention_edit');
  });
});

describe('a canvas selection that is not the binding WITHDRAWS the claim — the selected referent is never stolen', () => {
  it('another node selected → selection_conflict', () => {
    const r = run('Set it to 100000.', BOUND, ['fac_price']);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('selection_conflict');
  });
  it('a non-factor selected → selection_conflict too (ANY other selection withdraws)', () => {
    const r = run('Set it to 100000.', BOUND, ['out_mrr']);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('selection_conflict');
  });
  it('TWIN: the binding itself selected → applies', () => {
    expect(run('Set it to 100000.', BOUND, ['fac_shi']).matched).toBe(true);
  });
  it('TWIN: nothing selected → applies', () => {
    expect(run('Set it to 100000.', BOUND, []).matched).toBe(true);
  });
});

describe('a VALUE-ONLY message ASKS naming the candidate — it never applies (measured: the existing path refuses a bare quantity for a named target)', () => {
  it('PRECONDITION: the label path refuses a bare quantity even with the target named (no_edit_verb)', () => {
    for (const message of ['Sales Headcount Investment 100000', '100000', 'Sales Headcount Investment: 100000']) {
      const r = tryDeterministicValueUpdate(message, extractQuantities(message), GRAPH, [], FACTOR_IDS, false);
      expect(r.matched, message).toBe(false);
      if (!r.matched) expect(r.skip_reason, message).toBe('no_edit_verb');
    }
  });

  const bare: readonly [string, number, string | null][] = [
    ['100000', 100000, null],
    ['100,000.', 100000, null],
    ['£100k', 100000, 'GBP'],
    ['£100,000', 100000, 'GBP'],
    ['50%', 0.5, 'percentage'],
  ];
  for (const [message, value, unit] of bare) {
    it(`"${message}" → clarify with the bound referent as the ONLY candidate`, () => {
      const r = run(message);
      expect(r.matched).toBe(true);
      if (!r.matched) return;
      expect(r.form).toBe('bare_quantity');
      expect(r.dispatch).toBe('clarify');
      if (r.dispatch !== 'clarify') return;
      expect(r.candidates.map((c) => c.id)).toEqual(['fac_shi']);
      expect(r.quantity.value).toBe(value);
      expect(r.quantity.unit).toBe(unit);
    });
  }

  it('an UN-PREFIXED suffix form ("100k") is NOT claimed — the extractor reads it as 100, so an ask would offer a wrong number', () => {
    // Measured at this head: extractQuantities('100k')[0].value === 100 while
    // extractQuantities('£100k')[0].value === 100000. Claiming the bare form
    // would surface the wrong value in the chip; leaving it to the LLM is
    // today's behaviour.
    expect(extractQuantities('100k')[0]?.value).toBe(100);
    const r = run('100k');
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_anaphor');
  });

  it('a sentence around the value is not a bare quantity ("Let\'s go for 50%") — left to today\'s route (the Codex CCC-DIALOGUE-040 sibling shape, not this seam)', () => {
    const r = run("Let's go for 50%");
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('no_anaphor');
  });

  it('a bare quantity with an OPTION binding is not claimed: the executor\'s clarify branch persists a set_factor_value pending per candidate without a kind check (its kind gate sits on the set_factor_value dispatch only)', () => {
    const r = run('100000', BOUND_OPTION);
    expect(r.matched).toBe(false);
    if (!r.matched) expect(r.skip_reason).toBe('bare_quantity_needs_factor');
  });
});

describe('copy — the disclosure and the ask clear the runtime egress guards, with positive controls', () => {
  it('the disclosure is its own sentence, names the label, and hits neither guard', () => {
    const t = buildAnaphoricBindingDisclosure('Sales Headcount Investment');
    expect(t).toBe('Taking that as Sales Headcount Investment.');
    expect(findForbiddenPhraseHit(t)).toBeNull();
    expect(findSuccessClaimHit(t)).toBeNull();
  });
  it('the value-only ask names the candidate and hits neither guard', () => {
    const t = buildClarifyAssistantText([{ id: 'fac_shi', label: 'Sales Headcount Investment', score: 1, source: 'substring', labelMatchIndex: null }]);
    expect(t).toContain('Sales Headcount Investment');
    expect(t).toContain('?');
    expect(findForbiddenPhraseHit(t)).toBeNull();
    expect(findSuccessClaimHit(t)).toBeNull();
  });
  it('POSITIVE CONTROLS: both guards bite on the strings they exist for', () => {
    expect(findForbiddenPhraseHit('Actually nothing changed here.')).not.toBeNull();
    expect(findSuccessClaimHit('Updated Sales Headcount Investment.')).not.toBeNull();
    // and a receipt-shaped disclosure WOULD trip the success guard — which is
    // why the disclosure is not written in that shape.
    expect(findSuccessClaimHit('Set Sales Headcount Investment to £100,000.')).not.toBeNull();
  });
});
