/**
 * THIN CORE STRUCTURE FEEDBACK (20 Oct 2026; failure class 3, "one meaning, several AI encodings"). PURE. The mapper's
 * verdict, read back as tool feedback inside the same SDK turn: the withheld items the AI can fix by re-expressing what the
 * model already holds, each with how. Never a missing-information reason: those are asks for the person, not restructures,
 * and the AI must never fill one in to pass this check.
 */
import type { LivingModelT } from '../../../schemas/living-model.js';
import { goalIdOf, type Mapped, type Withheld, type WithheldReason } from './mapper.js';

export interface StructureFix { readonly id: string; readonly reason: WithheldReason; readonly fix: string }

/** Every reason is decided here, so a new one cannot slip through unclassified. */
const RESTRUCTURABLE: Record<WithheldReason, boolean> = {
  // Structure, in the sub-cases `fixOf` names: an item points at something the calculation cannot read through.
  link_endpoint_unknown: true, setting_not_convertible: true,
  // Missing information: a target, level, sign, size or meaning only the person can give.
  no_level_target: false, goal_level_unknown: false, factor_level_unknown: false, change_base_not_theirs: false,
  change_kind_unknown: false, link_sign_unknown: false, link_range_no_law: false, link_frame_unknown: false,
  // The stated figures or units do not fit: rewriting a figure or a unit would change what was said.
  change_base_invalid: false, goal_level_not_admitted: false, current_unit_mismatch: false, link_unit_mismatch: false,
  // Not computed in this slice: re-reading it would change its meaning ("exactly" as "at least", a range as a point).
  aim_not_in_slice: false, exact_target_not_in_slice: false, target_range_not_in_slice: false, level_range_not_in_slice: false,
  exact_not_drawable: false, condition_not_in_slice: false,
  // Which option is carrying on as now is the person's to say; a withheld chance is reported through its causes.
  no_single_status_quo: false, chance_rests_on_withheld: false,
};

/** What the AI is told with the feedback: the same content, re-expressed, once. */
export const RESTRUCTURE_DETAIL = 'Nothing was saved or prepared. The items in feedback cannot reach the calculation as written, though '
  + 'their meaning is clear. Call this same tool again with the same content, re-expressed as each fix says. Never add or change a '
  + 'figure, a quote or who said it; on propose_change, name in `remove` any item you remove. That call is taken as it is.';

/** `saved`: what the saved model already withholds; a change is sent back only over what it writes, never an older encoding. */
export function structureFeedback(model: LivingModelT, mapped: Pick<Mapped, 'graph' | 'withheld'>, saved: readonly Withheld[] = []): StructureFix[] {
  const was = new Set(saved.map((w) => `${w.id}\u0000${w.reason}`));
  const options = new Set(model.options.map((o) => o.id));
  const factors = new Set(model.factors.map((f) => f.id));
  const known = new Set([...options, ...factors, ...model.aims.map((a) => a.id)]);
  const goal = goalIdOf(mapped.graph) ?? "the aim's id";
  const fixOf = (id: string, reason: WithheldReason): string | undefined => {
    if (reason === 'setting_not_convertible') {
      // Only a setting naming nothing in the model. A null level, a unit unlike the factor's or a factor with no level is
      // information; a setting of an aim is a level, and re-expressing it as an effect would need a new figure.
      const o = model.options.find((x) => x.settings.some((s) => `${x.id}:${s.factor_id}` === id && !known.has(s.factor_id)));
      return o === undefined ? undefined
        : `Option ${o.id} sets ${id.slice(o.id.length + 1)}, which is not an item in the model: name the factor it sets by that factor's id.`;
    }
    const l = model.links.find((x) => x.id === id);
    if (l === undefined) return undefined;
    const missing = [l.from, l.to].filter((x) => !known.has(x));
    if (missing.length > 0) return `Link ${l.id} names ${missing.join(' and ')}, which is not an item in the model: point it at the item it means, by that item's id.`;
    if (options.has(l.to)) return `Link ${l.id} runs into option ${l.to}, but nothing in the model causes an option: an option acts through its settings, or through a link from the option.`;
    // The served P04 shape. An option's link to the goal itself waits on the goal's own level, and a link touching another aim
    // on a later slice: both are written the right way already.
    if (options.has(l.from) && factors.has(l.to)) {
      return `Option ${l.from}'s effect is linked to factor ${l.to}, which the calculation cannot read: an option reaches the goal only through `
        + `a link from the option to the aim (${goal}) or through a setting (the level it sets a factor to). If ${l.to} restates the aim's own `
        + `quantity, link the option to ${goal} instead and remove ${l.to} and its links, keeping its level today as the aim's current; `
        + `if the person gave the level the option sets ${l.to} to, make that a setting.`;
    }
    return undefined;
  };
  return mapped.withheld.flatMap((w) => {
    const fix = RESTRUCTURABLE[w.reason] && !was.has(`${w.id}\u0000${w.reason}`) ? fixOf(w.id, w.reason) : undefined;
    return fix === undefined ? [] : [{ id: w.id, reason: w.reason, fix }];
  });
}
