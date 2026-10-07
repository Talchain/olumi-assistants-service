/** S2a Run-only frame attestation and per-option mathematical licence input. */
import { shareByDateGoalOf, statedTeamShareOf } from './goal-kind.js';
import { timeBetween } from './deadline-date.js';
import { gate, type ShareGate, type ShareParts } from './event-by-date-share.js';

type Rec = Record<string, any>;

/** EXACT same reference and bytes for every other goal. Never writes persistence. */
export function withShareByDateFrame<G>(wireGraph: G, persistedGraph: unknown): G {
  const share = shareByDateGoalOf(persistedGraph);
  if (share === null) return wireGraph;
  const g = wireGraph as Rec;
  return { ...g, nodes: g.nodes.map((n: Rec) => n.id === share.goal.id
    ? { ...n, goal_threshold_frame: 'delta', goal_threshold: share.threshold_raw / 100 } : n) } as G;
}

export function sharePartsForOption(graph: unknown, optionId: string): ShareParts | null {
  const share = shareByDateGoalOf(graph);
  if (share === null) return null;
  const g = graph as Rec;
  const teamNode = g.nodes.find((n: Rec) => n.id === share.team_part_id);
  const team = statedTeamShareOf(teamNode, share.deadline, share.goal.goal_threshold_unit as string)!;
  const option = g.nodes.find((n: Rec) => n.id === optionId && n.kind === 'option');
  if (option === undefined) return null;
  const active = share.parts.filter(p => {
    const v = option.interventions[p.from];
    return p.from !== share.team_part_id && (typeof v === 'number' ? v : v?.value) === 1;
  });
  if (active.length > 1) return null;
  if (active.length === 0) return { team };
  const c = g.nodes.find((n: Rec) => n.id === active[0]!.from).observed_state.extra_share_by_date;
  return { team, extra: { monthlyShare: c.monthly_share / 100,
    D: timeBetween(c.reference_date, share.deadline, 'months'), leadLow: c.lead_low, leadHigh: c.lead_high } };
}

/** Null means unsupported parts, never permission to display a point. */
export function shareGateForOption(graph: unknown, optionId: string): ShareGate | null {
  const share = shareByDateGoalOf(graph), parts = sharePartsForOption(graph, optionId);
  if (share === null || parts === null) return null;
  return gate(parts, share.threshold_raw / 100);
}
