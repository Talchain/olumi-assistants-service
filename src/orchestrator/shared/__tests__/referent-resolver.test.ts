import { describe, expect, it } from 'vitest';

import {
  AMBIGUOUS_LABEL,
  buildLabelIndex,
  buildReferentIndex,
  deriveLabelIndex,
  normaliseForPhraseMatch,
  isSelfReferentialTarget,
  resolveLabelToId,
  resolveReferent,
  type GraphNodeLookup,
  type GraphNodeRef,
} from '../referent-resolver.js';

/**
 * ⭐⭐ THE REFERENT RESOLVER — "which stored element does this phrase name?"
 *
 * These specs pin the ONE thing the extraction added: a THREE-STATE answer.
 * `resolveLabelToId` returns `string | null`, and `null` means BOTH "I hold no
 * such element" AND "I hold two and cannot tell which you mean". Those are
 * opposite findings with opposite remedies, and only the second can be settled
 * by asking the user — which is why the ratified ask-the-user exit could never
 * be taken outside the one lane that hand-rolled its own collision predicate.
 *
 * Everything else here is a FOLD guard: the moved rails must behave exactly as
 * they did inside `phase3-blocks.ts`.
 */

const node = (id: string, label: string, kind: GraphNodeRef['kind'] = 'factor'): GraphNodeRef =>
  ({ id, label, kind });

const lookupOf = (...refs: readonly GraphNodeRef[]): GraphNodeLookup =>
  new Map(refs.map((r) => [r.id, r]));

describe('resolveReferent — the three-state answer', () => {
  it('BOUND: a unique label resolves to its node, carrying the stored label', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'Gross margin'), node('fac_2', 'Churn rate')));

    // Bind by IDENTITY (the id), never by a value predicate another node could satisfy.
    expect(resolveReferent(ri, 'Gross margin')).toEqual({
      kind: 'bound',
      id: 'fac_1',
      label: 'Gross margin',
    });
  });

  it('UNKNOWN: a phrase naming nothing in the model is distinguishable from ambiguity', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'Gross margin')));

    expect(resolveReferent(ri, 'Discount rate')).toEqual({ kind: 'unknown' });
  });

  it('⭐ AMBIGUOUS is its OWN state, not a second spelling of unknown', () => {
    const ri = buildReferentIndex(
      lookupOf(node('fac_1', 'Churn rate'), node('fac_2', 'Churn Rate'), node('fac_3', 'Gross margin')),
    );

    const answer = resolveReferent(ri, 'churn rate');

    // The whole point of the change: this must NOT be `unknown`.
    expect(answer.kind).toBe('ambiguous');
    expect(answer.kind === 'ambiguous' && answer.candidates.map((c) => c.id).sort()).toEqual([
      'fac_1',
      'fac_2',
    ]);
  });

  it('⭐ an ambiguous answer CARRIES its candidates — an ask that cannot list the options is not an exit', () => {
    const ri = buildReferentIndex(
      lookupOf(node('opt_a', 'Premium tier'), node('opt_b', 'premium  tier')),
    );

    const answer = resolveReferent(ri, 'Premium Tier');
    expect(answer.kind).toBe('ambiguous');

    // The ORIGINAL labels must survive, not the normalised key — a question put
    // to the user has to show them what they actually wrote.
    expect(answer.kind === 'ambiguous' && answer.candidates.map((c) => c.label)).toEqual([
      'Premium tier',
      'premium  tier',
    ]);
  });
});

