import { createHash } from 'node:crypto';

type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Bind the user's press to this scenario, goal and stated meaning at this month. */
export function steadyAttestationKey(goal: Rec, scenarioId: string): string {
  const label = typeof goal.label === 'string' ? goal.label.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return createHash('sha256').update(JSON.stringify([
    scenarioId, goal.id, label, goal.goal_threshold_unit ?? null, goal.goal_horizon_months,
  ])).digest('hex').slice(0, 32);
}

/** Science §(ad)(3): only this goal's user press licences steady-state time; any carrier takes precedence. */
export function horizonSteadyAttested(graph: unknown, scenarioId: string | undefined): boolean {
  if (scenarioId === undefined || !record(graph) || !Array.isArray(graph.nodes)) return false;
  const nodes = graph.nodes.filter(record);
  if (nodes.some(n => record(n.nonlinear_identity) && n.nonlinear_identity.operation === 'accumulation')) return false;
  const goals = nodes.filter(n => n.kind === 'goal');
  if (goals.length !== 1) return false;
  const g = goals[0]!;
  return typeof g.id === 'string' && typeof g.label === 'string'
    && typeof g.goal_horizon_months === 'number' && Number.isInteger(g.goal_horizon_months) && g.goal_horizon_months > 0
    && g.horizon_basis === 'steady_attested'
    && g.horizon_basis_source === 'user_stated'
    && g.horizon_basis_months === g.goal_horizon_months
    && g.horizon_basis_key === steadyAttestationKey(g, scenarioId);
}

const STEADY_FIELDS = ['horizon_basis', 'horizon_basis_source', 'horizon_basis_months', 'horizon_basis_key'] as const;

/**
 * Client graph bytes can never supply a user's press: every incoming attestation field is dropped. What the SERVER already
 * stored for the same node id is carried back, so saving the model never erases the user's answer (the key still voids it
 * when the goal's meaning, month or scenario differs). Mutates only node attestation fields at ingress.
 */
export function stripSteadyAttestation(graph: unknown, stored?: unknown): void {
  if (!record(graph) || !Array.isArray(graph.nodes)) return;
  const storedNodes = record(stored) && Array.isArray(stored.nodes) ? stored.nodes.filter(record) : [];
  for (const node of graph.nodes) {
    if (!record(node)) continue;
    for (const f of STEADY_FIELDS) delete node[f];
    const kept = storedNodes.find(n => n.id === node.id && n.kind === 'goal' && node.kind === 'goal');
    if (kept !== undefined && STEADY_FIELDS.every(f => kept[f] !== undefined)) {
      for (const f of STEADY_FIELDS) node[f] = kept[f];
    }
  }
}
