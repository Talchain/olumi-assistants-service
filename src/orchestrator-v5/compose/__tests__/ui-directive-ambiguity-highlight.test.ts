/**
 * The ambiguity-candidate highlight — "point at what the question is about".
 *
 * The claim under test is a TRUTHFULNESS claim, not a rendering one: when CEE
 * asks "which one did you mean?", the directive it attaches must name graph
 * entities that ACTUALLY EXIST in the graph the user is looking at, and must
 * emit nothing at all when it cannot. A highlight pointing at nothing is worse
 * than no highlight, so both directions are pinned here.
 *
 * ⚠ ON BINDING. Every assertion below binds to its object by IDENTITY (the
 * exact node id / label it must name), never by a predicate another node in the
 * fixture could satisfy — the fixtures deliberately carry DECOY nodes so that
 * "some target was emitted" cannot pass for "the candidate's target was
 * emitted". The discriminating pair at the end proves the binding rather than
 * merely asserting it.
 */

import { describe, it, expect } from 'vitest';
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

describe('collectAmbiguityCandidateEntityIds — the two carriers', () => {
  it('reads preconditions.target_entity_ids', () => {
    expect(collectAmbiguityCandidateEntityIds([candidateViaPreconditions('factor_price')])).toEqual(
      ['factor_price'],
    );
  });

  it('reads inline_patch.target_entity_ids', () => {
    expect(collectAmbiguityCandidateEntityIds([candidateViaInlinePatch('factor_churn')])).toEqual([
      'factor_churn',
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
    ).toEqual(['factor_price', 'factor_churn']);
  });

  it('dedupes an id carried in BOTH places on one candidate', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        {
          preconditions: { target_entity_ids: ['factor_price'] },
          action: { inline_patch: { target_entity_ids: ['factor_price'] } },
        },
      ]),
    ).toEqual(['factor_price']);
  });

  it('is total on malformed shapes — degrades to no ids, never throws', () => {
    expect(
      collectAmbiguityCandidateEntityIds([
        { preconditions: { target_entity_ids: 'not-an-array' } },
        { action: { inline_patch: null } },
        { action: { inline_patch: { target_entity_ids: [42, '', null] } } },
        {},
      ]),
    ).toEqual([]);
  });
});

describe('buildAmbiguityCandidateUiDirective — DIRECTION 1: ids present ⇒ it points at them', () => {
  it('names the candidates real node ids, with graph labels, in candidate order', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      ['factor_price', 'option_launch'],
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
      ['factor_price', 'factor_churn'],
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
    const directive = buildAmbiguityCandidateUiDirective(['factor_churn'], lookup());
    expect(directive!.targets[0]!.label).toBe('Monthly churn');
    expect(directive!.targets[0]!.label).not.toBe('factor_churn');
  });

  it('drops the unresolvable ids but keeps the resolvable ones', () => {
    const directive = buildAmbiguityCandidateUiDirective(
      ['factor_price', 'ghost_node_not_in_graph'],
      lookup(),
    );
    expect(directive!.targets.map((t) => t.id)).toEqual(['factor_price']);
  });

  it('emits a block that passes the strict boundary schema', () => {
    const directive = buildAmbiguityCandidateUiDirective(['factor_price'], lookup());
    expect(UiDirectiveBlockSchema.safeParse(directive).success).toBe(true);
  });
});

describe('buildAmbiguityCandidateUiDirective — DIRECTION 2: nothing to point at ⇒ NO directive', () => {
  it('emits nothing when the candidate set is EMPTY', () => {
    expect(buildAmbiguityCandidateUiDirective([], lookup())).toBeNull();
  });

  /**
   * THE LOAD-BEARING GATE. Ids that name nothing in the user's graph must
   * produce no gesture at all — not an empty-targets block, not a partial one.
   */
  it('emits nothing when NO candidate id resolves in the graph', () => {
    expect(
      buildAmbiguityCandidateUiDirective(['ghost_a', 'ghost_b'], lookup()),
    ).toBeNull();
  });

  it('emits nothing against an EMPTY graph', () => {
    expect(
      buildAmbiguityCandidateUiDirective(
        ['factor_price'],
        buildGraphNodeLookupFromGraph({ nodes: [], edges: [] }),
      ),
    ).toBeNull();
  });

  it('emits nothing against an ABSENT graph (degraded persisted read)', () => {
    expect(
      buildAmbiguityCandidateUiDirective(
        ['factor_price'],
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
    expect(buildAmbiguityCandidateUiDirective(ids, big)).toBeNull();
    // ...and the cap itself is inclusive, so one fewer still emits.
    expect(buildAmbiguityCandidateUiDirective(ids.slice(0, -1), big)).not.toBeNull();
  });
});

describe('the charter — uncertainty shown, decision NOT implied', () => {
  const directive = () =>
    buildAmbiguityCandidateUiDirective(['factor_price', 'option_launch'], lookup())!;

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
      ['factor_price', 'option_launch'],
      lookup(),
    )!;
    const reversed = buildAmbiguityCandidateUiDirective(
      ['option_launch', 'factor_price'],
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
    const directive = buildAmbiguityCandidateUiDirective(['factor_price'], lookup())!;
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
    const real = buildAmbiguityCandidateUiDirective(['factor_price'], lookup())!;
    const decoyed = buildAmbiguityCandidateUiDirective(['factor_decoy'], lookup())!;
    // Both are well-formed directives — "a directive was emitted" cannot tell
    // them apart, which is exactly why the suite asserts ids.
    expect(UiDirectiveBlockSchema.safeParse(decoyed).success).toBe(true);
    expect(decoyed.targets.map((t) => t.id)).not.toEqual(real.targets.map((t) => t.id));
  });

  it('GREEN arm: changing an UNRELATED node leaves the candidates directive identical', () => {
    const before = buildAmbiguityCandidateUiDirective(['factor_price'], lookup())!;
    const mutatedGraph = {
      nodes: GRAPH.nodes.map((n) =>
        n.id === 'factor_decoy' ? { ...n, label: 'Renamed decoy' } : n,
      ),
      edges: [],
    };
    const after = buildAmbiguityCandidateUiDirective(
      ['factor_price'],
      buildGraphNodeLookupFromGraph(mutatedGraph),
    )!;
    expect(after.targets).toEqual(before.targets);
  });
});
