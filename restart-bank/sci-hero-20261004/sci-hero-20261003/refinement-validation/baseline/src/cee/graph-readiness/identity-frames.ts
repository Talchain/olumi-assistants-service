/**
 * ⭐ A STATED IDENTITY NEEDS A FRAME ON EVERY PART, BEFORE THE RUN (Canvas #72 5898075514; R3 5898098452): ISL's identity
 * rule 1 (`robustness_analyzer_v2._resolve_structural_identity_plans`) withholds the WHOLE analysis as
 * `identity_frame_missing` when the identity node or any participant carries no `execution_frame`. PLoT forwards only an
 * identity that is not Olumi's unconfirmed reading (`stated_in_brief !== false`; an inferred one with a frameless part is
 * not forwarded, variant (b)), and frames each part with `resolveNodeFrame` (cap → scale_frame → the value/raw pair) or,
 * for a goal, its `goal_threshold_cap`. Readiness reads the same rule so the Run is never offered to be answered with a
 * question. Pure; mirrors PLoT `translator-v3.ts` / `intervention-normaliser.ts` exactly.
 */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** PLoT's frame for a node: `cap` → `scale_frame` → the value/raw pair → a goal's `goal_threshold_cap`. */
export function plotResolvesFrame(node: Rec): boolean {
  const os = rec(node.observed_state);
  if (positive(os?.cap) || positive(node.scale_frame)) return true;
  const [value, raw] = [os?.value, os?.raw_value];
  if (typeof value === 'number' && Number.isFinite(value) && typeof raw === 'number' && Number.isFinite(raw)
    && value > 0 && raw > value && raw / value > 1) return true;
  return node.kind === 'goal' && positive(node.goal_threshold_cap);
}

export interface IdentityFrameGap {
  /** The part with no frame (the identity node itself, or one of its participants). */
  readonly id: string;
  readonly label: string;
  /** The node that declares the identity. */
  readonly identity_id: string;
  readonly identity_label: string;
}

/** Every frameless part of every identity ISL would be sent (and so refuse), in graph order. */
export function statedIdentityFrameGaps(graph: unknown): IdentityFrameGap[] {
  const nodes = (rec(graph)?.nodes as unknown[] | undefined ?? []).map(rec).filter((n): n is Rec => n !== undefined);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const labelOf = (id: string): string => { const l = byId.get(id)?.label; return typeof l === 'string' && l !== '' ? l : id; };
  const gaps: IdentityFrameGap[] = [];
  for (const node of nodes) {
    const identity = rec(node.nonlinear_identity);
    if (identity === undefined || identity.stated_in_brief === false || typeof node.id !== 'string') continue;
    const parts = [node.id, ...(Array.isArray(identity.factor_ids) ? identity.factor_ids : []),
      ...(Array.isArray(identity.addends) ? identity.addends : [])].filter((id): id is string => typeof id === 'string');
    for (const id of parts) {
      const part = byId.get(id);
      if (part !== undefined && plotResolvesFrame(part)) continue;
      gaps.push({ id, label: labelOf(id), identity_id: node.id, identity_label: labelOf(node.id) });
    }
  }
  return gaps;
}
