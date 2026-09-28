/**
 * ⛔ THE AGENT SAYS HOW EACH LIMIT WAS CHECKED, FROM THE RUN'S OWN PER-LIMIT VERDICTS (MG #72 5864956818).
 *
 * Served `pj-20260928T063347Z` C10: both of the user's limits came back `estimate_only / level_olumi_estimate`. They
 * WERE checked, but against Olumi's own figures. The Agent's run result carried only the generic
 * `leader_claim.withheld_reason: constraint_verdict_withheld`, so the reply said the total-investment limit "was not
 * checkable" and closed on "the model needs a checkable definition of total investment": a false cause, pointing the
 * user at the wrong fix.
 *
 * The per-limit rows (`analysis_limit_verdicts`, the same fact the readback carries) say exactly which it was. Each
 * becomes ONE fixed sentence per state and reason. Nothing is re-derived: a row whose limit has no label in the model
 * is left out, never named by guess.
 */
import { readRatifiedConstraints, type StoredLimitVerdicts } from '../../orchestrator/context/constraint-feasibility.js';

export interface LimitCheck {
  /** The join key for MG's per-limit ask (`limited-level-ask.ts`, seam 5865033356): its sentence rides here verbatim. */
  readonly constraint_id: string;
  readonly limit: string;
  readonly state: 'scored' | 'estimate_only' | 'unscored';
  /** The one sentence the user is told about this limit. */
  readonly say: string;
}

const q = (label: string): string => `‘${label}’`;

/** One sentence per state (and, for `estimate_only`, per whose figure it was checked against). */
function sentenceFor(label: string, state: LimitCheck['state'], reason: string | undefined): string {
  if (state === 'scored') return `${q(label)} was checked against the figures in your model.`;
  if (state === 'unscored') return `${q(label)} cannot be checked in this model yet.`;
  if (reason === 'level_user_assumption') return `${q(label)} was checked, against a figure you accepted as an assumption.`;
  // Only how it was checked. What the user can give instead is MG's ask (DL ruling 5865003207: one wording, one producer).
  return `${q(label)} was checked, but only against Olumi’s estimates, not figures you gave.`;
}

export const LIMIT_CHECKS_NOTE =
  'How each of the user’s limits was checked in this run. Say it only with its sentence here. A limit checked against '
  + 'Olumi’s estimates WAS checked: never call it not checkable or unchecked, and never ask for a way to make it checkable. '
  + 'Only a limit whose state is unscored cannot be checked yet.';

/** `undefined` when the run carries no per-limit rows, or none can be named. */
export function limitChecksForAgent(graph: unknown, verdicts: StoredLimitVerdicts | null | undefined): LimitCheck[] | undefined {
  if (verdicts === null || verdicts === undefined) return undefined;
  const limits = readRatifiedConstraints(graph);
  const nodes = (graph as { nodes?: unknown } | null | undefined)?.nodes;
  const nodeLabel = (id: string | null): string | null => {
    if (id === null || !Array.isArray(nodes)) return null;
    const n = nodes.find((x) => x !== null && typeof x === 'object' && (x as { id?: unknown }).id === id) as { label?: unknown } | undefined;
    return typeof n?.label === 'string' && n.label.trim() !== '' ? n.label.trim() : null;
  };
  const out: LimitCheck[] = [];
  for (const row of verdicts.per_limit) {
    const limit = limits.find((c) => c.constraint_id === row.constraint_id);
    const label = (limit?.label ?? '').trim() !== '' ? limit!.label!.trim() : nodeLabel(limit?.node_id ?? null);
    if (label === null) continue;
    out.push({ constraint_id: row.constraint_id, limit: label, state: row.state, say: sentenceFor(label, row.state, row.reason) });
  }
  return out.length > 0 ? out : undefined;
}
