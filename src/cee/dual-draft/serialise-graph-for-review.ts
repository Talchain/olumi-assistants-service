/**
 * Compact deterministic serialisation of a GraphV3 draft for the M2 review
 * prompt.
 *
 * ~70–80% smaller than a pretty-printed JSON dump and — deliberately — a
 * projection: M2 sees structure (ids, kinds, labels, edge parameters) but no
 * value-bearing internals (interventions, observed_state, thresholds,
 * priors). What M2 never sees, it cannot echo back as an invented value.
 * Array order is preserved from the graph, so identical inputs always
 * serialise identically.
 */
import type { GraphV3T } from '../../schemas/cee-v3.js';

export function serialiseGraphForReview(graph: GraphV3T): string {
  const lines: string[] = [];

  lines.push('NODES (id | kind | label):');
  for (const n of graph.nodes) {
    lines.push(`- ${n.id} | ${n.kind} | ${n.label}`);
  }

  lines.push('');
  lines.push('EDGES (from -> to, strength mean/std, existence probability, direction):');
  for (const e of graph.edges) {
    lines.push(
      `- ${e.from} -> ${e.to} (mean=${e.strength.mean}, std=${e.strength.std}, exists_p=${e.exists_probability}, ${e.effect_direction})`,
    );
  }

  const goals = graph.nodes.filter((n) => n.kind === 'goal');
  if (goals.length > 0) {
    lines.push('');
    lines.push(`GOALS: ${goals.map((g) => g.id).join(', ')}`);
  }

  return lines.join('\n');
}
