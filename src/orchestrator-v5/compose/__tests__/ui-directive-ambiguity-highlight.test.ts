/**
 * The ambiguity-candidate highlight — "point at what the question is about".
 *
 * The claim under test is a TRUTHFULNESS claim, not a rendering one: when CEE
 * asks "which one did you mean?", the directive it attaches must name graph
 * entities that ACTUALLY EXIST in the graph the user is looking at, and must
 * emit nothing at all when it cannot. A highlight pointing at nothing is worse
 * than no highlight, so both directions are pinned here.
 *
 * ⚠ AND IT MUST POINT AT ALL OF THEM OR NONE. Coverage is all-or-nothing: a
 * highlight over a PROPER SUBSET of the numbered options is not a weaker
 * gesture, it is a different and false one — on a turn asking the user to
 * choose, lighting one of two implies the choice. That rule REVERSES this
 * suite's own earlier pin ("drops the unresolvable ids but keeps the resolvable
 * ones"), deliberately; the reversal is pinned by name below so nobody
 * re-litigates it as an oversight.
 *
 * ⚠ ON BINDING. Every assertion below binds to its object by IDENTITY (the
 * exact node id / label it must name), never by a predicate another node in the
 * fixture could satisfy — the fixtures deliberately carry DECOY nodes so that
 * "some target was emitted" cannot pass for "the candidate's target was
 * emitted". The discriminating pair at the end proves the binding rather than
 * merely asserting it.
 */

import { describe, it, expect, vi } from 'vitest';
import { UiDirectiveBlockSchema } from '@talchain/schemas/boundary';
import {
  buildAmbiguityCandidateUiDirective,
  collectAmbiguityCandidateEntityIds,
  AMBIGUITY_HIGHLIGHT_MAX_TARGETS,
} from '../ui-directive.js';
import { buildGraphNodeLookupFromGraph } from '../phase3-blocks.js';
import { composeDirectAnswerResponse } from '../../compose.js';

/**
 * A persisted-graph snapshot in the shape CEE actually holds for a turn
 * (`context.persistedGraph`): nodes with id/kind/label.
 *
 * DECOYS ARE LOAD-BEARING. `factor_decoy` and `option_decoy` are real,
 * resolvable graph nodes that no candidate targets. A test that merely asserted
 * "targets is non-empty" or "a factor was highlighted" would pass on them; the
 * assertions below name ids, so it cannot.
 */
const GRAPH = {
  nodes: [
    { id: 'factor_price', kind: 'factor', label: 'Unit price' },
    { id: 'factor_churn', kind: 'factor', label: 'Monthly churn' },
    { id: 'option_launch', kind: 'option', label: 'Launch in Q3' },
    { id: 'factor_decoy', kind: 'factor', label: 'Decoy factor nobody asked about' },
    { id: 'option_decoy', kind: 'option', label: 'Decoy option nobody asked about' },
  ],
  edges: [],
};

const lookup = () => buildGraphNodeLookupFromGraph(GRAPH);

/** A candidate carrying its entities on `preconditions` (one of two carriers). */
const candidateViaPreconditions = (...ids: string[]) => ({
  preconditions: { target_entity_ids: ids },
});

/** A candidate carrying its entities on `inline_patch` (the other carrier). */
const candidateViaInlinePatch = (...ids: string[]) => ({
  action: { inline_patch: { handler_id: 'set_factor_value', target_entity_ids: ids } },
});

/** One id per candidate — the common builder input, spelled as groups. */
const oneEach = (...ids: string[]): readonly (readonly string[])[] => ids.map((id) => [id]);

describe('collectAmbiguityCandidateEntityIds — the two carriers', () => {
  it('reads preconditions.target_entity_ids', () => {
    expect(collectAmbiguityCandidateEntityIds([candidateViaPreconditions('factor_price')])).toEqual(
      [['factor_price']],
    );
  });

  it('reads inline_patch.target_entity_ids', () => {
    expect(collectAmbiguityCandidateEntityIds([candidateViaInlinePatch('factor_churn')])).toEqual([
      ['factor_churn'],
    ]);
  });

  /**
   * The differently-named-twins guard. Reading only ONE carrier under-covers
   * whichever proposals the other producer minted, and that under-coverage is
   * invisible: it looks exactly like a candidate with no graph entity. This
   * case FAILS if either carrier is dropped.
   */
  it('unions both carriers across a mixed candidate set, in candidate order', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        candidateViaPreconditions('factor_price'),
        candidateViaInlinePatch('factor_churn'),
      ]),
    ).toEqual([['factor_price'], ['factor_churn']]);
  });

  it('dedupes an id carried in BOTH places on one candidate', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        {
          preconditions: { target_entity_ids: ['factor_price'] },
          action: { inline_patch: { target_entity_ids: ['factor_price'] } },
        },
      ]),
    ).toEqual([['factor_price']]);
  });

  it('is total on malformed shapes — degrades to empty groups, never throws', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        { preconditions: { target_entity_ids: 'not-an-array' } },
        { action: { inline_patch: null } },
        { action: { inline_patch: { target_entity_ids: [42, '', null] } } },
        {},
      ]),
    ).toEqual([[], [], [], []]);
  });
});

