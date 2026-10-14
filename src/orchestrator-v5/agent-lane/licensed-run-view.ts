/**
 * ⭐ THE RUN AS THE MODEL MAY READ IT — the licensed view (AI HARNESS PR-L1, programme-docs#85 5931097719).
 *
 * Served (Paul, 1 Oct, scenario 96c6f5f4, all 4 later Runs): PLoT's `CONSTRAINT_LEVEL_DRAWS_OUT_OF_DOMAIN` warning named
 * the withheld leader in `decision_brief.warnings[0].message`, and the Agent's `run_analysis` tool result handed that
 * prose to the model verbatim while the model was told `leader_may_be_named: false`. The PLoT enrichment is an untyped
 * passthrough (`z.record`), so a deny-list of known members can never be complete.
 *
 * So, when the model is told it may NOT name a leader (`claim_permissions.leader_may_be_named !== true`, which is
 * derived from the ONE `leaderLicence`), the run it reads is an ALLOW-list projection:
 * - the enrichment first goes through the wire's own withheld projection (`projectTransportEnrichmentForWithheldClaim`:
 *   `decision_review` dropped, brief headline / rank, robustness, critiques and conditional-winner identities removed);
 * - then every string in the enrichment survives only when it is CODE-SHAPED (an id, code, enum or timestamp: no
 *   whitespace) or sits under a LABEL key (a name the user gave a model element). Producer prose — `message`, `note`,
 *   `headline`, any new member PLoT adds — never passes;
 * - a member whose KEY designates a leading option (`keyDesignatesLeadingOption`) is nulled wherever it sits;
 * - the block's own `summary` goes through `projectAnalysisSummaryForWithheldClaim`.
 *
 * It decides NOTHING about which figures may be shown: goal chances, outcomes and shares follow F1b's per-claim
 * licences, applied upstream (`analysisResultForAgent`). This view removes leader IDENTITY and producer PROSE only.
 * A permitted run is returned by reference, byte-identical. CEE's own words (`what_is_missing`, notes, limit checks)
 * are outside the enrichment and untouched.
 *
 * Applied where a run enters the model's context, and nowhere else: the Agent loop's `function_call_output`
 * (`agent-loop.ts`) and the Run button's interpreter input (`agent-v1-turn.ts`). The route's own `tool_results` keep
 * the raw result. PURE. Never throws (a projection failure returns a run with NO enrichment, never the raw one).
 */
import { keyDesignatesLeadingOption } from '../compose/leading-option-egress-guard.js';
import { projectModelFacingRunDelta } from '../context/model-facing-run-delta.js';
import type { ContextPackRunDelta } from '../context/context-pack-schema.js';
import {
  projectAnalysisSummaryForWithheldClaim,
  projectTransportEnrichmentForWithheldClaim,
} from '../compose/withheld-claim-projection.js';

/** Keys whose string value is a NAME the user gave a model element: kept even with whitespace. */
export const LICENSED_LABEL_KEYS: ReadonlySet<string> = new Set([
  'label',
  'option_label',
  'factor_label',
  'node_label',
  'edge_label',
  'constraint_label',
  'limit_label',
  'goal_label',
  'display_label',
  'from_label',
  'to_label',
  'name',
  'unit',
]);

/** An identifier, code, enum or timestamp: no whitespace, bounded. Never prose. */
const CODE_SHAPED = /^[\p{L}\p{N}_.:/+-]{1,96}$/u;

const RUN_TOOL = 'run_analysis';

/**
 * Run-over-run leader keys (`run_delta.leader.current_leading_option_id` / `prior_leading_option_id`): the shared
 * anchored family (`keyDesignatesLeadingOption`) does not match them (L3 inventory §3), and `run_delta.leader` is gated
 * on entitlement only (`build-run-delta.ts`).
 */
const RUN_OVER_RUN_LEADER_KEY = /^(?:current|prior|previous|new|old)_leading_option(?:_(?:id|ids|label|name))?$/i;

