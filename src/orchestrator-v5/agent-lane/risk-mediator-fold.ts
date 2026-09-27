/**
 * ⛔ C5 — A RISK OLUMI DRAFTED AS A MEDIATOR IS FOLDED INTO THE DIRECT LINK, WITH ITS TOTAL EFFECT KEPT.
 *
 * SERVED (Paul, session a295e4a1, exports 17d1cd3a / 90b8f080, 27 Sep): construction drafted the risk "Price
 * sensitivity" BETWEEN two factors — Pro plan price → Price sensitivity (0.5 ± 0.125) → Monthly churn
 * (0.0075 ± 0.00375), both `cee_hypothesis` — with no direct Pro plan price → Monthly churn link. On the canvas the
 * risk band sits below the factors, so that link ran UP across the bands (Canvas REVIEW C5). Re-kinding the risk as a
 * factor is refused: it makes a factor with no value (the C4 hazard).
 *
 * RULING (AI Quality #70 5854837708, on MG 5854828033 item 5), at ADMISSION only (new drafts), under ALL of:
 *  1. the risk has exactly ONE parent (a factor), at least one FACTOR child, every link in or out of it is Olumi's own,
 *     and it carries no user value — otherwise it is left exactly as drafted;
 *  2. for each child k, in normalised delta form: mean′ = mean(direct p→k, if any) + μ₁·μ₂ and
 *     σ′ = √(σ_d² + μ₁²σ₂² + μ₂²σ₁² + σ₁²σ₂²), independent; direction = sign(mean′);
 *  3. if |mean′| + 2σ′ > 1 for ANY child (the Q6 truncation rule), the risk is not folded at all;
 *  4. the link stays `cee_hypothesis`, its rationale carries the risk's own words, and the ledger records
 *     "folded risk '<risk>' into <p> → <k>" so the not-modelled disclosure says it.
 *
 * ⚠ DECLARED CONSEQUENCE (the ruling's): a product of two sampled strengths is replaced by one, moment-matched, so
 * win-% can move slightly. It is Olumi's drafting, not the user's figure, and it is said.
 *
 * Pure: the caller (`admit-model.ts`, `admitOnce`) decides which risks something else admission emits still names
 * (`pinned`) and removes each folded risk's node, class and ledger lines.
 */
import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';
import type { AdmittedEdge } from './admit-candidate.js';

/** The ruling's truncation bound (Q6): a folded strength must stay representable in [-1, 1] at two σ. */
const TRUNCATION_BOUND = 1;

export interface FoldableNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description?: string;
  readonly observed_state?: unknown;
  readonly interventions?: unknown;
}

interface Moments { readonly mean: number; readonly std: number; readonly exists_probability: number }

/**
 * The moment match (#70 5854837708 item 2): the total effect of p → risk → k (plus a direct p → k), as one link.
 *
 * `exists_probability` is NOT specified by the ruling. // exists_probability: MG's choice, AIQ to confirm
 * A new link exists when both of the path's links do (p₁·p₂); merged into a direct link, when either route does
 * (1 − (1 − p_d)(1 − p₁p₂)).
 */
export function foldedMoments(first: Moments, second: Moments, direct?: Moments): Moments {
  const mean = (direct?.mean ?? 0) + first.mean * second.mean;
  const std = Math.sqrt(
    (direct?.std ?? 0) ** 2
    + first.mean ** 2 * second.std ** 2
    + second.mean ** 2 * first.std ** 2
    + first.std ** 2 * second.std ** 2,
  );
  const path = first.exists_probability * second.exists_probability;
  const exists_probability = direct === undefined ? path : 1 - (1 - direct.exists_probability) * (1 - path);
  return { mean, std, exists_probability };
}

export interface RiskFold {
  readonly risk_id: string;
  /** Every `from::to` the fold removed: the risk's own links. */
  readonly consumed: readonly string[];
  readonly entry: RepairEntry;
}

const pairOf = (e: { from: string; to: string }): string => `${e.from}::${e.to}`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const momentsOf = (e: AdmittedEdge): Moments => ({ mean: e.strength.mean, std: e.strength.std, exists_probability: e.exists_probability });
const wellFormed = (e: AdmittedEdge): boolean => finite(e.strength?.mean) && finite(e.strength?.std) && finite(e.exists_probability)
  && (e.effect_direction === 'positive' || e.effect_direction === 'negative');

/** Who sized the folded link: a placeholder if any input was one (the ruling); an estimate only if every input was. */
function foldedMagnitude(inputs: readonly AdmittedEdge[]): 'olumi_placeholder' | 'olumi_estimate' | undefined {
  const m = inputs.map((e) => e.provenance?.magnitude);
  if (m.includes('olumi_placeholder')) return 'olumi_placeholder';
  return m.every((x) => x === 'olumi_estimate') ? 'olumi_estimate' : undefined;
}

/**
 * Fold every eligible risk, in model order, over the causal edges admission has just sized. Returns the edges with
 * each folded risk's links replaced by its merged links (at the position of the risk's own link to that child, or
 * of the direct link it merged into), and one ledger entry per folded risk. A risk that fails ANY condition is left
 * exactly as drafted.
 */
