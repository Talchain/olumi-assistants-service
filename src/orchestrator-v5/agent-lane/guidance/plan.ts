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
 * The plan an asked pre-mortem METHOD stresses: the licensed leader, else the user's explicit pick. Never auto-named
 * (PTL 5933036532 #5): with neither, the method asks which option to stress-test (choose_plan).
 */
export function methodPlanOf(s: GuidanceSignals): string | undefined {
  if (s['run.leader_licensed'] === true && s['run.leader_option_id']) return s['run.leader_option_id'];
  const pick = s['user.selected_option_id'];
  return pick && (s['model.non_sq_option_ids'] ?? []).includes(pick) ? pick : undefined;
}
