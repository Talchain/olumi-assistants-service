import { sameEngineQuantity } from '../untouched-level-invariant.js';
import { isDeepStrictEqual } from 'node:util';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { defaultFrameFor } from './admit-model.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../tools/plot-intervention-scale.js';

/** Resolve derived ranges over the complete native cohort, never its first/last member. */
export function proposedFrameForLevels(levels: readonly { raw_value?: number; cap?: number }[]): number | null {
  const native = levels.flatMap(l => typeof l.raw_value === 'number' && Number.isFinite(l.raw_value) ? [l.raw_value] : []);
  if (native.length === 0) return null;
  const largest = Math.max(...native.map(Math.abs));
  const caps = [...new Set(levels.flatMap(l => typeof l.cap === 'number' && Number.isFinite(l.cap) && l.cap > 0 ? [l.cap] : []))];
  if (caps.length === 1 && caps[0]! >= largest) return caps[0]!;
  return largest > 1 || caps.length > 1 ? defaultFrameFor(largest) : null;
}

/** Preserve the native point and all other metadata while changing its coordinate frame. */
export function levelOnFinalFrame<T extends { value: number; raw_value?: number; cap?: number }>(level: T, cap: number | null): T {
  return cap !== null && typeof level.raw_value === 'number' && Number.isFinite(level.raw_value)
    ? { ...level, value: level.raw_value / cap, cap } : level;
}

export const SIBLING_LEVEL_UNRESOLVABLE = 'sibling_level_unresolvable';
export const SIBLING_LEVEL_UNRESOLVABLE_SENTENCE =
  'Nothing was saved. Olumi couldn\'t read another option\'s level for this factor, so it didn\'t add a range that could change it.';
export const SIBLING_REENCODE_DISCLOSURE_PARTS = [
  'Kept "', '" on "', '" at the same amount on the new range.',
] as const;

export interface ReencodedSibling {
  readonly option_id: string;
  readonly factor_id: string;
  readonly option: string;
  readonly factor: string;
  readonly quantity: number;
  readonly detail: string;
}

export function siblingReencodeDisclosure(option: string, factor: string): string {
  const [start, middle, end] = SIBLING_REENCODE_DISCLOSURE_PARTS;
  return start + option + middle + factor + end;
}

type Dict = Record<string, unknown>;
function frameOf(node: Dict): number | undefined {
  const os = (node.observed_state ?? {}) as Dict;
  return typeof os.cap === 'number' && Number.isFinite(os.cap) && os.cap > 0 ? os.cap
    : typeof node.scale_frame === 'number' && Number.isFinite(node.scale_frame) && node.scale_frame > 1 ? node.scale_frame : undefined;
}

/**
 * Plan the approval's frame transition and sibling preservation together, before
 * any write. Resolve on the trusted preimage with PLoT's egress owner.
 * Encoded codes are the sole exception: the resolver proves frames never scale
 * them. An unresolved cell refuses the whole plan; neither input is mutated.
 */
