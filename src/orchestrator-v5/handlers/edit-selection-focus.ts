import type { GraphV3T } from '../../orchestrator/types.js';
import type { SelectedElementsIngress } from '../boundary/request-extensions.js';

/** Published selection refs are capped at 20; keep the projection bounded too. */
const MAX_EDIT_FOCUS_ELEMENTS = 20;

/**
 * Project selected node identities into the existing edit-only `## FOCUS`
 * prompt section.
 *
 * The projection is deliberately strict and read-only:
 *
 * - IDs are resolved against the exact graph snapshot handed to edit_graph.
 * - Client labels/kinds never enter the prompt; all displayed fields come from
 *   the strict GraphV3 parse.
 * - Structural fallback graphs are ineligible because their labels/defaults
 *   are not an authoritative edit-context source.
 * - Missing, duplicate and ambiguous identities fail closed.
 * - Edge refs remain out of scope: GraphV3 edges have no stable `id`, so
 *   resolving one would require inference.
 *
 * JSON encoding makes every item one deterministic prompt record even when a
 * valid model label contains quotes or newlines.
 */
export function projectEditSelectionFocus(
  selectedElements: SelectedElementsIngress | null | undefined,
  graph: GraphV3T,
  graphStrictlyParsed: boolean,
): string[] {
  if (!graphStrictlyParsed || selectedElements === null || selectedElements === undefined) {
    return [];
  }

  const nodesById = new Map<string, GraphV3T['nodes'][number] | null>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, nodesById.has(node.id) ? null : node);
  }

  const focus: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedElements.node_ids) {
    if (seen.has(id)) continue;
    seen.add(id);

    const node = nodesById.get(id);
    if (node === undefined || node === null) continue;

    focus.push(JSON.stringify({ id: node.id, kind: node.kind, label: node.label }));
    if (focus.length === MAX_EDIT_FOCUS_ELEMENTS) break;
  }

  return focus;
}