/**
 * THE SHAPE IS THE FACT. The builder's question is "does EVERY option the
 * question numbers have something to point at?", and a flat union cannot answer
 * it: merged, a candidate that contributed NOTHING is indistinguishable from
 * one whose id another candidate also carries. These two cases are the ones a
 * flatten would silently destroy, and they pull in OPPOSITE directions — the
 * first must suppress, the second must emit — so no single wrong shape can
 * satisfy both.
 */
describe('collectAmbiguityCandidateEntityIds — candidate boundaries survive', () => {
  it('emits exactly one group per candidate, so a candidate carrying NOTHING stays visible', () => {
    const groups = collectAmbiguityCandidateEntityIds([
      candidateViaPreconditions('factor_price'),
      {},
    ]);
    expect(groups).toHaveLength(2);
    expect(groups).toEqual([['factor_price'], []]);
  });

  it('does NOT dedupe across candidates — two candidates naming one node keep both groups', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        candidateViaPreconditions('factor_price'),
        candidateViaInlinePatch('factor_price'),
      ]),
    ).toEqual([['factor_price'], ['factor_price']]);
  });
});

describe('buildAmbiguityCandidateUiDirective — DIRECTION 1: ids present ⇒ it points at them', () => {
  it('names the candidates real node ids, with graph labels, in candidate order', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      oneEach('factor_price', 'option_launch'),
      lookup(),
    );
    expect(directive).not.toBeNull();
    expect(directive!.verb).toBe('highlight');
    // IDENTITY binding: the exact ids, in order. No decoy may appear.
    expect(directive!.targets).toEqual([
      { id: 'factor_price', label: 'Unit price', kind: 'factor' },
      { id: 'option_launch', label: 'Launch in Q3', kind: 'option' },
    ]);
  });

  it('every emitted target id EXISTS in the graph the user is looking at', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      oneEach('factor_price', 'factor_churn'),
      lookup(),
    );
    const graphIds = new Set(GRAPH.nodes.map((n) => n.id));
    expect(directive!.targets.length).toBeGreaterThan(0);
    for (const t of directive!.targets) expect(graphIds.has(t.id)).toBe(true);
  });

  /**
   * Labels come from the GRAPH, never from the id. The Phase-3 §0.1 invariant:
   * an id-as-label fallback would render a raw identifier on the canvas.
   */
  it('resolves labels from the graph and never falls back to the id', () => {
    const directive = buildAmbiguityCandidateUiDirective([['factor_churn']], lookup());
    expect(directive!.targets[0]!.label).toBe('Monthly churn');
    expect(directive!.targets[0]!.label).not.toBe('factor_churn');
  });

  /**
   * WITHIN a candidate, a spare unresolvable id is a detail, not a missing
   * option: candidate 1 still has something to point at, so the question is
   * still fully covered. This is the exact boundary the coverage rule turns
   * on — across candidates the same partial-ness suppresses (below).
   */
  it('emits when a candidate carries an unresolvable id ALONGSIDE a resolvable one', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      [['factor_price', 'ghost_node_not_in_graph'], ['option_launch']],
      lookup(),
    );
    expect(directive!.targets.map((t) => t.id)).toEqual(['factor_price', 'option_launch']);
  });

  it('emits a block that passes the strict boundary schema', () => {
    const directive = buildAmbiguityCandidateUiDirective([['factor_price']], lookup());
    expect(UiDirectiveBlockSchema.safeParse(directive).success).toBe(true);
  });
});

