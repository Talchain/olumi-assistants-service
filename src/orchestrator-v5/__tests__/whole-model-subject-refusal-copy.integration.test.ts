/**
 * ⭐⭐⭐ THE REFUSAL IS RIGHT. ITS DIAGNOSIS IS FALSE.
 * Captured 1 Sep 2026, deployed CEE `d545535`, reproducible 2/2 byte-identical:
 *
 *   USER  "Why does this decision matter?"   → `structure_query.kind:'outgoing_influence'`
 *   CEE   "I could not tell which part of your model you are asking about,
 *          so I will not guess at what it affects."
 *
 *   USER  "Why does the goal matter?"        → `structure_query.kind:'dependencies'`
 *   CEE   "I could not tell which part of your model you are asking about,
 *          so I will not guess at what connects to it."
 *
 * The user was perfectly clear. They asked about the whole thing. The product
 * replied that it could not understand them. **A false diagnosis inside a
 * refusal is worse than the refusal**, and it is the one part of this turn that
 * is fixable here without re-opening a fabrication seam.
 *
 * ⚠⚠ IS THE WHOLE MODEL A RESOLVABLE SUBJECT? DERIVED AT THE BYTES — NO, NOT IN
 * THIS CARRIER. `buildSelectedElementEdgeEvidence` takes its subject from
 * `structure_query.element_id` and nothing else (`routing/structural-pair-evidence.ts`);
 * both `DependenciesQuerySchema` and `OutgoingInfluenceQuerySchema` declare
 * `element_id: z.string().min(1)` under `.strict()` (`routing/types.ts`). The only
 * element-free arm of the union is `kind:'general'`, which reaches a DIFFERENT
 * composer. So a whole-model referent is UNREPRESENTABLE in the carrier the
 * router selected — the resolver is structurally node-scoped, and no amount of
 * subject resolution can bind "this decision" to a node that is not in the graph.
 *
 * ⭐ AND THE CONTRAST CONTROL THAT PROVES IT IS THE WORDING, NOT THE GRAPH: the
 * SAME turn, SAME graph, SAME `structure_query`, SAME resolved proposal entity,
 * with the FULL canonical label substituted for the whole-model phrase, RESOLVES
 * and answers. Pinned below in both directions. Resolution is not broken and is
 * NOT loosened by this change.
 *
 * ⚠ WHAT THIS CHANGE DELIBERATELY DOES NOT DO, because each is a known worse
 * defect already paid for in this repo:
 *   - It does not touch the VERDICT. Letting `ambiguous` fall through to the
 *     projection is #1310, rejected: it answers a different question confidently.
 *   - It does not widen `normaliseWholeModelStructureQuery`. Demoting to
 *     `general` sets `mayUseAuthoredGeneralAnswer` TRUE and re-opens #1229, where
 *     fluent prose invented an unlisted option-to-factor dependency.
 *   - It does not promise a whole-model answer. Swept for a deterministic
 *     element-free route: the only two `kind:'general'` constructions in
 *     `route-with-tool-use.ts` are the PILL-forced default (:1405) and the narrow
 *     single-factor demotion (:1475). Neither catches this question, so telling
 *     the user to "ask about the model as a whole" would advertise an action that
 *     may terminate in the same refusal. Rowed instead.
 *   - It does not touch the `subject_selection:'single_resolved'` branch, which
 *     is a different reachability class (the user HAS one element selected). Its
 *     copy is pinned UNCHANGED below, and is this file's different-subject control.
 *
 * SO THE FIX IS THE WORDS ONLY, exactly the shape #1308 shipped on the sibling
 * branch: state the SCOPE the answer has ("one part at a time") instead of
 * asserting a comprehension failure, and give the remedy that is DERIVED to work
 * — the EXACT label (proven by the contrast control below) or a canvas selection
 * (proven by `routing/__tests__/outgoing-influence-evidence.test.ts`, whose
 * selection fixture resolves without the prose gate). The old "name it" told the
 * user to do the thing they believed they had just done.
 */
import { randomUUID } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

