/**
 * ⭐ THE COMPACT FIRST-MODEL GATE — decision-critical, not comprehensive.
 *
 * Paul's exact first turn produced **26 nodes / 57 edges** (3 AI-added options,
 * 14 factors, 5 risks) from `Should I hire a Tech lead or two developers to
 * increase velocity?`. That is the served construction contract behaving as
 * written, not a regression: `build-model.ts` instructs turn one to
 * *"Then widen: add the options, factors, risks, outcomes and causal mechanisms
 * that materially improve strategic reasoning"*, and two further served rules
 * require every risk and every factor to be wired through to the goal. So each
 * widened node also acquires a chain — which is how 26 nodes becomes 57 edges.
 * The node count and the edge count have ONE root cause.
 *
 * ── ⛔ THIS MODULE ASSESSES. IT NEVER TRUNCATES. ────────────────────────────
 * There is no slice, no filter, no "drop the last N" anywhere in it, and that is
 * the whole design. A truncating gate would silently discard material — and the
 * material most at risk is the user's own, because it is admitted FIRST and so
 * sits wherever the cut lands. Silent truncation would defeat the one requirement
 * that outranks the size target: preserve every explicit user option and fact.
 * Oversize is therefore a VERDICT the caller acts on by retrying under a tighter
 * instruction or refusing out loud, never by editing the model here.
 *
 * ── ⭐⭐ THE CAP TARGETS WIDENING, NEVER THE USER ───────────────────────────
 * Admission records how every node got here (`InferenceClass`): `brief_stated`
 * (the user said it), `builder_inferred` (read out of the brief), `model_proposed`
 * (added beyond it). `model_proposed` IS the widening, so it is the only
 * legitimate shed target and the verdict names its size.
 *
 * And the case that must not be got wrong: when the user's OWN stated material
 * alone exceeds the cap, the cap is unreachable without deleting what they said.
 * {@link ConstructionSizeVerdict.user_material_exceeds_limit} says so, and the
 * documented answer is to ADMIT that model — a user with eleven options has
 * eleven options. A gate that refused there would be a size target overriding
 * the user, which is the wrong way round.
 */
import type { AdmittedModel, InferenceClass } from './admit-model.js';

/**
 * Hard initial target. Set by Release Control, not derived here — so it is a
 * stated product limit rather than a number this module invented.
 */
export const COMPACT_LIMITS = { maxNodes: 12, maxEdges: 20 } as const;

export interface ConstructionSizeLimits {
  readonly maxNodes: number;
  readonly maxEdges: number;
}

export interface ConstructionSizeVerdict {
  readonly within: boolean;
  readonly nodes: number;
  readonly edges: number;
  readonly limits: ConstructionSizeLimits;
  /** How far over, per dimension. Zero when within. */
  readonly over_by: { readonly nodes: number; readonly edges: number };
  /** Node counts by graph kind, so a refusal can say WHAT is oversized. */
  readonly by_kind: Readonly<Record<string, number>>;
  /** Node counts by how each one got here. `model_proposed` is the widening. */
  readonly by_provenance: Readonly<Record<InferenceClass, number>>;
  /** The floor: nodes the user themselves stated. Never a shed target. */
  readonly brief_stated_nodes: number;
  /**
   * RELATIONSHIPS the user themselves stated, counted by the only honest marker
   * available: `provenance.source === 'brief_extraction'`, which is what an
   * `explicit` candidate link becomes at admission
   * (`admit-candidate.ts::provenanceSourceFor`).
   *
   * ⛔ ADDED AFTER AN EXACT-HEAD REVIEW. The exemption below read node counts
   * ONLY, so an explicit brief that sits inside 12 nodes while stating more than
   * 20 relationships fell into the retry/refusal path — and the stated contract
   * covers the user's FACTS AND RELATIONSHIPS, not only their nodes.
   */
  readonly brief_stated_edges: number;
  /** Widened nodes — the only legitimate thing a retry should shed. */
  readonly sheddable_nodes: number;
  /**
   * TRUE when the user's own stated material alone exceeds a limit — on EITHER
   * dimension — so the cap cannot be met without deleting what they said. The
   * caller must ADMIT, not refuse: their model is their model.
   */
  readonly user_material_exceeds_limit: boolean;
  /** One sentence a user could be shown. Empty when within budget. */
  readonly detail: string;
}

