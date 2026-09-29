import { parseEdgeTargetPath, type EditPatchOperationLike } from './adapters/edit-graph-producer.js';

type Dict = Record<string, unknown>;
export interface RemovedInterventionPair { readonly optionId: string; readonly factorId: string }
export type ConfirmedInterventionRemovalResult<T> =
  | { readonly status: 'unchanged' | 'reconciled'; readonly graph: T; readonly removedPairs: readonly RemovedInterventionPair[] }
  | { readonly status: 'refused'; readonly reason: 'ambiguous' | 'malformed_carrier' | 'conflicting_carrier' | 'not_landed' | 'readded_pair' };

function object(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (!object(left) || !object(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}

type Cell = { container: Dict; key: string; raw: boolean };
/** Enumerate existing cells without creating containers or interpreting absence. */
function cells(record: Dict, factorId: string): Cell[] {
  const result: Cell[] = [];
  const map = (container: Dict, key: string, raw = false) => {
    if (!Object.hasOwn(container, key)) return;
    const value = container[key];
    if (!object(value)) throw new Error('malformed_carrier');
    if (Object.hasOwn(value, factorId)) result.push({ container: value, key: factorId, raw });
  };
  map(record, 'interventions');
  map(record, 'raw_interventions', true);
  for (const root of ['data', 'observed_state']) {
    if (object(record[root])) map(record[root], 'interventions');
    for (const separator of ['/', '.']) map(record, `${root}${separator}interventions`);
  }
  for (const prefix of ['interventions', 'data/interventions', 'observed_state/interventions', 'data.interventions', 'observed_state.interventions']) {
    const separator = prefix.includes('.') ? '.' : '/';
    const key = `${prefix}${separator}${factorId}`;
    if (Object.hasOwn(record, key)) result.push({ container: record, key, raw: false });
    // A partial flat spec cannot establish agreement with the saved full cell.
    if (Object.keys(record).some(k => k.startsWith(`${key}${separator}`))) throw new Error('malformed_carrier');
  }
  return result;
}

function graphShape(value: unknown): { nodes: Dict[]; edges: Dict[]; options: Dict[] } {
  if (!object(value) || !Array.isArray(value.nodes) || !Array.isArray(value.edges) ||
      value.nodes.some(node => !object(node)) || value.edges.some(edge => !object(edge)) ||
      (value.options !== undefined && (!Array.isArray(value.options) || value.options.some(option => !object(option))))) {
    throw new Error('malformed_carrier');
  }
  return { nodes: value.nodes as Dict[], edges: value.edges as Dict[], options: (value.options ?? []) as Dict[] };
}

function unique(nodes: Dict[], id: string): Dict {
  const matches = nodes.filter(node => node.id === id);
  if (matches.length !== 1) throw new Error('ambiguous');
  return matches[0]!;
}

/**
 * Called only after the exact held batch was confirmed and applied. A whole
 * canonical map replacement AND a landed explicit edge removal jointly own
 * deletion; ordinary thin node mirrors never gain deletion authority here.
 */
export function propagateConfirmedInterventionRemovals<T>(input: {
  readonly beforeGraph: unknown;
  readonly afterGraph: T;
  readonly operations: readonly EditPatchOperationLike[];
}): ConfirmedInterventionRemovalResult<T> {
  try {
    const replacements = input.operations.filter(op => op.op === 'update_node' && object(op.value) && Object.hasOwn(op.value, 'interventions'));
    const removals = input.operations.filter(op => op.op === 'remove_edge').flatMap(op => {
      const target = parseEdgeTargetPath(op.path);
      return target ? [target] : [];
    });
    if (!replacements.some(op => removals.some(edge => edge.from === op.path))) {
      return { status: 'unchanged', graph: input.afterGraph, removedPairs: [] };
    }
    const before = graphShape(input.beforeGraph);
    const after = graphShape(input.afterGraph);
    const removedPairs: RemovedInterventionPair[] = [];
    for (const op of replacements) {
      if (!removals.some(edge => edge.from === op.path)) continue;
      const oldNode = unique(before.nodes, op.path);
      if (oldNode.kind !== 'option' || !object(oldNode.interventions)) continue;
      const replacement = (op.value as Dict).interventions;
      const omitted = Object.keys(oldNode.interventions).filter(factorId =>
        removals.some(edge => edge.from === op.path && edge.to === factorId) &&
        (!object(replacement) || !Object.hasOwn(replacement, factorId)));
      if (omitted.length === 0) continue;
      if (!object(replacement)) throw new Error('malformed_carrier');
      const newNode = unique(after.nodes, op.path);
      if (oldNode.kind !== 'option' || newNode.kind !== 'option') throw new Error('ambiguous');
      for (const factorId of omitted) {
        const paired = removals.filter(edge => edge.from === op.path && edge.to === factorId);
        if (paired.length !== 1 || replacements.filter(other => other.path === op.path).length !== 1) throw new Error('ambiguous');
        const oldFactor = unique(before.nodes, factorId);
        const newFactor = unique(after.nodes, factorId);
        if (oldFactor.kind !== newFactor.kind || oldFactor.kind === 'option') throw new Error('ambiguous');
        if (!object(newNode.interventions) || !sameValue(newNode.interventions, replacement) ||
            before.edges.filter(edge => edge.from === op.path && edge.to === factorId).length !== 1 ||
            after.edges.some(edge => edge.from === op.path && edge.to === factorId)) throw new Error('not_landed');
        for (const other of input.operations) {
          if ((other.op === 'add_node' || other.op === 'remove_node') && (other.path === op.path || other.path === factorId)) throw new Error('readded_pair');
          if (other.op === 'add_edge' || other.op === 'update_edge') {
            const edge = other.op === 'add_edge' && object(other.value) ? other.value : parseEdgeTargetPath(other.path);
            if (edge?.from === op.path && edge.to === factorId) throw new Error('readded_pair');
          }
          if (other.op === 'update_node' && other.path === op.path && object(other.value) && cells(other.value, factorId).length > 0) throw new Error('readded_pair');
        }
        const oldMirrors = before.options.filter(option => option.id === op.path);
        const newMirrors = after.options.filter(option => option.id === op.path);
        if (oldMirrors.length > 1 || newMirrors.length > 1) throw new Error('ambiguous');
        const original = oldNode.interventions[factorId];
        const readValue = (entry: unknown) => {
          const value = object(entry) ? entry.value : entry;
          if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('malformed_carrier');
          if (object(entry) && entry.target_match !== undefined &&
              (!object(entry.target_match) || entry.target_match.node_id !== factorId)) throw new Error('conflicting_carrier');
          if (object(entry) && entry.unit !== undefined && typeof entry.unit !== 'string') throw new Error('malformed_carrier');
          return { value, unit: object(entry) ? entry.unit : undefined };
        };
        const originalValue = readValue(original);
        const oldCells = [oldNode, ...oldMirrors].flatMap(record => cells(record, factorId));
        const newCells = [newNode, ...newMirrors].flatMap(record => cells(record, factorId));
        const raw = oldCells.filter(cell => cell.raw).map(cell => cell.container[cell.key]);
        if (raw.some(value => !['string', 'number', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value)) || value !== raw[0])) throw new Error('conflicting_carrier');
        for (const cell of [...oldCells, ...newCells]) {
          const value = cell.container[cell.key];
          if (cell.raw) {
            if (!['string', 'number', 'boolean'].includes(typeof value) || value !== raw[0]) throw new Error('conflicting_carrier');
          } else {
            const observed = readValue(value);
            if (observed.value !== originalValue.value ||
                (observed.unit !== undefined && originalValue.unit !== undefined && observed.unit !== originalValue.unit)) throw new Error('conflicting_carrier');
          }
        }
        removedPairs.push({ optionId: op.path, factorId });
      }
    }
    if (removedPairs.length === 0) return { status: 'unchanged', graph: input.afterGraph, removedPairs };
    const graph = structuredClone(input.afterGraph);
    const cloned = graphShape(graph);
    for (const { optionId, factorId } of removedPairs) {
      const records = [unique(cloned.nodes, optionId), ...cloned.options.filter(option => option.id === optionId)];
      for (const record of records) for (const cell of cells(record, factorId)) delete cell.container[cell.key];
    }
    return { status: 'reconciled', graph, removedPairs };
  } catch (error) {
    const reasons = ['ambiguous', 'malformed_carrier', 'conflicting_carrier', 'not_landed', 'readded_pair'] as const;
    const reason = reasons.find(reason => error instanceof Error && error.message === reason) ?? 'malformed_carrier';
    return { status: 'refused', reason };
  }
}