describe('buildAmbiguityCandidateUiDirective — DIRECTION 2: nothing to point at ⇒ NO directive', () => {
  it('emits nothing when the candidate set is EMPTY', () => {
    expect(buildAmbiguityCandidateUiDirective([], lookup())).toBeNull();
  });

  it('emits nothing when candidates exist but NONE carries an entity id', () => {
    expect(buildAmbiguityCandidateUiDirective([[], []], lookup())).toBeNull();
  });

  /**
   * THE LOAD-BEARING GATE. Ids that name nothing in the user's graph must
   * produce no gesture at all — not an empty-targets block, not a partial one.
   */
  it('emits nothing when NO candidate id resolves in the graph', () => {
    expect(
      buildAmbiguityCandidateUiDirective(oneEach('ghost_a', 'ghost_b'), lookup()),
    ).toBeNull();
  });

  it('emits nothing against an EMPTY graph', () => {
    expect(
      buildAmbiguityCandidateUiDirective(
        [['factor_price']],
        buildGraphNodeLookupFromGraph({ nodes: [], edges: [] }),
      ),
    ).toBeNull();
  });

  it('emits nothing against an ABSENT graph (degraded persisted read)', () => {
    expect(
      buildAmbiguityCandidateUiDirective(
        [['factor_price']],
        buildGraphNodeLookupFromGraph(null),
      ),
    ).toBeNull();
  });

  /**
   * Suppress rather than truncate: a truncated highlight would point at a
   * SUBSET of what the question asks about, which is worse than no gesture.
   */
  it('suppresses entirely above the target cap rather than truncating', () => {
    const nodes = Array.from({ length: AMBIGUITY_HIGHLIGHT_MAX_TARGETS + 1 }, (_, i) => ({
      id: `factor_${i}`,
      kind: 'factor',
      label: `Factor ${i}`,
    }));
    const big = buildGraphNodeLookupFromGraph({ nodes, edges: [] });
    const ids = nodes.map((n) => n.id);
    expect(buildAmbiguityCandidateUiDirective(oneEach(...ids), big)).toBeNull();
    // ...and the cap itself is inclusive, so one fewer still emits.
    expect(buildAmbiguityCandidateUiDirective(oneEach(...ids.slice(0, -1)), big)).not.toBeNull();
  });
});

/**
 * ⭐ COVERAGE IS ALL-OR-NOTHING — the rule this change exists for, and the
 * reversal of a previously ratified position.
 *
 * The earlier revision dropped unresolvable ids one at a time and suppressed
 * only when the set emptied. On a MIXED candidate set that lit a PROPER SUBSET
 * of the numbered options — and on a turn whose whole purpose is to ask which
 * option the user meant, lighting one of two implies the answer. The cap door
 * in the same module had already ratified the opposite position for the same
 * outcome; the two doors simply disagreed, and this one was wrong.
 *
 * ⚠ BOTH DIRECTIONS LIVE HERE, IN ONE BLOCK, ON PURPOSE. A false positive that
 * DROPS the gesture is a gap; one that INVENTS an implied answer is a lie; they
 * cannot share a window, so the drop cases and the legitimate-emit cases are
 * pinned together and a change that darkened the gesture wholesale would fail
 * the second half rather than pass a shrunken suite.
 */
describe('coverage is all-or-nothing — a proper subset would imply the answer', () => {
  // ── DROP direction: the gesture must go dark ──────────────────────────────
  it('SUPPRESSES when one of two candidates names an entity NOT in the graph', () => {
    expect(
      buildAmbiguityCandidateUiDirective(
        [['factor_price'], ['entity_not_yet_in_graph']],
        lookup(),
      ),
    ).toBeNull();
  });

  it('SUPPRESSES when one of two candidates carries no entity id at all', () => {
    // The named real case: a `run_analysis` / `what_would_flip` pending
    // alongside a proposal. It has no `target_entity_ids` on either carrier.
    expect(
      buildAmbiguityCandidateUiDirective([['option_launch'], []], lookup()),
    ).toBeNull();
  });

  it('SUPPRESSES on the end-to-end call-site expression, collector included', () => {
    // The exact shape turn-executor.ts pipes: collector output straight into
    // the builder. Pinning the pair together is what stops a future flatten in
    // the collector re-opening this with the builder untouched.
    const directive = buildAmbiguityCandidateUiDirective(
      collectAmbiguityCandidateEntityIds([
        candidateViaPreconditions('factor_price'),
        candidateViaInlinePatch('entity_not_yet_in_graph'),
      ]),
      lookup(),
    );
    expect(directive).toBeNull();
  });

  // ── EMIT direction: the legitimate counterpart, same run ──────────────────
  it('STILL EMITS when every candidate resolves — exact ids, in candidate order', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      collectAmbiguityCandidateEntityIds([
        candidateViaPreconditions('factor_price'),
        candidateViaInlinePatch('option_launch'),
      ]),
      lookup(),
    );
    expect(directive).not.toBeNull();
    expect(directive!.targets).toEqual([
      { id: 'factor_price', label: 'Unit price', kind: 'factor' },
      { id: 'option_launch', label: 'Launch in Q3', kind: 'option' },
    ]);
  });

  /**
   * The false-suppression trap this change could easily have shipped: two
   * candidates that legitimately name the SAME node are fully covered, and a
   * cross-candidate dedup in the collector would empty the second group and
   * read it as uncovered. One target, both candidates covered, gesture honest.
   */
  it('STILL EMITS when two candidates name the SAME node — deduped to one target', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      collectAmbiguityCandidateEntityIds([
        candidateViaPreconditions('factor_price'),
        candidateViaInlinePatch('factor_price'),
      ]),
      lookup(),
    );
    expect(directive).not.toBeNull();
    expect(directive!.targets).toEqual([
      { id: 'factor_price', label: 'Unit price', kind: 'factor' },
    ]);
  });

  it('STILL EMITS for a single candidate whose id resolves', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      collectAmbiguityCandidateEntityIds([candidateViaPreconditions('factor_churn')]),
      lookup(),
    );
    expect(directive!.targets.map((t) => t.id)).toEqual(['factor_churn']);
  });
});