/** An admitted edge the user themselves stated. */
const isBriefStatedEdge = (e: unknown): boolean =>
  typeof e === 'object' &&
  e !== null &&
  (e as { provenance?: { source?: unknown } }).provenance?.source === 'brief_extraction';

const EMPTY_PROVENANCE: Readonly<Record<InferenceClass, number>> = {
  brief_stated: 0,
  builder_inferred: 0,
  model_proposed: 0,
};

/**
 * Count the ADMITTED graph, never the candidate.
 *
 * Admission is what decides which of the model's items become nodes at all — it
 * merges, drops unreachable relationships and withholds direction-less links. A
 * cap read off the raw candidate would be measuring a different object from the
 * one that gets registered, and would disagree with the canvas the user sees.
 */
export function assessConstructionSize(
  admitted: Pick<AdmittedModel, 'nodes' | 'edges' | 'inference_classes'>,
  limits: ConstructionSizeLimits = COMPACT_LIMITS,
): ConstructionSizeVerdict {
  const nodes = admitted.nodes.length;
  const edges = admitted.edges.length;

  const by_kind: Record<string, number> = {};
  for (const n of admitted.nodes) {
    const kind = String((n as { kind?: unknown }).kind ?? 'unknown');
    by_kind[kind] = (by_kind[kind] ?? 0) + 1;
  }

  const by_provenance: Record<InferenceClass, number> = { ...EMPTY_PROVENANCE };
  for (const n of admitted.nodes) {
    // ⚠ ABSENCE IS NOT `model_proposed`. An id with no recorded class is
    // UNCLASSIFIED, and counting it as widening would invite a retry to shed
    // something nobody established was the model's invention. It is counted in
    // the total and in `by_kind`, and left out of the provenance split, which is
    // why these three need not sum to `nodes`.
    const cls = admitted.inference_classes[n.id];
    if (cls !== undefined) by_provenance[cls] += 1;
  }

  const brief_stated_nodes = by_provenance.brief_stated;
  const brief_stated_edges = admitted.edges.filter(isBriefStatedEdge).length;
  const sheddable_nodes = by_provenance.model_proposed;
  const within = nodes <= limits.maxNodes && edges <= limits.maxEdges;
  const over_by = {
    nodes: Math.max(0, nodes - limits.maxNodes),
    edges: Math.max(0, edges - limits.maxEdges),
  };
  const user_material_exceeds_limit =
    brief_stated_nodes > limits.maxNodes || brief_stated_edges > limits.maxEdges;

  const parts: string[] = [];
  if (over_by.nodes > 0) parts.push(`${nodes} nodes (limit ${limits.maxNodes})`);
  if (over_by.edges > 0) parts.push(`${edges} links (limit ${limits.maxEdges})`);
  const detail = within
    ? ''
    : `The first model came back at ${parts.join(' and ')}. `
      + `${sheddable_nodes} of the ${nodes} nodes were added beyond the brief`
      + (brief_stated_nodes > 0 ? `, and ${brief_stated_nodes} came from what you said` : '')
      + '.';

  return {
    within,
    nodes,
    edges,
    limits,
    over_by,
    by_kind,
    by_provenance,
    brief_stated_nodes,
    brief_stated_edges,
    sheddable_nodes,
    user_material_exceeds_limit,
    detail,
  };
}

/**
 * The instruction delta for ONE bounded retry.
 *
 * ⛔ IT NAMES A TARGET, NEVER A LIST. Telling the model which nodes to drop
 * would be this module choosing what the decision is about; telling it the
 * budget and that the user's own material is untouchable leaves that judgement
 * where it belongs and keeps the refusal honest if it fails again.
 */
export function retryInstruction(v: ConstructionSizeVerdict): string {
  return [
    `Your previous model was too large: ${v.nodes} nodes and ${v.edges} links.`,
    `The limit is ${v.limits.maxNodes} nodes and ${v.limits.maxEdges} links.`,
    'Keep EVERY option, factor, figure, constraint, horizon AND STATED RELATIONSHIP the brief gives — those are not negotiable and must not be dropped or merged.',
    'Remove what you ADDED beyond the brief: speculative options, secondary factors, risks and outcomes that are not decision-critical for this question.',
    'Anything you judge material but cannot fit belongs in `unknowns` as a question, NOT as a node.',
    'Do not invent a number, an effect or a baseline to make the smaller model analysable.',
    'Every option must still say what it does, and every kept node must still reach the goal metric.',
  ].join(' ');
}
