/**
 * ⭐ THE REFUSAL MUST NOT DENY A CAPABILITY THIS DEPLOYMENT HAS — the
 * `reader_only_refusal` limb, for the 0.50.0 canvas direct-edit vocabulary.
 *
 * Third member of a family that has now cost this repo three separate defects:
 *   · `unsupported-action-capability-honesty.test.ts`       (ROADMAP 2.663, structural)
 *   · `unsupported-action-draft-capability-honesty.test.ts` (`draft_graph`, witnessed live)
 *   · this file                                             (canvas system events)
 *
 * ── THE DEFECT THIS CLOSES ────────────────────────────────────────────────
 * #1138 shipped, for a canvas-originated structural add:
 *
 *   "I can't add a factor to the model in this version, so I haven't changed
 *    the model."
 *
 * CEE can add a factor. Chat reaches `add_node` / `add_edge` / `update_node`
 * through `edit-graph-dispatch.ts:148` → `propose-structural-edit.ts`, whose
 * advertised grammar (`STRUCTURAL_EDIT_OPS`) is itself pinned both ways to the
 * enforcing `PatchOperation` union. The sentence denied the CAPABILITY when the
 * true limitation is only that this deployment has no writer for the gesture
 * performed ON THE CANVAS — an implementation fact, never a product limit.
 *
 * ⭐ AND IT CLOSED A LOOP. `compose/unsupported-action-response.ts:247-267`
 * appends "You can make this change (add factor) directly on the canvas"
 * UNCONDITIONALLY. Chat sent the user to the canvas; the canvas said the
 * version could not. An affordance terminating in refusal, with no exit.
 *
 * ── THE INVARIANT UNDER TEST (written against the SPEC, not the case) ─────
 * A reader-only refusal may assert a VERSION-LEVEL limit only where this
 * deployment has no route to the outcome. Where a route exists, the refusal
 * must SCOPE the denial to the surface that genuinely cannot serve it, and
 * NAME the route that works.
 *
 * ── ⚠ PINNED BOTH WAYS, BECAUSE HALF A GUARD IS THE USUAL FAILURE ─────────
 * Two OPPOSITE harms live under this one predicate and they cannot share an
 * assertion (CLAUDE.md trap 22b):
 *   A. denying a capability we HAVE  → the user is told something false about
 *      the product, and loses the route that would have worked;
 *   B. promising a route we LACK     → a false promise, which is strictly
 *      worse than a flat denial because it costs the user a wasted attempt.
 * Cases below are written in matched pairs so neither direction can be traded
 * away to satisfy the other.
 *
 * ── ⚠ NO NATURAL-LANGUAGE PREDICATE, DELIBERATELY (trap 22f) ──────────────
 * Four rounds were once burned oscillating on one NL regex. This file asserts
 * STRUCTURAL properties of the sentence (is the denial canvas-scoped? is the
 * chat route named?) plus VERBATIM identity pins on the exact false sentences
 * that shipped. It never tries to parse the copy for meaning.
 *
 * ⭐ RE-SURFACE TRIGGER: **the UI re-vendors to schemas ≥0.50.0**. That single
 * event gives these three kinds a live producer and makes any dishonesty here
 * user-visible. It is the same trigger as the local-receipt mirror in
 * `model-management/mutation-receipt.ts` and the latent receipt-hash rewrite.
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import {
  buildReaderOnlyRefusal,
  READER_ONLY_CHAT_ROUTE_OPS,
  SYSTEM_EVENT_HANDLING,
} from '../dispatch.js';
import { STRUCTURAL_EDIT_OPS } from '../../tools/propose-structural-edit.js';

/**
 * Build the payload the real emitter reads. Only `event.kind` and `stage` are
 * consumed by `buildReaderOnlyRefusal`, so the cast is honest about scope.
 */
function refusalFor(kind: string) {
  return buildReaderOnlyRefusal({
    kind: 'system_event',
    stage: 'frame',
    event: { kind },
  } as unknown as SystemEventTurnPayload);
}

function textFor(kind: string): string {
  return refusalFor(kind).assistant_text.toLowerCase();
}

/** Kinds declared reader-only by the PRODUCTION map, derived — never re-listed. */
const READER_ONLY_KINDS = (
  Object.entries(SYSTEM_EVENT_HANDLING) as [string, string][]
)
  .filter(([, handling]) => handling === 'reader_only_refusal')
  .map(([kind]) => kind)
  .sort();

/**
 * Reader-only kinds this deployment genuinely has NO chat route for.
 *
 * An explicit KNOWN-NO-ROUTE set, not an omission: a kind absent from BOTH this
 * set and `READER_ONLY_CHAT_ROUTE_OPS` is unadjudicated and REDs below. That is
 * the honest way to carry a gap (trap 22f) — the suite stays green for the
 * right reason and fails if the set grows OR shrinks.
 */
const KNOWN_NO_CHAT_ROUTE = new Set<string>(['edge_strength_edit']);

