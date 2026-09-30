import { canonicalLabel, shortLabel } from './admit-model.js';

interface OptionNode {
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly description?: unknown;
}

/**
 * Match an admitted option to its draft identity after admission shortens its display label.
 * Admission preserves the full draft label in `description`. Accept it only when the node's
 * label is exactly that text shortened by admission; arbitrary descriptions are not identities.
 * The correspondence must be one-to-one on both sides. This establishes identity, never evidence
 * that an option is user-authored: quotes and ownership still pass their own existing checks.
 */
export function admittedOptionKeys<N extends OptionNode>(
  nodes: readonly N[], options: readonly { readonly label: string }[],
): ReadonlyMap<N, string> {
  const candidateCounts = new Map<string, number>();
  for (const option of options) {
    const key = canonicalLabel(option.label ?? '');
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }
  const correspondence: [N, string][] = [];
  const nodeCounts = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== 'option' || typeof node.label !== 'string') continue;
    const full = typeof node.description === 'string' && node.description !== node.label
      && shortLabel(node.description) === node.label ? node.description : node.label;
    const key = canonicalLabel(full);
    if (key === '' || candidateCounts.get(key) !== 1) continue;
    correspondence.push([node, key]);
    nodeCounts.set(key, (nodeCounts.get(key) ?? 0) + 1);
  }
  return new Map(correspondence.filter(([, key]) => nodeCounts.get(key) === 1));
}
