/**
 * ⭐ SD-1 SLICE R — THE RUN'S OWN DELIVERED RECORD (schemas 0.78 `RunAnalysisResultSchema.delivered_record`; DL ruling
 * #87, 6 Oct: "carry what the Run DELIVERED, never re-composed").
 *
 * J1 record 4b (run 37402501132): after a reload, or in a fresh browser, the Analysis panel lost the Run's "Olumi model
 * review" cards and the coverage disclosure — composed for the Run's turn and stored nowhere. This builder records them
 * ON the Run's fact, in the same commit, so the scenario read can serve them (`scenario-graph-analysis-read.ts`).
 *
 * ⛔ THE BYTES MUST BE THE ONES THE USER SAW. Between compose and the wire, Phase 3 prose meets two transforms
 * (design trace, CEE 231affbe): the egress sanitiser (`sanitiseOlumiResponseForEgress`, a pure function of the text and
 * the graph — applied HERE, identically), and the leader-withheld rewording (`enforceLeadingOptionClaimsAtWire`), whose
 * inputs are only complete after commit (the route reads the goal scope back from the store). That rewording edits a
 * prose field ONLY when the field asserts a leading option (`projectField`: `textAssertsLeadingOption` gates first).
 * So this builder records a turn ONLY when no Phase 3 prose field asserts one — checked lexically AND against every
 * option label the turn knows (graph + `analysis_ready`), so a narrower wire roster can only assert less. On those turns
 * the rewording is the identity whatever the licence, and the stored bytes are the wire's by construction. A turn whose
 * cards assert a leader records NOTHING (the read then shows what it shows today) — never a guess at the rewording.
 * The read adds its own serve-or-omit check under its own (stricter) licence.
 *
 * Pure; never throws. Omits (never truncates) whenever anything is out of contract — a partial record would misstate
 * what was seen (`phase3_blocks: []` means "none delivered").
 */
import { OlumiResponseSchema, RunDeliveredRecordSchema, type OlumiResponse, type RunDeliveredRecord } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import type { GraphV3T } from '../../schemas/cee-v3.js';
import { BLOCK_PROSE_FIELDS, textAssertsLeadingOption } from './leading-option-egress-guard.js';
import { sanitiseOlumiResponseForEgress } from './output-safety.js';
import type { AnalysisReadyPayload } from './analysis-ready-emit.js';
import { log } from '../../utils/telemetry.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The Phase 3 block types a Run's turn delivers (schemas 0.78 `DeliveredPhase3BlockSchema`). */
export const DELIVERED_PHASE3_TYPES: ReadonlySet<string> = new Set(['review_card', 'coaching', 'evidence', 'exercise']);

export type DeliveredRecordOmitReason =
  | 'no_run_fact' | 'several_run_facts' | 'unbound_run' | 'authority_unavailable' | 'asserts_leader'
  | 'sanitise_unstable' | 'egress_refused' | 'option_out_of_contract' | 'schema_refused' | 'threw';

export type DeliveredRecordOutcome =
  | { readonly kind: 'recorded'; readonly record: RunDeliveredRecord }
  | { readonly kind: 'omitted'; readonly reason: DeliveredRecordOmitReason };

export interface DeliveredRecordInput {
  /** The response as committed (after the owner's public-answer projection) — the one the wire starts from. */
  readonly response: OlumiResponse;
  /** The facts this commit writes; exactly one must be the Run (`run_analysis`, not a refusal marker). */
  readonly handlerFacts: readonly HandlerFact[];
  /** The graph the sanitiser and the wire read for this turn (`turnGraph` / `snapshotGraph`). */
  readonly graph: GraphV3T | null;
  /** The turn's `analysis_ready` — the coverage options it delivered, and a roster source. */
  readonly analysisReady: AnalysisReadyPayload | null | undefined;
  /** The route ships `blocks: []` when the analysis authority is unavailable: then nothing was delivered. */
  readonly authorityUnavailable: boolean;
  readonly requestId: string;
  readonly exitPath: string;
}

const omitted = (reason: DeliveredRecordOmitReason): DeliveredRecordOutcome => ({ kind: 'omitted', reason });

