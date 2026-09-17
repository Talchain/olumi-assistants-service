/**
 * ⭐⭐⭐ WE SHOW THE MODEL FIELDS IT IS NOT ALLOWED TO SET, AND THE PROMPT TELLS IT
 * TO MIRROR THEM.
 *
 * Three facts, each verified at the bytes, which only bite together:
 *
 *   1. The served `edit_graph` prompt says *"Mirror the nearest comparable
 *      existing node shape"* and names `provenance` / `raw_value`
 *      (hash-verified served prompt `40b79180ad739011`, Core, 17 Sep).
 *   2. `CompactNode` — what the model is SHOWN — declares `raw_value`, `source`
 *      and `provenance` (`graph-compact.ts:92-122`).
 *   3. `PIPELINE_OWNED_ROOTS` refuses all three **at every path segment**
 *      (`field-safety.ts:253`), so a mirrored edit is rejected.
 *
 * ⇒ The product shows a field, instructs imitation, and then refuses the result.
 * The user sees *"I couldn't take that change forward, so the model is
 * unchanged."* That is a self-inflicted dead end, not a model failure.
 *
 * ⚠ `budget.ts` DOES strip `source` — in `trimCompactNodeTier3`, reached only by
 * pass 3, which runs **only when the graph is still over budget**
 * (`budget.ts:319-329`). So the contradiction is the ORDINARY path and the
 * relief is the exceptional one, which is exactly backwards. ⭐ It also means
 * the product ALREADY ships behaviour where these fields are absent from the
 * model's view — under load, in production — so removing them is not a leap
 * into the unknown. That is the strongest argument available for the fix and it
 * is why this guard is worth having before the fix rather than after.
 *
 * ⛔ THIS FILE CHANGES NO BEHAVIOUR. It is a DERIVED guard: it computes the
 * intersection from the two live sources rather than restating either, so it
 * cannot go stale the way a hand-copied list would (trap 12). It REDs if the
 * overlap GROWS — a new refused field reaching the model — or SHRINKS, which
 * means someone fixed it and this note is the stale one.
 */
import { describe, expect, it } from 'vitest';

import { PIPELINE_OWNED_ROOTS } from '../../../orchestrator-v5/graph-management/field-safety.js';
import { compactGraph } from '../graph-compact.js';

/** Keys the compaction actually emits, derived — never hand-listed. */
function emittedNodeKeys(): Set<string> {
  const graph = {
    nodes: [
      {
        id: 'n1',
        kind: 'factor',
        label: 'Tech Lead Hiring Cost',
        category: 'observable',
        observed_state: { value: 0.8, raw_value: 80000, unit: '£', source: 'cee_inference' },
      },
      {
        id: 'n2',
        kind: 'option',
        label: 'Hire a Tech Lead',
        category: 'controllable',
        interventions: { n1: 0.8 },
      },
      { id: 'n3', kind: 'goal', label: 'Increase Productivity', category: 'observable' },
    ],
    edges: [{ from: 'n1', to: 'n3', effect_direction: 'negative' }],
  } as unknown as Parameters<typeof compactGraph>[0];
  const keys = new Set<string>();
  for (const node of compactGraph(graph).nodes) {
    for (const k of Object.keys(node as unknown as Record<string, unknown>)) keys.add(k.toLowerCase());
  }
  return keys;
}

/**
 * ⛔ THE EXACT KNOWN OVERLAP. Every field the model is shown that its own
 * referee will refuse. Adding a row means a new self-inflicted dead end; removing
 * one without editing this line means the fix landed and the note went stale.
 */
const KNOWN_SHOWN_BUT_UNSETTABLE: readonly string[] = ['provenance', 'raw_value', 'source'];
// ⚠ I first wrote this as two entries, from reading `CompactNode`'s declaration.
// The derivation returned THREE on its first run — `provenance` is emitted too.
// That is the guard earning its place before it ever shipped: a hand-written
// list of what we show the model was wrong the moment it was written, which is
// precisely why this file computes the set instead of restating it.

describe('the model is not shown fields its referee refuses', () => {
  it('PRECONDITION: both sources are non-empty, so the intersection means something', () => {
    // An intersection of an empty set with anything is empty and proves nothing.
    // This estate has shipped exactly that vacuity, so the guard asserts its own
    // inputs before asserting anything about their overlap.
    expect(PIPELINE_OWNED_ROOTS.size, 'refused segments').toBeGreaterThan(5);
    expect(emittedNodeKeys().size, 'keys the compaction emits').toBeGreaterThan(5);
  });

  it('THE EXACT OVERLAP — REDs if it grows OR shrinks', () => {
    const shown = emittedNodeKeys();
    const overlap = [...shown].filter((k) => PIPELINE_OWNED_ROOTS.has(k)).sort();
    expect(
      overlap,
      'fields shown to the model that field-safety will refuse it from setting — ' +
        'the prompt tells it to mirror comparable nodes, so this overlap is an instruction to fail',
    ).toEqual([...KNOWN_SHOWN_BUT_UNSETTABLE].sort());
  });

  it('and the relief path already exists — it is just gated on token pressure', () => {
    // `trimCompactNodeTier3` deletes `source`, but only on pass 3. The product
    // therefore already runs, in production, with this field absent from the
    // model's view. Pinned because it is the evidence that unconditional removal
    // is safe, and because it is the thing a reader would otherwise have to
    // re-derive from `budget.ts` to evaluate the fix.
    expect(PIPELINE_OWNED_ROOTS.has('source'), 'refused by the referee').toBe(true);
    expect(emittedNodeKeys().has('source'), 'and shown to the model on the ordinary path').toBe(true);
  });
});
