/**
 * V5 edit_graph P0 (add-option encoding) — encode option interventions to the
 * canonical top-level OptionV3 contract, or report which options cannot be
 * safely encoded so the edit can DEFER (reject) rather than persist an
 * analysis-incompatible option.
 *
 * Why this exists: the edit_graph LLM emits option interventions in shapes that
 * are NOT analysis-ready after `GraphV3.safeParse` strips `node.data`:
 *   SHAPE 1: `data.interventions: { <fac>: {unit, raw_value} }` with NO numeric
 *            `value` (the prompt asks for `value`; the model omits it).
 *   SHAPE 2: option-level `unit`/`raw_value` smeared onto the option node, with
 *            NO interventions bundle at all.
 * (Both also occur at TOP-LEVEL `interventions` — a raw-only entry there is just
 * as unconfigured, since analysis reads a finite numeric `value`.)
 * Each reaches run_analysis with zero numeric interventions → options_not_configured.
 *
 * This function (run in the edit handler BEFORE commit) recovers interventions
 * from every location and DERIVES the model-unit `value` using the SAME
 * canonical encoder `set_factor_value` uses — `normaliseFactorValue`
 * (`value = raw_value / cap`). It does NOT invent value-scale semantics:
 *   - `value` already present (numeric) → used as-is (PR #276 behaviour preserved).
 *   - `value` missing but `raw_value` + a cap → encoded, BUT only when the target
 *     factor RESOLVES to a real factor node and the canonical predicate (run with
 *     the factor's `unit`) accepts the proposal (so a unit mismatch / out-of-range
 *     / ambiguous bare number is rejected → deferred).
 *   - otherwise NOT safely derivable → the option id is returned as UNRESOLVED and
 *     the caller must reject/defer the edit (no graph mutation).
 *
 * Independent of the Track S intercept repair and the PR #276 commit normaliser
 * (which still runs at commit as a safety net).
 */
import { normaliseFactorValue } from '../../orchestrator-v5/tools/handlers/d1-shared/normalise-factor-value.js';
import { log } from '../../utils/telemetry.js';

type Dict = Record<string, unknown>;
const SLASH_KEY_RE = /^data\/interventions\/(.+)$/;

/** Raw intervention recovered from any location, pre-encoding. */
interface RawIntervention {
  /** Model-unit value when already present (0..1). */
  readonly value?: number;
  /** User-unit value before normalisation. */
  readonly raw_value?: number;
  readonly unit?: string;
  /** Cap carried on the intervention object itself (proposal cap). */
  readonly cap?: number;
}

export interface EncodeOptionInterventionsResult<T> {
  /** The encoded graph (a clone) when any option was rewritten; else the original reference. */
  readonly graph: T;
  /**
   * Option ids that carry intervention intent that cannot be made analysis-ready.
   * Restricted to `touchedOptionIds` when provided. Non-empty ⇒ the caller MUST
   * defer (reject) the edit without committing the graph.
   */
  readonly unresolvedOptionIds: string[];
}

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Interpret a recovered source (bare scalar = model value; object = {value,raw_value,unit,cap}). */
function toRawIntervention(src: unknown): RawIntervention {
  const bare = finiteNum(src);
  if (bare !== undefined) return { value: bare };
  if (!isPlainObject(src)) return {};
  const out: { value?: number; raw_value?: number; unit?: string; cap?: number } = {};
  const v = finiteNum(src.value);
  if (v !== undefined) out.value = v;
  const rv = finiteNum(src.raw_value);
  if (rv !== undefined) out.raw_value = rv;
  if (typeof src.unit === 'string') out.unit = src.unit;
  const cap = finiteNum(src.cap);
  if (cap !== undefined) out.cap = cap;
  return out;
}

/**
 * Gather an option's interventions that are NOT already canonical-numeric, from
 * (precedence high→low): data.interventions, slash-keyed, node-level (SHAPE 2,
 * single factor edge, only when no top-level bundle), and finally any top-level
 * entry lacking a finite numeric `value` (raw-only/malformed). Numeric top-level
 * entries are NOT gathered — they are preserved verbatim by the caller.
 */
function gatherRawInterventions(node: Dict, factorTargets: readonly string[]): Map<string, RawIntervention> {
  const out = new Map<string, RawIntervention>();

  // Source 1: data.interventions (SHAPE 1).
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    for (const [fac, src] of Object.entries(data.interventions as Dict)) {
      out.set(fac, toRawIntervention(src));
    }
  }

  // Source 2: slash-keyed flat entries `data/interventions/<fac>`.
  for (const [k, v] of Object.entries(node)) {
    const m = SLASH_KEY_RE.exec(k);
    if (!m) continue;
    const fac = m[1]!;
    if (out.has(fac)) continue;
    out.set(fac, toRawIntervention(v));
  }

  // Source 3 (SHAPE 2): node-level unit/raw_value/value, no bundle, single factor edge.
  const nodeLevel = toRawIntervention({ value: node.value, raw_value: node.raw_value, unit: node.unit, cap: node.cap });
  const hasNodeLevel = nodeLevel.value !== undefined || nodeLevel.raw_value !== undefined;
  if (out.size === 0 && !isPlainObject(node.interventions) && hasNodeLevel && factorTargets.length === 1) {
    out.set(factorTargets[0]!, nodeLevel);
  }

  // Source 4 (lowest): top-level entries WITHOUT a finite numeric value (raw-only/malformed).
  const top = node.interventions;
  if (isPlainObject(top)) {
    for (const [fac, src] of Object.entries(top)) {
      if (out.has(fac)) continue;
      const rec = toRawIntervention(src);
      if (rec.value !== undefined) continue; // numeric → preserved verbatim, not gathered
      out.set(fac, rec);
    }
  }

  return out;
}

