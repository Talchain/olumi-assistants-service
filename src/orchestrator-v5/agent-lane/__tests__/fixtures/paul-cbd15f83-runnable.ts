/**
 * Paul's stored scenario graph (`cbd15f83`), made RUNNABLE by one edge — for rows that must pass the REAL
 * run loader (`loadScenarioSnapshotForRunAnalysis`) rather than a stub fed the stored bytes.
 *
 * ⛔ WHY THE STORED BYTES THEMSELVES REFUSE THE RUN. `paul-cbd15f83-stored-graph.json` is the read-only store
 * snapshot `9b30de7c` (#1942), taken AFTER Paul added the option "Test £54 versus £59 by customer cohort before
 * rollout" (`5d442591`) in chat. That option has edges to three factors but NO edge from `decision_mrr`, so the
 * real loader refuses it before PLoT is ever called: `AnalysisNotReadyError` with `OPTION_NOT_LINKED_TO_DECISION`
 * on `5d442591` (the served readiness builder reports the same block; `agent-sees-one-readiness.test.ts`). The
 * spec that uses this module asserts that refusal on the stored bytes as its own contrast row, so this header
 * cannot go stale silently.
 *
 * THE ONE CHANGE: link `5d442591` from `decision_mrr` with the same edge shape as the decision's other option
 * edges — exactly `linked()` in `agent-sees-one-readiness.test.ts`. Nothing else differs from the stored bytes;
 * the goal (`mrr`: target 20000 "GBP MRR", cap 25000, frame `level`, no `observed_state`) is untouched.
 */
import { readFileSync } from 'node:fs';

type Edge = { from: string; to: string } & Record<string, unknown>;
type Graph = { nodes: ({ id: string; kind: string; label: string } & Record<string, unknown>)[]; edges: Edge[] } & Record<string, unknown>;

export const PAUL_CBD15F83_UNLINKED_OPTION = '5d442591';

/** The stored bytes, verbatim (a fresh copy per call). */
export function paulCbd15f83Stored(): Graph {
  return JSON.parse(readFileSync(new URL('./paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as Graph;
}

/** The stored bytes plus the one decision → option edge the chat-added option lacks. */
export function paulCbd15f83Runnable(): Graph {
  const g = paulCbd15f83Stored();
  const decisionEdge = g.edges.find((e) => e.from === 'decision_mrr');
  if (decisionEdge === undefined) throw new Error('fixture drift: decision_mrr has no option edge to copy');
  g.edges.push({ ...decisionEdge, from: 'decision_mrr', to: PAUL_CBD15F83_UNLINKED_OPTION });
  return g;
}
