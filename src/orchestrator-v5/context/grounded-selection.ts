/**
 * `_grounded_selection` — the WIRE half of selection-aware answering (hop 4b).
 *
 * WHAT QUESTION THIS FIELD ANSWERS, and it is the only one it answers:
 *
 *   > Which model elements was THIS turn's answer grounded on?
 *
 * It is a producer-side fact about the answer's CONTEXT: the elements CEE
 * placed in the routing prompt's `focus` section (`ContextPack.focus`, see
 * `projectFocus`). It is deliberately NOT a claim that the answer's TEXT
 * mentions each one — no code here reads the model's output, and pretending
 * otherwise would be exactly the guarantee-theatre this estate hunts.
 *
 * ⭐ ONE AUTHORITY. `ContextPack.focus` already decides what the answer was
 * grounded on: which elements resolved, which were dropped by the element cap,
 * and — the load-bearing part — WHY anything is missing (`unresolved`). This
 * module RE-PROJECTS that decision for the wire; it never re-derives it. A
 * second derivation would be a second authority on what the user selected, and
 * the two would disagree the first time a graph read degrades (CLAUDE.md trap
 * #21: two questions under one name).
 *
 * ⚠ WHY THE IDS COME FROM `TurnSelection` AND NOT FROM `focus.elements`.
 * `projectFocus` runs every string through `boundText` before it reaches an
 * LLM prompt — including the id, at `FOCUS_ID_MAX_CHARS`. A bounded id carries
 * an ellipsis and therefore matches NO node on the canvas, so a consumer given
 * `focus.elements[].id` would silently highlight nothing on exactly the inputs
 * the bound exists to defend against. The wire needs the CANONICAL id, so the
 * ids are read from `selection.elements` — the same objects `projectFocus`
 * mapped, before its prompt-safety bounding. `focus.elements.length` is what
 * ties the two: it IS the element cap as it actually applied on this turn, so
 * the wire set is the prompt set and nothing recomputes the cap.
 *
 * ⚠ NOT A SCHEMA FIELD AT `@talchain/schemas` 0.40.0. `OlumiResponseSchema` is
 * `.strict()`, so an undeclared top-level key fails egress validation and drops
 * the whole turn to the typed fallback envelope. This rides as an
 * underscore-prefixed PRODUCT sidecar — stripped before validation, re-attached
 * after — the same mechanic and the same class as `_reasoning` (ROADMAP 1.42)
 * and `_answer_shape` (ROADMAP 1.132), both of which are documented as
 * "pending formalisation as a named field on the shared contract". The UI's
 * `responseParser` demotes any undeclared root key into its `__additive__`
 * sidecar, which is where the consumer reads it.
 */
import type { ContextPackFocus } from './context-pack-assembler.js';
import type { TurnSelection } from '../build-turn-context.js';

/**
 * The wire shape. Two fields, and the second one is the reason this is not
 * simply an array of ids.
 */
export interface GroundedSelection {
  /**
   * The canonical canvas ids of the elements the answer was grounded on, in
   * the order the turn requested them. EMPTY is meaningful and honest: the
   * turn pointed at something, and nothing resolvable came back — read
   * `unresolved` to learn why.
   */
  readonly element_ids: readonly string[];
  /**
   * Why anything is missing — a CLOSED ENUM, copied verbatim from
   * `ContextPack.focus.unresolved`, never re-derived.
   *
   * ⭐ `not_in_model` and `could_not_check` MUST NOT COLLAPSE, and this field
   * exists on the wire precisely so the UI cannot collapse them at the pixel
   * layer. `not_in_model` = the graph was read and does not contain it (it is
   * honest to show nothing). `could_not_check` = the graph could not be read,
   * so we do not KNOW whether it is there — a consumer that renders that as
   * "not found" reintroduces the conflation hop 3 and hop 4 spent their whole
   * design keeping apart.
   */
  readonly unresolved: ContextPackFocus['unresolved'];
}

/**
 * Project the turn's grounded focus onto the wire.
 *
 * ⚠ RETURNS `null` — key ABSENT, never `_grounded_selection: null` — whenever
 * this turn's answer was not grounded on a selection. Absence keeps every
 * pre-hop-4b turn byte-identical on the wire, which is the property the
 * inertness test pins.
 *
 * @param focus     `ContextPack.focus` as it was assembled for THIS turn's
 *                  routing prompt, or `undefined` when the pack carried none.
 *                  This is the gate: no focus ⇒ nothing was grounded ⇒ null.
 * @param selection The resolved selection the focus was projected from, used
 *                  ONLY as the source of canonical ids (see the file header).
 */
export function projectGroundedSelection(
  focus: ContextPackFocus | undefined,
  selection: TurnSelection | undefined,
): GroundedSelection | null {
  // The pack's focus is the single authority on whether this turn was
  // grounded. `projectFocus` already returned null for "no selection" and for
  // "an empty selection", so there is no second emptiness rule here.
  if (focus === undefined) return null;
  // Defensive, and it fails CLOSED: the focus cannot exist without the
  // selection it was projected from, but if a future caller ever passes one
  // without the other we emit no ids rather than a set we cannot vouch for.
  const groundedElements = selection === undefined
    ? []
    : selection.elements.slice(0, focus.elements.length);
  return {
    element_ids: groundedElements.map((element) => element.id),
    unresolved: focus.unresolved,
  };
}
