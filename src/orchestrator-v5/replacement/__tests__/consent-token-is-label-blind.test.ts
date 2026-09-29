/**
 * ⭐⭐ THE CONSENT TOKEN IS LABEL-BLIND — so no operation here may rename.
 *
 * Flagged by the data layer while deriving something else, and it is the kind
 * of flag that is easy to nod at and forget: **`computeAnalysisAffectingGraphHash`
 * does not hash labels.** A user agrees to a change on "Annual Recurring
 * Revenue"; between the offer and the acceptance the node is relabelled; the
 * revision token does not move, the acceptance is honoured, and the user has
 * agreed to a sentence about a thing that is now called something else.
 *
 * ── WHY IT DOES NOT BITE TODAY, MEASURED ──────────────────────────────────
 * The op kinds this layer can emit are `add_node`, `add_edge` and
 * `update_node`. `update_node` is built by `buildOptionEffectRawOperation` and
 * targets `/nodes/<option>/data/interventions/<factor>` — an intervention leaf.
 * **Nothing here writes an existing node's label.** `add_node` carries a label,
 * but for a node that does not exist yet, and adding a node DOES move the hash.
 *
 * ⛔ SO THIS FILE IS A TRIPWIRE, NOT A FIX. The exposure is one operation away:
 * the moment this layer can rename, the consent model needs a second gate
 * keyed on the label (an `expected_label`-style assertion), because the
 * revision token will not notice. Pinning it here means that change cannot be
 * made quietly — it REDs, and whoever makes it has to have the conversation.
 *
 * ⚠ NOT ASSERTED: that the hash is label-blind. That is the data layer's
 * property and their measurement; restating it here would be a mirror of
 * someone else's fact (trap 12). What is asserted is the only thing this layer
 * controls — **what its own operations touch.**
 */
import { describe, expect, it } from 'vitest';

import { buildOptionEffectRawOperation } from '../../routing/option-effect-write.js';

describe('no operation this layer emits can rename an existing node', () => {
  it('the option-effect write targets an intervention leaf and carries no label', () => {
    const op = buildOptionEffectRawOperation({
      optionId: 'opt-expand',
      optionLabel: 'Expand Outbound Sales',
      factorId: 'f-arr',
      factorLabel: 'Annual Recurring Revenue',
      value: 0.4,
    }) as { op: string; path: string; value: Record<string, unknown> };

    // ⚠ POSITIVE CONTROL: the builder must have produced a real operation, or
    // every assertion below passes by inspecting undefined (trap 13).
    expect(op, 'the builder must emit an operation at all').toBeTruthy();
    expect(op.op).toBe('update_node');

    // The path decides what is written. An intervention leaf cannot rename.
    expect(op.path).toContain('/interventions/');
    expect(op.path).not.toContain('label');

    // ⭐ AND THE VALUE, because a path can be innocent while the payload is
    // not: `update_node`'s value is a RECORD OF UPDATES at the applier, so a
    // `label` key here would rename regardless of how the path reads.
    expect(Object.keys(op.value)).not.toContain('label');

    // ⚠ REFINED AFTER MEASURING, because my first version of this assertion
    // was too broad and FAILED — correctly. The label DOES appear in the
    // operation, in `rationale`:
    //   "Sets the effect value the user gave for Expand Outbound Sales on
    //    Annual Recurring Revenue."
    // That is human-readable prose explaining the change, and prose renames
    // nothing. The distinction that matters is **prose versus payload**: only
    // `path` and `value` are read by the applier, so only those can mutate a
    // label. Asserting over the whole serialised op conflated the two and
    // would have made this guard impossible to keep green for a correct
    // operation.
    const written = { path: op.path, value: op.value };
    expect(JSON.stringify(written)).not.toContain('Annual Recurring Revenue');
    expect(JSON.stringify(written)).not.toContain('Expand Outbound Sales');
  });

  /**
   * ⭐ THE DISCRIMINATING TWIN. Without it, the assertions above could pass
   * because the builder emits something inert, or because the serialisation
   * check can never find anything. This proves the same check WOULD catch a
   * label if one were present — so its silence above is a finding, not
   * blindness.
   */
  it('the same checks DO fire on an operation that carries a label', () => {
    const renameShaped = {
      op: 'update_node',
      path: '/nodes/f-arr/label',
      value: { label: 'Annual Recurring Revenue' },
    };

    expect(renameShaped.path).toContain('label');
    expect(Object.keys(renameShaped.value)).toContain('label');
    // The same prose-versus-payload check that stays silent above must FIRE
    // here, or its silence proves nothing.
    const written = { path: renameShaped.path, value: renameShaped.value };
    expect(JSON.stringify(written)).toContain('Annual Recurring Revenue');
  });
});
