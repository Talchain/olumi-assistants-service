import {
  RunAnalysisHandlerFactSchema,
  type RunAnalysisHandlerFact,
} from '@talchain/schemas/orchestrator';
import type { LeaderLicence } from '../compose/leader-licence.js';
import { isSuccessfulRunAnalysisFact } from '../context/freshness.js';
import { goalChancePrecisionOf } from '../goal-target/goal-chance-driver.js';
import { agentLicenceRecordOf, isLicensedDriver } from '../goal-target/goal-chance-licence.js';
import { goalChanceOptionWithheldForAgent } from '../goal-target/goal-chance-range-agent.js';
import {
  GOAL_FIGURES_USER_EFFECT_CLAMPED,
  GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED,
  goalFiguresWithheldWarnings,
} from '../../orchestrator/context/option-result-source.js';

type RecordValue = Record<string, unknown>;
const recordOf = (value: unknown): RecordValue | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : undefined;
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const probability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Persisted payload paths read by this specification and the SQL fact trigger.
 * [] denotes array entries; {option_id} denotes a key bound to that option.
 * The licence fields below belong to the single GOAL_CHANCE_LICENSED warning.
 * noop is a v5_handler_facts column, not part of the serialised payload.
 * Keep the migration header's `payload_path` comments in this exact order.
 */
export const TYPED_RUN_PAYLOAD_PATHS = [
  'fact_type',
  'fact_version',
  'result.scenario_id',
  'result.run_id',
  'result.leading_option_id',
  'result.constraint_verdict.may_name_leading_option',
  'result.computed_at',
  'result.input_snapshot',
  'result.input_snapshot.sent_digest',
  'result.enrichment.analysis_status',
  'result.enrichment.option_comparison',
  'result.enrichment.option_comparison[].option_id',
  'result.enrichment.option_comparison[].probability_of_goal',
  'result.enrichment.option_comparison[].probability_of_goal_precision.basis',
  'result.enrichment.option_comparison[].probability_of_goal_precision.method',
  'result.enrichment.option_comparison[].probability_of_goal_precision.confidence_level',
  'result.enrichment.option_comparison[].probability_of_goal_precision.n_informative',
  'result.enrichment.option_comparison[].probability_of_goal_precision.n_met',
  'result.enrichment.option_comparison[].probability_of_goal_precision.interval_lower',
  'result.enrichment.option_comparison[].probability_of_goal_precision.interval_upper',
  'result.enrichment.inference_warnings[]',
  'result.inference_warnings[]',
  'result.enrichment.inference_warnings[].code',
  'result.enrichment.inference_warnings[].option_ids',
  'result.enrichment.inference_warnings[].form',
  'result.enrichment.inference_warnings[].similar_option_ids',
  'result.enrichment.inference_warnings[].leader_option_id',
  'result.enrichment.inference_warnings[].next_option_id',
  'result.enrichment.inference_warnings[].withheld_option_ids',
  'result.enrichment.inference_warnings[].pct_by_option.{option_id}',
  'result.enrichment.inference_warnings[].horizon_untested',
  'result.enrichment.inference_warnings[].summary_withheld',
  'result.enrichment.inference_warnings[].driver_by_option.{option_id}',
] as const;

export interface TypedRunRowsContext {
  readonly scenarioId: string;
  /** Match the SQL boundary: live inserts quarantine absent identity; backfill skips it. */
  readonly mode?: 'trigger' | 'backfill';
  /** Only the identity of the graph this frozen Run evaluated, when attested by the caller. */
  readonly graphIdentityHash?: string | null;
}

export interface TypedRunOptionRow {
  readonly option_id: string;
  readonly chance: number | null;
  /** The recorded 95% Wilson simulation-precision interval, never outcome quantiles or sensitivity ranges. */
  readonly low: number | null;
  readonly high: number | null;
  /** Shared vocabulary; this is the option's GOAL CHANCE licence, independently of the leader licence. */
  readonly licence_status: LeaderLicence;
  readonly withheld_reason: string | null;
  readonly driver: RecordValue | null;
}

/** Reference mapping for the SQL trigger; SQL owns scenario/user/revision/fact_id and the option rows' run_id. */
export interface TypedRunRows {
  readonly run_id: string;
  /** producer verdict at Run time; compose applies further remove-only gates; NOT the final permission */
  readonly leading_option_id: string | null;
  readonly constraint_may_name_leading_option: boolean | null;
  readonly canonical_request_hash: string;
  readonly status: 'succeeded' | 'failed' | 'withheld';
  readonly computed_at: string;
  readonly graph_identity_hash: string | null;
  readonly input_snapshot: NonNullable<RunAnalysisHandlerFact['result']['input_snapshot']>;
  readonly options: readonly TypedRunOptionRow[];
}

