import type { GuidanceSignals } from './types.js';

/** The ROW's subject (copy + cooldown key): the licensed leader, else the user's pick, else the single user option. */
export function planOf(s: GuidanceSignals): string | undefined {
  const options = s['model.non_sq_option_ids'] ?? [];
  if (s['run.leader_licensed'] === true && s['run.leader_option_id']) return s['run.leader_option_id'];
  const pick = s['user.selected_option_id'];
  if (pick && options.includes(pick)) return pick;
  return options.length === 1 ? options[0] : undefined;
}

/**
 * The plan an asked pre-mortem METHOD stresses: the licensed leader, else the user's explicit pick. Only an explicit
 * worksheet press gives the pick precedence. Never auto-named
 * (PTL 5933036532 #5): with neither, a generic multi-option press stresses the decision; otherwise ask which option.
 */
export function methodPlanOf(s: GuidanceSignals): string | undefined {
  const pick = s['user.selected_option_id'];
  if (isPremortemWorksheetPress(s['user.premortem_worksheet_press_id'])) {
    return pick && (s['model.non_sq_option_ids'] ?? []).includes(pick) ? pick : undefined;
  }
  if (s['run.leader_licensed'] === true && s['run.leader_option_id']) return s['run.leader_option_id'];
  return pick && (s['model.non_sq_option_ids'] ?? []).includes(pick) ? pick : undefined;
}

/** A worksheet press is explicit and has exactly the option chip's 12-hex hash shape. */
export function isPremortemWorksheetPress(chipId: unknown): chipId is string {
  return typeof chipId === 'string' && /^agent-premortem-plan:[a-f0-9]{12}$/u.test(chipId);
}

/** A generic press can stress the decision without selecting any of the user's own options. */
export function isDecisionPlan(s: GuidanceSignals): boolean {
  return s['user.generic_method_press'] !== false
    && s['run.leader_licensed'] === false
    && s['user.selected_option_id'] == null
    && (s['model.non_sq_option_ids'] ?? []).length >= 2;
}