describe('reader-only refusal — the capability denial must be true', () => {
  it('⭐ PRECONDITION PIN — the kinds under test really are declared reader-only', () => {
    // trap 13b: a discriminator must pin its own precondition, or it can pass
    // because the fixture stopped reaching the branch rather than because the
    // property holds. If a writer lands and these become 'mutating', this REDs
    // here first and names why.
    // ⚠⚠ THIS WAS `toBeGreaterThan(0)` AND IT HAD TO CHANGE, because the set is
    // now EMPTY — `structural_add_edge` was the last reader-only kind and left
    // when its writer landed. Every kind `SYSTEM_EVENT_HANDLING` declares now has
    // a writer or a defined non-writer posture.
    //
    // ⛔ ASSERTED EXACTLY, NOT DELETED. An empty set is the healthy reading TODAY
    // and will stop being one the moment a contract version adds a kind CEE
    // cannot yet write: that kind must land reader-first, and this REDs then, by
    // name, so its refusal copy gets adjudicated instead of being parked. The
    // opposite treatment — dropping the pin because it currently has nothing to
    // say — is how this file would decay into agreeing with whatever is current.
    expect(READER_ONLY_KINDS).toEqual([]);
    for (const kind of Object.keys(READER_ONLY_CHAT_ROUTE_OPS)) {
      expect(SYSTEM_EVENT_HANDLING[kind as keyof typeof SYSTEM_EVENT_HANDLING]).toBe(
        'reader_only_refusal',
      );
    }
  });

  describe('DIRECTION A — a capability we HAVE must not be denied', () => {
    /**
     * ⚠⚠ THIS WAS A `describe.skipIf` AND THAT WAS THE WRONG ANSWER TWICE OVER.
     *
     * The table is empty today — `structural_add_edge` was the last reader-only
     * kind and left when its writer landed — and `it.each([])` is an error in
     * vitest. Skipping the block avoided the error and cost two things:
     *
     *   1. A SKIPPED TEST IS INVISIBLE COVERAGE, which is exactly what the
     *      repo's skip inventory exists to stop. It was green on the base commit
     *      and red on mine; the ratchet was right and I was wrong.
     *   2. It also skipped the VERBATIM SENTENCE PINS below, which do not depend
     *      on the table at all and were still doing real work.
     *
     * One always-running case with an explicit empty branch keeps every
     * assertion live, reports honestly when there is nothing to iterate, and
     * adds no skip. The emptiness is separately guarded by the exact-table pin,
     * which REDs the moment a kind is parked reader-only.
     */
    it('⭐ every reader-only kind scopes its denial to the canvas and names the chat route', () => {
      const kinds = Object.keys(READER_ONLY_CHAT_ROUTE_OPS);
      if (kinds.length === 0) {
        // Not a silent pass: states WHY there is nothing to iterate, so a reader
        // of the output can tell "no kinds" from "no assertions".
        expect(SYSTEM_EVENT_HANDLING).toBeDefined();
        expect(kinds).toEqual([]);
        return;
      }
      for (const kind of kinds) {
        const text = textFor(kind);
        // The denial is about the SURFACE, not the capability.
        expect(text, `${kind} does not scope its denial to the canvas`).toContain('canvas');
        // And the route that works is named, so the user is not left stuck.
        expect(text, `${kind} names no chat route`).toContain('in chat');
      }
    });

    it('⭐ THE WITNESSED FALSE SENTENCES — bound VERBATIM, by identity', () => {
      // Value predicates could be satisfied by a different sentence (trap 19);
      // these are the exact strings #1138 shipped.
      // `structural_add` is no longer reader-only — it has a writer — so its
      // refusal branch is unreachable and there is no sentence left to pin here.
      // The pin migrated to `structural-add.test.ts`, which asserts the WRITER's
      // copy states what actually happened AND what is still missing.
      expect(textFor('structural_add_edge')).not.toContain(
        "i can't add a link between factors in this version",
      );
      // `structural_rename` is no longer reader-only — it has a writer — so its
      // refusal branch is unreachable and there is no sentence left to pin. The
      // pin migrated to `structural-rename.test.ts`, which asserts the WRITER's
      // copy states what actually happened. Removing it here rather than leaving
      // it asserting against the generic fallback is deliberate: a test that
      // passes because the branch it names is dead is a guard agreeing with
      // itself (trap 13b).
    });

    it('⭐ the honest state claim SURVIVES the fix', () => {
      // The fix must not delete the true half. The server really did not write
      // the graph, and the user must still be told so.
      for (const kind of Object.keys(READER_ONLY_CHAT_ROUTE_OPS)) {
        expect(textFor(kind)).toContain("haven't changed the model");
      }
    });
  });

  describe('DIRECTION B — a route we LACK must not be promised', () => {
    it('⭐ the GENERIC fallback promises no chat route', () => {
      // An unlisted kind gets the generic sentence. It cannot know a route
      // exists, so it must not claim one. This is the assertion that stops a
      // future "just say ask me in chat everywhere" fix.
      const text = textFor('patch_accepted');
      expect(text).toContain("haven't changed the model");
      expect(text).not.toContain('in chat');
      expect(text).not.toContain('canvas');
    });

    it('⭐ a KNOWN-NO-ROUTE kind promises no chat route', () => {
      for (const kind of KNOWN_NO_CHAT_ROUTE) {
        expect(textFor(kind)).not.toContain('in chat');
      }
    });
  });

  describe('trap 12d — the route table is pinned BOTH WAYS', () => {
    it('⭐ every op named as a route is a REAL advertised structural-edit op', () => {
      // Positive control first: a silently-empty read must not make this vacuous.
      expect(STRUCTURAL_EDIT_OPS.length).toBeGreaterThan(0);
      expect(STRUCTURAL_EDIT_OPS).toContain('add_node');
      for (const op of Object.values(READER_ONLY_CHAT_ROUTE_OPS)) {
        expect(STRUCTURAL_EDIT_OPS).toContain(op);
      }
    });

    it('⭐ every reader-only kind is ADJUDICATED — route, or explicitly none', () => {
      // Total coverage. A new reader-only kind cannot be added without deciding
      // what its copy may claim; an unadjudicated kind REDs here by name.
      for (const kind of READER_ONLY_KINDS) {
        const adjudicated =
          Object.prototype.hasOwnProperty.call(READER_ONLY_CHAT_ROUTE_OPS, kind) ||
          KNOWN_NO_CHAT_ROUTE.has(kind);
        expect({ kind, adjudicated }).toEqual({ kind, adjudicated: true });
      }
    });

    it('⭐ the route table is EXACT — it REDs if it grows or shrinks', () => {
      // Empty, and pinned exactly so it REDs if it GROWS (a kind parked
      // reader-only without adjudicating its copy) as loudly as it did when it
      // shrank. See the precondition above for why emptiness is asserted rather
      // than the pin being removed.
      expect(Object.keys(READER_ONLY_CHAT_ROUTE_OPS).sort()).toEqual([]);
    });
  });

  it('no internal vocabulary reaches the user', () => {
    for (const kind of Object.keys(READER_ONLY_CHAT_ROUTE_OPS)) {
      const text = textFor(kind);
      expect(text).not.toContain('add_node');
      expect(text).not.toContain('reader_only');
      expect(text).not.toContain(kind);
    }
  });

  it('the stable machine reason is unchanged (client rollout-floor signal)', () => {
    // The copy fix must not disturb the typed signal a client uses to tell this
    // rollout floor from a malformed payload (B1/422).
    for (const kind of Object.keys(READER_ONLY_CHAT_ROUTE_OPS)) {
      const block = refusalFor(kind).blocks[0] as { error_code?: string; details?: { reason?: string } };
      expect(block.error_code).toBe('FEATURE_NOT_ENABLED');
      expect(block.details?.reason).toBe(`${kind}_reader_only`);
    }
  });
});