/**
 * Derive the model-unit `value`, or `undefined` when it cannot be SAFELY derived
 * (the defer signal). Safe derivation requires: a resolvable target factor, a cap
 * (from the intervention or the factor's observed_state), and acceptance by the
 * canonical predicate run WITH the factor's unit (rejecting unit mismatch /
 * out-of-range / ambiguous bare numbers). Never invents a scale.
 */
function deriveValue(rec: RawIntervention, factor: Dict | undefined): number | undefined {
  if (rec.value !== undefined) return rec.value;
  if (rec.raw_value === undefined) return undefined;
  if (factor === undefined) return undefined; // target must resolve to a real factor

  const obs = isPlainObject(factor.observed_state) ? factor.observed_state : undefined;
  const factorCap = obs ? finiteNum(obs.cap) : undefined;
  const factorUnit = obs && typeof obs.unit === 'string' ? obs.unit : undefined;
  const effectiveCap = rec.cap ?? factorCap;
  if (effectiveCap === undefined) return undefined; // no cap → not safely derivable

  try {
    const { value } = normaliseFactorValue({
      rawInput: rec.raw_value,
      ...(rec.unit !== undefined ? { unit: rec.unit } : {}),
      ...(rec.cap !== undefined ? { proposalCap: rec.cap } : {}),
      ...(factorCap !== undefined ? { factorCap } : {}),
      ...(factorUnit !== undefined ? { factorUnit } : {}),
      inputHasUnit: rec.unit !== undefined,
    });
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined; // canonical guards rejected (unit mismatch / range / ambiguous) → defer
  }
}

/** Construct a canonical InterventionV3, preserving an existing top-level entry's target_match. */
function buildInterventionV3(fac: string, value: number, rec: RawIntervention, existing: unknown): Dict {
  const iv: Dict = {
    value,
    source: 'user_specified',
    target_match:
      isPlainObject(existing) && isPlainObject(existing.target_match)
        ? existing.target_match
        : { node_id: fac, match_type: 'exact_id', confidence: 'high' },
  };
  if (rec.unit !== undefined) iv.unit = rec.unit;
  if (rec.raw_value !== undefined) iv.raw_value = rec.raw_value;
  return iv;
}

/**
 * Encode option interventions to the canonical top-level contract, or report
 * which (touched) options cannot be safely encoded.
 *
 * @param graph  the post-edit graph (any shape; treated defensively).
 * @param touchedOptionIds  option ids the edit referenced; only these can flag an
 *   unresolved/defer (a pre-existing malformed option cannot block an unrelated
 *   edit). When undefined, every option may flag.
 */
