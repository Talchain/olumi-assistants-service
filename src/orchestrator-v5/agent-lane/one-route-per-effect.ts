/**
 * ⛔ ONE EFFECT, ONE ROUTE — A RISK THAT ONLY RE-DRAWS ITS FACTOR'S OWN DIRECT LINK IS NOT A SECOND ROUTE FOR THAT
 * FACTOR (PR Review CHANGES_REQUIRED on #2276 @ df299ae5; AI Quality 5883228443).
 *
 * Measured on the saved 7×3 drafts (arm lsF, A-0): `Pro plan price → Price sensitivity (+)`,
 * `Price sensitivity → New Pro subscribers (−)` AND `Pro plan price → New Pro subscribers (−)`. The price's effect on
 * new subscribers is drawn twice, the same way, so the engine counts it twice. The shape is not #2276's alone: base
 * (Baseline v1) carries it on 3/21 drafts, and a prompt sentence naming it traded it for other regressions (arm lsG:
 * a refusal, AIQ row 1 62 → 56, risks 21 → 18). So it is closed here, deterministically, on the exact shape:
 *
 *   a MACHINE-AUTHORED link factor L → risk R is left out when EVERY link leaving R points at a quantity X that L
 *   already links to straight, with the same overall sign (sign(L→R) × sign(R→X) = sign(L→X)).
 *
 * Only that one link goes. The risk stays in the model with its own links, so the uncertainty it names is still shown
 * and still reaches the goal (the validator's EXEMPT_UNREACHABLE_OUTCOME_RISK: a risk with no controllable path is
 * information, not an error); it simply no longer moves with L, whose effect on X is already the direct link.
 * NOT folded: a user-stated link (their claim about their own decision, as `foldedShortcutPairs` above it); a risk
 * with ANY link to a quantity L does not reach straight (its other effect is its own); a tempering risk whose route
 * runs AGAINST the direct link (hires → capacity, hires → ramp-up risk → capacity −: a real, separate downside).
 * Every fold is said in the ledger. Pure.
 */
import type { RepairEntry } from '@talchain/schemas';

export interface RouteEdge {
  readonly from: string;
  readonly to: string;
  readonly effect_direction?: string;
  readonly provenance?: { readonly source?: unknown };
}

const signOf = (e: RouteEdge): number =>
  e.effect_direction === 'negative' ? -1 : e.effect_direction === 'positive' ? 1 : 0;

export function oneRoutePerEffect<E extends RouteEdge>(
  edges: readonly E[],
  kindById: ReadonlyMap<string, unknown>,
  labelById: ReadonlyMap<string, unknown>,
  userAuthoredSources: ReadonlySet<string>,
): { readonly edges: E[]; readonly loss: RepairEntry[] } {
  const direct = new Map(edges.map((e) => [`${e.from}::${e.to}`, e] as const));
  const label = (id: string): string => (typeof labelById.get(id) === 'string' ? String(labelById.get(id)) : id);
  const dropped = new Set<string>();
  const loss: RepairEntry[] = [];
  for (const e of edges) {
    if (kindById.get(e.from) !== 'factor' || kindById.get(e.to) !== 'risk') continue;
    if (userAuthoredSources.has(String(e.provenance?.source ?? ''))) continue;
    const s = signOf(e);
    if (s === 0) continue;
    const outs = edges.filter((x) => x.from === e.to);
    if (outs.length === 0) continue;
    const redrawn = outs.every((x) => {
      const straight = direct.get(`${e.from}::${x.to}`);
      return straight !== undefined && signOf(x) !== 0 && signOf(straight) === s * signOf(x);
    });
    if (!redrawn) continue;
    dropped.add(`${e.from}::${e.to}`);
    const targets = outs.map((x) => `"${label(x.to)}"`).join(' and ');
    loss.push({
      field_path: `edges[${e.from}::${e.to}].one_route`,
      before: e.effect_direction ?? null,
      after: null,
      reason:
        `The link from "${label(e.from)}" to "${label(e.to)}" was left out: "${label(e.from)}" already moves ${targets} `
        + `straight, the same way, so a route through "${label(e.to)}" would count that effect twice. `
        + `"${label(e.to)}" stays in the model as a risk to ${targets}.`,
      severity: 'info',
    } as RepairEntry);
  }
  return { edges: edges.filter((e) => !dropped.has(`${e.from}::${e.to}`)), loss };
}