export function preserveSiblingQuantities<T>(before: unknown, after: T,
  targets: readonly { optionId: string; factorId: string }[]):
  | { kind: 'preserved'; graph: T; reencoded: ReencodedSibling[] }
  | { kind: 'refused'; reason: 'sibling_level_unresolvable' | 'level_frame_mismatch' | 'untouched_level_rescaled' } {
  const prior = before as { nodes?: Dict[]; options?: Dict[] };
  const result = structuredClone(after) as T & { nodes?: Dict[]; options?: Dict[] };
  if (!Array.isArray(prior.nodes) || !Array.isArray(result.nodes)) return { kind: 'preserved', graph: after, reencoded: [] };
  const attached = new Map<string, { cap: number; label: string; initial: boolean }>();
  for (const node of result.nodes) {
    if (node.kind !== 'factor' || typeof node.id !== 'string') continue;
    const was = prior.nodes.find(n => n.id === node.id);
    const cap = frameOf(node);
    if (was !== undefined && frameOf(was) !== cap && cap !== undefined) {
      attached.set(node.id, { cap, label: String(node.label ?? node.id), initial: frameOf(was) === undefined });
    }
  }
  if (attached.size === 0) return { kind: 'preserved', graph: after, reencoded: [] };
  const scales = buildFactorScaleMap(prior.nodes);
  const finalScales = buildFactorScaleMap(result.nodes);
  const selected = new Set(targets.map(t => `${t.optionId}::${t.factorId}`));
  const reencoded = new Map<string, ReencodedSibling>();
  const collections = [
    { before: prior.nodes.filter(n => n.kind === 'option'), after: result.nodes.filter(n => n.kind === 'option') },
    { before: prior.options ?? [], after: result.options ?? [] },
  ];
  for (const collection of collections) for (const option of collection.after) {
    const was = collection.before.find(n => n.id === option.id);
    if (was === undefined) continue;
    const carriers = [option.interventions, (option.data as Dict | undefined)?.interventions]
      .filter((c): c is Dict => c !== null && typeof c === 'object');
    for (const [factorId, { cap, label, initial }] of attached) {
      const key = `${option.id}::${factorId}`;
      if (selected.has(key)) continue;
      const cells = [...carriers.filter(c => Object.hasOwn(c, factorId)).map(c => ({ carrier: c, key: factorId })),
        ...(Object.hasOwn(option, `data/interventions/${factorId}`) ? [{ carrier: option, key: `data/interventions/${factorId}` }] : [])];
      if (cells.length === 0) continue;
      const resolved = resolveRawInterventionValue(mergeInterventionSourceObjects(was)[factorId], scales.get(factorId));
      if (resolved.value === null) return { kind: 'refused', reason: SIBLING_LEVEL_UNRESOLVABLE };
      if (resolved.codeNotMagnitude) continue;
      const quantity = resolved.value;
      const nextResolved = resolveRawInterventionValue(mergeInterventionSourceObjects(option)[factorId], finalScales.get(factorId));
      const held = mergeInterventionSourceObjects(was)[factorId];
      const rawPair = held !== null && typeof held === 'object' ? held as Dict : undefined;
      // Keep existing writer representations: initial attachment re-encodes
      // siblings (including scale_frame-only factors); cap edits refresh
      // consistent numeric raw pairs. Native-looking passthrough stays native.
      const refreshPair = typeof rawPair?.raw_value === 'number' && Number.isFinite(rawPair.raw_value)
        && resolved.rule === 'raw_value_used' && resolved.unitIntervalEquivalent !== undefined;
      const initialEncoding = initial && (resolved.rule === 'raw_value_used'
        || (resolved.inputValue !== null && resolved.inputValue >= 0 && resolved.inputValue <= 1));
      if (sameEngineQuantity(quantity, nextResolved.value) && !refreshPair && !initialEncoding) continue;
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > cap) return { kind: 'refused', reason: 'level_frame_mismatch' };
      for (const { carrier, key: cellKey } of cells) {
        const cell = carrier[cellKey];
        const next = { ...(typeof cell === 'object' && cell !== null ? cell : {}), value: quantity / cap, raw_value: quantity, cap };
        if (typeof cell === 'object' && cell !== null && Object.hasOwn(cell, 'raw_value')) {
          Object.assign(next, { raw_value: (cell as Dict).raw_value });
        }
        const check = resolveRawInterventionValue(next, finalScales.get(factorId));
        if (!sameEngineQuantity(quantity, check.value)) return { kind: 'refused', reason: 'untouched_level_rescaled' };
        if (isDeepStrictEqual(cell, next)) continue;
        carrier[cellKey] = next;
        const optionLabel = String(option.label ?? option.id);
        reencoded.set(key, { option_id: String(option.id), factor_id: factorId, option: optionLabel, factor: label,
          quantity, detail: siblingReencodeDisclosure(optionLabel, label) });
      }
    }
  }
  return { kind: 'preserved', graph: result, reencoded: [...reencoded.values()] };
}

/** Identify only stored coordinate changes proven to preserve PLoT quantities. */
export function reencodedSiblingDiff(before: unknown, after: unknown): ReencodedSibling[] {
  const prior = before as { nodes?: Dict[]; options?: Dict[] };
  const current = after as { nodes?: Dict[]; options?: Dict[] };
  const hybrid = { ...current, nodes: current.nodes?.map(n => n.kind === 'option' ? prior.nodes?.find(p => p.id === n.id) ?? n : n),
    ...(prior.options !== undefined ? { options: prior.options } : {}) };
  const plan = preserveSiblingQuantities(before, hybrid, []);
  if (plan.kind !== 'preserved') return [];
  const scales = buildFactorScaleMap(current.nodes ?? []);
  return plan.reencoded.filter(cell => {
    const option = [...(current.nodes ?? []), ...(current.options ?? [])].find(n => n.id === cell.option_id);
    if (option === undefined) return false;
    const held = mergeInterventionSourceObjects(option)[cell.factor_id] as Dict | undefined;
    const was = [...(prior.nodes ?? []), ...(prior.options ?? [])].find(n => n.id === cell.option_id);
    return held !== undefined && !isDeepStrictEqual(was && mergeInterventionSourceObjects(was)[cell.factor_id], held)
      && held.value === cell.quantity / (held.cap as number) && held.raw_value === cell.quantity
      && resolveRawInterventionValue(held, scales.get(cell.factor_id)).value === cell.quantity;
  });
}
