/**
 * Spine A — option-controlled-lever detection (V5-owned claim-safety BACKSTOP,
 * NOT the producer fix).
 *
 * An option-controlled lever is a factor that some decision option intervenes
 * on: it is pinned by the option, not an independently tunable external
 * variable. Describing such a factor as a "tunable sensitivity driver" is
 * unsafe prose. The producer fix lives in Science/PLoT Lane A1 (it should zero
 * such a factor's sensitivity at source). Until that lands — and to cover
 * stale / pre-fix / cache-outlives-deploy facts — CEE must refuse to surface a
 * controlled lever as a tunable driver. This module is that structural
 * detector.
 *
 * Boundary invariants (F.6):
 *   - READ-ONLY over graph structure. It computes, corrects, or overwrites NO
 *     sensitivity / elasticity / producer value. Suppression (done by the
 *     consumer) drops a driver from a projection; the underlying analysis fact
 *     is never mutated.
 *   - Authority is STRUCTURAL `factor_id` membership ONLY — never the factor
 *     label (labels collide; a label match with a different id must NOT
 *     suppress) and never PLoT's `zero_reason` (CEE does not consume it, and it
 *     would not cover the elasticity-driven A1b path anyway).
 *   - Fail-safe for product operation: a malformed / interventionless graph
 *     yields an empty set, so nothing is suppressed and the response shape is
 *     unaffected. The safe failure mode is over-suppression of prose, never a
 *     crash.
 *
 * A fired suppression is EVIDENCE THE PRODUCER FIX IS STILL REQUIRED — never a
 * sign the issue is closed.
 */

import type { DriverSummary } from '../../orchestrator/context/analysis-compact.js';

type Dict = Record<string, unknown>;

function isPlainObject(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Slash-keyed flat intervention entry, e.g. `data/interventions/fac_annual_cost`. */
const SLASH_KEY_RE = /^data\/interventions\/(.+)$/;

/**
 * Add every `factor_id` an option node intervenes on, UNIONED across all known
 * locations. A safety backstop must not miss a factor that lives in one shape
 * but not another, so — unlike the readiness path's precedence read — this takes
 * the union. Mirrors the recovery sources in `normalise-option-interventions.ts`
 * (`recoverFromDataSources`), which overlays these onto the canonical top-level
 * `node.interventions` while preserving top-level-only factors:
 *   1. canonical top-level `node.interventions`
 *   2. `node.data.interventions` (pre-normalisation / just-edited shape)
 *   3. slash-keyed flat entries `node["data/interventions/<fac>"]`
 */
function addNodeInterventionFactorIds(node: Dict, add: (factorId: string) => void): void {
  if (isPlainObject(node.interventions)) {
    for (const fac of Object.keys(node.interventions)) add(fac);
  }
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    for (const fac of Object.keys(data.interventions)) add(fac);
  }
  for (const key of Object.keys(node)) {
    const m = SLASH_KEY_RE.exec(key);
    if (m !== null && typeof m[1] === 'string') add(m[1]);
  }
}

/**
 * Collect the set of `factor_id`s that any option in `graph` intervenes on.
 *
 * Sources are UNIONED so a controlled factor cannot slip through by living in
 * one shape but not another:
 *   1. option-kind graph NODES — top-level `node.interventions`,
 *      `node.data.interventions`, and slash-keyed `data/interventions/<fac>`;
 *   2. the canonical `graph.options[]` array — `option.interventions`.
 *
 * Read from the RAW turn graph: the compacted ContextPack projection strips
 * intervention bundles, so it must NOT be used as authority.
 *
 * Returns an empty set for any malformed / interventionless graph.
 */
export function collectInterventionControlledFactorIds(
  graph: unknown,
): ReadonlySet<string> {
  const controlled = new Set<string>();
  if (!isPlainObject(graph)) return controlled;

  const add = (factorId: string): void => {
    const id = factorId.trim();
    if (id.length > 0) controlled.add(id);
  };

  if (Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      addNodeInterventionFactorIds(node, add);
    }
  }

  if (Array.isArray(graph.options)) {
    for (const option of graph.options) {
      if (!isPlainObject(option)) continue;
      if (isPlainObject(option.interventions)) {
        for (const fac of Object.keys(option.interventions)) add(fac);
      }
    }
  }

  return controlled;
}

/**
 * Structural membership test: is this driver's factor controlled by an option
 * intervention? Authority is `factor_id` ONLY — never the label.
 */
export function isInterventionControlledDriver(
  driver: Pick<DriverSummary, 'factor_id'>,
  controlledFactorIds: ReadonlySet<string>,
): boolean {
  if (controlledFactorIds.size === 0) return false;
  const id = typeof driver.factor_id === 'string' ? driver.factor_id.trim() : '';
  return id.length > 0 && controlledFactorIds.has(id);
}

/**
 * Partition drivers into `kept` (safe to surface) and `suppressed`
 * (option-controlled levers). The order of `kept` is preserved. Pure — no
 * mutation of inputs, no derivation of new values.
 */
export function partitionInterventionControlledDrivers(
  drivers: readonly DriverSummary[],
  controlledFactorIds: ReadonlySet<string>,
): { kept: DriverSummary[]; suppressed: DriverSummary[] } {
  if (controlledFactorIds.size === 0) {
    return { kept: drivers.slice(), suppressed: [] };
  }
  const kept: DriverSummary[] = [];
  const suppressed: DriverSummary[] = [];
  for (const driver of drivers) {
    if (isInterventionControlledDriver(driver, controlledFactorIds)) {
      suppressed.push(driver);
    } else {
      kept.push(driver);
    }
  }
  return { kept, suppressed };
}
