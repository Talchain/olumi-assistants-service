import { isDeepStrictEqual } from 'node:util';
import { parseFlatInterventionKey } from '../orchestrator/tools/encode-option-interventions.js';
import { mergeInterventionSourceObjects } from '../orchestrator/tools/analysis-ready-helper.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from './tools/plot-intervention-scale.js';
import { PersistedGraphInvariantError } from './persisted-graph-invariants.js';

type Dict = Record<string, unknown>;
export function sameEngineQuantity(a: number | null, b: number | null): boolean {
  return a === b || (a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b)
    && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b)));
}

export class UntouchedLevelRescaledError extends PersistedGraphInvariantError {
  readonly reason = 'untouched_level_rescaled' as const;
  constructor(pairs: string[]) {
    super([{ code: 'untouched_level_rescaled', entity_ids: pairs.sort().slice(0, 20), count: pairs.length }]);
  }
}

export function records(value: unknown): Dict[] {
  return Array.isArray(value) ? value.filter((v): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
}

/**
 * The winning egress cell, with only resolver inputs. Bare numbers and promoted
 * {value} objects are equivalent. Source/evidence/target metadata and shadowed
 * carriers do not reach the resolver.
 * Field authority: tools/plot-intervention-scale.ts:239-266 reads value,
 * raw_value and delegates encoding to classifyEncodedInterventionAdmissibility
 * (orchestrator/shared/encoded-intervention-admissibility.ts:38-66), which also
 * reads value_type and encoding_map. The cell's cap is not consulted.
 */
export function resolverInput(option: Dict, factor: string): Dict | undefined {
  const cell = mergeInterventionSourceObjects(option)[factor];
  if (typeof cell === 'number') return { value: cell };
  if (cell === null || typeof cell !== 'object') return undefined;
  const input = cell as Dict;
  return Object.fromEntries(['value', 'raw_value', 'value_type', 'encoding_map']
    .filter(field => input[field] !== undefined).map(field => [field, input[field]]));
}

/** Full scale-map entry, including convention proof and diagnostic unit.
 * Authority: tools/plot-intervention-scale.ts:404-449; never a cap-only proxy.
 */
export function resolverFrame(factor: Dict) {
  return typeof factor.id === 'string' ? buildFactorScaleMap([factor]).get(factor.id) : undefined;
}

/** Approval is operation intent, including raw-only inputs the egress reader drops. */
export function approvedInterventionTargets(
  operations: readonly { op: string; path: string; value?: unknown }[], nodes: unknown,
): { optionId: string; factorId: string }[] {
  return operations.flatMap(op => {
    const node = records(nodes).find(n => n.id === op.path && n.kind === 'option');
    if (!node || (op.op !== 'update_node' && op.op !== 'add_node') || op.value === null || typeof op.value !== 'object') return [];
    const value = op.value as Dict;
    const data = value.data as Dict | undefined;
    const keys = new Set<string>();
    for (const carrier of [value.interventions, data?.interventions]) {
      if (carrier !== null && typeof carrier === 'object' && !Array.isArray(carrier)) {
        for (const key of Object.keys(carrier)) keys.add(key);
      }
    }
    for (const key of Object.keys(value)) {
      const factorId = parseFlatInterventionKey(key);
      if (factorId !== undefined) keys.add(factorId);
    }
    return [...keys].map(factorId => ({ optionId: op.path, factorId }));
  });
}

/** Intent-free door: unchanged resolver inputs cannot acquire a new quantity. */
/** True when any resolver-readable carrier still has a key for this factor, finite or not. */
function carrierHolds(option: Dict, factor: string): boolean {
  const data = option.data as Dict | undefined;
  return [option.interventions, data?.interventions].some(c => c !== null && typeof c === 'object' && Object.hasOwn(c as Dict, factor))
    || Object.hasOwn(option, `data/interventions/${factor}`);
}

export function assertUntouchedLevelQuantities(before: unknown, after: unknown): void {
  if (before === null || before === undefined || after === null || typeof before !== 'object' || typeof after !== 'object') return;
  const base = before as Dict;
  const final = after as Dict;
  const oldNodes = records(base.nodes);
  const newNodes = records(final.nodes);
  const oldScales = new Map(oldNodes.map(n => [n.id, resolverFrame(n)]));
  const newScales = new Map(newNodes.map(n => [n.id, resolverFrame(n)]));
  const collections = [
    [oldNodes.filter(n => n.kind === 'option'), newNodes.filter(n => n.kind === 'option')],
    [records(base.options), records(final.options)],
  ];
  const failures = new Set<string>();
  for (const [oldOptions, newOptions] of collections) for (const option of oldOptions!) {
    const current = newOptions!.find(n => n.id === option.id);
    if (!current) continue;
    const oldCells = mergeInterventionSourceObjects(option);
    const newCells = mergeInterventionSourceObjects(current);
    for (const factor of Object.keys(oldCells)) {
      if (!Object.hasOwn(newCells, factor)) {
        // A carrier still holds the level but the engine can no longer read it: the level vanished, not removed.
        if (carrierHolds(current, factor)) failures.add(`${option.id}::${factor}`);
        continue;
      }
      if (!isDeepStrictEqual(resolverInput(option, factor), resolverInput(current, factor))) continue;
      const was = resolveRawInterventionValue(resolverInput(option, factor), oldScales.get(factor));
      const now = resolveRawInterventionValue(resolverInput(current, factor), newScales.get(factor));
      if (was.codeNotMagnitude || now.codeNotMagnitude) continue;
      if (!sameEngineQuantity(was.value, now.value)) failures.add(`${option.id}::${factor}`);
    }
  }
  if (failures.size > 0) throw new UntouchedLevelRescaledError([...failures]);
}
