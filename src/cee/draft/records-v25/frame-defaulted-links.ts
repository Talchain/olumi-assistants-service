/**
 * ⭐ AN OLUMI-SIZED LINK FOLLOWS THE LEVEL IT IS SIZED ON (C, DL #70 5849216942).
 *
 * Admission sizes a link once, at construction (`admit-model.ts` → `sizeLink`). A target whose level is not known
 * then keeps today's ±0.5 default. A level that arrives LATER (the user approves Olumi's starting point, confirms an
 * assumption, or overrides it) never reached those links.
 *
 * ⚠ SERVED (`f-20260926T190952Z`, CEE 3fdd9c3): churn got 5% at step 02 and 12% at step 13. Both links into it stayed
 * ±0.5 through all 16 steps, and every option was withheld (out-of-domain 0.34–0.77). Engine-direct on PLoT 1f6ad52,
 * re-sizing ONLY those two links by D6 at the held level made 3/3 options decision-grade (out-of-domain ≤ 0.001;
 * `quality-evidence/c-run1-resize-20260926/`).
 *
 * This re-runs admission's own `sizeLink` on the links whose size is Olumi's own: today's default (no `magnitude`,
 * exactly the default signature) or D6's `olumi_placeholder`. It is a pure function of the graph, so a second pass
 * changes nothing. A user's size (`user_stated`, a `user_*` source) and Olumi's stated estimate (`olumi_estimate`) are
 * never touched (D7/D9), and neither are structural option/decision edges.
 */
import { STRENGTH_DEFAULT_SIGNATURE } from '@talchain/schemas';

import { percentLevelFrame } from '../../../orchestrator-v5/agent-lane/admit-constraint.js';
import { naturalAmountUnitOf, sizeLink, type MagnitudeNode } from './link-effect.js';
import { stableStringify } from '../../../orchestrator/context/stable-stringify.js';
import { edgeReviewedByUser } from '../../graph-readiness/obligation-provenance.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const levelOf = (v: unknown): number | undefined => (finite(v) ? v : isRec(v) && finite(v.value) ? v.value : undefined);

/** Structural edges carry topology, never a size anyone could author. */
const STRUCTURAL_KINDS = new Set(['option', 'decision']);

/** Today's projection, exactly as admission writes it (`sizeLink` `unchanged`). */
function isDefaultSize(strength: unknown): boolean {
  return isRec(strength)
    && finite(strength.mean) && Math.abs(strength.mean) === STRENGTH_DEFAULT_SIGNATURE.mean
    && strength.std === STRENGTH_DEFAULT_SIGNATURE.std;
}

/** The size on this edge is Olumi's own, so the magnitude contract may re-derive it. */
function sizedByOlumi(edge: Rec): boolean {
  // R11: a size the user CONFIRMED is their settled view of it — never silently re-derived, though it stays Olumi's.
  if (edgeReviewedByUser(edge)) return false;
  const p = isRec(edge.provenance) ? edge.provenance : {};
  if (p.source !== 'cee_hypothesis') return false;
  if (p.magnitude === undefined) return p.natural_effect === undefined && isDefaultSize(edge.strength);
  return p.magnitude === 'olumi_placeholder';
}

/**
 * ⚠ THE DOMAIN THE ENGINE JUDGES A LIMITED LEVEL ON. A percentage level spelled with a population ("% of Pro subscribers
 * per month", the served starting point) is not a period-only percent, so on its words alone `levelDomain` gives it no
 * domain. That is deliberate for open language ("% change …" is no level). A LEVEL limit on the node, admitted in the
 * canonical percent unit (`percentLevelFrame`, the ONE rule admission also asks), is the structured field that says it is one: `MagnitudeNode.percent_level`, the ONE rule
 * `levelDomain` applies for admission and here alike (with its typed guard: no option level below zero).
 */
/** The node ids a level limit in "%" names (exported for the user-stated link-effect writer, one builder). */
export function percentLevelIds(graph: Rec): Set<string> {
  const out = new Set<string>();
  const limits = Array.isArray(graph.goal_constraints) ? graph.goal_constraints : [];
  for (const c of limits) {
    if (!isRec(c) || c.value_frame !== 'level' || typeof c.node_id !== 'string' || typeof c.unit !== 'string') continue;
    if (typeof c.value === 'number' && percentLevelFrame(c.value, c.unit, c.value_frame) !== undefined) out.add(c.node_id);
  }
  return out;
}

/** The stored graph's nodes as the sizing contract reads them (exported: the link-effect writer re-sizes on the same view). */
export function magnitudeNodes(nodes: readonly Rec[], percentLevel: ReadonlySet<string>): Map<string, MagnitudeNode> {
  const optionLevels = new Map<string, number[]>();
  for (const n of nodes) {
    if (n.kind !== 'option' || !isRec(n.interventions)) continue;
    for (const [factorId, iv] of Object.entries(n.interventions)) {
      const level = levelOf(iv);
      if (level !== undefined) optionLevels.set(factorId, [...(optionLevels.get(factorId) ?? []), level]);
    }
  }
  return new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, {
    label: typeof n.label === 'string' ? n.label : (n.id as string),
    kind: typeof n.kind === 'string' ? n.kind : undefined,
    scale_frame: n.scale_frame,
    observed_state: isRec(n.observed_state) ? (n.observed_state as MagnitudeNode['observed_state']) : undefined,
    goal_threshold_cap: n.goal_threshold_cap,
    goal_threshold_unit: n.goal_threshold_unit,
    // Draft records carry claim units on `data.unit`; the old view only read
    // observed_state and consequently made outcome/goal-path sizing refuse even
    // when the model had stated the natural unit.
    unit: isRec(n.data) && typeof n.data.unit === 'string' ? n.data.unit : null,
    option_levels: optionLevels.get(n.id as string) ?? [],
    ...(percentLevel.has(n.id as string) ? { percent_level: true } : {}),
  }]));
}

