/**
 * `ObservedStateV3.source` is DERIVED from the shared contract, not mirrored.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 * Until 0.40.0 this enum was a hand-copied 7-literal list, and the file's own
 * comment named the UI's `SOURCE_CLASSES` as "the acknowledged cross-repo
 * source" — i.e. it documented itself as a mirror of a list living in another
 * repository. That is CLAUDE.md trap 12 exactly: the drift is silent and reads
 * green. 0.40.0 minted `OBSERVED_STATE_SOURCE_LITERALS` as the single owner and
 * instructs consumers to derive from it.
 *
 * ⚠ DERIVATION PROVES AGREEMENT AND CAN NEVER PROVE COMPLETENESS (trap 12d).
 * A guard derived from the canonical list is structurally blind to a literal
 * MISSING from that list — delete a member upstream and a purely derived guard
 * stays green. So this file ships BOTH kinds:
 *
 *   1. the DERIVED set-equality assertion (nothing drifts from the owner), and
 *   2. a HAND-WRITTEN corpus of literals this estate is known to write, which
 *      is the only thing that can notice the canonical list is SHORT.
 *
 * Neither supersedes the other and dropping either loses a whole defect class.
 */

import { describe, expect, it } from 'vitest';
import { OBSERVED_STATE_SOURCE_LITERALS } from '@talchain/schemas';

import { GraphV3, ObservedStateV3 } from '../cee-v3.js';

/** Build a minimal graph carrying one factor with the given `source`. */
function graphWithSource(source: string): unknown {
  return {
    nodes: [
      {
        id: 'fac_churn',
        label: 'Churn risk after a price rise',
        kind: 'factor',
        observed_state: { value: 0.85, source },
      },
    ],
    edges: [],
  };
}

describe('ObservedStateV3.source — derived from the shared contract', () => {
  it('accepts EXACTLY the canonical vocabulary — set equality, so drift fails loud in BOTH directions', () => {
    // Derived on both sides: every canonical literal must parse, and no literal
    // outside the canonical list may. A one-directional check ("all canonical
    // literals parse") would stay green if CEE silently accepted extras.
    const accepted = OBSERVED_STATE_SOURCE_LITERALS.filter(
      (literal) => ObservedStateV3.safeParse({ value: 0.5, source: literal }).success,
    );
    expect([...accepted].sort()).toEqual([...OBSERVED_STATE_SOURCE_LITERALS].sort());

    // The complement direction: a literal the contract does NOT declare is
    // refused. Without this the enum could have been replaced by z.string()
    // and every assertion above would still pass.
    const notDeclared = 'totally_invented_source';
    expect((OBSERVED_STATE_SOURCE_LITERALS as readonly string[])).not.toContain(notDeclared);
    expect(ObservedStateV3.safeParse({ value: 0.5, source: notDeclared }).success).toBe(false);
  });

  it('HAND-WRITTEN corpus (trap 12d) — every literal this estate is known to write is in the canonical list', () => {
    // NOT derived from the contract, deliberately. This is the only guard that
    // can see the canonical list being SHORT. Each member is here because a
    // named writer in this estate emits it; a canonical list that loses one
    // must RED here even though the derived assertion above would stay green.
    //
    //   user_override      CEE set_factor_value / chat edits (canonicalise-value-ops.ts:316)
    //   brief_extraction   CEE brief extraction; read by money-invariant.ts + graph-normalizer.ts
    //   cee_inference      CEE's own inference writer
    //   user_confirmed     UI "confirm as is"
    //   user               UI Model-tab factor-value edit
    //   user_edited        UI OutputsDock transition bridge
    //   user_assumption    UI reserved "mark as assumption"
    //   user_calibration   UI inspector calibration
    //   explicit           extraction-type sibling carried by UI SOURCE_CLASSES
    //   inferred           model-estimate sibling carried by UI SOURCE_CLASSES
    //   cee_repair         CEE repair writer, carried by UI SOURCE_CLASSES
    //   panel_elicited     0.40.0 — CEE's verified panel apply (this slice)
    const KNOWN_WRITTEN_LITERALS = [
      'user_override',
      'brief_extraction',
      'cee_inference',
      'user_confirmed',
      'user',
      'user_edited',
      'user_assumption',
      'user_calibration',
      'explicit',
      'inferred',
      'cee_repair',
      'panel_elicited',
    ] as const;

    for (const literal of KNOWN_WRITTEN_LITERALS) {
      expect(
        (OBSERVED_STATE_SOURCE_LITERALS as readonly string[]).includes(literal),
        `"${literal}" is written by a named writer in this estate but is absent from ` +
          `OBSERVED_STATE_SOURCE_LITERALS — the canonical list is SHORT, and a derived ` +
          `guard cannot see that.`,
      ).toBe(true);
      expect(ObservedStateV3.safeParse({ value: 0.5, source: literal }).success).toBe(true);
    }
  });

  it('panel_elicited survives the WHOLE-GRAPH parse — the exact call that gated the stamp', () => {
    // Binding this to `GraphV3`, not just `ObservedStateV3`, is the point:
    // `system-events/factor-value-edit.ts` runs `GraphV3.safeParse(mergedGraph)`
    // on the POST-stamp graph and, on failure, refuses with 'merged_graph_invalid'
    // ("I couldn't save that change"). Asserting only the leaf schema would pass
    // while the real call site still refused.
    const parsed = GraphV3.safeParse(graphWithSource('panel_elicited'));
    expect(parsed.success).toBe(true);

    // POSITIVE CONTROL for the assertion above: the same call refuses a source
    // outside the vocabulary, so a green result is evidence the parse ran and
    // discriminated — not that the schema stopped checking.
    expect(GraphV3.safeParse(graphWithSource('totally_invented_source')).success).toBe(false);
  });

  it('elicited_from rides through the parse intact — passthrough, ids only', () => {
    // `ObservedStateV3` is `.passthrough()`, so the typed ref survives without
    // CEE declaring it. Pinned because the stamp is worthless if the field is
    // dropped between the handler write and the persisted bytes.
    const elicitedFrom = {
      round_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      participant_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    };
    const parsed = GraphV3.safeParse({
      nodes: [
        {
          id: 'fac_churn',
          label: 'Churn risk after a price rise',
          kind: 'factor',
          observed_state: { value: 0.85, source: 'panel_elicited', elicited_from: elicitedFrom },
        },
      ],
      edges: [],
    });
    expect(parsed.success).toBe(true);
    const node = parsed.success ? parsed.data.nodes[0] : undefined;
    expect((node?.observed_state as { elicited_from?: unknown } | undefined)?.elicited_from).toEqual(
      elicitedFrom,
    );
  });
});
