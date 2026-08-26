/**
 * S7 — THE REPAIR CHIP MUST HAND THE USER TO A SURFACE THAT CAN ACTUALLY SAVE.
 *
 * ## The gap, derived at the bytes (not inferred from the symptom)
 *
 * On the witnessed capture the chip click returned `blocks: []`. That is not a
 * composer oversight — it is structural, and it has two independent causes:
 *
 *   1. `edit-graph-dispatch.ts` builds `editGraphFact` ONLY when a mutation
 *      applied, so the `not_honoured` branch commits `handler_facts: []`.
 *   2. `compose.ts`'s directive ladder is driven entirely by that fact list, so
 *      with zero facts no row runs and the row-7 fallback finds no card.
 *
 * ⚠ THE OBVIOUS FIX IS DEAD CODE: a `case 'edit_graph'` in
 * `buildFocusInspectorDirective` could never fire, because no `edit_graph` fact
 * reaches that switch on this path (CLAUDE.md trap 16-inverse).
 *
 * ## ⭐⭐ WHY THE DESTINATION IS THE MODEL TAB AND NOT THE CANVAS
 *
 * This row's FIRST cut emitted `open_inspector` at the option node, on the
 * strength of `buildConfigureOptionDirectSetSentence`'s repo derivation that the
 * canvas option panel edits `data/interventions/<factorId>` and that
 * "intervention inputs MUST remain editable".
 *
 * **A live drive on 2026-08-25 refuted it.** The panel renders the intervention
 * row (`inspector-intervention-81ce2f8a`, pre-filled `0.7`) and `+ Add a change`
 * — and BOTH sit inside a `<fieldset disabled>` six ancestors up. A forced
 * native write moved the input visually and produced **zero wire calls**, with
 * no confirm affordance at any phase. The panel's own notice reads: *"This
 * inspector is read-only because these changes cannot yet be saved to the shared
 * model. Use the Model tab for supported factor values or ask Olumi to change
 * structure."* It is read-only **by policy**, so that gesture would have been an
 * honest panel telling the user it cannot help — a detour, not a destination.
 *
 * ⚠⚠ THE INSTRUMENT LESSON, and it is why the first cut looked safe:
 * **A PER-ELEMENT `disabled` CHECK IS NOT AN ENABLED CHECK.** Both controls
 * report `disabled: false` on themselves; only an actionability check sees the
 * ancestor `<fieldset disabled>`. A DOM snapshot would have called it editable.
 *
 * ## Why the SHIPPED builder, not a bespoke one
 *
 * `REMEDY_SECTION_BY_OPEN_ITEM_KIND` already maps `option_needs_encoding →
 * 'options'`, and `turn-executor.ts` already emits that gesture for this very
 * blocker on the advice-gate path. So this converges on the live builder rather
 * than minting a second spelling of one destination (trap 12).
 *
 * ## What this suite does NOT claim
 *
 * That `OptionsSection`'s rows WRITE is **not witnessed by this lane** — and the
 * lesson above is precisely why that is stated rather than assumed. If a drive
 * finds it read-only too, this gesture and the advice-gate one are the same
 * defect and re-point together.
 */

import { describe, it, expect } from 'vitest';

import {
  buildGateRemedySectionDirective,
  REMEDY_SECTION_BY_OPEN_ITEM_KIND,
} from '../ui-directive.js';

/**
 * ⭐ THE READINESS KIND THIS SEAM IS IN, pinned by name.
 *
 * `option_needs_encoding` is defined as "connected to factors but has no numeric
 * values set" — exactly the state `evaluateConfigureOptionOutcome` returns
 * `not_honoured` for. Binding the test to the KIND rather than to the string
 * `'options'` means a remap of the destination fails HERE, loudly, instead of
 * silently sending users somewhere new.
 */
const SEAM_KIND = 'option_needs_encoding' as const;

describe('the repair gesture converges on the shipped remedy surface', () => {
  it('PRECONDITION — this seam’s readiness kind maps to the options section', () => {
    // Pins the premise the whole row rests on. If this mapping is ever changed,
    // the dispatch's destination changed with it and that must not be silent.
    expect(REMEDY_SECTION_BY_OPEN_ITEM_KIND[SEAM_KIND]).toBe('options');
  });

  it('emits a ui_directive', () => {
    const block = buildGateRemedySectionDirective(SEAM_KIND);
    expect(block).not.toBeNull();
    expect(block?.type).toBe('ui_directive');
  });

  it('opens the Model tab’s options section', () => {
    const block = buildGateRemedySectionDirective(SEAM_KIND);
    expect(block?.verb).toBe('open_section');
    expect(block?.ui_target).toEqual({ kind: 'model_section', id: 'options' });
  });

  /**
   * A panel verb carries its target in `ui_target`, and `targets` is empty BY
   * CONTRACT. Asserted so a future change that started attaching a node target
   * — reintroducing the entity-pointing shape the drive just refuted — fails
   * here rather than shipping.
   */
  it('carries no entity target — the section is the claim, not a node', () => {
    expect(buildGateRemedySectionDirective(SEAM_KIND)?.targets).toEqual([]);
  });

  it('is stamped as a deterministic non-fact gesture', () => {
    expect(buildGateRemedySectionDirective(SEAM_KIND)?.source).toBe('gate');
  });

  /**
   * ⭐ DISCRIMINATING CONTROL. An unmapped kind must yield NO gesture, not a
   * default one — "opening the wrong section is worse than opening none",
   * because a gesture is an implicit claim the remedy lives there. Without this,
   * a builder that returned a fixed section for everything would pass every
   * assertion above.
   */
  it.each([
    ['goal_threshold_missing'],
    ['option_needs_mapping'],
    ['model_needs_review'],
  ] as const)('an unmapped kind (%s) emits nothing', (kind) => {
    expect(REMEDY_SECTION_BY_OPEN_ITEM_KIND[kind]).toBeNull();
    expect(buildGateRemedySectionDirective(kind)).toBeNull();
  });
});