describe('ReferentScope — same authority, question-specific rails', () => {
  it('scan REFUSES a bare generic single word, because prose says "cost" incidentally', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'Cost')));

    expect(resolveReferent(ri, 'Cost', 'scan')).toEqual({ kind: 'unknown' });
  });

  it('⭐ candidate BINDS that same word, because the user typed it in order to name the element', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'Cost')));

    expect(resolveReferent(ri, 'Cost', 'candidate')).toEqual({
      kind: 'bound',
      id: 'fac_1',
      label: 'Cost',
    });
  });

  it('scan refuses a sub-minimum-length label; candidate binds it', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'AI')));

    expect(resolveReferent(ri, 'AI', 'scan')).toEqual({ kind: 'unknown' });
    expect(resolveReferent(ri, 'AI', 'candidate')).toEqual({
      kind: 'bound',
      id: 'fac_1',
      label: 'AI',
    });
  });

  it('⭐⭐ candidate scope resolves STRICTLY MORE than scan, never fewer — the rails only ever open', () => {
    // The predicted failure mode of this whole change was "every symptom metric
    // turns green and the user is exactly as stuck", i.e. a resolver that buys
    // its safety by asking more often. This asserts the opposite direction as a
    // PROPERTY over a corpus, not as an anecdote.
    const lookup = lookupOf(
      node('fac_1', 'Cost'),
      node('fac_2', 'AI'),
      node('fac_3', 'Gross margin'),
      node('fac_4', 'Time-to-market'),
      node('fac_5', 'Churn rate (%)'),
      node('opt_1', '顧客離脱率'),
    );
    const ri = buildReferentIndex(lookup);
    const phrases = [
      'Cost', 'AI', 'Gross margin', 'Time to market', 'Churn rate (%)',
      '顧客離脱率', 'Discount rate', '', 'C#',
    ];

    for (const p of phrases) {
      const scan = resolveReferent(ri, p, 'scan');
      const cand = resolveReferent(ri, p, 'candidate');
      if (scan.kind === 'bound') {
        // Anything scan binds, candidate binds to the SAME id.
        expect(cand).toEqual(scan);
      }
      if (scan.kind === 'ambiguous') {
        expect(cand.kind).toBe('ambiguous');
      }
    }
  });

  it('ambiguity is a genuine identity fact and is reported in BOTH scopes', () => {
    const ri = buildReferentIndex(lookupOf(node('fac_1', 'Cost'), node('fac_2', 'cost')));

    expect(resolveReferent(ri, 'Cost', 'candidate').kind).toBe('ambiguous');
    // scan still refuses first on the generic-token rail — the rail is about
    // over-matching prose, and it fires before identity is consulted.
    expect(resolveReferent(ri, 'Cost', 'scan')).toEqual({ kind: 'unknown' });
  });
});

describe('the fold: buildLabelIndex is a PROJECTION of the one multimap', () => {
  it('a unique label maps to its id; a duplicate maps to AMBIGUOUS_LABEL', () => {
    const lookup = lookupOf(
      node('fac_1', 'Gross margin'),
      node('fac_2', 'Churn rate'),
      node('fac_3', 'churn  RATE'),
    );

    const index = buildLabelIndex(lookup);

    expect(index.get('gross margin')).toBe('fac_1');
    expect(index.get('churn rate')).toBe(AMBIGUOUS_LABEL);
  });

  it('an empty normalised label is skipped, not indexed under ""', () => {
    // `"—"` and `"()"` normalise to the empty string under the canonical rail.
    const index = buildLabelIndex(lookupOf(node('fac_1', '—'), node('fac_2', 'Gross margin')));

    expect(index.has('')).toBe(false);
    expect(index.get('gross margin')).toBe('fac_2');
  });

  it('⭐ the projection agrees with a HAND-WRITTEN corpus, not only with itself (trap 12d)', () => {
    // A derived guard proves agreement and can never prove completeness. This
    // corpus is the thing that would notice the projection being short.
    const cases: ReadonlyArray<readonly [readonly (readonly [string, string])[], string, string | symbol | undefined]> = [
      [[['fac_1', 'Gross margin']], 'gross margin', 'fac_1'],
      [[['fac_1', 'Time-to-market']], 'time to market', 'fac_1'],
      [[['fac_1', 'R&D spend']], 'r d spend', 'fac_1'],
      [[['fac_1', 'Churn rate (%)']], 'churn rate', 'fac_1'],
      [[['fac_1', '顧客離脱率']], '顧客離脱率', 'fac_1'],
      [[['fac_1', 'Cost'], ['fac_2', 'COST']], 'cost', AMBIGUOUS_LABEL],
      [[['fac_1', 'Gross margin']], 'nothing here', undefined],
    ];

    for (const [nodes, key, want] of cases) {
      const index = buildLabelIndex(lookupOf(...nodes.map(([id, label]) => node(id, label))));
      expect(index.get(key), `key ${JSON.stringify(key)}`).toBe(want);
    }
  });

  it('buildLabelIndex === deriveLabelIndex(buildReferentIndex(..)) — one source, two views', () => {
    const lookup = lookupOf(
      node('fac_1', 'Gross margin'),
      node('fac_2', 'Churn rate'),
      node('fac_3', 'churn rate'),
      node('fac_4', '—'),
    );

    expect([...buildLabelIndex(lookup).entries()]).toEqual(
      [...deriveLabelIndex(buildReferentIndex(lookup)).entries()],
    );
  });
});

