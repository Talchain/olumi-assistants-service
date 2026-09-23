import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildDraftStructureDirective,
  readDraftStructureFacts,
  secondDrawIsStructurallyCleaner,
  violatesDraftStructure,
} from '../draft-structure.js';

const body = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.body.json`, import.meta.url), 'utf8'));

/**
 * ⭐ ALL THREE ARE REAL DRAWS from 8 consecutive draft calls against deployed
 * `cee-staging` on 23 Sep 2026, banked at `output/grammar-baseline-20260923/`.
 * Labels and brief prose were stripped; ids, kinds, edges and the
 * `unresolved_targets` themselves are the wire's own — and the targets ARE the
 * defect, so they are kept verbatim.
 */
const ONLY_TARGET = body('blocked-only-by-target');   // run 7: 0 edges, target "49"
const BOTH = body('both-mechanisms');                 // run 2: 4 edges + "Price"
const READY = body('ready-control-2');                // run 8: clean, status ready

describe('the run that refuted the earlier claim', () => {
  /**
   * ⛔ THE PUBLISHED NUMBER THIS CORRECTS. "An option→risk edge agrees with the
   * refusal 100% of the time" was true of the captures it was measured on and
   * is FALSE at n=8 — 7/8. Run 7 is the eighth: zero edge violations, and still
   * `needs_user_input`, because one option's target was the literal `"49"`
   * while a factor called Pro Plan Price sat in the same graph.
   */
  it('has ZERO edge violations and is STILL structurally invalid', () => {
    const f = readDraftStructureFacts(ONLY_TARGET);
    expect(f.readable).toBe(true);
    expect(f.edgeGrammar.violations).toHaveLength(0);
    expect(f.unresolvableTargets).toEqual(['49']);
    expect(f.totalViolations).toBe(1);
    expect(violatesDraftStructure(f)).toBe(true);
  });

  it('the edge-only detector would have called it clean — the gap, pinned', () => {
    // The contrast that justifies this module existing at all. If someone
    // deletes `draft-structure.ts` and routes the redraw back through
    // `edge-grammar.ts` alone, this is the assertion that REDs.
    const f = readDraftStructureFacts(ONLY_TARGET);
    expect(f.edgeGrammar.violations).toHaveLength(0);   // the old predicate: clean
    expect(f.totalViolations).toBeGreaterThan(0);       // the truth: blocked
  });

  it('the payload really did refuse it', () => {
    const ar = (ONLY_TARGET as { analysis_ready: { status: string } }).analysis_ready;
    expect(ar.status).toBe('needs_user_input');
  });
});

describe('both mechanisms are counted, and summed', () => {
  it('a draw with both carries both', () => {
    const f = readDraftStructureFacts(BOTH);
    expect(f.edgeGrammar.violations).toHaveLength(4);
    expect(f.unresolvableTargets).toEqual(['Price']);
    expect(f.totalViolations).toBe(5);
  });

  it('⭐ the CONTRAST CONTROL is clean on BOTH and its payload says ready', () => {
    // A predicate that fires on every draw would be worthless. This is the draw
    // it must not fire on, and its own payload agrees.
    const f = readDraftStructureFacts(READY);
    expect(f.readable).toBe(true);
    expect(f.edgeGrammar.violations).toHaveLength(0);
    expect(f.unresolvableTargets).toEqual([]);
    expect(f.totalViolations).toBe(0);
    expect(violatesDraftStructure(f)).toBe(false);
    expect((READY as { analysis_ready: { status: string } }).analysis_ready.status).toBe('ready');
  });
});

describe('what counts as unresolvable', () => {
  const graph = {
    nodes: [
      { id: 'opt_a', kind: 'option' },
      { id: 'fac_price', kind: 'factor' },
      { id: 'risk_churn', kind: 'risk' },
    ],
    edges: [],
  };
  const withTargets = (targets: unknown[]) => ({
    graph,
    analysis_ready: { status: 'needs_user_mapping', options: [{ id: 'opt_a', status: 'needs_user_mapping', unresolved_targets: targets }] },
  });

  it('a target that IS a node is not counted here — it is a real gap, or the other mechanism', () => {
    const f = readDraftStructureFacts(withTargets(['risk_churn', 'fac_price']));
    expect(f.unresolvableTargets).toEqual([]);
  });

  it('a target that names nothing in the graph is counted', () => {
    expect(readDraftStructureFacts(withTargets(['49'])).unresolvableTargets).toEqual(['49']);
  });

  it('is de-duplicated and sorted, so two draws of one defect compare equal', () => {
    const f = readDraftStructureFacts(withTargets(['Price', '49', 'Price']));
    expect(f.unresolvableTargets).toEqual(['49', 'Price']);
  });

  it('a READY option is not inspected — only a refused one costs the user', () => {
    const f = readDraftStructureFacts({
      graph,
      analysis_ready: { status: 'ready', options: [{ id: 'opt_a', status: 'ready', unresolved_targets: ['49'] }] },
    });
    expect(f.unresolvableTargets).toEqual([]);
  });

  it('non-string targets and malformed options are survived, not thrown on', () => {
    const f = readDraftStructureFacts({
      graph,
      analysis_ready: { status: 'x', options: [null, 'y', { status: 'needs_user_mapping', unresolved_targets: [1, null, {}, '49'] }] },
    });
    expect(f.unresolvableTargets).toEqual(['49']);
  });

  it('⛔ reads ONLY analysis_ready — a loose options mirror decides nothing', () => {
    // Binding to the payload the readiness authority itself produced is what
    // keeps this predicting the refusal the user actually meets.
    const f = readDraftStructureFacts({
      graph,
      options: [{ id: 'opt_a', status: 'needs_user_mapping', unresolved_targets: ['ghost'] }],
      analysis_ready: { status: 'ready', options: [] },
    });
    expect(f.unresolvableTargets).toEqual([]);
  });

  it('an absent analysis_ready is readable and clean, not a crash', () => {
    const f = readDraftStructureFacts({ graph });
    expect(f.readable).toBe(true);
    expect(f.totalViolations).toBe(0);
  });
});

describe('unreadable is not clean', () => {
  for (const [name, value] of [
    ['null', null],
    ['a string', 'body'],
    ['no graph at all', { analysis_ready: { options: [] } }],
  ] as const) {
    it(`${name} reports readable:false and never triggers a redraw`, () => {
      const f = readDraftStructureFacts(value);
      expect(f.readable).toBe(false);
      expect(violatesDraftStructure(f)).toBe(false);
    });
  }
});

describe('selection over BOTH mechanisms', () => {
  it('fewer total violations wins', () => {
    expect(secondDrawIsStructurallyCleaner(readDraftStructureFacts(BOTH), readDraftStructureFacts(READY))).toBe(true);
    expect(secondDrawIsStructurallyCleaner(readDraftStructureFacts(BOTH), readDraftStructureFacts(ONLY_TARGET))).toBe(true);
  });

  it('a tie keeps the first', () => {
    expect(secondDrawIsStructurallyCleaner(readDraftStructureFacts(ONLY_TARGET), readDraftStructureFacts(ONLY_TARGET))).toBe(false);
  });

  it('a worse draw never wins', () => {
    expect(secondDrawIsStructurallyCleaner(readDraftStructureFacts(ONLY_TARGET), readDraftStructureFacts(BOTH))).toBe(false);
  });

  it('⛔ trading one defect for the other is NOT progress', () => {
    // The lexicographic rule this forbids: a draw that fixed all four edge
    // violations while introducing four unresolvable targets leaves the user
    // exactly as blocked. Both cost one refused option each, so they are summed.
    const graph = { nodes: [{ id: 'o', kind: 'option' }, { id: 'r', kind: 'risk' }], edges: [{ from: 'o', to: 'r' }] };
    const edgesOnly = { graph, analysis_ready: { status: 'x', options: [] } };
    const targetsOnly = {
      graph: { nodes: graph.nodes, edges: [] },
      analysis_ready: { status: 'x', options: [{ id: 'o', status: 'needs_user_mapping', unresolved_targets: ['49'] }] },
    };
    const a = readDraftStructureFacts(edgesOnly);
    const b = readDraftStructureFacts(targetsOnly);
    expect(a.totalViolations).toBe(1);
    expect(b.totalViolations).toBe(1);
    expect(secondDrawIsStructurallyCleaner(a, b)).toBe(false);
    expect(secondDrawIsStructurallyCleaner(b, a)).toBe(false);
  });
});

describe('the directive names only the defects this draw actually has', () => {
  it('an edges-only draw is told about edges and NOT about targets', () => {
    // A directive that corrects an error the drafter did not make teaches it to
    // avoid a shape that was fine.
    const d = buildDraftStructureDirective(readDraftStructureFacts({
      graph: { nodes: [{ id: 'o', kind: 'option' }, { id: 'r', kind: 'risk' }], edges: [{ from: 'o', to: 'r' }] },
      analysis_ready: { status: 'x', options: [] },
    }));
    expect(d).toContain('ALLOWED EDGE PATTERNS');
    expect(d).not.toContain('intervention target');
  });

  it('a targets-only draw is told about targets and NOT about edges', () => {
    const d = buildDraftStructureDirective(readDraftStructureFacts(ONLY_TARGET));
    expect(d).toContain('does not name any node');
    expect(d).toContain('controllable FACTOR');
    expect(d).not.toContain('ALLOWED EDGE PATTERNS');
  });

  it('a draw with both is told about both', () => {
    const d = buildDraftStructureDirective(readDraftStructureFacts(BOTH));
    expect(d).toContain('ALLOWED EDGE PATTERNS');
    // Number-agnostic: one target reads "does not name", several "do not".
    expect(d).toMatch(/does not name any node|do not name any node/);
  });

  it('a clean draw produces no directive at all', () => {
    expect(buildDraftStructureDirective(readDraftStructureFacts(READY))).toBe('');
  });

  it('⛔ never echoes the offending target back — it came from the brief', () => {
    // System-authored and content-free, to the same standard as
    // `buildPriorAttemptDirective`. "49" is the user's own number.
    const d = buildDraftStructureDirective(readDraftStructureFacts(ONLY_TARGET));
    expect(d).not.toContain('49');
    expect(buildDraftStructureDirective(readDraftStructureFacts(BOTH))).not.toContain('Price');
  });

  it('⛔ still never tells the drafter to delete or weaken a risk', () => {
    const d = buildDraftStructureDirective(readDraftStructureFacts(BOTH)).toLowerCase();
    expect(d).toContain('keep every risk');
    expect(d).toContain('do not delete a risk');
  });
});
