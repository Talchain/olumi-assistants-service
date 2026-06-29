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

/**
 * Read an option node's intervention bundle, honouring the same location
 * precedence the readiness path uses (`tools/handlers/analysis-ready-core.ts`):
 * the canonical OptionV3 location is the node's top-level `interventions`, but a
 * just-edited node can still carry it under `data.interventions`. The bundle is
 * a record keyed by `factor_id`.
 */
function readInterventionBundle(node: Dict): Dict {
  const data = node.data;
  if (isPlainObject(data) && isPlainObject(data.interventions)) {
    return data.interventions;
  }
  if (isPlainObject(node.interventions)) {
    return node.interventions;
  }
  return {};
}

/**
 * Collect the set of `factor_id`s that any option in `graph` intervenes on.
 *
 * Sources are UNIONED so a no-op cannot arise from one shape being used over
 * the other:
 *   1. option-kind graph NODES — `node.interventions` / `node.data.interventions`
 *      (the canvas-display copy that survives on the persisted/turn graph);
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

  const addBundleKeys = (bundle: Dict): void => {
    for (const factorId of Object.keys(bundle)) {
      const id = factorId.trim();
      if (id.length > 0) controlled.add(id);
    }
  };

  if (Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isPlainObject(node) || node.kind !== 'option') continue;
      addBundleKeys(readInterventionBundle(node));
    }
  }

  if (Array.isArray(graph.options)) {
    for (const option of graph.options) {
      if (!isPlainObject(option)) continue;
      if (isPlainObject(option.interventions)) {
        addBundleKeys(option.interventions);
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