/** Does this KEY name a leading option's identity? The shared family plus the run-over-run keys. */
export function keyNamesLeader(key: string): boolean {
  return keyDesignatesLeadingOption(key) || RUN_OVER_RUN_LEADER_KEY.test(key);
}

/** Every member whose key names a leading option and carries a value → `null`, at any depth. Input never mutated. */
export function withoutLeaderDesignations(value: unknown, depth = 0): unknown {
  if (depth > 40) return value;
  if (Array.isArray(value)) {
    const out = value.map((v) => withoutLeaderDesignations(v, depth + 1));
    return out.some((v, i) => v !== value[i]) ? out : value;
  }
  const rec = record(value);
  if (rec === undefined) return value;
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyNamesLeader(k) && v !== null && v !== undefined && v !== '') { out[k] = null; changed = true; continue; }
    const next = withoutLeaderDesignations(v, depth + 1);
    if (next !== v) changed = true;
    out[k] = next;
  }
  return changed ? out : value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The model may name a leader only on the permission it was given for THIS run. Absent is never permission. */
export function runToolOutputLicensesLeader(result: unknown): boolean {
  return (record(record(result)?.claim_permissions)?.leader_may_be_named) === true;
}

/** An identifier, code, enum or timestamp (no whitespace, bounded): never prose. */
export function isCodeShaped(value: string): boolean {
  return CODE_SHAPED.test(value);
}

function stringSurvives(key: string | undefined, value: string): boolean {
  if (CODE_SHAPED.test(value)) return true;
  return key !== undefined && LICENSED_LABEL_KEYS.has(key);
}

/** The allow-list walk over the (already projected) enrichment. */
function proseFree(value: unknown, key: string | undefined, depth: number): unknown {
  if (depth > 40) return undefined;
  if (typeof value === 'string') return stringSurvives(key, value) ? value : undefined;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const kept = proseFree(item, key, depth + 1);
      if (kept !== undefined) out.push(kept);
    }
    return out;
  }
  const rec = record(value);
  if (rec === undefined) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyNamesLeader(k) && v !== null && v !== undefined && v !== '') {
      out[k] = null;
      continue;
    }
    const kept = proseFree(v, k, depth + 1);
    if (kept !== undefined) out[k] = kept;
  }
  return out;
}

/** The run block (`analysisResultForAgent`'s output) with leader identity and producer prose removed. */
export function licensedRunBlockForModel(block: unknown): unknown {
  const rec = record(block);
  if (rec === undefined) return block;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (keyNamesLeader(k) && v !== null && v !== undefined && v !== '') { out[k] = null; continue; }
    if (k === 'summary' && typeof v === 'string') { out[k] = projectAnalysisSummaryForWithheldClaim(v); continue; }
    if (k === 'enrichment') {
      try {
        const projected = projectTransportEnrichmentForWithheldClaim(record(v));
        const clean = projected === undefined ? undefined : proseFree(projected, undefined, 0);
        if (clean !== undefined) out[k] = clean;
      } catch {
        // Fail closed: no enrichment rather than the raw one.
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * What the model reads for one tool call. Canonical-state recovery applies the same delta projection as host context;
 * `run_analysis` applies the licensed run view. Other results are returned by reference.
 */
export function modelFacingToolResult<T>(toolName: string, result: T): T {
  if (toolName === 'get_canonical_state') {
    const rec = record(result);
    const analysis = record(rec?.analysis);
    if (rec === undefined || analysis === undefined || !('run_delta' in analysis)) return result;
    const { run_delta: delta, ...rest } = analysis;
    return { ...rec, analysis: { ...rest,
      ...(runToolOutputLicensesLeader(analysis) && record(delta) !== undefined
        ? { run_delta: projectModelFacingRunDelta(delta as ContextPackRunDelta) } : {}),
    } } as T;
  }
  if (toolName !== RUN_TOOL || runToolOutputLicensesLeader(result)) return result;
  const rec = record(result);
  if (rec === undefined || !('result' in rec)) return result;
  return { ...rec, result: licensedRunBlockForModel(rec.result) } as T;
}