describe('the fold: resolveLabelToId is unchanged and agrees with scan scope', () => {
  it('⭐ union assertion — the legacy adapter and the new scan scope never disagree', () => {
    // If these two ever part company, prose output has silently moved. This is
    // the guard that makes "byte-identical prose" an assertion rather than a claim.
    const lookup = lookupOf(
      node('fac_1', 'Cost'),
      node('fac_2', 'AI'),
      node('fac_3', 'Gross margin'),
      node('fac_4', 'Time-to-market'),
      node('fac_5', 'Churn rate'),
      node('fac_6', 'churn RATE'),
      node('opt_1', '顧客離脱率'),
      node('opt_2', 'Kubernetes'),
    );
    const li = buildLabelIndex(lookup);
    const ri = buildReferentIndex(lookup);

    const phrases = [
      'Cost', 'AI', 'C#', 'Gross margin', 'Time to market', 'Time-to-market',
      'Churn rate', '顧客離脱率', 'Kubernetes', 'Discount rate', '', '   ', '—',
    ];

    let bound = 0;
    for (const p of phrases) {
      const legacy = resolveLabelToId(li, p);
      const scoped = resolveReferent(ri, p, 'scan');
      const projected = scoped.kind === 'bound' ? scoped.id : null;
      expect(projected, `phrase ${JSON.stringify(p)}`).toBe(legacy);
      if (legacy !== null) bound++;
    }

    // POSITIVE CONTROL: an agreement assertion over a corpus where NOTHING
    // resolves is vacuous. Prove the corpus actually exercises the bound path.
    expect(bound).toBeGreaterThanOrEqual(3);
  });
});

describe('the fold: the canonical normalisation is the one that moved', () => {
  it('normalises punctuation, case and Unicode exactly as the prose rail did', () => {
    expect(normaliseForPhraseMatch('Time-to-market')).toBe('time to market');
    expect(normaliseForPhraseMatch('Churn rate (%)')).toBe('churn rate');
    expect(normaliseForPhraseMatch('R&D spend')).toBe('r d spend');
    expect(normaliseForPhraseMatch('  Customer   satisfaction ')).toBe('customer satisfaction');
  });

  it('⭐ a CJK label SURVIVES — two of the lane-private normalisers erase it to ""', () => {
    // `edit-graph.ts:754` and `propose-handoff.ts:162` both strip to `[a-z0-9]`,
    // so a Japanese label normalises to the empty string and every lookup keyed
    // on it silently matches nothing. The canonical rail is Unicode-aware.
    expect(normaliseForPhraseMatch('顧客離脱率')).toBe('顧客離脱率');
    expect(normaliseForPhraseMatch('顧客離脱率')).not.toBe('');
  });
});

describe('isSelfReferentialTarget — provenance identity, not string similarity', () => {
  const LIMIT = 'Keep total reporting spend under £200,000 a year';

  it('⭐ TARGET ARM: a node minted FROM the limit sentence is self-referential', () => {
    // All three defective bindings had `node.source_quote` present and identical
    // to the constraint sentence.
    expect(isSelfReferentialTarget(LIMIT, LIMIT)).toBe(true);
  });

  it('⭐ CONTRAST ARM: a real metric on the SAME `risk` kind is NOT self-referential', () => {
    // "Voluntary Attrition Rate" — a legitimate metric whose provenance is null.
    // This is the case the rejected `kind` filter would have broken, and it is
    // what proves this predicate does not proxy for kind.
    expect(isSelfReferentialTarget(null, LIMIT)).toBe(false);
  });

  it('absent provenance on EITHER side is not evidence of self-reference', () => {
    expect(isSelfReferentialTarget(undefined, LIMIT)).toBe(false);
    expect(isSelfReferentialTarget(LIMIT, undefined)).toBe(false);
    expect(isSelfReferentialTarget(null, null)).toBe(false);
  });

  it('a DIFFERENT quote is not self-reference — this is identity, not similarity', () => {
    // Deliberately high string overlap: substring similarity would call this a
    // hit, and that is exactly the `fuzzyMatchNodeId` failure being replaced.
    expect(isSelfReferentialTarget('Total reporting spend', LIMIT)).toBe(false);
    expect(isSelfReferentialTarget(LIMIT, 'Total reporting spend')).toBe(false);
  });

  it('identity is judged after the canonical normalisation, so punctuation and case do not defeat it', () => {
    expect(
      isSelfReferentialTarget('KEEP TOTAL REPORTING SPEND UNDER £200,000 A YEAR!', LIMIT),
    ).toBe(true);
  });

  it('an empty or punctuation-only quote never matches', () => {
    expect(isSelfReferentialTarget('', '')).toBe(false);
    expect(isSelfReferentialTarget('—', '—')).toBe(false);
  });
});