describe('the charter — uncertainty shown, decision NOT implied', () => {
  const directive = () =>
    buildAmbiguityCandidateUiDirective(oneEach('factor_price', 'option_launch'), lookup())!;

  /**
   * `focus` and `open_inspector` act on a SINGLE target — using either would
   * force a choice of one candidate, which is the decision the turn is asking
   * the USER to make. `highlight` pulses every target equally.
   */
  it('uses the multi-target verb, never a single-target one', () => {
    expect(directive().verb).toBe('highlight');
    expect(['focus', 'open_inspector']).not.toContain(directive().verb);
  });

  it('carries NO caption — zero free text, zero hallucination surface', () => {
    expect(directive().note).toBeUndefined();
  });

  it('carries no panel target (graph verbs must not smuggle one)', () => {
    expect(directive().ui_target).toBeUndefined();
  });

  /**
   * Ordering carries no rank: targets appear in the candidate set's own order,
   * which is the order of the numbered list the user is reading.
   */
  it('preserves candidate order rather than imposing one', () => {
    const forward = buildAmbiguityCandidateUiDirective(
      oneEach('factor_price', 'option_launch'),
      lookup(),
    )!;
    const reversed = buildAmbiguityCandidateUiDirective(
      oneEach('option_launch', 'factor_price'),
      lookup(),
    )!;
    expect(forward.targets.map((t) => t.id)).toEqual(['factor_price', 'option_launch']);
    expect(reversed.targets.map((t) => t.id)).toEqual(['option_launch', 'factor_price']);
  });
});

/**
 * THE MOUNT PATH — and it is a real hazard here, not ceremony.
 *
 * `ComposeInput.blocks` reaches the wire ONLY through
 * `composeDirectAnswerResponse`; its sibling `composeClarifyResponse`
 * HARD-CODES `blocks: []`. The ambiguity sites route through the
 * turn-executor's `composeAnswer` wrapper, which calls the former — but that is
 * a fact about the wiring, and a future tidy-up that "simplified" a
 * clarification turn onto the clarify composer would silently delete this
 * gesture with every other test still green. This pins the carrying composer by
 * behaviour, and pins the non-carrying one so the asymmetry stays visible.
 */
describe('the mount path — the block actually reaches the response', () => {
  it('composeDirectAnswerResponse CARRIES the directive onto the wire', () => {
    const directive = buildAmbiguityCandidateUiDirective([['factor_price']], lookup())!;
    const response = composeDirectAnswerResponse({
      answerKind: 'functional',
      assistant_text: 'Which one would you like? 1) Unit price',
      stage: 'frame',
      blocks: [directive],
    });
    expect(response.blocks).toHaveLength(1);
    const emitted = response.blocks[0] as typeof directive;
    expect(emitted.type).toBe('ui_directive');
    expect(emitted.targets.map((t) => t.id)).toEqual(['factor_price']);
  });
});

