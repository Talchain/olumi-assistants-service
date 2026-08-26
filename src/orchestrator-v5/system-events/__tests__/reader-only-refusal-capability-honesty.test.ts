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
    expect(READER_ONLY_KINDS.length).toBeGreaterThan(0);
    for (const kind of Object.keys(READER_ONLY_CHAT_ROUTE_OPS)) {
      expect(SYSTEM_EVENT_HANDLING[kind as keyof typeof SYSTEM_EVENT_HANDLING]).toBe(
        'reader_only_refusal',
      );
    }
  });

  describe('DIRECTION A — a capability we HAVE must not be denied', () => {
    it.each(Object.keys(READER_ONLY_CHAT_ROUTE_OPS))(
      '⭐ %s scopes the denial to the canvas and names the chat route',
      (kind) => {
        const text = textFor(kind);
        // The denial is about the SURFACE, not the capability.
        expect(text).toContain('canvas');
        // And the route that works is named, so the user is not left stuck.
        expect(text).toContain('in chat');
      },
    );

    it('⭐ THE WITNESSED FALSE SENTENCES — bound VERBATIM, by identity', () => {
      // Value predicates could be satisfied by a different sentence (trap 19);
      // these are the exact strings #1138 shipped.
      expect(textFor('structural_add')).not.toContain(
        "i can't add a factor to the model in this version",
      );
      expect(textFor('structural_add_edge')).not.toContain(
        "i can't add a link between factors in this version",
      );
      expect(textFor('structural_rename')).not.toContain(
        "i can't rename a factor in this version",
      );
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
      expect(Object.keys(READER_ONLY_CHAT_ROUTE_OPS).sort()).toEqual([
        'structural_add',
        'structural_add_edge',
        'structural_rename',
      ]);
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
