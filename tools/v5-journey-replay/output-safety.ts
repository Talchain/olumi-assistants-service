/**
 * Path-aware output-safety scanner for the v5 journey replay harness.
 *
 * Two responsibilities:
 *  1. Walk a response body and flag raw entity-IDs that leak into user-facing
 *     text fields, while ignoring structural fields (id, node_id, target, ...)
 *     where the same id is allowed.
 *  2. Scan user-facing text for internal terminology — split into a STRICT set
 *     (failure / recovery responses must be 100% clean) and a LENIENT set
 *     (logged as warnings on normal explanation responses to avoid drowning
 *     the harness in false positives on legitimate decision-content language
 *     like "implementation failure risk" or "winner-take-all").
 *
 * This is deliberately separate from `forbidden-terms.ts`, which backs the
 * legacy flat scan on assistant_text + chip text. The two modules layer:
 * forbidden-terms covers the existing six steps' core check; output-safety
 * runs in addition on every step that uses the new assertion helpers.
 */

/**
 * Mirror of `ENTITY_ID_LEAK_RE` from
 * `src/orchestrator/shared/entity-id-pattern.ts:25`. Hard-coded (not imported)
 * so the harness stays an external contract test rather than a tautology.
 *
 * Update both in lockstep if the canonical pattern changes.
 */
export const ENTITY_ID_RE =
  /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[_:-][a-z0-9_:-]+\b/i;

/**
 * Internal terms that must NEVER appear in user-facing text on failure
 * / recovery response paths. These are unambiguous internal-leak signals.
 */
export const INTERNAL_TERM_RE_STRICT =
  /\b(zod|executor|encountered\s+an\s+error|ai\s+service|analysis\s+service)\b/i;

/**
 * Softer phrases that often appear in legitimate decision content
 * ("handler" can be a real word in some contexts, "winner" is decision
 * vocabulary, "recommended" is normal advice prose). On normal explanation
 * paths these are reported as warnings, never hard fails.
 */
export const INTERNAL_TERM_RE_LENIENT = /\b(handler|winner|recommended)\b/i;

/**
 * Field names that are skipped at any depth during the entity-id walk.
 * These are structural / machine-consumed fields where a raw id is the
 * correct payload (e.g. `suggested_actions[].id`, `flip_scenarios[].factor_id`,
 * `coaching.bias_signals[].target`).
 *
 * Why the `_id`-suffix fallthrough below in addition to this allowlist:
 * the brief enumerated `id, node_id, edge_id, factor_id, option_id`, but
 * the v5 wire format emits a long tail of structural id fields the brief
 * couldn't have anticipated — `scenario_id`, `request_id`, `turn_id`,
 * `goal_node_id`, `decision_id`, `outcome_id`, `journey_id`, etc. All of
 * them carry raw entity-shaped values by contract; treating each as a
 * leak would drown the harness in false positives. A name-suffix rule
 * is the smallest abstraction that covers the family without naming
 * every variant. The rule is field-name-scoped: only the field whose
 * NAME ends in `_id` is skipped — sibling text fields (label, message,
 * narrative, summary, content) are still scanned at the same depth, so
 * a leak in user-facing text NEXT TO an excluded id is still flagged.
 * `EXCLUDED_FIELD_NAMES_SUFFIX_TEST` in the unit test pins this
 * behavior.
 */
const EXCLUDED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'id',
  'target',
  'referenced_option_ids',
  'flip_scenarios',
  'action_type',
  'payload',
  // Graph-edge endpoints — `from`/`to` carry node-id references by
  // contract, never user-facing text. Cross-boundary contract report
  // §6 documents path-aware exclusions for structural pointers; on the
  // V3 wire shape these are the canonical edge fields.
  'from',
  'to',
  // Diagnostic subtrees enumerated as not-user-facing in the
  // cross-boundary contract report §4 (Docs/v5/cross-boundary-contract-test-report.md).
  // These carry enum codes, structural ids in `details`, pipeline
  // metadata, etc. — all machine-consumed.
  'validation_warnings',
  'draft_warnings',
  'trace',
  'meta',
  '_meta',
  '_pipeline_outcome',
  '_diagnostics',
  'quality',
  'fallback_reason',
  'answer_source',
  // analysis_ready substructure: model_adjustments[*].field carries
  // factor-id references; interventions / raw_interventions are
  // option->factor maps with id keys.
  'model_adjustments',
  'interventions',
  'raw_interventions',
  'extraction_metadata',
  'intervention_details',
  'blockers',
]);

function isExcludedField(name: string): boolean {
  if (EXCLUDED_FIELD_NAMES.has(name)) return true;
  // Any field whose name ends in `_id` is a structural identifier.
  if (name.endsWith('_id')) return true;
  return false;
}

export interface EntityIdMatch {
  readonly path: string;
  readonly match: string;
}

/**
 * Walk `body` recursively. For each string value reached via a non-excluded
 * path, test against `ENTITY_ID_RE` and accumulate matches. Returns an empty
 * array when nothing leaks.
 */
export function scanForEntityIds(body: unknown): EntityIdMatch[] {
  const out: EntityIdMatch[] = [];
  walk(body, '$', out, scanString);
  return out;
}

export type InternalTermMode = 'strict' | 'lenient';

export interface InternalTermMatch {
  readonly path: string;
  readonly match: string;
  readonly mode: InternalTermMode;
}

/**
 * Scan only user-facing text fields for internal terminology. Skips structural
 * fields via the same `EXCLUDED_FIELD_NAMES` set, plus a small allowlist of
 * known user-facing strings.
 */
export function scanInternalTerms(body: unknown, mode: InternalTermMode): InternalTermMatch[] {
  const re = mode === 'strict' ? INTERNAL_TERM_RE_STRICT : INTERNAL_TERM_RE_LENIENT;
  const out: InternalTermMatch[] = [];
  walk(body, '$', out, (s, path, sink) => {
    const m = s.match(re);
    if (m && m[0]) {
      (sink as InternalTermMatch[]).push({ path, match: m[0], mode });
    }
  });
  return out;
}

function scanString(s: string, path: string, sink: EntityIdMatch[]): void {
  // Use a global regex by reconstructing — `ENTITY_ID_RE` is non-global so a
  // single .match returns only the first hit per call. For our purposes the
  // first hit per leaf is sufficient (the evidence row only needs one path
  // to fail), but capturing all matches is cheap and useful for triage.
  const global = new RegExp(ENTITY_ID_RE.source, ENTITY_ID_RE.flags.includes('g') ? ENTITY_ID_RE.flags : ENTITY_ID_RE.flags + 'g');
  let m: RegExpExecArray | null;
  while ((m = global.exec(s)) !== null) {
    sink.push({ path, match: m[0] });
    // Defensive: avoid infinite loop on zero-width matches.
    if (m.index === global.lastIndex) global.lastIndex++;
  }
}

type LeafFn<T> = (s: string, path: string, sink: T[]) => void;

function walk<T>(node: unknown, path: string, sink: T[], onString: LeafFn<T>): void {
  if (node == null) return;
  if (typeof node === 'string') {
    onString(node, path, sink);
    return;
  }
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walk(node[i], `${path}[${i}]`, sink, onString);
    }
    return;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (isExcludedField(key)) continue;
    walk(value, `${path}.${key}`, sink, onString);
  }
}
