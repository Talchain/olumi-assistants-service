/**
 * ⛔ AN OPTION SETS WHAT THE USER CHOSE, NOT A LIMITED TOTAL ITS OWN LEVERS ALREADY MOVE (AIQ #75 5902306402; MG
 * successor #75 5902260283 / 5902277663; DL 5902321589 (b)).
 *
 * Served, two journeys, one shape:
 *   · E (lock `f95ea20` rep1/rep3): every hiring option set `annual_salary_spend` at an Olumi total AND set the
 *     headcount linked into it, so the user's "£120k a year each" had no place and was never held (PJ-E-FIG).
 *   · A (`1f9d769` reps 1–2, R3 5902268039): the retention option pinned churn at Olumi's 2.5% while its own lever →
 *     churn link was a placeholder, so the churn limit scored it P = 1 on Olumi's own level (AIQ: NOT earned).
 * In both, the node carries a USER LIMIT, and the limit's verdict rested on a level Olumi pinned instead of on the
 * option's own levers. The level is dropped; the node then follows from those levers (sized links are Olumi's disclosed
 * estimate; a placeholder falls to R-c's per-option withhold and its ask).
 *
 * NARROW ON PURPOSE (0-LLM corpus, R3 `wires-spike-97`): the unrestricted rule hit 54 non-E option levels, e.g. an option
 * that funds a release AND sets "New feature rollout" = 1. Only a node a user limit names is touched; a level the user
 * stated (`explicit`) is never dropped; a lever must be an intervention with a level on the SAME option. Pure.
 */

export interface OptionLevelOverOwnLevers {
  readonly option: string;
  readonly factor: string;
  readonly value: number;
  /** The option's own levers whose links reach `factor`. */
  readonly via: readonly string[];
}

interface Intervention { readonly factor_label: string; readonly value: number; readonly provenance: string }
interface ModelShape {
  readonly options: readonly { readonly label: string; readonly interventions?: readonly Intervention[] }[];
  readonly links?: readonly { readonly from: string; readonly to: string }[];
  readonly constraints?: readonly { readonly metric: string }[];
}

const key = (s: string): string => s.trim().toLowerCase();

export function dropOptionLevelsOverOwnLevers<M extends ModelShape>(model: M): { model: M; dropped: OptionLevelOverOwnLevers[] } {
  const limited = new Set((model.constraints ?? []).map((c) => key(c.metric)));
  if (limited.size === 0) return { model, dropped: [] };
  const parents = new Map<string, Set<string>>();
  for (const l of model.links ?? []) parents.set(key(l.to), (parents.get(key(l.to)) ?? new Set()).add(key(l.from)));
  const upstreamOf = (t: string): Set<string> => {
    const out = new Set<string>();
    const queue = [t];
    while (queue.length > 0) {
      for (const p of parents.get(queue.shift()!) ?? []) if (!out.has(p) && p !== t) { out.add(p); queue.push(p); }
    }
    return out;
  };
  const dropped: OptionLevelOverOwnLevers[] = [];
  const options = model.options.map((o) => {
    const ivs = o.interventions ?? [];
    const drop = new Set<Intervention>();
    for (const iv of ivs) {
      if (iv.provenance === 'explicit' || !limited.has(key(iv.factor_label))) continue;
      const up = upstreamOf(key(iv.factor_label));
      const via = ivs.filter((p) => p !== iv && up.has(key(p.factor_label))).map((p) => p.factor_label);
      if (via.length === 0) continue;
      drop.add(iv);
      dropped.push({ option: o.label, factor: iv.factor_label, value: iv.value, via });
    }
    return drop.size === 0 ? o : { ...o, interventions: ivs.filter((iv) => !drop.has(iv)) };
  });
  return dropped.length === 0 ? { model, dropped } : { model: { ...model, options } as M, dropped };
}