export function foldRiskMediators<E extends AdmittedEdge>(args: {
  readonly nodes: readonly FoldableNode[];
  /** Topology edges (decision → option, option → factor): they count as parents, and are never folded. */
  readonly structural: readonly { readonly from: string; readonly to: string }[];
  readonly causal: readonly E[];
  /** Olumi's own link: `cee_hypothesis`, not in USER_AUTHORED_EDGE_SOURCES, not sized by the user. */
  readonly olumisOwn: (e: E) => boolean;
  /** Risk ids something else admission emits still names (a limit, a declared identity, a withheld link, the brief). */
  readonly pinned: ReadonlySet<string>;
  /** `from::to` of links the drafter stated with direction unknown: a fold must not draw them with a sign. */
  readonly declined: ReadonlySet<string>;
}): { edges: E[]; folds: RiskFold[] } {
  const byId = new Map(args.nodes.map((n) => [n.id, n] as const));
  const words = (id: string): string => {
    const n = byId.get(id);
    return String(n?.description ?? n?.label ?? id);
  };
  const label = (id: string): string => String(byId.get(id)?.label ?? id);
  let edges: E[] = [...args.causal];
  const folds: RiskFold[] = [];

  for (const risk of args.nodes) {
    if (risk.kind !== 'risk' || args.pinned.has(risk.id)) continue;
    // "Carries no user value": a risk holds no level or setting of its own; one that does is not Olumi's to fold.
    if (risk.observed_state !== undefined || risk.interventions !== undefined) continue;
    const parents = [...args.structural.filter((e) => e.to === risk.id), ...edges.filter((e) => e.to === risk.id)];
    if (parents.length !== 1) continue;
    const inbound = edges.find((e) => e.to === risk.id);
    if (inbound === undefined || byId.get(inbound.from)?.kind !== 'factor') continue;
    const parent = inbound.from;
    const outbound = edges.filter((e) => e.from === risk.id);
    if (!outbound.some((e) => byId.get(e.to)?.kind === 'factor')) continue;
    if (new Set(outbound.map((e) => e.to)).size !== outbound.length) continue;
    if (outbound.some((e) => e.to === parent || e.to === risk.id)) continue;
    const own = [inbound, ...outbound];
    if (!own.every(wellFormed)) continue;
    if (!own.every(args.olumisOwn)) continue;

    const merges: { child: string; direct: E | undefined; edge: E }[] = [];
    let refused = false;
    for (const out of outbound) {
      const directs = edges.filter((e) => e.from === parent && e.to === out.to);
      const direct = directs[0];
      if (directs.length > 1 || args.declined.has(`${parent}::${out.to}`)
        || (direct !== undefined && !(wellFormed(direct) && args.olumisOwn(direct)))) { refused = true; break; }
      const m = foldedMoments(momentsOf(inbound), momentsOf(out), direct === undefined ? undefined : momentsOf(direct));
      if (!(Math.abs(m.mean) + 2 * m.std <= TRUNCATION_BOUND) || m.mean === 0 || !(m.std > 0)) { refused = true; break; }
      const inputs = direct === undefined ? [inbound, out] : [direct, inbound, out];
      const magnitude = foldedMagnitude(inputs);
      const reasoning = `Olumi's risk "${words(risk.id)}", folded into this link: Olumi drafted it as a step between `
        + `"${label(parent)}" and "${label(out.to)}", so its effect is carried here with the same overall size.`;
      const { natural_effect: _stale, magnitude: _m, reasoning: prior, ...kept } = (direct?.provenance ?? {}) as NonNullable<AdmittedEdge['provenance']>;
      const edge = {
        ...(direct ?? {}),
        from: parent,
        to: out.to,
        strength: { mean: m.mean, std: m.std },
        exists_probability: m.exists_probability,
        effect_direction: m.mean > 0 ? 'positive' : 'negative',
        provenance: {
          ...kept,
          source: 'cee_hypothesis',
          reasoning: prior === undefined ? reasoning : `${prior} ${reasoning}`,
          ...(magnitude !== undefined ? { magnitude } : {}),
        },
        ...(inputs.some((e) => e.defaulted === true) ? { defaulted: true } : {}),
      } as E;
      merges.push({ child: out.to, direct, edge });
    }
    if (refused) continue;

    const consumed = own.map(pairOf);
    const replaced = new Map<object, E>();
    for (const mg of merges) {
      if (mg.direct !== undefined) replaced.set(mg.direct, mg.edge);
      else replaced.set(outbound.find((e) => e.to === mg.child)!, mg.edge);
    }
    // Each merged link takes the place of the direct link it merged into, else of the risk's own link to that child;
    // every link left touching the risk goes with it.
    edges = edges.map((e) => replaced.get(e) ?? e).filter((e) => e.to !== risk.id && e.from !== risk.id);

    const into = merges.map((mg) => `${label(parent)} → ${label(mg.child)}`).join(' and ');
    const oneLink = merges.length === 1;
    folds.push({
      risk_id: risk.id,
      consumed,
      entry: {
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `nodes[${risk.id}].risk_folded`,
        before: {
          risk: words(risk.id),
          links: own.map((e) => ({ from: e.from, to: e.to, strength: { ...e.strength }, exists_probability: e.exists_probability, effect_direction: e.effect_direction })),
          ...(merges.some((mg) => mg.direct !== undefined)
            ? { direct: merges.filter((mg) => mg.direct !== undefined).map((mg) => ({ from: mg.direct!.from, to: mg.direct!.to, strength: { ...mg.direct!.strength }, exists_probability: mg.direct!.exists_probability })) }
            : {}),
        },
        after: merges.map((mg) => ({ from: mg.edge.from, to: mg.edge.to, strength: { ...mg.edge.strength }, exists_probability: mg.edge.exists_probability })),
        reason:
          `Olumi folded risk '${label(risk.id)}' into ${into}: Olumi had drafted it as a step between `
          + `"${label(parent)}" and what it changes, so its effect is carried on ${oneLink ? 'that link' : 'those links'} `
          + `with the same overall size, and it is no longer shown as a separate risk. That is Olumi's drafting, not `
          + `anything you said; say if "${label(risk.id)}" should stay a risk of its own.`,
        severity: 'info',
      },
    });
  }
  return { edges, folds };
}
