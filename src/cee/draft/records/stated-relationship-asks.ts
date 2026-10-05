/**
 * ⭐ #2576 item E (DL product test: NEVER A SILENT DROP): a relationship the USER stated that the compile could not use
 * is no longer counted as Olumi's (item A, `model-building-notices.ts`), so it must reach the user another way. This
 * asks it, in `open_questions` — the carrier DGAI already shows verbatim (`_agent.open_questions`, the reply's status
 * line) — naming the user's own words and the typed reason in plain words, with one question or one edit.
 *
 * Exactly the rows item A leaves out of the notice count: a stated-item row (`claim_kind: "stated_item"`) whose reason
 * maps to `relationship_not_used`. Rows the compiler's own ask already raises (`completion.ts`: a stated limit's
 * unresolved reference, `illegal_shape`) are not asked twice. One question per stated item, in the items' order.
 */
import { NOTICE_KIND_BY_REASON } from "./model-building-notices.js";
import { STATED_ITEM_DROP_KIND, type DroppedRecordRef } from "./projector.js";

type Reason = DroppedRecordRef["reason"];

/** Already asked by `enumerateCompletionAsk` for a stated row (constraint_target_unbindable / illegal_shape). */
const ASKED_BY_THE_COMPILER: ReadonlySet<Reason> = new Set<Reason>([
  "unparseable_ref", "ref_out_of_range", "ref_target_not_a_node", "missing_ref", "ambiguous_ref", "ref_kind_illegal",
]);

const SAY: Readonly<Partial<Record<Reason, (q: string) => string>>> = {
  user_stated_no_effect: (q) => `You said "${q}", so the model has no link between them. If you're not sure, add the link back to see how much it would matter.`,
  no_effect_with_amount: (q) => `"${q}" says it makes no difference but also gives a size, so the model uses neither yet. Which did you mean?`,
  range_bounds_inverted: (q) => `"${q}": the low end of the range is above the high end, so the model doesn't use that size yet. What range did you mean?`,
  range_excludes_point: (q) => `"${q}": the figure sits outside the range you gave, so the model doesn't use that size yet. Which figure did you mean?`,
  range_straddles_zero: (q) => `"${q}": the range runs from a fall to a rise, so the model can't tell which way it goes. Which way does it go?`,
  relationship_unsized: (q) => `You said "${q}", but not by how much, so the model doesn't use a size from it yet. Roughly how much does it change?`,
  quantity_unit_undeclared: (q) => UNIT(q), unit_not_evidenced: (q) => UNIT(q), unit_period_ambiguous: (q) => UNIT(q),
  unit_literal_contradicts_unit: (q) => UNIT(q), unit_restated_conflict: (q) => UNIT(q),
  literal_absent: (q) => FIGURE(q), literal_ambiguous: (q) => FIGURE(q), literal_not_whole_amount: (q) => FIGURE(q),
  literal_value_mismatch: (q) => FIGURE(q), span_and_literal_both: (q) => FIGURE(q), value_scale_restated_conflict: (q) => FIGURE(q),
  quantity_declaration_mismatch: (q) => FIGURE(q), option_value_unbound: (q) => FIGURE(q),
  relationship_endpoint_missing: (q) => ENDPOINT(q), relationship_endpoint_ambiguous: (q) => ENDPOINT(q),
  relationship_endpoint_illegal: (q) => ENDPOINT(q), lever_endpoint_ambiguous: (q) => ENDPOINT(q),
  self_loop: (q) => ENDPOINT(q), endpoint_demoted_duplicate: (q) => ENDPOINT(q),
  relationship_sign_conflicts_with_link: (q) => `"${q}": that runs the other way from the link in the model, so your figure isn't used yet. Which way does it go?`,
  effect_detail_conflicts_with_relationship: (q) => `"${q}": that runs the other way from the link in the model, so your figure isn't used yet. Which way does it go?`,
  option_lever_undeclared: (q) => `"${q}": Olumi couldn't tell what this option sets, so its figure isn't used yet. Which factor does it change, and to what?`,
  option_lever_link_conflict: (q) => `"${q}": the level you gave differs from the one the model links to this option, so it isn't used yet. Which level did you mean?`,
  option_lever_is_goal: (q) => `"${q}" sets your goal's own figure directly, so the model can't compare it with your other options. What does it change that moves the goal?`,
  option_change_by_baseline_unknown: (q) => BASELINE(q), option_change_by_baseline_unbound: (q) => BASELINE(q),
};
function UNIT(q: string): string { return `"${q}": Olumi couldn't tell what unit its figure is in, so the model doesn't use it yet. What unit is it?`; }
function FIGURE(q: string): string { return `"${q}": Olumi couldn't read the figure from your words, so the model doesn't use it yet. What figure did you mean?`; }
function ENDPOINT(q: string): string { return `"${q}": Olumi couldn't tell which two parts of the model this connects, so it isn't in the model yet. What does it change?`; }
function BASELINE(q: string): string { return `"${q}" changes something by an amount, but its current level isn't known, so no new level was set. What is it today?`; }
const GENERIC = (q: string): string => `"${q}": the model couldn't use this as written yet. What did you mean by it?`;

/** The user's own relationships item A leaves out of the Olumi-attributed count, each asked once, in plain words. */
export function statedRelationshipQuestions(dropped: readonly DroppedRecordRef[]): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const d of dropped) {
    if (d.claim_kind !== STATED_ITEM_DROP_KIND || NOTICE_KIND_BY_REASON[d.reason] !== "relationship_not_used") continue;
    if (ASKED_BY_THE_COMPILER.has(d.reason) || d.label.trim() === "") continue;
    const key = d.stated_index ?? -1 - out.length;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push((SAY[d.reason] ?? GENERIC)(d.label.trim()));
  }
  return out;
}