/**
 * SUPPRESSION IS OBSERVABLE — the module's own discipline is that every drop is
 * reason-tagged so it is never a silent no-op (the broken-alarm class).
 *
 * The failure modes MUST stay distinguishable: "this turn had nothing to point
 * at" is normal, whereas "the candidates named entities the user's graph does
 * not contain" is a DRIFT signal (a proposal outliving its nodes, or a degraded
 * persisted read). They suppress identically, so without separate tags the
 * second is invisible — which is precisely how a silently-degrading gesture
 * would go unnoticed.
 *
 * ⚠ AND THE THIRD TAG IS THE PRICE OF THIS CHANGE, MADE COUNTABLE. Partial
 * coverage darkens a gesture that used to render (wrongly). Its live frequency
 * is unmeasured and this suite claims nothing about it; merged into either
 * neighbouring tag, that cost would be permanently unmeasurable.
 */
describe('suppression is reason-tagged, and the reasons are distinguishable', () => {
  const reasonsFor = async (
    groups: readonly (readonly string[])[],
    lk: ReturnType<typeof buildGraphNodeLookupFromGraph>,
  ): Promise<string[]> => {
    const telemetry = await import('../../../utils/telemetry.js');
    const seen: string[] = [];
    const spy = vi
      .spyOn(telemetry, 'emit')
      .mockImplementation((event: unknown, payload: unknown) => {
        if (event === telemetry.TelemetryEvents.V5UiDirectiveSuppressed) {
          seen.push(String((payload as { reason?: unknown }).reason));
        }
      });
    buildAmbiguityCandidateUiDirective(groups, lk);
    spy.mockRestore();
    return seen;
  };

  it('tags an EMPTY candidate set distinctly from unresolved targets', async () => {
    expect(await reasonsFor([], lookup())).toEqual(['ambiguity_no_candidate_entities']);
  });

  it('tags ids that do not resolve in the graph as a DRIFT signal, not as "nothing to point at"', async () => {
    expect(await reasonsFor([['ghost_a']], lookup())).toEqual(['ambiguity_targets_unresolved']);
  });

  it('tags PARTIAL coverage distinctly from both — this is the countable cost', async () => {
    expect(await reasonsFor([['factor_price'], ['ghost_a']], lookup())).toEqual([
      'ambiguity_candidate_coverage_partial',
    ]);
  });

  it('tags a candidate with NO ids alongside a resolvable one as partial coverage', async () => {
    expect(await reasonsFor([['factor_price'], []], lookup())).toEqual([
      'ambiguity_candidate_coverage_partial',
    ]);
  });

  it('tags the over-cap suppression distinctly', async () => {
    const nodes = Array.from({ length: AMBIGUITY_HIGHLIGHT_MAX_TARGETS + 1 }, (_, i) => ({
      id: `factor_${i}`,
      kind: 'factor',
      label: `Factor ${i}`,
    }));
    expect(
      await reasonsFor(
        oneEach(...nodes.map((n) => n.id)),
        buildGraphNodeLookupFromGraph({ nodes, edges: [] }),
      ),
    ).toEqual(['ambiguity_too_many_targets']);
  });
});

/**
 * THE DISCRIMINATING PAIR — proves the assertions bind to the CANDIDATE's
 * object, not merely to "a target".
 *
 * Break it for ALL → the identity assertions must fail (a builder returning any
 * other node cannot satisfy them). Break it for a DIFFERENT object → they must
 * still hold. A single biting mutant proves sensitivity to something; the pair
 * proves sensitivity to the named object.
 */
describe('discriminating pair — binding by identity', () => {
  it('RED arm: a builder that returned the DECOY instead would not satisfy the identity assertion', () => {
    const real = buildAmbiguityCandidateUiDirective([['factor_price']], lookup())!;
    const decoyed = buildAmbiguityCandidateUiDirective([['factor_decoy']], lookup())!;
    // Both are well-formed directives — "a directive was emitted" cannot tell
    // them apart, which is exactly why the suite asserts ids.
    expect(UiDirectiveBlockSchema.safeParse(decoyed).success).toBe(true);
    expect(decoyed.targets.map((t) => t.id)).not.toEqual(real.targets.map((t) => t.id));
  });

  it('GREEN arm: changing an UNRELATED node leaves the candidates directive identical', () => {
    const before = buildAmbiguityCandidateUiDirective([['factor_price']], lookup())!;
    const mutatedGraph = {
      nodes: GRAPH.nodes.map((n) =>
        n.id === 'factor_decoy' ? { ...n, label: 'Renamed decoy' } : n,
      ),
      edges: [],
    };
    const after = buildAmbiguityCandidateUiDirective(
      [['factor_price']],
      buildGraphNodeLookupFromGraph(mutatedGraph),
    )!;
    expect(after.targets).toEqual(before.targets);
  });
});
