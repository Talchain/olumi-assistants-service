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
 * The ceiling a first model is gated against — a BACKSTOP to the envelope, not
 * the envelope itself, and not a product rule.
 *
 * ⛔ WAS 12 / 20, AND 12 / 20 MADE THE ENVELOPE UNREACHABLE. Release Control's
 * envelope (5792626729) is 1 decision + 1 goal + every user option (normally
 * 3–5) + roughly 4–8 factors + 4–6 outcomes and risks only where they
 * materially improve the reasoning: 12–18 nodes for an ordinary brief, up to
 * 21 at its edges. Links are decision→option (≤5) + option→factor + each
 * factor's own link toward the goal + outcome→goal — about 1.6× the node count.
 * A 12/20 ceiling therefore refused, or forced a retry that shed, a model the
 * envelope calls normal, and it pushed the drafter to the 6-node, goal-orphaned
 * first model measured on served 553254d. 18 / 30 admits the ordinary envelope
 * and still catches the 26-node / 57-link explosion this gate was built for.
 */
export const COMPACT_LIMITS = { maxNodes: 18, maxEdges: 30 } as const;

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
  /**
   * ⛔ THE FLOOR A RETRY CANNOT GO BELOW — the user's stated material plus the
   * structural scaffolding every model needs (goal and decision nodes), and the
   * links whose BOTH ends are floor nodes. Release Control's binding item on #1710: if
   * the user's material PLUS required scaffolding alone exceeds 12/20, the model
   * is admitted unchanged and reported oversized — never refused, truncated or
   * retried.
   */
  readonly floor_nodes: number;
  readonly floor_edges: number;
  /**
   * IDENTITIES of what the user stated, not counts — independent review of #1710
   * at 78b07e8b: a retry with the same brief-stated COUNTS but a swapped option
   * or relationship was adopted. Keyed on kind + normalised label (admission
   * re-slugs ids between passes; a label is what the user said).
   */
  readonly brief_stated_keys: { readonly nodes: readonly string[]; readonly edges: readonly string[] };
  /** One sentence a user could be shown. Empty when within budget. */
  readonly detail: string;
}

/** Nodes every model carries whatever the brief: the question and what it is judged against. */
const STRUCTURAL_KINDS = new Set(['goal', 'decision']);

/** A label as an identity: case, spacing and trailing punctuation do not make a different thing. */
const keyLabel = (l: unknown): string => String(l ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();

/**
 * ⛔ THE IDENTITY IS WHAT THE USER SAID, NOT THE DISPLAY LABEL. Admission cuts
 * every label over 33 characters to a word boundary and keeps the full text on
 * `description` (`admit-model.ts`), so two options that share a prefix — "…in
 * London office" and "…in Berlin office" — have the SAME label. Keyed on the
 * label they are one identity, and a retry that drops one of them passes.
 */
export const nodeIdentity = (n: unknown): string => {
  const r = n as { kind?: unknown; label?: unknown; description?: unknown };
  return `${String(r.kind ?? '')}:${keyLabel(r.description ?? r.label)}`;
};

/**
 * TRUE only when every user-stated node AND relationship of `before` is still
 * present in `after`, by identity. Counts are not enough: a same-count swap is a
 * different decision.
 */
export function keepsEveryUserStatedIdentity(before: ConstructionSizeVerdict, after: ConstructionSizeVerdict): boolean {
  const n = new Set(after.brief_stated_keys.nodes);
  const e = new Set(after.brief_stated_keys.edges);
  return before.brief_stated_keys.nodes.every((k) => n.has(k)) && before.brief_stated_keys.edges.every((k) => e.has(k));
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
  // The floor is the user's stated material plus the STRUCTURAL scaffolding every
  // model needs (its goal and decision nodes) — not whatever the builder chose to
  // label "inferred", which on Paul's real first turn would have exempted the
  // widening itself from the cap. Links count only when BOTH ends are floor nodes.
  const endpoint = (e: unknown, k: 'from' | 'to'): string => String((e as Record<string, unknown>)[k] ?? '');
  const nodeIds = new Set(admitted.nodes.map((n) => n.id));
  const floorIds = new Set(
    admitted.nodes
      .filter((n) => admitted.inference_classes[n.id] === 'brief_stated' || STRUCTURAL_KINDS.has(String((n as { kind?: unknown }).kind ?? '')))
      .map((n) => n.id),
  );
  // A relationship the user STATED is user material, and so are the two things it
  // relates — whatever class admission gave those nodes.
  for (const e of admitted.edges.filter(isBriefStatedEdge)) {
    for (const id of [endpoint(e, 'from'), endpoint(e, 'to')]) if (nodeIds.has(id)) floorIds.add(id);
  }
  const floor_nodes = floorIds.size;
  const floor_edges = admitted.edges.filter((e) => isBriefStatedEdge(e) || (floorIds.has(endpoint(e, 'from')) && floorIds.has(endpoint(e, 'to')))).length;
  const user_material_exceeds_limit = floor_nodes > limits.maxNodes || floor_edges > limits.maxEdges;
  const identityOf = new Map(admitted.nodes.map((n) => [n.id, nodeIdentity(n)]));
  const brief_stated_keys = {
    nodes: admitted.nodes
      .filter((n) => admitted.inference_classes[n.id] === 'brief_stated')
      .map(nodeIdentity)
      .sort(),
    // ⛔ THE STATED DIRECTION IS PART OF THE RELATIONSHIP. "X increases Y" and
    // "X decreases Y" join the same two things and are opposite claims.
    edges: admitted.edges
      .filter(isBriefStatedEdge)
      .map((e) => `${identityOf.get(endpoint(e, 'from')) ?? endpoint(e, 'from')}->${identityOf.get(endpoint(e, 'to')) ?? endpoint(e, 'to')}:${String((e as { effect_direction?: unknown }).effect_direction ?? '')}`)
      .sort(),
  };

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
    floor_nodes,
    floor_edges,
    brief_stated_keys,
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
