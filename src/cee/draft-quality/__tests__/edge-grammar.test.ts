import { describe, expect, it } from 'vitest';
import {
  buildEdgeGrammarDirective,
  readEdgeGrammarFacts,
  secondDrawIsCleaner,
  violatesEdgeGrammar,
} from '../edge-grammar.js';

import { readFileSync } from 'node:fs';

/** Read a banked capture exactly as the repo's other wire fixtures are read
 *  (`plot-request-scale-captures.test.ts`) — the bytes on disk, unparsed by
 *  any build step, so what is asserted is what was captured. */
const capture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.graph.json`, import.meta.url), 'utf8'));

const blocked8 = capture('draft');
const blockedPricing = capture('draft-pricing');
const blockedHiring = capture('draft-hiring2');
const readyControl = capture('draft-pricing-no-churn-READY');

/**
 * ⭐ THE CORPUS IS NOT MINE. All four fixtures are the structural skeleton of
 * REAL draws captured from deployed staging `bdad785a` on 23 Sep 2026 and
 * banked at `output/conventional-draft-size-20260923/`. Labels and brief text
 * were stripped; ids, kinds and edges are the wire's own.
 *
 * ⭐⭐ AND THE FOURTH ONE IS THE CONTRAST CONTROL, not a rounding-out case.
 * `draft-pricing-no-churn-READY` is the draw that went on to a COMPLETE PLoT
 * run (`analysis_status: computed`, 10,000 samples). A predicate that fires on
 * every draw would be worthless; this is the draw it must NOT fire on.
 */
describe('edge grammar — measured on real staging draws', () => {
  it('the READY draw that reached a scored analysis carries ZERO violations', () => {
    const facts = readEdgeGrammarFacts(readyControl);
    expect(facts.readable).toBe(true);
    expect(facts.violations).toHaveLength(0);
    expect(facts.optionsAffected).toBe(0);
    expect(violatesEdgeGrammar(facts)).toBe(false);
  });

  it('the three blocked draws each carry the violations the wire showed', () => {
    // Counts bound by IDENTITY to the capture they came from, never a
    // "greater than zero" predicate another draw could satisfy.
    expect(readEdgeGrammarFacts(blocked8).violations).toHaveLength(8);
    expect(readEdgeGrammarFacts(blockedPricing).violations).toHaveLength(2);
    expect(readEdgeGrammarFacts(blockedHiring).violations).toHaveLength(2);
  });

  it('counts the DISTINCT options a user would see refused, not the edges', () => {
    // 8 illegal edges but only 4 options: the number that predicts the refusal
    // is the option count, and conflating the two overstates the damage 2x.
    const facts = readEdgeGrammarFacts(blocked8);
    expect(facts.violations).toHaveLength(8);
    expect(facts.optionsAffected).toBe(4);
  });

  it('every violation it reports really is option -> risk in that graph', () => {
    const g = blocked8 as { nodes: { id: string; kind: string }[] };
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
    for (const v of readEdgeGrammarFacts(blocked8).violations) {
      expect(kind.get(v.from)).toBe('option');
      expect(kind.get(v.to)).toBe('risk');
    }
  });
});

describe('edge grammar — what must NOT count', () => {
  const kinds = [
    { id: 'o1', kind: 'option' },
    { id: 'r1', kind: 'risk' },
    { id: 'f1', kind: 'factor' },
    { id: 'g1', kind: 'goal' },
    { id: 'out1', kind: 'outcome' },
  ];

  it('a bidirected edge is excluded — it asserts a common cause, not an intervention', () => {
    // Bound to the SAME discriminator the readiness authority filters on
    // (`analysis-ready.ts`). If these two ever disagree the refusal and the
    // redraw trigger drift apart silently.
    const facts = readEdgeGrammarFacts({
      nodes: kinds,
      edges: [{ from: 'o1', to: 'r1', edge_type: 'bidirected' }],
    });
    expect(facts.readable).toBe(true);
    expect(facts.violations).toHaveLength(0);
  });

  it('every LEGAL edge pattern the prompt lists is left alone', () => {
    const facts = readEdgeGrammarFacts({
      nodes: [...kinds, { id: 'd1', kind: 'decision' }],
      edges: [
        { from: 'd1', to: 'o1' },
        { from: 'o1', to: 'f1' },
        { from: 'f1', to: 'r1' },
        { from: 'f1', to: 'out1' },
        { from: 'r1', to: 'g1' },
        { from: 'out1', to: 'g1' },
      ],
    });
    expect(facts.readable).toBe(true);
    expect(facts.violations).toHaveLength(0);
  });

  it('the reverse direction is not a violation — risk -> option is a different claim', () => {
    const facts = readEdgeGrammarFacts({
      nodes: kinds,
      edges: [{ from: 'r1', to: 'o1' }],
    });
    expect(facts.violations).toHaveLength(0);
  });
});

describe('edge grammar — unreadable is not clean', () => {
  /**
   * ⛔ THE FAILURE THIS PINS. `readable: false` and "no violations" are the
   * same `violations.length === 0` to a careless caller, so a payload-shape
   * change would silently retire the whole check while every count still read
   * zero. `violatesEdgeGrammar` must branch on `readable` FIRST.
   */
  for (const [name, value] of [
    ['null', null],
    ['a string', 'graph'],
    ['an array', []],
    ['an object with no nodes/edges', { foo: 1 }],
    ['nodes present but edges missing', { nodes: [] }],
    ['edges present but nodes missing', { edges: [] }],
  ] as const) {
    it(`${name} reports readable:false and never triggers a redraw`, () => {
      const facts = readEdgeGrammarFacts(value);
      expect(facts.readable).toBe(false);
      expect(violatesEdgeGrammar(facts)).toBe(false);
    });
  }

  it('an empty but well-formed graph is READABLE and clean', () => {
    // The contrast control for the case above: proves `readable` tracks shape,
    // not emptiness.
    const facts = readEdgeGrammarFacts({ nodes: [], edges: [] });
    expect(facts.readable).toBe(true);
    expect(facts.violations).toHaveLength(0);
  });

  it('survives malformed members without throwing', () => {
    const facts = readEdgeGrammarFacts({
      nodes: [null, 'x', { id: 'o1', kind: 'option' }, { id: 5, kind: 'risk' }, { kind: 'risk' }],
      edges: [null, 'y', { from: 'o1' }, { to: 'r1' }, { from: 1, to: 2 }],
    });
    expect(facts.readable).toBe(true);
    expect(facts.violations).toHaveLength(0);
  });
});

describe('selection — fewer violations wins, a tie keeps the first', () => {
  const facts = (n: number) => readEdgeGrammarFacts({
    nodes: [{ id: 'o1', kind: 'option' }, ...Array.from({ length: n }, (_, i) => ({ id: `r${i}`, kind: 'risk' }))],
    edges: Array.from({ length: n }, (_, i) => ({ from: 'o1', to: `r${i}` })),
  });

  it('a cleaner second draw wins', () => {
    expect(secondDrawIsCleaner(facts(8), facts(0))).toBe(true);
    expect(secondDrawIsCleaner(facts(8), facts(2))).toBe(true);
  });

  it('a TIE keeps the first draw — the one the pipeline already passed over', () => {
    expect(secondDrawIsCleaner(facts(2), facts(2))).toBe(false);
    expect(secondDrawIsCleaner(facts(0), facts(0))).toBe(false);
  });

  it('a WORSE second draw never wins', () => {
    expect(secondDrawIsCleaner(facts(2), facts(8))).toBe(false);
  });

  it('an unreadable draw on either side never wins and never loses the first', () => {
    expect(secondDrawIsCleaner(facts(8), readEdgeGrammarFacts(null))).toBe(false);
    expect(secondDrawIsCleaner(readEdgeGrammarFacts(null), facts(0))).toBe(false);
  });

  it('the real capture pair: the 8-violation draw loses to the READY control', () => {
    expect(secondDrawIsCleaner(
      readEdgeGrammarFacts(blocked8),
      readEdgeGrammarFacts(readyControl),
    )).toBe(true);
  });
});

describe('the corrective directive', () => {
  it('names the rule and the count, and agrees in number', () => {
    const one = buildEdgeGrammarDirective(readEdgeGrammarFacts({
      nodes: [{ id: 'o1', kind: 'option' }, { id: 'r1', kind: 'risk' }],
      edges: [{ from: 'o1', to: 'r1' }],
    }));
    expect(one).toContain('1 direct option→risk link');
    expect(buildEdgeGrammarDirective(readEdgeGrammarFacts(blocked8))).toContain('8 direct option→risk links');
  });

  it('states the mechanism the contract actually requires', () => {
    const d = buildEdgeGrammarDirective(readEdgeGrammarFacts(blocked8));
    expect(d).toContain('option → factor → risk');
    expect(d).toContain('ALLOWED EDGE PATTERNS');
  });

  it('⛔ never tells the drafter to delete or weaken a risk', () => {
    // The harm this forbids: a drafter that learns to hide a downside to pass
    // a shape check. The prompt's own "decorative risk does not count" rule is
    // the thing being protected.
    const d = buildEdgeGrammarDirective(readEdgeGrammarFacts(blocked8)).toLowerCase();
    expect(d).toContain('keep every risk');
    expect(d).toContain('do not delete a risk');
    expect(d).not.toMatch(/remove the risk|drop the risk|delete the risk\b(?! to satisfy)/);
  });

  it('carries no node ids from the graph it was built from', () => {
    // System-authored and content-free, to the same standard as
    // `buildPriorAttemptDirective`.
    const d = buildEdgeGrammarDirective(readEdgeGrammarFacts(blocked8));
    for (const v of readEdgeGrammarFacts(blocked8).violations) {
      expect(d).not.toContain(v.from);
      expect(d).not.toContain(v.to);
    }
  });
});
