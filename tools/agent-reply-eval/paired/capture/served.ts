/**
 * Loads the SERVED 57f903c route-level captures (read-only, local) and derives the inputs the
 * fast-path-3 capture needs. Nothing here is invented: every value is read from a served
 * response, and each approximation is named in `approximations`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const SERVED_ROOT = '~/olumi-ai-quality-20260924/captures';

type J = Record<string, any>;
const readJson = (p: string): { json: J; sha256: string; path: string } => {
  const text = readFileSync(p, 'utf8');
  return { json: JSON.parse(text) as J, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), path: p };
};

export interface ServedCase {
  readonly label: 'hiring' | 'pricing';
  readonly dir: string;
  readonly scenario_id: string;
  readonly construction: { request: J; response: J };
  readonly approve: { request: J; response: J };
  readonly explicitRun: { request: J; response: J };
  readonly files: { path: string; sha256: string }[];
}

export function loadServed(label: 'hiring' | 'pricing'): ServedCase {
  const dir = join(SERVED_ROOT, `57f903c-${label}`);
  const files: { path: string; sha256: string }[] = [];
  const get = (name: string) => { const r = readJson(join(dir, name)); files.push({ path: r.path, sha256: r.sha256 }); return r.json; };
  const construction = { request: get('construction.request.json'), response: get('construction.response.json') };
  const approve = { request: get('approve.request.json'), response: get('approve.response.json') };
  const explicitRun = { request: get('explicit-run.request.json'), response: get('explicit-run.response.json') };
  const scenario_id = String(explicitRun.request['scenario_id']);
  return { label, dir, scenario_id, construction, approve, explicitRun, files };
}

/**
 * The durable rows the route's restart seeding reads (`store.readRecent`, NEWEST FIRST).
 * The answer row stores the FINAL (finalised) assistant_text, so the served responses'
 * `assistant_text` is exactly what that column holds for these two turns.
 */
export function durableRowsFor(c: ServedCase): { turn_id: string; user_message: string; assistant_message: string }[] {
  return [
    { turn_id: String(c.approve.request['turn_id']), user_message: String(c.approve.request['message']), assistant_message: String(c.approve.response['assistant_text']) },
    { turn_id: String(c.construction.request['turn_id']), user_message: String(c.construction.request['message']), assistant_message: String(c.construction.response['assistant_text']) },
  ];
}

/** The persisted graph as the served readback carried it (`draft_graph` = nodes, edges, goal_constraints). */
export function servedGraph(c: ServedCase): Record<string, unknown> {
  const dg = c.explicitRun.response['draft_graph'] as J;
  return {
    nodes: dg['nodes'],
    edges: dg['edges'],
    ...(Array.isArray(dg['goal_constraints']) && dg['goal_constraints'].length > 0 ? { goal_constraints: dg['goal_constraints'] } : {}),
  };
}

export function servedAnalysisResult(c: ServedCase): J | null {
  const blocks = (c.explicitRun.response['blocks'] as J[] | undefined) ?? [];
  return blocks.find((b) => b['type'] === 'analysis_result') ?? null;
}

/**
 * The internal conventional Run's answer, approximated from the served explicit-run response:
 * its `assistant_text` (→ `ran.what_is_missing`) was not captured and is not echoed anywhere
 * in the Agent route's response, so it is ''.
 */
export function runResponseFor(c: ServedCase): J {
  const r = c.explicitRun.response;
  const result = servedAnalysisResult(c);
  return {
    response_version: 2,
    assistant_text: '',
    suggested_actions: [],
    insights: [],
    graph_hash: r['graph_hash'],
    blocks: result !== null ? [result] : [],
    analysis_ready: r['analysis_ready'],
    analysis_state: r['analysis_state'],
  };
}

/** The fragile link R&C's card names: the highest switch probability among the visible fragile edges. */
export function fragileLinkFor(c: ServedCase): { from_label: string; to_label: string; edge_id: string; switch_probability: number; source: string } | null {
  const result = servedAnalysisResult(c);
  const fragile = ((result?.['enrichment'] as J | undefined)?.['robustness'] as J | undefined)?.['fragile_edges'] as J[] | undefined;
  if (Array.isArray(fragile) && fragile.length > 0) {
    const visible = fragile.filter((e) => e['visible'] !== false);
    const pool = visible.length > 0 ? visible : fragile;
    const top = [...pool].sort((a, b) => Number(b['switch_probability'] ?? 0) - Number(a['switch_probability'] ?? 0))[0]!;
    return { from_label: String(top['from_label']), to_label: String(top['to_label']), edge_id: String(top['edge_id']), switch_probability: Number(top['switch_probability']), source: 'analysis_result.enrichment.robustness.fragile_edges (max switch_probability, visible)' };
  }
  return null;
}