/**
 * ⭐ THE KIND THE SUITE ABOVE STRUCTURALLY CANNOT SEE.
 *
 * `READER_ONLY_KINDS` is derived from `SYSTEM_EVENT_HANDLING` — correctly, so it
 * cannot drift. But `edge_strength_edit` is declared `'mutating'` there and only
 * becomes a refusal at RUNTIME, when `dispatchSystemEvent` demotes it because
 * `config.features.graphCas.rpcEnforce !== true`. So the one kind whose copy was
 * actually false was invisible to the one suite written to catch false copy, and
 * nothing but a single integration assertion pinned it.
 *
 * That is why this block is keyed on the kind directly rather than on a derived
 * list: a runtime-demoted kind has no declaration to derive from. It is a
 * deliberate exception to "derive, never re-list", and the derived precondition
 * below states the exact reason it is allowed, so it REDs if that stops being
 * true — e.g. if the kind is ever declared `reader_only_refusal`, at which point
 * the suite above covers it and this block should be deleted.
 */
describe('edge_strength_edit — a runtime-demoted kind, refused without naming a gesture', () => {
  it('⭐ PRECONDITION — this kind is NOT declared reader-only, which is why it needs its own pin', () => {
    expect(SYSTEM_EVENT_HANDLING.edge_strength_edit).toBe('mutating');
    expect(READER_ONLY_KINDS).not.toContain('edge_strength_edit');
  });

  /**
   * One kind, two gestures since 0.50.0 (`direction_intent`). The copy table
   * reads `event.kind` alone, so ANY axis it names is a guess — and it was wrong
   * for every direction-only edit. Naming no axis cannot be false.
   */
  it.each(['strength', 'direction', 'helps', 'hurts'])(
    'does not name the "%s" axis it cannot know the user changed',
    (axis) => {
      expect(textFor('edge_strength_edit')).not.toContain(axis);
    },
  );

  it('still says what happened and that nothing changed', () => {
    const text = textFor('edge_strength_edit');
    expect(text).toContain('link');
    expect(text).toContain("haven't changed the model");
  });

  it('keeps the machine reason, so the rollout floor stays distinguishable from B1/422', () => {
    const block = refusalFor('edge_strength_edit').blocks[0] as {
      error_code?: string;
      details?: { reason?: string };
    };
    expect(block.error_code).toBe('FEATURE_NOT_ENABLED');
    expect(block.details?.reason).toBe('edge_strength_edit_reader_only');
  });
});