/**
 * Every roster the wire could bind labels with: the graph's options (its first choice) and the analysis_ready options (its
 * fallback), each on its OWN, plus their union. Assertion detection is not monotonic under a roster union: a longer label
 * in one roster can swallow the predicate a shorter label in the other leaves standing (buddy r1 P1-1: `Team` vs
 * `Team leads`). So each roster is checked separately; empty rosters are skipped.
 */
function rostersOf(graph: GraphV3T | null, analysisReady: AnalysisReadyPayload | null | undefined): string[][] {
  const labelsOf = (items: unknown[], keep: (r: Rec) => boolean) => [...new Set(items.filter(isRec).filter(keep)
    .map((r) => r.label).filter((l): l is string => typeof l === 'string' && l.trim() !== ''))];
  const graphRoster = labelsOf(isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [], (n) => n.kind === 'option');
  const readyRoster = labelsOf(isRec(analysisReady) && Array.isArray(analysisReady.options) ? analysisReady.options : [], () => true);
  return [graphRoster, readyRoster, [...new Set([...graphRoster, ...readyRoster])]].filter((r) => r.length > 0);
}

function assertsLeader(block: Rec, rosters: readonly string[][]): boolean {
  return BLOCK_PROSE_FIELDS.some((field) => {
    const value = block[field];
    return typeof value === 'string' && value.length > 0
      && (textAssertsLeadingOption(value) || rosters.some((optionLabels) => textAssertsLeadingOption(value, { optionLabels })));
  });
}

/**
 * Would the wire's egress contract accept this response (`validateEgress`, validators/b1.ts)? The same schema and the same
 * one-carrier rescue (`model_version_receipt` alone at fault → retried without it), with none of its telemetry (the route
 * emits its own). A refused response ships the typed fallback, which carries no Phase 3 block (buddy r1 P1-3), so a record
 * of it would describe cards nobody saw. Pinned to the real validator in the builder's tests.
 */
export function egressContractAccepts(response: unknown): boolean {
  const parsed = OlumiResponseSchema.safeParse(response);
  if (parsed.success) return true;
  if (!isRec(response) || !Object.prototype.hasOwnProperty.call(response, 'model_version_receipt')) return false;
  if (!parsed.error.issues.every((i) => i.path[0] === 'model_version_receipt')) return false;
  const { model_version_receipt: _dropped, ...withoutReceipt } = response;
  return OlumiResponseSchema.safeParse(withoutReceipt).success;
}

export function buildRunDeliveredRecord(input: DeliveredRecordInput): DeliveredRecordOutcome {
  try {
    const runFacts = input.handlerFacts.filter((f) => f.fact_type === 'run_analysis' && !f.noop);
    if (runFacts.length === 0) return omitted('no_run_fact');
    if (runFacts.length > 1) return omitted('several_run_facts');
    const result = runFacts[0]!.result as Rec;
    const runId = result.run_id;
    const graphHash = result.graph_hash_at_run;
    if (typeof runId !== 'string' || runId === '' || typeof graphHash !== 'string' || graphHash === '') return omitted('unbound_run');
    if (input.authorityUnavailable) return omitted('authority_unavailable');
    // The route validates the sanitised response and ships its typed fallback when the contract refuses it.
    const wholeSanitised = sanitiseOlumiResponseForEgress(input.response, {
      graph: input.graph, requestId: input.requestId, exitPath: input.exitPath, userMessage: null, mayNameLeadingOption: false,
    });
    if (!egressContractAccepts(wholeSanitised)) return omitted('egress_refused');

    const phase3 = (input.response.blocks ?? []).filter((b) => isRec(b) && DELIVERED_PHASE3_TYPES.has(String(b.type)));
    // The wire's own sanitiser, over the Phase 3 subset only (assistant_text and every other block are not recorded).
    const sanitise = (blocks: unknown[]): unknown[] => (sanitiseOlumiResponseForEgress(
      // A blocks-only carrier: no prose, chips or insights (their finalisers and telemetry belong to the wire, not to
      // this record). The sanitiser's block pass is per block, so the Phase 3 bytes are the wire's.
      { ...input.response, assistant_text: '', suggested_actions: [], insights: [], blocks } as OlumiResponse,
      {
        graph: input.graph, requestId: input.requestId, exitPath: input.exitPath,
        // The looping-chip guard's only input; the carrier has no chips.
        userMessage: null,
        // No reader (EgressSanitiseOpts, E1 2026-07-27). The leader rule here is this builder's own omission below.
        mayNameLeadingOption: false,
      },
    ).blocks ?? []) as unknown[];
    const sanitised = sanitise(phase3);
    // The route sanitises the response several times (each exit re-enters the chokepoint), and a replacement label is not
    // itself re-sanitised (buddy r1 P1-2: an id whose label is another node's id). Record only when one more pass changes
    // nothing, so the stored bytes are the wire's whatever the number of passes.
    if (JSON.stringify(sanitise(sanitised)) !== JSON.stringify(sanitised)) return omitted('sanitise_unstable');
    const rosters = rostersOf(input.graph, input.analysisReady);
    if (sanitised.some((b) => isRec(b) && assertsLeader(b, rosters))) return omitted('asserts_leader');

    const deliveredOptions = isRec(input.analysisReady) && Array.isArray(input.analysisReady.options) ? input.analysisReady.options : null;
    const options = deliveredOptions?.map((o) => (isRec(o) ? {
      option_id: o.option_id,
      label: o.label,
      status: o.status,
      interventions: o.interventions,
    } : o));
    if (options?.some((o) => !isRec(o))) return omitted('option_out_of_contract');

    const parsed = RunDeliveredRecordSchema.safeParse({
      record_version: 1,
      run_id: runId,
      graph_hash: graphHash,
      phase3_blocks: sanitised,
      ...(options !== undefined ? { analysis_ready_options: options } : {}),
    });
    return parsed.success ? { kind: 'recorded', record: parsed.data } : omitted('schema_refused');
  } catch {
    return omitted('threw');
  }
}

