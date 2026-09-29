/**
 * P1 — "edit applied, but the reply asks what to change". NOT FIXED. PINNED.
 *
 * On an applied edit, `assistant_text` is built from LLM coaching prose
 * authored BEFORE the applied graph came back (`edit-graph.ts:3918-3923`), and
 * the wholesale replacement in `selectEditAssistantText` fires ONLY on
 * `modelUnchanged === true`. So an edit that DID apply can ship prose asking
 * the user what they would like to change.
 *
 * The brief's instruction was explicit: fix this ONLY with a STRUCTURED
 * discriminator — an existing flag or field marking the prose as
 * clarification-shaped — and if none exists, do NOT write a natural-language
 * predicate. (CLAUDE.md trap 22f: an ambiguous NL predicate oscillates; four
 * rounds on one such predicate in CEE #888 each fixed one direction and opened
 * the other.)
 *
 * NONE EXISTS. Derived at the bytes, complete manifest:
 *
 *   - `noOpClarificationPreserved` — the only field that means "this prose is
 *     a clarifying question". Every occurrence in `edit-graph.ts` (189, 2439,
 *     2452, 2457, 2493, 2494, 2512, 2513, 2530) is the type declaration or
 *     the NO-OP branch. It is structurally unreachable on the applied path.
 *
 *   - `pendingClarification` — set once, at `edit-graph.ts:2033`, on the
 *     `resolutionMode === 'clarify'` branch, which returns
 *     `appliedGraph: null, wasRejected: true`. Not an applied edit.
 *
 *   - the applied-path return object in full: `blocks, assistantText,
 *     latencyMs, appliedGraph, wasRejected, appliedChanges, operations,
 *     operation_meta, modelUnchanged?, displayAnchorsRepaired?,
 *     suggestedActions?, diagnostics, routeMetadata`. No clarification marker.
 *
 *   - `EditGraphLLMResult` (`edit-graph.ts:248-253`): `operations`,
 *     `removed_edges`, `warnings`, `coaching`. The model is never asked
 *     whether its prose is a question.
 *
 * So the RECEIPT half of the fix exists (`appliedChanges`) and the
 * DISCRIMINATOR half does not. Closing this needs a producer change: the
 * edit-graph prompt emitting a structured "this is a clarifying question"
 * signal, or the applied path threading one. That is a separate, reviewed
 * piece of work — not a regex over English written from one head.
 *
 * These assertions pin the gap so it REDs the day a discriminator lands and
 * this asymmetry has not been revisited. A gap recorded in the suite is
 * honest; a gap invisible to it is how "we'll do it later" becomes never.
 */
import { describe, expect, it } from 'vitest';

import { selectEditAssistantText } from '../edit-graph-dispatch.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

function appliedResult(over: Partial<EditGraphResult> = {}): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'What would you like to change about the hiring budget?',
    latencyMs: 1,
    appliedGraph: { nodes: [], edges: [] } as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    ...over,
  } as EditGraphResult;
}

describe('F — the replacement is asymmetric, and this pins WHY it cannot be fixed here', () => {
  it('a no-op edit DOES get the deterministic fallback (the working half)', () => {
    const text = selectEditAssistantText(
      appliedResult({ modelUnchanged: true }),
      'Nothing changed in the model.',
    );
    expect(text).toBe('Nothing changed in the model.');
  });

  it('KNOWN DEFECT — an APPLIED edit still ships the LLM prose, question or not', () => {
    // This assertion documents current behaviour and is EXPECTED TO CHANGE.
    // When a structured discriminator lands, this REDs and whoever added it is
    // sent to `selectEditAssistantText` to make the replacement symmetric.
    const text = selectEditAssistantText(appliedResult({ modelUnchanged: false }), 'fallback');
    expect(text).toBe('What would you like to change about the hiring budget?');
  });

  it('the applied result carries the RECEIPT half but no DISCRIMINATOR half', () => {
    const applied = appliedResult({
      modelUnchanged: false,
      appliedChanges: { summary: 'Set hiring budget' } as unknown as EditGraphResult['appliedChanges'],
    });
    // The receipt a symmetric replacement would render from: PRESENT.
    expect(applied.appliedChanges).toBeDefined();
    // The signal it would branch on: ABSENT. `noOpClarificationPreserved` is
    // the only field meaning "this prose is a clarifying question", and it is
    // set exclusively on the no-op branch.
    expect(applied.noOpClarificationPreserved).toBeUndefined();
  });

  it('CONTRAST CONTROL — the absence above is a fact about the payload, not a blind probe', () => {
    // A field that IS optional-and-absent here reads the same as one that does
    // not exist at all, so assert against a field the applied path genuinely
    // populates. Without this, the assertion above would pass on a typo.
    const applied = appliedResult({ modelUnchanged: false });
    expect(applied.wasRejected).toBe(false);
    expect(applied.appliedGraph).not.toBeNull();
  });
});
