/**
 * S7 — THE REPAIR CHIP MUST HAND THE USER TO WHERE THE VALUE IS SET.
 *
 * ## The gap, derived at the bytes (not inferred from the symptom)
 *
 * On the witnessed capture the chip click returned `blocks: []`. That is not a
 * composer oversight — it is structural, and it has two independent causes:
 *
 *   1. `edit-graph-dispatch.ts` builds `editGraphFact` ONLY when a mutation
 *      applied (`editGraphFact = effectiveAppliedMutation ? … : null`, and
 *      `handler_facts: editGraphFact ? [editGraphFact] : []`). The configure
 *      chip lands on the `not_honoured` branch, where nothing applied — so the
 *      turn commits with `handler_facts: []`.
 *   2. `compose.ts`'s directive ladder is driven entirely by that fact list, so
 *      with zero facts `tryEmitUiDirective` is never called and the row-7
 *      `buildDiscussedEntityUiDirective` fallback finds no card to read a
 *      target from.
 *
 * ⚠ THE CONSEQUENCE FOR THE OBVIOUS FIX, and it is why this builder is free
 * rather than a new `case` in `buildFocusInspectorDirective`: that switch's
 * `default:` arm returns null for `edit_graph` and the temptation is to give
 * `edit_graph` a directive class there. **It would be dead code.** There is no
 * `edit_graph` fact on this path for the switch to receive — the code path
 * would be live and the DATA could never reach it (CLAUDE.md trap 16-inverse).
 *
 * ## Why `open_inspector` at the OPTION, and not something else
 *
 * The value lives at `data/interventions/<factorId>` on the OPTION node — the
 * field CEE writes (`op: 'update_node'`) and the field the canvas edits, from
 * the option panel only. That derivation is not made here: it is already
 * carried, with its UI-tip evidence, by `buildConfigureOptionDirectSetSentence`,
 * whose prose this gesture now makes true by actually opening the panel it
 * names. `open_inspector` is the established verb for exactly this — it is what
 * `buildMutationInspectorDirective` emits at a mutated node.
 *
 * ## What this suite does NOT claim
 *
 * Nothing here is evidence about the wire. It pins CEE's emission only. Whether
 * the deployed UI honours `open_inspector` on an option target is a UI-side
 * claim, unverified by this lane and not asserted anywhere below.
 */

import { describe, it, expect } from 'vitest';

import { buildConfigureOptionRepairDirective } from '../ui-directive.js';

const OPTION_ID = 'opt_ai_rebuild';
const OPTION_LABEL = 'rebuild our product on an AI-native architecture';

/** A DIFFERENT entity that co-exists on the real graph — the decoy for trap 19. */
const FACTOR_ID = 'fac_cash_runway';

describe('buildConfigureOptionRepairDirective — the gesture the chip promised', () => {
  it('emits a ui_directive block', () => {
    const block = buildConfigureOptionRepairDirective(OPTION_ID, OPTION_LABEL);
    expect(block).not.toBeNull();
    expect(block?.type).toBe('ui_directive');
  });

  it('opens the inspector — the surface that edits the intervention', () => {
    expect(buildConfigureOptionRepairDirective(OPTION_ID, OPTION_LABEL)?.verb).toBe(
      'open_inspector',
    );
  });

  /**
   * ⭐ IDENTITY BINDING (CLAUDE.md trap 19). The target is asserted by ID, not
   * by "a target exists" or by kind alone — a factor target would satisfy both
   * of those while pointing the user at a panel that cannot set this value.
   */
  it('points at the OPTION by id, never the factor', () => {
    const block = buildConfigureOptionRepairDirective(OPTION_ID, OPTION_LABEL);
    expect(block?.targets).toHaveLength(1);
    expect(block?.targets[0]?.id).toBe(OPTION_ID);
    expect(block?.targets[0]?.id).not.toBe(FACTOR_ID);
    expect(block?.targets[0]?.kind).toBe('option');
    expect(block?.targets[0]?.label).toBe(OPTION_LABEL);
  });

  /**
   * `gate` — not `ladder`. This file's own doctrine draws the line: a LADDER
   * directive rides a handler fact (the user did something, the gesture follows
   * the result); a GATE directive rides something CEE answered deterministically
   * WITHOUT a fact. This path commits `handler_facts: []` by construction, so
   * stamping it `ladder` would tell every capture and every telemetry query that
   * a fact backed a gesture that no fact backs.
   */
  it('is stamped as a deterministic non-fact gesture', () => {
    expect(buildConfigureOptionRepairDirective(OPTION_ID, OPTION_LABEL)?.source).toBe('gate');
  });

  it.each([
    ['empty id', '', OPTION_LABEL],
    ['empty label', OPTION_ID, ''],
    ['whitespace id', '   ', OPTION_LABEL],
  ])('fails closed on %s — never points at nothing', (_name, id, label) => {
    expect(buildConfigureOptionRepairDirective(id, label)).toBeNull();
  });
});