/**
 * Stamp the record onto the ONE run_analysis fact it is bound to. Returns the facts unchanged unless the stamped fact
 * still parses as the contract's Run fact — the commit never fails, and never writes a fact a reader would refuse.
 */
export function stampDeliveredRecord(
  facts: readonly HandlerFact[],
  record: RunDeliveredRecord,
  parsesAsRunFact: (fact: unknown) => boolean,
): readonly HandlerFact[] {
  let stamped = 0;
  const next = facts.map((f) => {
    if (f.fact_type !== 'run_analysis' || f.noop || (f.result as Rec).run_id !== record.run_id) return f;
    stamped += 1;
    return { ...f, result: { ...(f.result as Rec), delivered_record: record } } as HandlerFact;
  });
  if (stamped !== 1) return facts;
  return next.every((f) => f.fact_type !== 'run_analysis' || parsesAsRunFact(f)) ? next : facts;
}

/**
 * The commit hook (`CommitMetadata.stampHandlerFacts`): build from the response AS COMMITTED, stamp the Run fact, and
 * hand back the facts the write carries. Any omission returns the facts exactly as given (by reference). Content-free
 * log line only: the reason, never the prose.
 */
export function makeDeliveredRecordStamper(
  ctx: Omit<DeliveredRecordInput, 'response' | 'handlerFacts'>,
): (response: OlumiResponse, facts: readonly HandlerFact[]) => readonly HandlerFact[] {
  return (response, facts) => {
    const out = buildRunDeliveredRecord({ ...ctx, response, handlerFacts: facts });
    if (out.kind === 'omitted') {
      if (out.reason !== 'no_run_fact') {
        log.info({ event: 'v5.delivered_record.omitted', request_id: ctx.requestId, exit_path: ctx.exitPath, reason: out.reason },
          'SD-1 delivered_record omitted (the Run commits without it)');
      }
      return facts;
    }
    const stamped = stampDeliveredRecord(facts, out.record, (f) => RunAnalysisHandlerFactSchema.safeParse(f).success);
    log.info({
      event: stamped === facts ? 'v5.delivered_record.omitted' : 'v5.delivered_record.recorded',
      request_id: ctx.requestId, exit_path: ctx.exitPath,
      ...(stamped === facts ? { reason: 'stamp_refused' } : { block_count: out.record.phase3_blocks.length }),
    }, 'SD-1 delivered_record');
    return stamped;
  };
}