export type TypedRunRowsResult = { readonly ok: TypedRunRows }
  | { readonly quarantine: string }
  | { readonly skipped_legacy: true };

/**
 * Maps ONE persisted fact. Malformed facts quarantine individually; backfill skips pre-run-identity facts.
 * Inputs are never rebuilt from the current graph. The canonical hash is the snapshot's sent_digest (the schema's
 * SHA-256 of the actual PLoT request, request ID excluded). graph_hash_at_run is an analysis-affecting currentness
 * hash, so it is deliberately NOT relabelled as graph_identity_hash.
 *
 * Option permission comes only from recorded GOAL_CHANCE_LICENSED and scoped withhold warnings. A leader withhold
 * does not suppress an independently licensed chance. Mapping policy: a recorded horizon_untested or
 * summary_withheld caveat maps an otherwise permitted point to permitted_with_caveat; uncertainty alone does not.
 */
export function toTypedRunRows(fact: unknown, ctx: TypedRunRowsContext): TypedRunRowsResult {
  try {
    return mapOneFact(fact, ctx);
  } catch {
    // Keep the boundary total even for an unexpected malformed in-memory value.
    return { quarantine: 'run_analysis fact could not be read' };
  }
}

function mapOneFact(fact: unknown, ctx: TypedRunRowsContext): TypedRunRowsResult {
  const source = recordOf(fact);
  const sourceResult = recordOf(source?.result);
  let producerPermission: boolean | null = null;
  let schemaFact = fact;
  // Check the identity boundary before the current schema: legacy payloads may
  // predate its other required fields, and JSON-null identity is also legacy.
  if (source?.fact_type === 'run_analysis' && source.fact_version === 1 && source.noop === false) {
    if (sourceResult === undefined) return { quarantine: 'result_shape' };
    if (!Object.hasOwn(sourceResult, 'run_id') || sourceResult.run_id === null) {
      return ctx.mode === 'backfill' ? { skipped_legacy: true } : { quarantine: 'run_id_absent' };
    }
    if (!nonEmpty(sourceResult.run_id)) return { quarantine: 'run_id_invalid' };
    if (!nonEmpty(ctx.scenarioId) || sourceResult.scenario_id !== ctx.scenarioId) {
      return { quarantine: 'scenario_id_mismatch' };
    }
    if (sourceResult.leading_option_id !== null && typeof sourceResult.leading_option_id !== 'string') {
      return { quarantine: 'leading_option_id_shape' };
    }
    if (typeof sourceResult.summary !== 'string') return { quarantine: 'summary_shape' };
    if (Object.hasOwn(sourceResult, 'constraint_verdict')) {
      const verdict = recordOf(sourceResult.constraint_verdict);
      if (verdict === undefined || (Object.hasOwn(verdict, 'may_name_leading_option')
        && typeof verdict.may_name_leading_option !== 'boolean')) {
        return { quarantine: 'constraint_may_name_leading_option_shape' };
      }
      producerPermission = typeof verdict.may_name_leading_option === 'boolean' ? verdict.may_name_leading_option : null;
      // This projection reads only the source boolean. The verdict's other
      // members are not this table's permission contract; absence stays NULL.
      const schemaResult = { ...sourceResult };
      delete schemaResult.constraint_verdict;
      schemaFact = { ...source, result: schemaResult };
    }
  }
  const parsed = RunAnalysisHandlerFactSchema.safeParse(schemaFact);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { quarantine: `invalid run_analysis fact at ${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'schema mismatch'}` };
  }
  const runFact = parsed.data;
  const result = runFact.result;
  if (runFact.noop !== false) return { quarantine: 'run_analysis noop does not attest a Run execution' };
  if (!nonEmpty(result.run_id)) return { quarantine: 'run_id_invalid' };
  if (!nonEmpty(ctx.scenarioId) || result.scenario_id !== ctx.scenarioId) {
    return { quarantine: 'scenario_id_mismatch' };
  }
  if (!nonEmpty(result.computed_at) || !Number.isFinite(Date.parse(result.computed_at))) {
    return { quarantine: 'result.computed_at must be a recorded timestamp' };
  }
  if (result.input_snapshot === undefined) return { quarantine: 'result.input_snapshot is required; historical inputs cannot be reconstructed' };
  const graphIdentityHash = ctx.graphIdentityHash ?? null;
  if (graphIdentityHash !== null && !/^[0-9a-f]{64}$/.test(graphIdentityHash)) {
    return { quarantine: 'context.graphIdentityHash must be an attested SHA-256 graph identity' };
  }

  const enrichment = result.enrichment ?? {};
  const rawStatus = enrichment.analysis_status;
  if (rawStatus !== undefined && typeof rawStatus !== 'string') {
    return { quarantine: 'result.enrichment.analysis_status must be a string when recorded' };
  }
  let status: TypedRunRows['status'];
  if (isSuccessfulRunAnalysisFact(runFact)) status = 'succeeded';
  else if (rawStatus === 'failed') status = 'failed';
  else if (rawStatus === 'blocked' || rawStatus === 'refused') status = 'withheld';
  else return { quarantine: 'result.enrichment.analysis_status has no supported typed Run status' };

  const comparisons = enrichment.option_comparison;
  if (comparisons !== undefined && !Array.isArray(comparisons)) {
    return { quarantine: 'result.enrichment.option_comparison must be an array' };
  }
  if (status === 'succeeded' && !Array.isArray(comparisons)) {
    return { quarantine: 'result.enrichment.option_comparison is required for a succeeded Run' };
  }
  const licence = agentLicenceRecordOf(result);
  const warningRecords = Array.isArray(enrichment.inference_warnings) ? enrichment.inference_warnings : [];
  const licenceRecorded = warningRecords.some(value => recordOf(value)?.code === 'GOAL_CHANCE_LICENSED');
  if (licenceRecorded && licence === undefined) {
    return { quarantine: 'result.enrichment contains a malformed or duplicated GOAL_CHANCE_LICENSED record' };
  }
  const options: TypedRunOptionRow[] = [];
  const ids = new Set<string>();
  for (const value of comparisons ?? []) {
    const option = recordOf(value);
    if (option === undefined || !nonEmpty(option.option_id)) {
      return { quarantine: 'result.enrichment.option_comparison[].option_id is required' };
    }
    const optionId = option.option_id;
    if (ids.has(optionId)) return { quarantine: `duplicate option_id in result.enrichment.option_comparison: ${optionId}` };
    ids.add(optionId);
    const chance = option.probability_of_goal;
    if (chance !== undefined && !probability(chance)) {
      return { quarantine: `option ${optionId} probability_of_goal chance must be numeric in [0,1]` };
    }
    const precision = goalChancePrecisionOf(option);
    if (option.probability_of_goal_precision !== undefined && precision === null) {
      return { quarantine: `option ${optionId} probability_of_goal_precision must be its valid 95% Wilson interval` };
    }

    let reason: string | null = null;
    if (status !== 'succeeded') reason = `analysis_${rawStatus as string}`;
    else if (goalChanceOptionWithheldForAgent(result, optionId)) {
      // Scope mirrors the shared point entitlement reader. PLoT #416/#422 are always run-wide.
      const warning = goalFiguresWithheldWarnings(enrichment).find(w =>
        w.code === GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED || w.code === GOAL_FIGURES_USER_EFFECT_CLAMPED
        || !Array.isArray(w.option_ids) || w.option_ids.length === 0
        || !w.option_ids.every(nonEmpty) || new Set(w.option_ids).size !== w.option_ids.length
        || w.option_ids.includes(optionId));
      reason = typeof warning?.code === 'string' ? warning.code : 'goal_chance_withheld';
    } else if (licence === undefined) reason = 'goal_chance_licence_not_recorded';
    else if ((Array.isArray(licence.withheld_option_ids) && licence.withheld_option_ids.includes(optionId))) {
      reason = 'GOAL_CHANCE_LICENSED_WITHHELD_OPTION';
    } else if (!Array.isArray(licence.option_ids) || !licence.option_ids.includes(optionId)) {
      reason = 'goal_chance_not_licensed_for_option';
    } else if (chance === undefined) reason = 'probability_of_goal_not_recorded';

    if (reason !== null) {
      options.push({ option_id: optionId, chance: null, low: null, high: null,
        licence_status: 'withheld', withheld_reason: reason, driver: null });
      continue;
    }
    const displayed = recordOf(licence!.pct_by_option)?.[optionId];
    if (typeof displayed !== 'number' || !Number.isInteger(displayed) || displayed < 0 || displayed > 100) {
      return { quarantine: `option ${optionId} GOAL_CHANCE_LICENSED percentage is malformed` };
    }
    const recordedDriver = recordOf(recordOf(licence!.driver_by_option)?.[optionId]);
    const caveated = licence!.horizon_untested === true || recordOf(licence!.summary_withheld) !== undefined;
    options.push({
      option_id: optionId, chance: chance as number,
      low: precision?.interval_lower ?? null, high: precision?.interval_upper ?? null,
      licence_status: caveated ? 'permitted_with_caveat' : 'permitted', withheld_reason: null,
      driver: recordedDriver !== undefined && isLicensedDriver(recordedDriver) ? recordedDriver : null,
    });
  }
  return { ok: {
    run_id: result.run_id,
    leading_option_id: result.leading_option_id,
    constraint_may_name_leading_option: producerPermission,
    canonical_request_hash: result.input_snapshot.sent_digest,
    status, computed_at: result.computed_at, graph_identity_hash: graphIdentityHash,
    input_snapshot: result.input_snapshot, options,
  } };
}
