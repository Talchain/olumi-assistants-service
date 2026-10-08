/** RC3 (a′): server-authored, option-bound preconditions stay on the model with no Run effect. */
import { NodeV3 } from '../../schemas/cee-v3.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { hasReliesOnRiskWrite } from '../graph-management/field-safety.js';

type Rec = Record<string, unknown>;
const record = (x: unknown): Rec | undefined => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Rec : undefined;
export type ReliesOnRisk = { readonly option_id: string };
export function readReliesOnRisk(raw: unknown): ReliesOnRisk | undefined {
  const parsed = NodeV3.shape.relies_on.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Re-check the stored stamp before hold AND apply; only its validated copy may bypass the producer-field screen. */
export function reliesOnRefereeOperations(operations: readonly PatchOperation[], graph: unknown): PatchOperation[] | undefined {
  const g = record(graph);
  const nodes = Array.isArray(g?.nodes) ? g.nodes.map(record).filter((n): n is Rec => n !== undefined) : [];
  const edges = Array.isArray(g?.edges) ? g.edges.map(record).filter((e): e is Rec => e !== undefined) : [];
  for (const op of operations) {
    const node = record(op.value);
    // The only exception to the generic writer screen is this validated,
    // top-level add stamp. Nested/merge updates never acquire that authority.
    if (hasReliesOnRiskWrite([op]) && (op.op !== 'add_node' || node?.relies_on === undefined)) return undefined;
    if (node?.relies_on === undefined) continue;
    const stamp = readReliesOnRisk(node.relies_on);
    const id = node.id;
    if (op.op !== 'add_node' || typeof id !== 'string' || op.path !== id || node.kind !== 'risk' || stamp === undefined
      || nodes.some((n) => n.id === id)
      || nodes.filter((n) => n.id === stamp.option_id).length !== 1
      || !nodes.some((n) => n.id === stamp.option_id && n.kind === 'option')
      || edges.some((e) => e.from === id || e.to === id)
      || operations.filter((other) => other.op === 'add_node' && other.path === id).length !== 1
      || operations.some((other) => {
        if (other === op) return false;
        const value = record(other.value);
        const pair = other.path.split('::');
        return other.path === id || value?.from === id || value?.to === id
          || (other.op.endsWith('_edge') && pair.includes(id))
          || (other.path === stamp.option_id && (other.op === 'remove_node' || value?.kind !== undefined));
      })) return undefined;
  }
  return operations.map((op) => {
    const value = record(op.value);
    if (op.op !== 'add_node' || value?.relies_on === undefined) return op;
    const { relies_on: _stamp, ...rest } = value;
    return { ...op, value: rest };
  });
}

/** Generic persistence merges may carry an existing server stamp, never change it. */
export function hasReliesOnRiskStampChange(before: unknown, after: unknown): boolean {
  const priorNodes = record(before)?.nodes;
  const nextNodes = record(after)?.nodes;
  const prior = Array.isArray(priorNodes) ? priorNodes.map(record).filter((n): n is Rec => n !== undefined) : [];
  if (!Array.isArray(nextNodes)) return false;
  return nextNodes.map(record).some(node => {
    if (node === undefined) return false;
    const previous = prior.find(n => n.id === node.id);
    return readReliesOnRisk(previous?.relies_on)?.option_id !== readReliesOnRisk(node.relies_on)?.option_id;
  });
}

/** Re-mintable disclosure: stored identity plus the current option label, with no model-authored copy. */
export function reliesOnRiskLine(riskLabel: string, optionLabel: string): string {
  return `‘${riskLabel}’: ‘${optionLabel}’ relies on this not happening. This model can't yet apply that risk to that option alone, `
    + "so the Run leaves it out, and that option's chance doesn't include it yet.";
}

/** The hold/card readers derive this from the same stamped add_node, never a sticky text member. */
export function heldReliesOnRiskLines(operations: readonly PatchOperation[], graph: unknown): string[] {
  if (reliesOnRefereeOperations(operations, graph) === undefined) return [];
  const nodes = record(graph)?.nodes;
  if (!Array.isArray(nodes)) return [];
  return operations.flatMap((op) => {
    const node = record(op.value);
    const stamp = op.op === 'add_node' ? readReliesOnRisk(node?.relies_on) : undefined;
    const option = stamp === undefined ? undefined : nodes.map(record).find((n) => n?.id === stamp.option_id && n.kind === 'option');
    return stamp !== undefined && typeof node?.label === 'string' && typeof option?.label === 'string'
      ? [reliesOnRiskLine(node.label, option.label)] : [];
  });
}
