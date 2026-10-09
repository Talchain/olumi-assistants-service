import { isDeepStrictEqual } from 'node:util';
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

function records(value: unknown): Dict[] {
  return Array.isArray(value) ? value.filter((v): v is Dict => v !== null && typeof v === 'object' && !Array.isArray(v)) : [];
}

/** Each resolver-readable carrier is compared, including shadowed cells and the options mirror. */
function carrierCells(option: Dict, factor: string): unknown[] {
  const data = option.data as Dict | undefined;
  return [option.interventions, data?.interventions].map(c => {
    const carrier = c as Dict | undefined;
    return carrier && Object.hasOwn(carrier, factor) ? [carrier[factor]] : [];
  }).concat([Object.hasOwn(option, `data/interventions/${factor}`) ? [option[`data/interventions/${factor}`]] : []]);
}

/** Intent-free door check: changed cell bytes are the writer's change; unchanged bytes cannot acquire a new quantity. */
export function assertUntouchedLevelQuantities(before: unknown, after: unknown): void {
  if (before === null || before === undefined || after === null || typeof before !== 'object' || typeof after !== 'object') return;
  const base = before as Dict;
  const final = after as Dict;
  const oldNodes = records(base.nodes);
  const newNodes = records(final.nodes);
  const oldScales = buildFactorScaleMap(oldNodes);
  const newScales = buildFactorScaleMap(newNodes);
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
      if (!Object.hasOwn(newCells, factor) || !isDeepStrictEqual(carrierCells(option, factor), carrierCells(current, factor))) continue;
      const was = resolveRawInterventionValue(oldCells[factor], oldScales.get(factor));
      const now = resolveRawInterventionValue(newCells[factor], newScales.get(factor));
      if (was.codeNotMagnitude || now.codeNotMagnitude) continue;
      if (!sameEngineQuantity(was.value, now.value)) failures.add(`${option.id}::${factor}`);
    }
  }
  if (failures.size > 0) throw new UntouchedLevelRescaledError([...failures]);
}