export function encodeOptionInterventionsForEdit<T>(
  graph: T,
  touchedOptionIds?: ReadonlySet<string>,
): EncodeOptionInterventionsResult<T> {
  if (!isPlainObject(graph) || !Array.isArray((graph as Dict).nodes)) {
    return { graph, unresolvedOptionIds: [] };
  }

  try {
    const nodes = (graph as Dict).nodes as unknown[];
    const edges = Array.isArray((graph as Dict).edges) ? ((graph as Dict).edges as unknown[]) : [];

    const factorById = new Map<string, Dict>();
    for (const n of nodes) {
      if (isPlainObject(n) && n.kind === 'factor' && typeof n.id === 'string') factorById.set(n.id, n);
    }
    const optionTargets = new Map<string, string[]>();
    for (const e of edges) {
      if (!isPlainObject(e)) continue;
      const from = e.from;
      const to = e.to;
      if (typeof from === 'string' && typeof to === 'string' && factorById.has(to)) {
        (optionTargets.get(from) ?? optionTargets.set(from, []).get(from)!).push(to);
      }
    }

    // NOTE on scope: ENCODE is applied to every encodable option (touched or
    // not) — a benign normalisation that mirrors the PR #276 commit normaliser
    // and is robust to a touched-detector false-negative. It can therefore repair
    // a pre-existing malformed option during an unrelated edit (and change the
    // graph hash); `node_ids` below makes that measurable. DEFER, by contrast, is
    // strictly touched-scoped — a pre-existing un-encodable option never blocks an
    // unrelated edit.
    const plan: Array<{ index: number; id: string; bundle: Dict }> = [];
    const unresolved: string[] = [];

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      const id = typeof node.id === 'string' ? node.id : '<unknown>';
      const isTouched = !touchedOptionIds || touchedOptionIds.has(id);
      const targets = optionTargets.get(id) ?? [];
      const recovered = gatherRawInterventions(node, targets);

      // Preserve numeric top-level entries verbatim (PR #276 configured entries).
      const base: Dict = {};
      const top = node.interventions;
      if (isPlainObject(top)) {
        for (const [fac, iv] of Object.entries(top)) {
          if (toRawIntervention(iv).value !== undefined) base[fac] = isPlainObject(iv) ? { ...iv } : iv;
        }
      }

      if (recovered.size === 0) {
        // Nothing to encode here. A touched option carrying node-level intervention
        // intent that gatherRawInterventions could not attribute (SHAPE 2 with an
        // ambiguous target — zero or multiple factor edges) is malformed → defer.
        // NOTE: an option merely WIRED to factors with no interventions is a valid
        // intermediate ("needs encoding") state — NOT a malformed intervention — so
        // it is left alone. Deferring it would wrongly reject an unrelated edit
        // (e.g. a label rename) on such a pre-existing under-configured option.
        if (Object.keys(base).length === 0) {
          const nodeLevelIntent = finiteNum(node.raw_value) !== undefined || finiteNum(node.value) !== undefined;
          if (nodeLevelIntent && isTouched) unresolved.push(id);
        }
        continue;
      }

      const bundle: Dict = { ...base };
      let optionUnresolved = false;
      for (const [fac, rec] of recovered) {
        const value = deriveValue(rec, factorById.get(fac));
        if (value === undefined) {
          optionUnresolved = true;
          break;
        }
        bundle[fac] = buildInterventionV3(fac, value, rec, base[fac]);
      }

      if (optionUnresolved) {
        if (isTouched) unresolved.push(id);
        continue; // leave malformed; discarded if the edit defers (touched), else untouched
      }
      plan.push({ index: i, id, bundle });
    }

    if (unresolved.length > 0) {
      return { graph, unresolvedOptionIds: unresolved }; // caller defers; no clone/mutate
    }
    if (plan.length === 0) {
      return { graph, unresolvedOptionIds: [] };
    }

    const clone = JSON.parse(JSON.stringify(graph)) as T;
    const cloneNodes = (clone as Dict).nodes as Dict[];
    for (const { index, bundle } of plan) {
      const node = cloneNodes[index]!;
      node.interventions = bundle;
      if (isPlainObject(node.data)) {
        delete (node.data as Dict).interventions;
        if (Object.keys(node.data as Dict).length === 0) delete node.data;
      }
      for (const k of Object.keys(node)) {
        if (SLASH_KEY_RE.test(k)) delete node[k];
      }
      delete node.unit;
      delete node.raw_value;
      delete node.value;
      delete node.cap;
    }

    log.info(
      { event: 'v5.edit_graph.option_interventions_encoded', encoded_count: plan.length, node_ids: plan.map((p) => p.id) },
      '[edit_graph] encoded option interventions to the canonical top-level contract',
    );

    return { graph: clone, unresolvedOptionIds: [] };
  } catch (err) {
    // Fail-CLOSED for the edit path: on an unexpected error we cannot certify the
    // touched options are analysis-ready, so we DEFER them (the caller rejects the
    // edit, leaving the graph unchanged) rather than risk persisting a malformed
    // option. Non-edit callers (no touched set) get the graph unchanged, no defer.
    try {
      log.warn(
        { event: 'v5.edit_graph.option_interventions_encode_failed', error_name: err instanceof Error ? err.name : 'non_error' },
        '[edit_graph] option-intervention encode threw; deferring touched options',
      );
    } catch { /* observability best-effort */ }
    return { graph, unresolvedOptionIds: touchedOptionIds ? Array.from(touchedOptionIds) : [] };
  }
}

/**
 * Option ids referenced by a set of patch operations (so a pre-existing,
 * untouched malformed option cannot block an unrelated edit). Loose
 * string-contains over each op's path + serialised value, intersected with the
 * actual option node ids — an over-approximation that is safe (only widens
 * "touched", never persists malformed shapes).
 */
export function optionIdsTouchedByOperations(
  operations: ReadonlyArray<{ path?: unknown; value?: unknown }>,
  graph: unknown,
): Set<string> {
  const touched = new Set<string>();
  if (!isPlainObject(graph) || !Array.isArray((graph as Dict).nodes)) return touched;
  const optionIds = ((graph as Dict).nodes as unknown[])
    .filter((n): n is Dict => isPlainObject(n) && n.kind === 'option' && typeof n.id === 'string')
    .map((n) => n.id as string);
  if (optionIds.length === 0) return touched;
  for (const op of operations) {
    let blob = typeof op.path === 'string' ? op.path : '';
    try { blob += ' ' + JSON.stringify(op.value ?? ''); } catch { /* ignore unserialisable */ }
    for (const id of optionIds) {
      if (blob.includes(id)) touched.add(id);
    }
  }
  return touched;
}