/**
 * R-c's unit rule (PR Review 5882690939): per node of a graph, the unit words the sizer says a link's natural size in,
 * built from the graph exactly as this re-sizer builds its nodes (option levels from the options' interventions). A
 * natural effect in any other unit ("percentage points" on a "percent change" or a "percentile rank") is not sized for
 * that node. Pure.
 */
export function naturalAmountUnitsOf(nodes: readonly Rec[]): Map<string, string> {
  return new Map([...magnitudeNodes(nodes, new Set())].map(([id, n]) => [id, naturalAmountUnitOf(n)] as const));
}

export interface FramedLinks<G> {
  /** The SAME object when no link changed. */
  readonly graph: G;
  /** `from::to` of every link re-sized (ids only). */
  readonly sized: readonly string[];
}

/**
 * Every Olumi-sized link that touches `factorId` (either end: the target's level bounds it, the source's level sets its
 * swing), re-sized on the levels the graph holds now.
 */
export function frameDefaultedLinks<G>(graph: G, factorId: string): FramedLinks<G> {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { graph, sized: [] };
  const nodes = (graph.nodes as unknown[]).filter(isRec);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  let magnitude: Map<string, MagnitudeNode> | undefined;
  const sized: string[] = [];
  const edges = (graph.edges as unknown[]).map((edge) => {
    if (!isRec(edge) || (edge.from !== factorId && edge.to !== factorId) || !sizedByOlumi(edge)) return edge;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined || STRUCTURAL_KINDS.has(from.kind as string) || STRUCTURAL_KINDS.has(to.kind as string)) return edge;
    const direction = edge.effect_direction === 'negative' || edge.effect_direction === 'positive'
      ? edge.effect_direction
      : isRec(edge.strength) && finite(edge.strength.mean) && edge.strength.mean < 0 ? 'negative' : 'positive';
    magnitude ??= magnitudeNodes(nodes, percentLevelIds(graph));
    const sizing = sizeLink({ direction, user_stated: false }, magnitude.get(from.id as string)!, magnitude.get(to.id as string)!);
    const strength = isRec(edge.strength) ? edge.strength : {};
    const provenance = isRec(edge.provenance) ? edge.provenance : {};
    if (sizing.outcome === 'placeholder') {
      const sameSize = strength.mean === sizing.mean && strength.std === sizing.std && provenance.magnitude === 'olumi_placeholder'
        // Key-order-insensitive: a graph read back from jsonb holds `natural_effect`'s keys shortest-first, never as written.
        && stableStringify(provenance.natural_effect) === stableStringify(sizing.natural_effect);
      if (sameSize) return edge;
      sized.push(`${String(edge.from)}::${String(edge.to)}`);
      const { natural_effect: _dropped, ...rest } = provenance;
      return {
        ...edge,
        strength: { ...strength, mean: sizing.mean, std: sizing.std },
        provenance: { ...rest, magnitude: 'olumi_placeholder', ...(sizing.natural_effect !== undefined ? { natural_effect: sizing.natural_effect } : {}) },
        defaulted: true,
      };
    }
    // Nothing to size against any more (no level held, or no frame): back to today's default, exactly as admission writes it.
    if (provenance.magnitude !== 'olumi_placeholder') return edge;
    sized.push(`${String(edge.from)}::${String(edge.to)}`);
    const { magnitude: _m, natural_effect: _n, ...rest } = provenance;
    return { ...edge, strength: { ...strength, mean: sizing.mean, std: sizing.std }, provenance: rest, defaulted: true };
  });
  return sized.length > 0 ? { graph: { ...graph, edges } as G, sized } : { graph, sized };
}

/**
 * ⭐ ONE AUTHOR OF THE WORDS (P1-a, DL #70 5850069309; shape AI Quality 5850079041): the links a new level re-sized, said
 * the same way by the door's own receipt and by the Agent's server-stated disclosure. Each link is grouped once — under
 * the valued factor it points INTO, else the valued factor it leaves — with the labels the caller supplies.
 */
export interface ResizedLinksGroup {
  readonly factor: string;
  readonly direction: 'into' | 'on';
  readonly links: readonly string[];
}

export function groupResizedLinks(
  pairs: readonly { readonly from: string; readonly to: string }[],
  valuedIds: readonly string[],
  labelOf: (id: string) => string,
): ResizedLinksGroup[] {
  const valued = new Set(valuedIds);
  const home = (l: { from: string; to: string }) => (valued.has(l.to) ? l.to : l.from);
  return [...valued].flatMap((id) => {
    const mine = pairs.filter(l => home(l) === id);
    if (mine.length === 0) return [];
    return [{ factor: labelOf(id), direction: mine.every(l => l.to === id) ? 'into' as const : 'on' as const,
      links: mine.map(l => labelOf(l.from === id ? l.to : l.from)) }];
  });
}

export function resizedLinksSentence(g: ResizedLinksGroup): string {
  return `Olumi also re-sized its own placeholder links ${g.direction} "${g.factor}" so they fit the new level `
    + `(${g.links.map(l => `"${l}"`).join(', ')}). They are Olumi's placeholders, not measurements.`;
}
