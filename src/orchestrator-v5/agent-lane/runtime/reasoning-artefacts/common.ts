import { createHash } from 'node:crypto';

/** Binding, hashing and provenance helpers extracted from pr/2159 common.ts. */

export type Provenance = 'user_stated' | 'source_evidence' | 'olumi_hypothesis' | 'unknown';

export interface DependencyIdentity {
  readonly kind: 'option' | 'criterion' | 'preference' | 'utility' | 'constraint' | 'analysis' | 'source' | 'claim' | 'fact_verdict' | 'model_element' | 'map_structure' | 'protocol';
  readonly id: string;
  readonly fingerprint: string;
}

export interface ArtefactBinding {
  readonly scenario_id: string;
  /** Historical provenance; changes here alone do not make an artefact stale. */
  readonly graph_revision: string;
  readonly dependencies: readonly DependencyIdentity[];
}

export class ArtefactInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ArtefactInputError';
  }
}

export function fail(code: string): never {
  throw new ArtefactInputError(code);
}

export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid_record');
  return value as Record<string, unknown>;
}

export function own(value: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(value, key) ? value[key] : undefined;
}

export function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some((key) => !Object.hasOwn(value, key))) fail('missing_field');
  if (Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))) fail('unexpected_field');
}

export function str(value: unknown, max = 600): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) fail('invalid_string');
  return value;
}

export function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail('invalid_array');
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) fail('sparse_array');
  }
  return value;
}

export function provenance(value: unknown): Provenance {
  if (value !== 'user_stated' && value !== 'source_evidence' && value !== 'olumi_hypothesis' && value !== 'unknown') {
    fail('invalid_provenance');
  }
  return value;
}

export function unique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

/** Object keys are sorted; arrays keep their meaningful order. Inherited keys are never read. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('non_json_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${list(value).map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const r = value as Record<string, unknown>;
    return `{${Object.keys(r).sort().map((key) => {
      const item = own(r, key);
      if (item === undefined) fail('non_json_value');
      return `${JSON.stringify(key)}:${canonicalJson(item)}`;
    }).join(',')}}`;
  }
  return fail('non_json_value');
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function dependency(kind: DependencyIdentity['kind'], id: string, value: unknown): DependencyIdentity {
  return { kind, id, fingerprint: contentHash(value) };
}

export function binding(scenarioId: unknown, graphRevision: unknown, dependencies: readonly DependencyIdentity[]): ArtefactBinding {
  const scenario_id = str(scenarioId, 160);
  const graph_revision = str(graphRevision, 160);
  unique(dependencies.map((d) => `${d.kind}\u0000${d.id}`), 'duplicate_dependency');
  return { scenario_id, graph_revision, dependencies: [...dependencies] };
}

export type BindingCurrentness =
  | { readonly state: 'current'; readonly changed_dependencies: readonly [] }
  | { readonly state: 'stale'; readonly changed_dependencies: readonly string[] }
  | { readonly state: 'invalid'; readonly changed_dependencies: readonly [] };

export function assessBindingCurrentness(saved: ArtefactBinding, current: ArtefactBinding): BindingCurrentness {
  if (saved.scenario_id !== current.scenario_id) return { state: 'invalid', changed_dependencies: [] };
  const now = new Map(current.dependencies.map((d) => [`${d.kind}\u0000${d.id}`, d.fingerprint]));
  const before = new Set(saved.dependencies.map((d) => `${d.kind}\u0000${d.id}`));
  const changed = saved.dependencies.filter((d) => now.get(`${d.kind}\u0000${d.id}`) !== d.fingerprint)
    .map((d) => `${d.kind}:${d.id}`);
  changed.push(...current.dependencies.filter((d) => !before.has(`${d.kind}\u0000${d.id}`))
    .map((d) => `${d.kind}:${d.id}`));
  return changed.length === 0
    ? { state: 'current', changed_dependencies: [] }
    : { state: 'stale', changed_dependencies: changed };
}