import { setTestSink } from '../../utils/telemetry.js';
import {
composeSelectedDependenciesEvidenceAnswer,
composeSelectedOutgoingInfluenceEvidenceAnswer,
} from '../tools/handlers/explanation-fallback.js';

const writes: Array<Record<string, unknown>> = [];
let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      writes.push(write);
      if (write.graph !== undefined) persistedGraph = write.graph;
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' }, entries_invalidated: [] }),
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));






const GOAL_LABEL = 'Close a Series A on acceptable terms';
const FIT_LABEL = 'Fit with target investor thesis and deal size';
const TRACTION_LABEL = 'Demonstrated revenue traction';
const RUNWAY_LABEL = 'Months of runway remaining';

/**
 * ⭐ THE EXACT WITNESSED WORDINGS. Never paraphrase — they are the evidence, and
 * their defining property is that neither names any element in the graph.
 */



/** The known-and-deliberately-unfixed shorthand case, kept as the opposite-direction twin. */


/** The authored prose invents a dependency the graph does not contain. */


const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: GOAL_LABEL },
    { id: 'fit', kind: 'factor', label: FIT_LABEL, observed_state: { value: 0.5 } },
    { id: 'traction', kind: 'factor', label: TRACTION_LABEL, observed_state: { value: 0.5 } },
    { id: 'runway', kind: 'factor', label: RUNWAY_LABEL, observed_state: { value: 0.5 } },
    { id: 'opt_a', kind: 'option', label: 'Raise now at a lower valuation', interventions: { runway: 0.8 } },
    { id: 'opt_b', kind: 'option', label: 'Delay and build traction', is_baseline: true, interventions: { traction: 0.6 } },
  ],
  edges: [
    { from: 'fit', to: 'goal', strength: { mean: 0.7, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'traction', to: 'fit', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'runway', to: 'goal', strength: { mean: -0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
  ],
  goal_node_id: 'goal',
};





/**
 * The frontier model is the ONLY producer of `structure_query.kind`, so the
 * adapter supplies exactly what a witnessed turn supplied. The evidence builder,
 * the label resolution and the handler are all production code below.
 */









beforeEach(() => {
  writes.length = 0;
  persistedGraph = structuredClone(GRAPH);
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});



describe('the composer copy binds to its own branch and its own direction', () => {
  /**
   * ⭐ THE DIFFERENT-SUBJECT CONTROL. `subject_selection:'single_resolved'` is a
   * DIFFERENT reachability class — the user HAS exactly one element selected, so
   * "name it or select it" would state a condition that is already true. It is
   * deliberately OUT OF SCOPE here, and pinned UNCHANGED so a bulk edit of the
   * neighbouring branch cannot silently take it too.
   */
  it('leaves the single-resolved branch exactly as it was (both directions)', () => {
    expect(
      composeSelectedDependenciesEvidenceAnswer({
        status: 'ambiguous',
        subject_selection: 'single_resolved',
      }),
    ).toBe(
      'I could not match your question to a single part of your saved model, so I will not guess at what connects to it. ' +
      'Check that the one you mean appears only once in the model, and ask again.',
    );

    expect(
      composeSelectedOutgoingInfluenceEvidenceAnswer({
        status: 'ambiguous',
        subject_selection: 'single_resolved',
      }),
    ).toBe(
      'I could not match your question to a single part of your saved model, so I will not guess at what it affects. ' +
      'Check that the one you mean appears only once in the model, and ask again.',
    );
  });

  /**
   * ⭐⭐ THE DIRECTION WORDS MUST NOT CROSS. The two composers render opposite
   * predicates from structurally identical payloads; the file's standing
   * invariant is that neither string contains the other's direction word. A
   * shared-copy refactor of the branch changed above would break exactly this.
   */
  it('keeps each ambiguous refusal free of the other direction word', () => {
    const incoming = composeSelectedDependenciesEvidenceAnswer({ status: 'ambiguous' });
    const outgoing = composeSelectedOutgoingInfluenceEvidenceAnswer({ status: 'ambiguous' });

    expect(incoming).toContain('connects to it');
    expect(incoming).not.toContain('affects');

    expect(outgoing).toContain('affects');
    expect(outgoing).not.toContain('connects to it');
  });
});
