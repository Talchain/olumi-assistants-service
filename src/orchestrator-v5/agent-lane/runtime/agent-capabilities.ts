/**
 * Agent lane — the capabilities, each delegating to an existing Olumi path.
 *
 * ⭐ NOTHING HERE OWNS A RULE. Canonical truth, admissibility, authorisation,
 * CAS, idempotency, persistence and analysis all stay where they already live;
 * these functions carry a request to them and report what came back. Writes and
 * analysis go through the SAME `/orchestrate/v2/turn` the product uses, via an
 * internal dispatch, so the Agent cannot reach a shortcut the UI does not have.
 *
 * ⛔ A MUTATION IS CONFIRMED FROM STATE, NEVER FROM A STATUS CODE. Observed on
 * 22 Sep: a tool that returned success on HTTP 200 made the Agent tell the user
 * "Added: …" while CEE had honestly refused with "I couldn't record that
 * properly, so I haven't changed the model." Every mutating capability below
 * re-reads the model afterwards and reports what the model actually shows.
 */

import { createHash, randomUUID } from 'node:crypto';
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../../tools/handlers/set-factor-value.js';
import { AGENT_RUN_ANALYSIS_CHIP_ID } from '../../handlers/agent-chip-ids.js';

/**
 * The durable operation identity for authorising a proposal.
 *
 * ⛔ IT MUST BE A v4-SHAPED UUID. Measured against the real
 * `SystemEventTurnPayloadSchema`: `turn_id` is regex-constrained, and a
 * readable key like `agent_authorise:<proposal_id>` is refused at ingress with
 * `INGRESS_CONTRACT_VIOLATION` before any handler runs. My first version used
 * exactly that readable form; the unit tests passed because the mock dispatch
 * does not validate the payload, and only posting it at the real boundary
 * showed all four calls refused.
 *
 * So this is a NAME-BASED uuid wearing a v4 costume: SHA-256 of the proposal
 * id with the version and variant nibbles forced. It is deterministic — the
 * same proposal always yields the same key, which is the whole point — and it
 * satisfies the wire. The trade is legibility in the turn log for a stable
 * idempotency key, and the stable key is what the replay arm needs.
 */

/** What the Agent is told to say about a named input that cannot hold a value. */
const NOT_A_FACTOR_NOTE =
  'These were named but are not factors (for example a risk), so no starting value can be set on them and they are ' +
  'NOT in this proposal. Tell the user plainly, before they approve, that each was left out and why; describe its ' +
  'effect through the factors it acts on instead. Never present the starting point as complete while any is listed here.';

/** The approval-facing disclosure of what was left out (empty when nothing was). */
function leftOutClause(notAFactor: readonly { label: string; kind: string }[]): string {
  if (notAFactor.length === 0) return '';
  return ` (left out, not a factor so it cannot hold a value: ${notAFactor.map((n) => `${n.label} — a ${n.kind}`).join('; ')})`;
}

export function authorisationTurnId(proposalId: string): string {
  const h = createHash('sha256').update(`agent_authorise:${proposalId}`).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/**
 * ⭐ THE RECEIPT A WRITE PRODUCED, read with the estate's own parser.
 *
 * ⛔ MEASURED GAP: the agent lane read `model_version_receipt` in 0 non-test
 * files, against 6 elsewhere in the estate. So even when a signed-in authorise
 * minted a version, `authorise_change` dropped the receipt — the Agent could not
 * say "saved as version 7", and a retry could not hand back what the first
 * authorisation produced.
 *
 * Returns the compact summary only. The receipt also carries the entire
 * committed `graph`, which must never ride into a tool result that is
 * stringified back into the model's context.
 *
 * A receipt that is PRESENT but fails the strict schema is reported, not
 * swallowed and not thrown: the write happened, the user's turn must not
 * crash, and nobody should read "no receipt" when one arrived malformed.
 */
export function receiptSummaryOf(json: unknown): { summary: ReceiptSummary | null; unreadable: boolean } {
  try {
    const r = modelVersionMutationReceiptFromResponse(json);
    if (r === null) return { summary: null, unreadable: false };
    return {
      summary: { version: r.sequence, version_id: r.version_id, mutation_id: r.mutation_id, source_turn_id: r.source_turn_id },
      unreadable: false,
    };
  } catch {
    return { summary: null, unreadable: true };
  }
}

import { createProposal, ProposalStore, type ProposalOperation, type ReceiptSummary, type StructuredProposal } from '../proposal.js';
import { modelVersionMutationReceiptFromResponse } from '../../model-management/mutation-receipt.js';
import { confirmEdgeWrite, describeOutcome } from '../confirm-write.js';
import { structuralFacts } from '../structural-facts.js';
import { defaultFrameFor } from '../admit-model.js';
import type { AgentCapabilities, AgentToolContext, ToolResult } from './agent-tools.js';
import { buildModelFromBrief, findConstructionVersion, type CallStructuredModel } from './build-model.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { linkedFactorsOf } from '../../routing/option-effect-write.js';

/** Marks a compound starting point, so a newer one can replace it before approval. */
const STARTING_POINT_BASIS = 'a starting point \u2014 values and what each option sets \u2014 for the user to adopt or correct in one approval';

/** One internal dispatch, so every path is the product's own. */
export type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

interface GraphRead {
  readonly graph_hash: string;
  /**
   * ⭐ THE IDENTITY-SPACE HASH OF THE SAME READ — "is this the same graph
   * object?" — kept so a write can assert the identity it actually read.
   *
   * ⛔ NOT INTERCHANGEABLE WITH `graph_hash`, which is the ANALYSIS projection
   * and excludes labels. That exclusion is the whole defect: a rename landing
   * between our read and our write passes an analysis-space comparison and is
   * then overwritten by our stale copy of the node. `''` when the read did not
   * supply one — an expectation is then simply not sent, never fabricated.
   */
  readonly graph_identity_hash: string;
  /**
   * Declared, not cast. `readGraph` passes the persisted node through verbatim,
   * so these are the carriers the stored graph really holds — counted across
   * every stored graph on 22 Sep 2026: `provenance` 209,115, `display_value`
   * 34,107, `scale_frame` 5,803. Naming them here is what lets the projection
   * read them without an `as` that would hide a later rename.
   */
  readonly nodes: {
    id: string;
    kind: string;
    label: string;
    description?: string;
    display_value?: unknown;
    scale_frame?: unknown;
    provenance?: unknown;
    observed_state?: Record<string, unknown>;
    interventions?: Record<string, unknown>;
    changes?: unknown;
  }[];
  readonly edges: { from: string; to: string }[];
  readonly analysis_state: unknown;
  /** The persisted graph exactly as read — every top-level carrier, not only nodes/edges. */
  readonly raw: Record<string, unknown>;
}

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/…$/, '').trim();

/**
 * ⭐ ONE PROJECTION of a persisted node into what the Agent is shown — used by
 * EVERY tool that hands the Agent entities.
 *
 * ⛔ It used to live inline in `get_canonical_state` while `build_model_from_brief`
 * kept its own `{label, kind, value}` list. An independent review ran both on the
 * same stored node — `{value: 0.45, raw_value: 9, unit: 'months', cap: 20}` — and
 * only one carried the figure. The route tells the Agent to answer from the BUILD
 * result, so the first reply every user sees quoted a normalised 0.45 and said the
 * unit was unknown. Two field lists will always drift; one cannot.
 */
export function projectEntity(n: GraphRead['nodes'][number]): Record<string, unknown> {
          // The carriers the persisted graph already holds. Reading them is not
          // enrichment — every one is a field the estate stores, and withholding
          // them made the Agent reconstruct from the prompt what canonical state
          // already knew.
          const os = (n.observed_state ?? {}) as Record<string, unknown>;
          const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
          const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
          // Value provenance is a DIFFERENT fact from entity provenance: who put
          // this NUMBER here, versus where the entity came from. Collapsing them
          // is how a system-read figure inherits a user's authority.
          const valueProvenance = {
            ...(str(os.source) ? { source: os.source } : {}),
            ...(str(os.extractionType) ? { extraction_type: os.extractionType } : {}),
          };
          return {
            // ⭐ THE ID. Without it the only way to act on an entity was a fuzzy
            // label match, which collides and cannot address two entities that
            // read alike.
            id: n.id,
            label: n.label,
            ...(n.description !== undefined ? { full_label: n.description } : {}),
            kind: n.kind,
            // A value only when one is actually stored. Absence is reported as
            // unknown rather than as a zero.
            value: num(os.value) ? os.value : null,
            // ⚠ EVERY FIELD BELOW IS OMITTED WHEN ABSENT, never nulled. A null
            // here reads to a model as a stated fact ("there is no unit") rather
            // than as silence, and the Agent would repeat it.
            ...(num(os.raw_value) ? { raw_value: os.raw_value } : {}),
            ...(str(n.display_value) ? { display_value: n.display_value } : {}),
            ...(str(os.unit) ? { unit: os.unit } : {}),
            // The scale carriers. A bare amount with none of these is not just
            // under-described, it is unanalysable downstream — the Agent needs to
            // see that to explain it.
            ...(num(os.cap) ? { cap: os.cap } : {}),
            ...(str(os.declared_scale) ? { declared_scale: os.declared_scale } : {}),
            ...(n.scale_frame === undefined ? {} : { scale_frame: n.scale_frame }),
            ...(Object.keys(valueProvenance).length === 0
              ? {}
              : { value_provenance: valueProvenance }),
            ...(n.provenance === undefined ? {} : { provenance: n.provenance }),
          };
        }

export function createAgentCapabilities(
  dispatch: InternalDispatch,
  proposals: ProposalStore,
  /**
   * Construction needs a structured model call. It is injected rather than
   * imported so this module still has no provider of its own — and when it is
   * absent the tool REFUSES rather than pretending the model could not be built
   * for some modelling reason.
   */
  callStructured?: CallStructuredModel,
  /**
   * 'preview' is READ-ONLY. This is the innermost of three layers: the tools
   * are not declared, `dispatchTool` refuses the names, and these refuse too.
   * Defence in depth, because a single prompt sentence is not a boundary.
   */
  mode: 'full' | 'preview' = 'full',
  /**
   * ⭐ THE UI RENDERS THE ANALYSIS FROM `blocks` AND `analysis_ready`, NOT FROM
   * THE PROSE. Measured on the real browser transport at `2fd8cbba`: the turn
   * came back 200 with a correct verdict in `assistant_text` and
   * `blocks=none`, `analysis_ready.options=0` — so a user reading the page saw
   * the sentence and an empty results panel.
   *
   * The raw payload is handed to the ROUTE through this callback rather than
   * returned in the ToolResult, because the ToolResult is JSON-stringified
   * straight back into the model's context: a full analysis payload there
   * would cost thousands of tokens per hop and tell the model nothing its own
   * summary does not already say.
   */
  onAnalysis?: (payload: { analysis_ready?: unknown; blocks?: unknown[] }) => void,
): AgentCapabilities {
  const readOnly = mode === 'preview';
  const refuseReadOnly = (): ToolResult => ({
    ok: false, mutated: false, refusal: 'read_only_preview',
    detail: 'This preview cannot change the model. Nothing has been altered.',
  });
  /**
   * Normalise the read route's `graph_identity_hash` to the 64-hex value the
   * register route compares. `''` means "no identity to anchor to" — the route
   * returns `null` for an absent, unparseable or identity-empty graph — and
   * every caller below treats `''` as "send no expectation".
   *
   * A bare string is tolerated so this keeps working if the wire is ever
   * flattened; nothing is invented either way, because the envelope's `.value`
   * IS the comparison space.
   */
  const identityHashOf = (raw: unknown): string => {
    if (typeof raw === 'string') return raw;
    if (raw !== null && typeof raw === 'object') {
      const v = (raw as { value?: unknown }).value;
      if (typeof v === 'string') return v;
    }
    return '';
  };

  const readGraph = async (scenarioId: string): Promise<GraphRead | null> => {
    const r = await dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, {});
    if (r.status !== 200) return null;
    const g = (r.json.graph ?? {}) as Record<string, unknown>;
    return {
      graph_hash: String(r.json.graph_hash ?? ''),
      // ⛔⛔ IT IS AN ENVELOPE OBJECT, NOT A STRING. The read route emits the
      // producer's own return value — `computeGraphIdentityHash(graph)`, type
      // `GraphIdentityHash | null` = `{kind, value, algorithm, ...}` — so the
      // `String(...)` this line used to do produced the literal
      // `"[object Object]"`, and once the register route enforced the field
      // EVERY frame write below would have been refused 409 and the user told a
      // competing writer had moved their model when none had. That is the exact
      // fabricated-concurrency claim this PR exists to remove, so it is fixed
      // here rather than tolerated. The register route compares the 64-hex
      // `.value` (`context/graph-cas-conflict.ts` extracts it), and accepts
      // either spelling; we send the value.
      graph_identity_hash: identityHashOf(r.json.graph_identity_hash),
      nodes: (g.nodes as GraphRead['nodes']) ?? [],
      edges: (g.edges as GraphRead['edges']) ?? [],
      analysis_state: r.json.analysis_state,
      raw: g,
    };
  };

  /**
   * ⛔ ONE APPROVAL MUST BE ABLE TO APPLY A WHOLE STARTING POINT — AND ONLY ONTO
   * THE MODEL THE USER APPROVED.
   *
   * Every proposal is bound to the model revision it was made against, so two
   * proposals offered together (starting values AND option levels) could never
   * both be applied from one "yes": applying the first superseded the second.
   * A compound proposal fixes that — and the first version of it (#1712 @
   * 3674539 / ecb45282) re-read the graph before each part and re-bound the
   * part to whatever it found. Independent review measured the consequence: an
   * UNRELATED edit between the approval and a write was absorbed, the approved
   * levels landed on a model the user never saw (a level shown as 7 FTE stored
   * as 70 after a re-frame), and the result said "applied".
   *
   * So the expected revision is CARRIED, never re-read-and-adopted:
   *   1. It starts at the parent-approved base — the exact read `authoriseChange`
   *      just authorised against, handed in here, not a second read.
   *   2. VALUES are applied IN MEMORY with the product's own
   *      `applyFactorValueEdit` (the inspector path's validator + handler +
   *      merge, unchanged), then written as ONE registration carrying
   *      `expected_graph_hash` = that base. `factor_value_edit` has no base on
   *      the wire (0.55, `.strict()`), so this is what makes the value write
   *      CONDITIONAL: the route refuses a moved model with nothing written, and
   *      the atomic RPC's CAS closes its own read→write window.
   *   3. The revision advances ONLY to the hash that registration reports for
   *      the bytes IT stored, and then to each CAS-gated
   *      `option_intervention_edit`'s own reported hash.
   *   4. Anything else stops the compound truthfully: `not_applied` with zero
   *      writes, or `partially_applied` naming exactly what landed.
   * The approved operations are applied verbatim. Nothing is regenerated.
   */
  const COMPOUND_ORDER = ['set_factor_value', 'set_option_intervention'] as const;
  const frameOf = (n: GraphRead['nodes'][number] | undefined): number | null => {
    const os = (n?.observed_state ?? {}) as { cap?: unknown };
    if (typeof os.cap === 'number' && os.cap > 0) return os.cap;
    if (typeof n?.scale_frame === 'number' && n.scale_frame > 0) return n.scale_frame;
    return null;
  };
  const applyCompound = async (
    ctx: Parameters<AgentCapabilities['authoriseChange']>[0],
    parent: StructuredProposal,
    approvedRead: GraphRead,
  ): Promise<ToolResult> => {
    const unsupported = parent.operations.filter((o) => !(COMPOUND_ORDER as readonly string[]).includes(o.op));
    if (unsupported.length > 0) {
      return { ok: false, mutated: false, refusal: 'unsupported_compound', detail: `This proposal mixes changes that cannot be applied together: ${[...new Set(unsupported.map((o) => o.op))].join(', ')}.` };
    }
    const notApplied = (reason: string, detail: string, extra: Record<string, unknown> = {}): ToolResult => ({
      ok: false, mutated: false, applied: false, proposal_id: parent.proposal_id,
      refusal: 'not_applied', reason, detail, parts: [], receipts: [], ...extra,
    });
    // (1) The carried revision starts at what the user approved.
    if (approvedRead.graph_hash !== parent.base_graph_identity_hash) {
      return notApplied('model_changed_since_approval', 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.');
    }
    const valueOps = parent.operations.filter((o) => o.op === 'set_factor_value');
    const levelOps = parent.operations.filter((o) => o.op === 'set_option_intervention');

    // (2) Values, in memory, through the product's own inspector path.
    let working: unknown = approvedRead.raw;
    for (let i = 0; i < valueOps.length; i += 1) {
      const o = valueOps[i];
      const v = (o.value ?? {}) as { value?: number; unit?: string };
      if (typeof v.value !== 'number') return notApplied('no_value_on_proposal', `No value was stored on the proposal for ${o.path}. Nothing was written.`);
      const event = {
        kind: 'factor_value_edit' as const,
        target_id: o.path,
        value: v.value,
        ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
      };
      const res = await applyFactorValueEdit({
        payload: {
          kind: 'system_event',
          turn_id: authorisationTurnId(`${parent.proposal_id}#value${i}`),
          scenario_id: ctx.scenario_id,
          stage: 'frame',
          event,
        } as never,
        event: event as never,
        requestId: ctx.request_id,
        persistedGraph: working,
        priorFacts: [],
      });
      if (res.kind !== 'mutated') {
        const label = approvedRead.nodes.find((n) => n.id === o.path)?.label ?? o.path;
        return notApplied('value_refused', `The value for ${label} could not be recorded (${res.reason}), so nothing was written.`, { refused_factor: label });
      }
      working = res.mutatedGraph;
    }
    let workingNodes = ((working as { nodes?: GraphRead['nodes'] }).nodes ?? []).map((n) => ({ ...n }));
    // A value that landed as a bare amount above 1 gets a range from its own
    // figure — the same step the single-kind path takes after its write, done
    // here BEFORE the one write so it is part of what is conditional.
    const framed: { factor: string; value: number; range: number }[] = [];
    workingNodes = workingNodes.map((n) => {
      if (!valueOps.some((o) => o.path === n.id)) return n;
      if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return n;
      const os = (n.observed_state ?? {}) as { value?: unknown; raw_value?: unknown; cap?: unknown };
      if (!(typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number')) return n;
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      const range = defaultFrameFor(raw);
      if (range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });
    // ⛔ A LEVEL IS A NUMBER ON ITS FACTOR'S FRAME. If this approval's own
    // values would give a level's factor a DIFFERENT frame from the one the
    // level was normalised against, the level would silently mean something
    // else (1.0 of 0-10 is 10, not the 1 the user was shown). Refuse first.
    const byIdAfterValues = new Map(workingNodes.map((n) => [n.id, n]));
    for (const o of levelOps) {
      const factorId = o.path.split('::')[1];
      const lv = (o.value ?? {}) as { cap?: number | null; derived_frame?: number | null };
      const levelFrame = typeof lv.cap === 'number' && lv.cap > 0 ? lv.cap : null;
      const factorFrame = frameOf(byIdAfterValues.get(factorId));
      if (factorFrame !== null && levelFrame !== null && factorFrame !== levelFrame) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed on a range this approval's own values would change. Nothing was written — propose again.`);
      }
      if (factorFrame !== null && levelFrame === null) {
        return notApplied('level_frame_changed_by_values', `A level for ${byIdAfterValues.get(factorId)?.label ?? factorId} was proposed before it had a range that this approval would give it. Nothing was written — propose again.`);
      }
    }
    // Derived level frames on factors that hold a value and still have no
    // range — the same attachment the single-kind level path makes.
    workingNodes = workingNodes.map((n) => {
      const op = levelOps.find((o) => o.path.split('::')[1] === n.id && typeof ((o.value ?? {}) as { derived_frame?: unknown }).derived_frame === 'number');
      if (op === undefined || frameOf(n) !== null) return n;
      const range = ((op.value ?? {}) as { derived_frame: number }).derived_frame;
      const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
      const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
      if (typeof raw !== 'number' || range <= 1) return n;
      framed.push({ factor: n.label, value: raw, range });
      return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
    });

    // ONE conditional write for every value (and any range they need).
    const receipts: ReceiptSummary[] = [];
    let valuesLanded = false;
    let carried = parent.base_graph_identity_hash;
    if (valueOps.length > 0 || framed.length > 0) {
      const operationId = authorisationTurnId(`${parent.proposal_id}#values`);
      const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
        graph: { ...(working as Record<string, unknown>), nodes: workingNodes },
        expected_graph_hash: carried,
        operation_id: operationId,
      });
      if (reg.status !== 200) {
        const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
        return notApplied(
          code === 'GRAPH_STALE' ? 'model_changed_since_approval' : 'values_not_written',
          code === 'GRAPH_STALE'
            ? 'The model changed after this was approved, so nothing was written. Read it again and propose afresh.'
            : `The values could not be saved (http ${reg.status}). Nothing was written.`,
        );
      }
      valuesLanded = true;
      const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
      if (mv !== undefined && typeof mv.version_id === 'string') {
        receipts.push({
          version: Number(mv.version_number), version_id: mv.version_id,
          mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
          source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
        } as ReceiptSummary);
      }
      const next = reg.json.graph_hash;
      if (typeof next !== 'string' || next.length === 0) {
        // No authoritative revision for our own write: we cannot prove the next
        // CAS base, so no level is written on a guess.
        return {
          ok: false, mutated: true, applied: false, proposal_id: parent.proposal_id,
          refusal: levelOps.length > 0 ? 'partially_applied' : 'not_applied',
          detail: 'The values were saved; the option levels were not written because the saved revision could not be confirmed.',
          parts: [{ part: 'values', ok: true, recorded_count: valueOps.length, requested_count: valueOps.length }, ...(levelOps.length > 0 ? [{ part: 'option_levels', ok: false, recorded_count: 0, requested_count: levelOps.length }] : [])],
          receipts,
        };
      }
      carried = next;
    }

    // (3) Levels, each CAS-gated on the revision our OWN previous write produced.
    let levelsRecorded = 0;
    let levelStop: string | null = null;
    for (let i = 0; i < levelOps.length; i += 1) {
      const o = levelOps[i];
      const [optionId, factorId] = o.path.split('::');
      const v = ((o.value ?? {}) as { normalised?: number }).normalised;
      if (typeof v !== 'number') { levelStop = `no level was stored on the proposal for ${o.path}`; break; }
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'system_event',
        turn_id: authorisationTurnId(`${parent.proposal_id}#level${i}`),
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        event: { kind: 'option_intervention_edit', option_id: optionId, factor_id: factorId, value: v, base_graph_hash: carried },
      });
      if (r.status !== 200) { levelStop = `the level for ${o.path} was refused (http ${r.status})`; break; }
      const rc = receiptSummaryOf(r.json);
      if (rc.summary !== null) receipts.push(rc.summary);
      const next = r.json.graph_hash;
      if (typeof next === 'string' && next.length > 0) {
        carried = next;
        levelsRecorded += 1;
        continue;
      }
      // A 200 with no revision committed nothing. It is either a verified no-op
      // (the model already holds exactly this level) or a refusal. A read tells
      // them apart — it VERIFIES, it never adopts: a revision other than the
      // carried one means someone else changed the model, and we stop.
      const check = await readGraph(ctx.scenario_id);
      const held = check?.nodes.find((n) => n.id === optionId)?.interventions?.[factorId] as { value?: unknown } | number | undefined;
      const heldValue = typeof held === 'number' ? held : (held as { value?: unknown } | undefined)?.value;
      if (check === null || check.graph_hash !== carried) { levelStop = 'the model changed while the option levels were being recorded'; break; }
      if (heldValue !== v) { levelStop = `the level for ${o.path} was not recorded`; break; }
      levelsRecorded += 1;
    }

    const all = levelStop === null && levelsRecorded === levelOps.length;
    if (all) proposals.markApplied(parent.proposal_id, receipts);
    const parts = [
      ...(valueOps.length > 0 ? [{ part: 'values', ok: valuesLanded, recorded_count: valuesLanded ? valueOps.length : 0, requested_count: valueOps.length }] : []),
      ...(levelOps.length > 0 ? [{ part: 'option_levels', ok: levelStop === null, recorded_count: levelsRecorded, requested_count: levelOps.length }] : []),
    ];
    return {
      ok: all,
      mutated: valuesLanded || levelsRecorded > 0,
      applied: all,
      proposal_id: parent.proposal_id,
      parts,
      receipts,
      revision_before: parent.base_graph_identity_hash,
      revision_after: carried,
      ...(framed.length > 0 ? { ranges_added_for_analysis: framed } : {}),
      ...(all
        ? {
            not_represented:
              'These values and levels are the user\u2019s adopted assumptions, not measurements, and the model records no mark ' +
              'distinguishing the two \u2014 say so when you describe what changed.',
          }
        : {
            refusal: valuesLanded || levelsRecorded > 0 ? 'partially_applied' : 'not_applied',
            detail: `${levelStop ?? 'Not every change was recorded'}. Tell the user exactly which part was recorded and which was not.`,
          }),
    };
  };
  /**
   * ⛔ A STARTING POINT MUST COVER EVERY FACTOR EACH OPTION ACTS ON.
   *
   * MEASURED on served 63cf4dcf (journey witness, direct transport): the
   * starting point gave "Stage Hiring After Review" ONE level, but the option is
   * wired to three factors; readiness blocks the comparison on every unset
   * (option, linked factor) pair (`missing_value`), so "one approval -> first
   * comparison" needed a second approval. Across six served journeys only two
   * were fully analysable after one approval.
   *
   * Deterministic, from the SAME reader the write and the proposer use
   * (`linkedFactorsOf`): the pairs still lacking a level after this proposal
   * would apply. The values themselves are never invented here — the Agent is
   * told which pairs to propose before it shows the user anything.
   */
  const missingPairs = async (ctx: AgentToolContext, levelPaths: ReadonlySet<string>): Promise<{ option: string; factor: string }[] | null> => {
    const g = await readGraph(ctx.scenario_id);
    if (g === null) return null;
    const missing: { option: string; factor: string }[] = [];
    for (const o of g.nodes.filter((n) => n.kind === 'option')) {
      const has = (o.interventions ?? {}) as Record<string, unknown>;
      for (const f of linkedFactorsOf(g as never, o.id)) {
        if (has[f.id] !== undefined || levelPaths.has(`${o.id}::${f.id}`)) continue;
        missing.push({ option: o.label, factor: String(f.label ?? f.id) });
      }
    }
    return missing;
  };
  const levelPathsOf = (ps: readonly StructuredProposal[]): Set<string> =>
    new Set(ps.flatMap((p) => p.operations).filter((o) => o.op === 'set_option_intervention').map((o) => o.path));
  /**
   * ⛔ COMPLETENESS IS AN ADMISSION RULE, NOT A NOTE — independent review of
   * #1719 at d00727aa: reporting the missing pairs AFTER storing an approvable
   * proposal let a model that ignored the note ask the user to approve an
   * incomplete set, and the user still needed a second approval. So an
   * incomplete starting point leaves NOTHING approvable.
   */
  const incompleteStartingPoint = (missing: { option: string; factor: string }[], extra: Record<string, unknown>): ToolResult => ({
    ok: false, mutated: false, refusal: 'incomplete_starting_point',
    options_missing_levels: missing,
    ...extra,
    detail:
      'Nothing is awaiting approval. A starting point must give a level for EVERY factor each option acts on, and the pairs in ' +
      'options_missing_levels have none. Call propose_starting_point again with the same values and levels PLUS a level for each ' +
      'pair (in the factor\u2019s own units, as an assumption to correct), then show the user that one proposal.' +
      (Array.isArray(extra.levels_not_accepted) && extra.levels_not_accepted.length > 0
        ? ' Some levels you DID give were not accepted: levels_not_accepted says which and why. Correct each one as its reason ' +
          'says. Re-sending the same value will be refused again.'
        : ''),
  });

  /**
   * A newer starting point REPLACES the caller's earlier unapproved one, so
   * "if exactly one is awaiting approval, authorise THAT" always names the
   * latest set the user was shown. Only starting points are replaced; an
   * ordinary single proposal is never discarded here.
   */
  const replaceEarlierStartingPoints = (ctx: AgentToolContext): void => {
    for (const o of proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id)) {
      const p = proposals.get(o.proposal_id);
      if (p !== undefined && p.provenance.basis === STARTING_POINT_BASIS) proposals.discard(o.proposal_id);
    }
  };

  const caps: AgentCapabilities = {
    async getCanonicalState(ctx: AgentToolContext): Promise<ToolResult> {
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      return {
        ok: true,
        mutated: false,
        graph_revision: g.graph_hash,
        empty: g.nodes.length === 0,
        entities: g.nodes.map(projectEntity),
        existing_links: g.edges.map((e) => `${e.from} -> ${e.to}`),
        // Derived by traversal of the persisted graph — facts, not estimates,
        // and the Agent may state them to the user as facts. Without these it
        // has to infer topology from an edge list, and measurably does it worse
        // than the product it is being compared against.
        structure: structuralFacts(g.nodes, g.edges),
        analysis: g.analysis_state,
        // Every proposal this user has been shown and not yet approved, newest
        // first. An approval with nothing to bind to is an approval that
        // silently does nothing.
        awaiting_your_approval: proposals.outstanding(ctx.scenario_id, ctx.authenticated_user_id),
      };
    },

    async proposeModelChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const find = (l: string) => g.nodes.find((n) => norm(n.label) === norm(l) || norm(n.description) === norm(l));
      const from = find(args.from_label);
      const to = find(args.to_label);
      if (from === undefined || to === undefined) {
        return {
          ok: false, mutated: false, refusal: 'unresolved_entity',
          detail: `No entity is labelled "${from === undefined ? args.from_label : args.to_label}". Read the state again and use a label exactly as it appears.`,
        };
      }
      if (g.edges.some((e) => e.from === from.id && e.to === to.id)) {
        return { ok: false, mutated: false, refusal: 'already_present', detail: 'That link is already in the model.' };
      }
      const operations: ProposalOperation[] = [
        { op: 'add_edge', path: `${from.id}::${to.id}`, value: { effect_direction: args.direction } },
      ];
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: args.rationale },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `Connect "${from.label}" to "${to.label}" (${args.direction})`,
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        note: 'Nothing has changed. Show this to the user and ask them to approve it before calling authorise_change.',
      };
    },

    /**
     * ⭐ ADOPTING ASSUMPTIONS IS A PROPOSAL, NOT A WRITE.
     *
     * The gap, measured on Paul's session of 22 Sep: 17 of 20 factors held no
     * value, the Agent listed sensible starting assumptions in prose, the user
     * replied "these look like a good set of assumptions, can you update the
     * model with them?" — and the turn came back `mutated: false` with
     * `[get_canonical_state]` as its only tool call. Honest, and inert.
     *
     * The dishonest fix is the one the incumbent already ships: invent the
     * numbers during construction and attribute them to the system. The honest
     * one is this — the model SUGGESTS, the user ADOPTS, and the adoption goes
     * through the same stored-proposal/authorise boundary as any other change,
     * so what gets written is exactly what was shown.
     *
     * ⛔ It will not overwrite a value that is already there. A factor that
     * already carries a number was set by somebody; replacing it with a guess
     * under cover of "adopting assumptions" is the failure this refuses.
     */
    async proposeAssumptions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.assumptions) ? args.assumptions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No assumptions were given.' };
      }

      /**
       * ⛔ ONLY A NODE THE VALUE WRITER ACCEPTS CAN BE PROPOSED A VALUE — the writer's own rule,
       * imported (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`), never a copy. Served `778f1fd`
       * (witness c7a, 24 Sep 03:05Z): a value proposed for a RISK node matched by label was
       * refused at write (`entity_kind_mismatch_at_execute`) and the whole approval landed
       * nothing. A label shared by a factor and another node resolves to the factor.
       */
      const writable = (n: { kind?: unknown }) => SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS.includes(String(n.kind));
      // An exact visible LABEL wins over a description match (a factor's description must never
      // take a value the user named for a risk); among equal matches, the writable kind wins.
      const find = (l: string) => {
        const byLabel = g.nodes.filter((n) => norm(n.label) === norm(l));
        const pool = byLabel.length > 0 ? byLabel : g.nodes.filter((n) => norm(n.description) === norm(l));
        return pool.find(writable) ?? pool[0];
      };
      const unresolved: string[] = [];
      const notAFactor: { label: string; kind: string }[] = [];
      const occupied: { label: string; current_value: number }[] = [];
      const seen = new Set<string>();
      const adopted: { id: string; label: string; value: number; unit: string; basis: string }[] = [];

      for (const a of input) {
        const node = find(String(a?.factor_label ?? ''));
        if (node === undefined) { unresolved.push(String(a?.factor_label ?? '')); continue; }
        if (!writable(node)) { notAFactor.push({ label: node.label, kind: String(node.kind) }); continue; }
        const existing = node.observed_state?.value;
        if (typeof existing === 'number') { occupied.push({ label: node.label, current_value: existing }); continue; }
        if (!Number.isFinite(Number(a?.value))) { unresolved.push(node.label); continue; }
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        adopted.push({
          id: node.id, label: node.label,
          value: Number(a.value), unit: String(a?.unit ?? ''), basis: String(a?.basis ?? ''),
        });
      }

      if (adopted.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_adopt',
          unresolved_labels: unresolved, already_valued: occupied,
          ...(notAFactor.length > 0 ? { not_a_factor: notAFactor } : {}),
          detail:
            'None of those could be adopted. Read the state again and use the labels exactly as they appear; ' +
            'factors that already hold a value are left alone.',
        };
      }

      // Sorted by node id so an identical set proposed in a different order is
      // the SAME proposal, not a second one.
      const ordered = [...adopted].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const operations: ProposalOperation[] = ordered.map((a) => ({
        op: 'set_factor_value',
        path: a.id,
        value: { value: a.value, unit: a.unit, basis: a.basis },
      }));
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'starting assumptions offered for the user to adopt or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          `Adopt ${ordered.length} starting assumption${ordered.length === 1 ? '' : 's'}: ` +
          ordered.map((a) => `${a.label} = ${a.value}${a.unit !== '' ? ' ' + a.unit : ''}`).join('; ') +
          leftOutClause(notAFactor),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        assumptions: ordered.map((a) => ({ factor: a.label, value: a.value, unit: a.unit, basis: a.basis })),
        ...(unresolved.length > 0 ? { unresolved_labels: unresolved } : {}),
        ...(occupied.length > 0 ? { left_alone_already_valued: occupied } : {}),
        // Named, but not something a value can be set on (a risk, an outcome, an option): left out,
        // so the user is never asked to approve a value that cannot be saved.
        ...(notAFactor.length > 0 ? { not_a_factor: notAFactor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        note:
          'Nothing has changed. Show the user each value and what it rests on, say plainly that these are ' +
          'assumptions to adopt or correct and NOT measurements, and call authorise_change with this ' +
          'proposal_id only once they agree.',
      };
    },

    /**
     * ⭐ WHAT AN OPTION DOES — the last structural blocker on the journey.
     *
     * ⛔ THE CONSTRAINT THAT DECIDES THIS DESIGN. `option_intervention_edit` is
     * `.strict()` and its `value` is `z.number().min(0).max(1)`, described as
     * "the effect value on the MODEL scale … no unit, no currency and no
     * percentage: the client converts nothing, and the server licenses no
     * raw-unit conversion on this path." A first version of this capability
     * took the user's "£54" and was WITHDRAWN unshipped, because turning it
     * into a number in [0, 1] meant choosing a scale at the moment of writing,
     * which is the fabrication this lane exists to prevent.
     *
     * ⭐ IT IS HONEST NOW ONLY BECAUSE THE FACTOR CARRIES A DECLARED FRAME.
     * Construction publishes `observed_state.cap`, so `raw / cap` READS the
     * user's own number against a range the model already stated and disclosed
     * — a different act from inventing one here. Both numbers are reported.
     *
     * ⛔ AND WITHOUT A FRAME IT REFUSES. A factor with no cap whose value is
     * outside [0, 1] cannot be expressed on this wire at all; saying so is the
     * correct outcome, not picking a denominator.
     */
    /**
     * ⭐ A STARTING POINT IS ONE PROPOSAL, SO ONE "YES" APPLIES ALL OF IT.
     * Composed from the two existing proposers — their validation, frames and
     * refusals are unchanged — then merged into one exact proposal on the SAME
     * base, and the two halves discarded so only the object the user is shown
     * is awaiting approval. See `applyCompound` for how it is applied.
     */
    async proposeStartingPoint(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const assumptions = Array.isArray(args?.assumptions) ? args.assumptions : [];
      const levels = Array.isArray(args?.option_levels) ? args.option_levels : [];
      if (assumptions.length === 0 && levels.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'Nothing was proposed.' };
      }
      const a = assumptions.length > 0 ? await caps.proposeAssumptions(ctx, { assumptions }) : null;
      const b = levels.length > 0 ? await caps.proposeOptionInterventions(ctx, { interventions: levels }) : null;
      const refused = {
        ...(a !== null && a.ok !== true ? { assumptions_refused: a } : {}),
        ...(b !== null && b.ok !== true ? { option_levels_refused: b } : {}),
      };
      const made = [a, b].filter((r): r is ToolResult => r !== null && r.ok === true && typeof r.proposal_id === 'string');
      if (made.length === 0) return { ok: false, mutated: false, refusal: 'nothing_to_propose', ...refused };
      // Only one half could be proposed: it is an ordinary proposal already.
      if (made.length === 1) {
        const only = proposals.get(made[0].proposal_id as string);
        const missing = await missingPairs(ctx, levelPathsOf(only !== undefined ? [only] : []));
        if (missing === null || missing.length > 0) {
          if (only !== undefined) proposals.discard(only.proposal_id);
          if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
          return incompleteStartingPoint(missing, {
            assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
            ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
            ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
            ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...refused,
          });
        }
        return { ...made[0], ...refused };
      }
      const halves = made.map((r) => proposals.get(r.proposal_id as string)).filter((p): p is StructuredProposal => p !== undefined);
      if (halves.length !== 2 || halves[0].base_graph_identity_hash !== halves[1].base_graph_identity_hash) {
        for (const h of halves) proposals.discard(h.proposal_id);
        return { ok: false, mutated: false, refusal: 'model_changed_while_proposing', detail: 'The model changed while this was being put together. Read the state again and propose once more.' };
      }
      const missing = await missingPairs(ctx, levelPathsOf(halves));
      if (missing === null || missing.length > 0) {
        for (const h of halves) proposals.discard(h.proposal_id);
        if (missing === null) return { ok: false, mutated: false, refusal: 'not_found' };
        return incompleteStartingPoint(missing, {
          assumptions: a?.assumptions ?? [], option_levels: b?.interventions ?? [],
          ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked } : {}),
          ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
          ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor } : {}), ...refused,
        });
      }
      const compound = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: halves[0].base_graph_identity_hash,
        operations: [...halves[0].operations, ...halves[1].operations],
        provenance: { authored_by: 'model_proposed', basis: STARTING_POINT_BASIS },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label: `${halves[0].public_label}; ${halves[1].public_label}`,
      });
      replaceEarlierStartingPoints(ctx);
      proposals.put(compound);
      for (const h of halves) proposals.discard(h.proposal_id);
      return {
        ok: true, mutated: false,
        proposal_id: compound.proposal_id,
        public_label: compound.public_label,
        base_revision: compound.base_graph_identity_hash,
        assumptions: a?.assumptions ?? [],
        option_levels: b?.interventions ?? [],
        // Levels the proposer LEFT OUT because the option is not wired to that
        // factor — the Agent must say so and offer a level it CAN record.
        ...(b !== null && Array.isArray(b.not_linked) ? { not_linked: b.not_linked, not_linked_note: b.not_linked_note } : {}),
        ...(b !== null && Array.isArray(b.levels_not_accepted) ? { levels_not_accepted: b.levels_not_accepted } : {}),
        // ⛔ What the user NAMED but this proposal leaves out, carried to the joined result (independent
        // review of #1800, 5806926323): when both halves succeed, the value half's omission otherwise
        // never reached the Agent, and the starting point looked complete at the moment of consent.
        ...(a !== null && Array.isArray(a.not_a_factor) ? { not_a_factor: a.not_a_factor, not_a_factor_note: NOT_A_FACTOR_NOTE } : {}),
        ...refused,
        note:
          'Nothing has changed. Show the user every value and level and what each rests on, say plainly they are ' +
          'assumptions to adopt or correct, NOT measurements, and that ONE approval applies all of them. Then call ' +
          'authorise_change with this proposal_id once they agree.',
      };
    },

    async proposeOptionInterventions(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const g = await readGraph(ctx.scenario_id);
      if (g === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const input = Array.isArray(args?.interventions) ? args.interventions : [];
      if (input.length === 0) {
        return { ok: false, mutated: false, refusal: 'empty_proposal', detail: 'No interventions were given.' };
      }
      const byLabel = (l: string, kind: string) =>
        g.nodes.find((n) => n.kind === kind && (norm(n.label) === norm(l) || norm(n.description) === norm(l)));

      const unresolved: string[] = [];
      const unframed: { factor: string; detail: string }[] = [];
      const unchanged: string[] = [];
      const notLinked: { option: string; factor: string; acts_on: string[] }[] = [];
      /**
       * ⛔ EVERY SUPPLIED LEVEL THAT IS NOT ACCEPTED, WITH ITS OPTION AND WHY.
       * MEASURED on served d1829c5 (journey J1): the starting point was refused
       * `incomplete_starting_point` three times in one turn because a level the
       * Agent DID supply was dropped here, and the refusal named only the pair
       * still missing — so the Agent re-sent the same value. The reason travels
       * with the pair, so the next attempt can correct it.
       */
      const notAccepted: { option: string; factor: string; value: unknown; reason: string }[] = [];
      const seen = new Set<string>();
      const set: {
        option: { id: string; label: string }; factor: { id: string; label: string };
        raw: number; normalised: number; cap: number | null; unit: string; basis: string;
        derivedFrame: number | null;
      }[] = [];

      for (const i of input) {
        const option = byLabel(String(i?.option_label ?? ''), 'option');
        const factor = byLabel(String(i?.factor_label ?? ''), 'factor');
        const asGiven = { option: String(i?.option_label ?? ''), factor: String(i?.factor_label ?? ''), value: i?.value };
        if (option === undefined) {
          unresolved.push(`option "${asGiven.option}"`);
          notAccepted.push({ ...asGiven, reason: `No option in the model is labelled "${asGiven.option}". Use an option label exactly as get_canonical_state gives it.` });
          continue;
        }
        if (factor === undefined) {
          unresolved.push(`factor "${asGiven.factor}"`);
          notAccepted.push({ ...asGiven, option: option.label, reason: `No factor in the model is labelled "${asGiven.factor}". Use a factor label exactly as get_canonical_state gives it.` });
          continue;
        }
        /**
         * ⛔ A LEVEL CAN ONLY BE SET ON A FACTOR THE OPTION IS WIRED TO — the
         * write's own rule, applied at PROPOSAL time. MEASURED on served
         * 0f2f3b87 (journey witness, scenario 1e7649c2): the Agent proposed
         * "Internal Lead Trial -> Tech lead headcount", an option with no link
         * to that factor. This proposer accepted it, `option_intervention_edit`
         * then refused it (`unresolved_effect_relationship`, same reader:
         * `linkedFactorsOf`), and because a compound's level chain stops at its
         * first refusal, NONE of that approval's levels landed — the user
         * approved a set that could never be written. Excluded here, with the
         * factors the option DOES act on, so the Agent corrects it before the
         * user is asked to approve anything.
         */
        const linked = linkedFactorsOf(g as never, option.id);
        if (!linked.some((f) => f.id === factor.id)) {
          notLinked.push({
            option: option.label, factor: factor.label,
            acts_on: linked.map((f) => String(f.label ?? f.id)),
          });
          continue;
        }
        const raw = Number(i?.value);
        if (!Number.isFinite(raw)) {
          unresolved.push(`${option.label} -> ${factor.label} (no value)`);
          notAccepted.push({ option: option.label, factor: factor.label, value: i?.value, reason: 'No numeric value was given.' });
          continue;
        }

        const os = (factor.observed_state ?? {}) as { cap?: unknown; unit?: unknown };
        /**
         * ⭐ THE STORED RANGE WINS OVER ONE DERIVED FROM THIS FIGURE. A factor
         * built with no baseline carries its range as `scale_frame` (the
         * declared carrier; see `admit-model.ts`), and the option levels
         * already on it were divided by that range. Reading `observed_state`
         * alone missed it, so this derived a second range from the user's
         * number and the two levels on one factor sat on two scales. Measured
         * in the replay of Paul's session (repro/FINDINGS.md, turns 3-4).
         */
        const storedFrame = typeof factor.scale_frame === 'number' && Number.isFinite(factor.scale_frame) && factor.scale_frame > 1
          ? factor.scale_frame : null;
        const cap = typeof os.cap === 'number' && Number.isFinite(os.cap) && os.cap > 0 ? os.cap : storedFrame;
        let normalised: number;
        let derivedFrame: number | null = null;
        if (cap !== null) {
          normalised = raw / cap;
          if (normalised < 0 || normalised > 1) {
            unframed.push({ factor: factor.label, detail: `${raw} is outside the model's range for this factor (0 to ${cap})` });
            notAccepted.push({
              option: option.label, factor: factor.label, value: raw,
              reason: `${raw} is outside the model's range for this factor (0 to ${cap}). Propose a level within that range, in the same units, as an assumption for the user to correct.`,
            });
            continue;
          }
        } else if (raw >= 0 && raw <= 1) {
          normalised = raw;
        } else if (raw > 1) {
          /**
           * ⭐ DERIVE THE FRAME RATHER THAN REFUSE, and say so.
           *
           * ⛔ MEASURED on the deployed build: this branch USED to refuse, and
           * the refusal was correct in isolation and a dead end in practice.
           * A factor with no VALUE cannot carry a range at construction —
           * `ObservedStateSchema` requires `value`, and a node-level `cap` is
           * stripped by `NodeV3Schema` — so "Feature release availability" and
           * "Price rollout exposure" could never be set by any option, and the
           * comparison could never run. The Agent's advice became "a rebuild is
           * required", which is not something to ask a user for.
           *
           * The frame is taken from the user's own figure and ATTACHED to the
           * factor on authorisation, exactly as the adopted-assumption path
           * already does. Reported below as `ranges_added_for_analysis`.
           */
          derivedFrame = defaultFrameFor(raw);
          normalised = raw / derivedFrame;
        } else {
          const detail =
            `"${factor.label}" has no stated range, and ${raw} cannot be read against one. ` +
            'Nothing here will pick a range on your behalf for a figure like that.';
          unframed.push({ factor: factor.label, detail });
          notAccepted.push({ option: option.label, factor: factor.label, value: raw, reason: detail });
          continue;
        }

        const current = (option.interventions ?? {})[factor.id] as { value?: unknown } | number | undefined;
        const currentValue = typeof current === 'number' ? current : (current as { value?: unknown } | undefined)?.value;
        if (currentValue === normalised || currentValue === raw) {
          unchanged.push(`${option.label} already sets ${factor.label} to ${String(currentValue)}`);
          continue;
        }
        const key = `${option.id}::${factor.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        set.push({
          option: { id: option.id, label: option.label },
          factor: { id: factor.id, label: factor.label },
          raw, normalised, cap: cap ?? derivedFrame, unit: typeof os.unit === 'string' ? os.unit : '',
          basis: String(i?.basis ?? ''), derivedFrame,
        });
      }

      if (set.length === 0) {
        return {
          ok: false, mutated: false, refusal: 'nothing_to_set',
          ...(unresolved.length > 0 ? { unresolved } : {}),
          ...(notLinked.length > 0 ? { not_linked: notLinked } : {}),
          ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
          ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
          ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
          detail: 'Nothing could be recorded. Tell the user exactly which of these it was and why.',
        };
      }

      const ordered = [...set].sort((x, y) =>
        `${x.option.id}::${x.factor.id}` < `${y.option.id}::${y.factor.id}` ? -1 : 1);
      const operations: ProposalOperation[] = ordered.map((i) => ({
        op: 'set_option_intervention',
        path: `${i.option.id}::${i.factor.id}`,
        value: { normalised: i.normalised, raw: i.raw, cap: i.cap, basis: i.basis, derived_frame: i.derivedFrame },
      }));
      const proposal = createProposal({
        scenario_id: ctx.scenario_id,
        user_id: ctx.authenticated_user_id,
        base_graph_identity_hash: g.graph_hash,
        operations,
        provenance: { authored_by: 'model_proposed', basis: 'what each option does, for the user to confirm or correct' },
        validation: { admitted: true, loss_count: 0, refusals: [] },
        public_label:
          ordered.map((i) => `${i.option.label} sets ${i.factor.label} to ${i.raw}${i.unit !== '' ? ' ' + i.unit : ''}`).join('; '),
      });
      proposals.put(proposal);
      return {
        ok: true, mutated: false,
        proposal_id: proposal.proposal_id,
        public_label: proposal.public_label,
        base_revision: g.graph_hash,
        interventions: ordered.map((i) => ({
          option: i.option.label, factor: i.factor.label,
          value: i.raw, unit: i.unit,
          // Both numbers, always. The user approves the one they said.
          recorded_on_model_scale: i.normalised,
          model_range: i.cap,
          ...(i.derivedFrame !== null ? { range_taken_from_your_figure: i.derivedFrame } : {}),
          basis: i.basis,
        })),
        ...(unresolved.length > 0 ? { unresolved } : {}),
        ...(notLinked.length > 0 ? {
          not_linked: notLinked,
          not_linked_note: 'These levels were LEFT OUT: the option is not connected to that factor, so no level can be recorded there. Propose a level on one of the factors each option acts on (listed in acts_on), or say the option needs a link first.',
        } : {}),
        ...(unframed.length > 0 ? { no_stated_range: unframed } : {}),
        ...(unchanged.length > 0 ? { already_set: unchanged } : {}),
        ...(notAccepted.length > 0 ? { levels_not_accepted: notAccepted } : {}),
        note:
          'Nothing has changed. Show the user the value in THEIR units and what it rests on, then call ' +
          'authorise_change with this proposal_id once they agree.',
      };
    },

    async authoriseChange(ctx, args): Promise<ToolResult> {
      if (readOnly) return refuseReadOnly();
      const before = await readGraph(ctx.scenario_id);
      if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
      const decision = proposals.authorise({
        proposal_id: args.proposal_id,
        scenario_id: ctx.scenario_id,
        authenticated_user_id: ctx.authenticated_user_id,
        current_graph_identity_hash: before.graph_hash,
      });
      if (decision.status === 'already_applied') {
        // ⭐ A retry RECOVERS the first result. It carries the proposal id, so
        // the retry is bound to the same proposal by identity, and the ORIGINAL
        // receipts, so the Agent can say which version it already became.
        return {
          ok: true, mutated: false, applied: true, already_applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts: decision.receipts,
          detail:
            decision.receipts.length > 0
              ? `That proposal was already applied and saved as version ${Math.max(...decision.receipts.map((x) => x.version))}. Nothing was applied twice.`
              : 'That proposal was already applied. No saved version was recorded for it. Nothing was applied twice.',
        };
      }
      if (decision.status !== 'execute') {
        return { ok: false, mutated: false, refusal: decision.status, ...(decision.status === 'superseded' ? { expected: decision.expected, actual: decision.actual } : {}) };
      }

      // The STORED operations are applied. Nothing is regenerated here.
      const ops = decision.proposal.operations;

      // A starting point mixes kinds; each single-kind path below handles one.
      if (new Set(ops.map((o) => o.op)).size > 1) return applyCompound(ctx, decision.proposal, before);

      if (ops[0]?.op === 'set_option_intervention') {
        /**
         * ⚠ THIS EVENT IS CAS-GATED AND `factor_value_edit` IS NOT — it carries
         * a REQUIRED `base_graph_hash`. Each applied edit moves the hash, so
         * the current one is re-read between edits; sending the proposal's base
         * for all of them refuses every edit after the first with a divergence
         * that is really our own preceding write.
         */
        const applied: { option: string; factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { path: string; detail: string }[] = [];
        const receipts: ReceiptSummary[] = [];
        /**
         * ⭐ ATTACH ANY DERIVED FRAME FIRST, in one write, before the levels.
         * The factor must carry its range before a level is recorded against
         * it, or the level is a number the model cannot interpret. Same
         * mechanism as the adopted-assumption path, and the same disclosure.
         */
        const framedHere: { factor: string; range: number }[] = [];
        const frames = new Map<string, number>();
        for (const o of ops) {
          const f = ((o.value ?? {}) as { derived_frame?: number | null }).derived_frame;
          if (typeof f === 'number' && f > 1) frames.set(o.path.split('::')[1], f);
        }
        if (frames.size > 0) {
          /**
           * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
           *
           * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
           * this write sends a WHOLE graph built from an earlier read. The
           * route's expectation is compared in ANALYSIS space, which EXCLUDES
           * labels — so a rename landing between our read and this write passes
           * the comparison and is then overwritten by our stale copy of the node.
           *
           * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
           * left it to the atomic-writer lease. That was too broad. A caller
           * cannot express an IDENTITY-space expectation — that part is true and
           * still belongs at the write boundary — but it CAN stop replaying stale
           * bytes, which is the other half the owner note named: *"a targeted
           * atomic patch … can avoid replaying the whole stale graph."*
           *
           * So: re-read, patch the FRESH nodes, and send those. An intervening
           * edit is preserved BY CONSTRUCTION rather than by a comparison that
           * cannot see it. The residual window shrinks from "user think-time plus
           * a model call" to the milliseconds between this read and the route's
           * own — and the route's CAS already covers its own read-to-write gap.
           *
           * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
           * already carries a usable frame in the fresh read is left alone. If
           * that leaves nothing to do, no write is attempted at all.
           *
           * A failed re-read falls back to the earlier read: degrading to
           * today's behaviour is right, because refusing the whole authorisation
           * because a READ failed would lose work the user already approved.
           */
          const nowRead = await readGraph(ctx.scenario_id);
          const base = nowRead ?? before;
          const stillNeeds = new Map<string, number>();
          for (const [id, range] of frames) {
            const node = base.nodes.find((n) => n.id === id);
            if (node !== undefined && frameOf(node) !== null) continue;
            stillNeeds.set(id, range);
          }
          const patched = base.nodes.map((n) => {
            const range = stillNeeds.get(n.id);
            if (range === undefined) return n;
            const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            /**
             * ⛔ A FACTOR WITH NO VALUE IS LEFT WITHOUT ONE. `ObservedStateSchema`
             * requires `value`, so attaching a range here would mean inventing a
             * baseline — and a zero baseline is the exact fabrication this lane
             * refuses ("an absent value is unknown, never zero"). It is also
             * unnecessary: the baseline gate skips a factor with no value
             * outright (`if (baseline === undefined) continue`), so an unvalued
             * factor was never what blocked the analysis. Only a factor that
             * ALREADY carries a bare amount gets the range.
             */
            if (typeof raw !== 'number') { frames.delete(n.id); return n; }
            framedHere.push({ factor: n.label, range });
            return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
          });
          if (framedHere.length > 0) {
            /**
             * ⛔⛔ CAS-GATED, AND IT WAS NOT. This write asserts
             * `edges: before.edges` — the WHOLE edge set as it was at the read
             * on entry to this capability — so without an expected hash it does
             * not merely lose a node change: any edge written in between is
             * silently restored to its old value, the user is told nothing, and
             * the Agent reports the frame as attached.
             *
             * ⚠ THE PROPOSAL CHECK IS NOT THE WRITE CHECK, and it is tempting to
             * think it covers this. `proposals.authorise` is bound to
             * `before.graph_hash`, but that is an in-memory comparison against a
             * hash THIS process read; the register call is the only thing that
             * can refuse ATOMICALLY at the row. Between them another writer can
             * land.
             *
             * The values write below already does this (`expected_graph_hash:
             * carried`), which is what made the omission a gap rather than a
             * design. Same shape, same honest refusal.
             *
             * ⚠ SENT ONLY WHEN NON-EMPTY: the route rejects an empty string
             * outright (`EXPECTED_GRAPH_HASH_INVALID`), and `readGraph` coerces
             * a missing hash to `''`. Omitting it there preserves today's
             * behaviour rather than turning a degraded read into a hard failure.
             */
            const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, nodes: patched, edges: base.edges },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
            if (reg.status !== 200) {
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              failures.push({
                path: 'scale_frame',
                detail: code === 'GRAPH_STALE'
                  ? 'the model changed while this was being prepared, so no range was attached and nothing was written — read it again and propose afresh'
                  : `could not attach a range: http ${reg.status}`,
              });
              framedHere.length = 0;
            }
          }
        }
        const rebased = framedHere.length > 0 ? await readGraph(ctx.scenario_id) : null;
        let baseHash = rebased?.graph_hash ?? before.graph_hash;
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const [optionId, factorId] = o.path.split('::');
          const v = ((o.value ?? {}) as { normalised?: number }).normalised;
          if (typeof v !== 'number') { failures.push({ path: o.path, detail: 'no value stored on the proposal' }); continue; }
          const r = await dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: { kind: 'option_intervention_edit', option_id: optionId, factor_id: factorId, value: v, base_graph_hash: baseHash },
          });
          const rc = receiptSummaryOf(r.json);
          if (rc.summary !== null) receipts.push(rc.summary);
          if (rc.unreadable) failures.push({ path: o.path, detail: 'a receipt arrived but could not be read' });
          if (r.status !== 200) {
            failures.push({ path: o.path, detail: `http ${r.status}` });
            // ⛔⛔ DO NOT ADVANCE THE BASE AFTER A REFUSED EDIT.
            //
            // This used to re-read the graph and reassign `baseHash`
            // UNCONDITIONALLY, which made the claim at the head of this block —
            // "a moved graph refuses the WHOLE authorisation, not half of it" —
            // false for every multi-op proposal. A stale base survived exactly
            // ONE iteration: op 0 was refused at the row, then `baseHash` became
            // the CONCURRENT writer's hash and ops 1..N passed the
            // `base_graph_hash` gate, landing on a model the user never approved
            // while the result still reported the approval as applied.
            //
            // A refusal means the graph moved because someone ELSE wrote. Keeping
            // the approved base means every remaining op is refused too, which is
            // the whole-or-nothing property this authorisation is supposed to
            // have. Advancing after a SUCCESS is different and still correct: the
            // graph moved because WE moved it, within this same authorisation.
            continue;
          }
          const mid = await readGraph(ctx.scenario_id);
          if (mid !== null) baseHash = mid.graph_hash;
        }

        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const [optionId, factorId] = o.path.split('::');
          const option = byId.get(optionId);
          const iv = (option?.interventions ?? {})[factorId] as { value?: unknown } | number | undefined;
          const recorded = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
          const stored = ((o.value ?? {}) as { raw?: number }).raw;
          applied.push({
            option: option?.label ?? optionId,
            factor: byId.get(factorId)?.label ?? factorId,
            requested: typeof stored === 'number' ? stored : Number.NaN,
            recorded: typeof recorded === 'number' ? recorded : null,
          });
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail: 'None of the levels were recorded. The model is unchanged.', failures, interventions: applied,
          };
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id, receipts);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts,
          recorded_count: landed.length,
          requested_count: applied.length,
          interventions: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(framedHere.length > 0 ? { ranges_added_for_analysis: framedHere } : {}),
          not_represented:
            'What each option does is now recorded from what the user said, not measured. The model ' +
            'stores each level against the factor\u2019s stated range, so quote the user\u2019s own number back ' +
            'to them, not the normalised one.' +
            (framedHere.length > 0
              ? ' Some factors had no range at all, which would have stopped the analysis running, so one was ' +
                'taken from the figure itself: ' + framedHere.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. Say so, and invite a correction \u2014 a range is a unit of measurement, not a forecast.'
              : ''),
        };
      }

      if (ops[0]?.op === 'set_factor_value') {
        /**
         * ⭐ APPLY EACH ADOPTED ASSUMPTION AS ITS OWN `factor_value_edit`, WITH
         * ITS OWN DERIVED IDENTITY. The wire has no batch form, and each event
         * needs a distinct `turn_id` because `(scenario_id, turn_id)` is unique
         * — so the key is derived from the proposal id AND the operation index,
         * which keeps a retry of the same authorisation idempotent per value
         * instead of minting a fresh id every attempt.
         *
         * ⚠ REPRESENTATION LOSS, RECORDED. `FactorValueEditEvent` is `.strict()`
         * and carries `{kind, target_id, value, raw_value?, unit?, field?,
         * applied_from?}` — there is NO provenance field on it, and the handler
         * stamps `observed_state.source` with `USER_EDIT_SOURCE`
         * (`canonicalise-value-ops.ts`) because it was built for the inspector.
         * (`user_explicit` is only the source of the proposal PARAMETER
         * `factor-value-edit.ts` builds, not the stored stamp.) That stamp is
         * right about WHO set the value (the user authorised this exact set)
         * and silent about WHAT IT RESTS ON. The
         * basis therefore survives only in the proposal and in what the Agent
         * says, so the result below tells it to say it.
         */
        const applied: { factor: string; requested: number; recorded: number | null }[] = [];
        const failures: { factor: string; detail: string }[] = [];
        const receipts: ReceiptSummary[] = [];
        for (let i = 0; i < ops.length; i += 1) {
          const o = ops[i];
          const v = (o.value ?? {}) as { value?: number; unit?: string };
          if (typeof v.value !== 'number') { failures.push({ factor: o.path, detail: 'no value stored on the proposal' }); continue; }
          const r = await dispatch('/orchestrate/v2/turn', {
            kind: 'system_event',
            turn_id: authorisationTurnId(`${decision.proposal.proposal_id}#${i}`),
            scenario_id: ctx.scenario_id,
            stage: 'frame',
            event: {
              kind: 'factor_value_edit',
              target_id: o.path,
              value: v.value,
              ...(v.unit !== undefined && v.unit !== '' ? { unit: v.unit } : {}),
            },
          });
          if (r.status !== 200) failures.push({ factor: o.path, detail: `http ${r.status}` });
          const rc = receiptSummaryOf(r.json);
          if (rc.summary !== null) receipts.push(rc.summary);
          if (rc.unreadable) failures.push({ factor: o.path, detail: 'a receipt arrived but could not be read' });
        }

        // ⛔ CONFIRMED FROM STATE. The handler may rescale what it was sent
        // (unit caps, percent-vs-fraction), so the recorded number is read back
        // and reported EVEN WHEN it differs from the one the user approved —
        // that difference is exactly the thing a user must not discover later.
        const afterSet = await readGraph(ctx.scenario_id);
        const byId = new Map((afterSet?.nodes ?? []).map((n) => [n.id, n]));
        for (const o of ops) {
          const node = byId.get(o.path);
          const stored = node?.observed_state?.value;
          const req = ((o.value ?? {}) as { value?: number }).value;
          applied.push({
            factor: node?.label ?? o.path,
            requested: typeof req === 'number' ? req : Number.NaN,
            recorded: typeof stored === 'number' ? stored : null,
          });
        }
        const landed = applied.filter((a) => a.recorded !== null);
        if (landed.length === 0) {
          return {
            ok: false, mutated: false, applied: false, refusal: 'not_applied',
            detail: 'None of the values were recorded. The model is unchanged.',
            failures, values: applied,
          };
        }

        /**
         * ⭐ ATTACH A SCALE FRAME TO ANYTHING THAT LANDED AS A BARE AMOUNT.
         *
         * ⛔ WHY THIS SECOND WRITE EXISTS, measured end to end. A factor above
         * 1 with no `cap` is refused by `run_analysis`
         * (`baseline_scale_unresolved`) and the refusal is permanent:
         * `factor_value_edit` is `.strict()` with no cap field, and posting a
         * `{value, raw_value}` pair is accepted with HTTP 200 then normalised
         * back to `raw === value`. Construction publishes the frame inside
         * `observed_state`, which survives because `ObservedStateSchema` is
         * `.passthrough()` — but a factor with NO baseline at construction has
         * no `observed_state` to carry one (`value` is required), and a
         * node-level `cap` is stripped by `NodeV3Schema`. So a factor that
         * gets its first value HERE, by adoption, would be unanalysable for
         * the life of the model.
         *
         * Measured on the deployed build: with the frame attached this way,
         * `analysis_ready` went `blocked` -> `ready`, blockers 0, and the run
         * produced win probabilities over 10,000 samples per option. Without
         * it, the same model refused.
         *
         * ⚠ The frame is DERIVED from the user's own number, `raw_value` keeps
         * that number untouched, and it is reported so the Agent says it.
         */
        const needsFrame = (afterSet?.nodes ?? []).filter((n) => {
          if (!ops.some((o) => o.path === n.id)) return false;
          const os = (n.observed_state ?? {}) as { value?: unknown; cap?: unknown };
          // ⛔ A factor that already carries a stored range was written ON it
          // by the value handler. A level above 1 there is the honest truth
          // about an over-range figure; deriving a new range for it would
          // rescale the baseline away from every option level on that factor.
          if (typeof n.scale_frame === 'number' && n.scale_frame > 1) return false;
          return typeof os.value === 'number' && Math.abs(os.value) > 1 && typeof os.cap !== 'number';
        });
        const framed: { factor: string; value: number; range: number }[] = [];
        /** The ranges this turn INTENDED to attach but could not — kept so a
         *  failure can name which factors still have no range, instead of the
         *  reply implying nothing was written at all. */
        let rangesNotAttached: { factor: string; value: number; range: number }[] = [];
        /**
         * ⛔ THE FIELD NAME MUST CARRY ITS OWN GUARANTEE. A consumer cannot tell a
         * verified absence from an intended one, so `ranges_not_attached` is
         * emitted ONLY when a post-refusal readback confirmed the factor still has
         * no range. When the readback fails this is set instead, and the consumer
         * says the present state is unknown rather than advising.
         *
         * CHANGES_REQUIRED on #1751 `f028650d`: the deterministic consumer turned
         * that event field into a present-state claim ("unchanged", "still needs a
         * range", "do not re-enter") with no readback between the refusal and the
         * sentence. Fixing only the consumer would leave the next consumer free to
         * make the same mistake; the contract is fixed here.
         */
        let currentStateUnknown = false;
        if (needsFrame.length > 0 && afterSet !== null) {
          const frameById = new Map<string, number>();
          for (const n of needsFrame) {
            const os = n.observed_state as { value: number; raw_value?: number };
            const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
            const range = defaultFrameFor(raw);
            if (range <= 1) continue;
            frameById.set(n.id, range);
            // ⛔ `framed` is NOT built here. It is the list reported back to the
            // user as `ranges_added_for_analysis`, and it must describe what the
            // write ACTUALLY DID — which is only knowable after the re-read
            // below decides which factors still need a frame. Building it here
            // meant a 200 reported ranges added for factors the code had
            // deliberately skipped because a competing writer already framed them.
          }
          if (frameById.size > 0) {
          /**
             * ⭐⭐ PATCH THE MODEL AS IT IS NOW, NOT AS IT WAS WHEN WE READ IT.
             *
             * ⛔ THE COUNTEREXAMPLE THIS CLOSES (owner note 5799139118, limb 1):
             * this write sends a WHOLE graph built from an earlier read. The
             * route's expectation is compared in ANALYSIS space, which EXCLUDES
             * labels — so a rename landing between our read and this write passes
             * the comparison and is then overwritten by our stale copy of the node.
             *
             * ⚠ I previously reported limb 1 as wholly uncloseable caller-side and
             * left it to the atomic-writer lease. That was too broad. A caller
             * cannot express an IDENTITY-space expectation — that part is true and
             * still belongs at the write boundary — but it CAN stop replaying stale
             * bytes, which is the other half the owner note named: *"a targeted
             * atomic patch … can avoid replaying the whole stale graph."*
             *
             * So: re-read, patch the FRESH nodes, and send those. An intervening
             * edit is preserved BY CONSTRUCTION rather than by a comparison that
             * cannot see it. The residual window shrinks from "user think-time plus
             * a model call" to the milliseconds between this read and the route's
             * own — and the route's CAS already covers its own read-to-write gap.
             *
             * ⛔ AND IT NEVER CLOBBERS A RANGE SOMEONE ELSE SUPPLIED: a factor that
             * already carries a usable frame in the fresh read is left alone. If
             * that leaves nothing to do, no write is attempted at all.
             *
             * A failed re-read falls back to the earlier read: degrading to
             * today's behaviour is right, because refusing the whole authorisation
             * because a READ failed would lose work the user already approved.
             */
            const nowRead = await readGraph(ctx.scenario_id);
            const base = nowRead ?? afterSet;
            const stillNeeds = new Map<string, number>();
            for (const [id, range] of frameById) {
              const node = base.nodes.find((n) => n.id === id);
              if (node !== undefined && frameOf(node) !== null) continue;
              /**
               * ⛔ AND IT MUST STILL HAVE A VALUE IN THE FRESH BYTES. `needsFrame`
               * validated `typeof os.value === 'number'` against the EARLIER read;
               * `patched` maps over the fresh one. A competing writer that cleared
               * a value therefore yielded `raw === undefined` and put `value: NaN`
               * on the wire — a number the selection filter never validated, on
               * bytes it never saw. The first site has this guard; this one did not.
               * A factor with no value is left without one rather than framed.
               */
              const freshOs = (node?.observed_state ?? {}) as { value?: unknown; raw_value?: unknown };
              const freshRaw = typeof freshOs.raw_value === 'number' ? freshOs.raw_value : freshOs.value;
              if (node === undefined || typeof freshRaw !== 'number' || !Number.isFinite(freshRaw)) continue;
              stillNeeds.set(id, range);
              // ⭐ Reported only now, from the FRESH node, so the sentence the user
              // reads and the bytes that were written are the same fact.
              framed.push({ factor: node.label, value: freshRaw, range });
            }
            const patched = base.nodes.map((n) => {
              const range = stillNeeds.get(n.id);
              if (range === undefined) return n;
              const os = (n.observed_state ?? {}) as { value: number; raw_value?: number };
              const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
              return { ...n, observed_state: { ...os, value: raw / range, raw_value: raw, cap: range, declared_scale: 'unit_interval' } };
            });
            /**
             * ⛔ THE SIBLING OF THE FRAME WRITE ABOVE, and it carried the same
             * omission. `afterSet` is a re-read, so it is fresher — but a read
             * is still a read, and this asserts `edges: afterSet.edges`, the
             * whole edge set as it was at that moment. Without an expected hash
             * a write landing in between is silently restored to its old value.
             *
             * ⚠ I CLAIMED THIS WAS FIXED ONCE AND IT WAS NOT. The claim went
             * into a commit message and a PR body while only the first site had
             * changed. Fixed now, and the guard below counts BOTH.
             */
            const reg = await dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
              // ⛔⛔ SPREAD THE WHOLE GRAPH. This sent only `{ nodes, edges }`, so
              // every other top-level key was DELETED by a write whose purpose is
              // to stop the model being overwritten. They are not cosmetic:
              // `computeAnalysisAffectingGraphHashSha256` (`context/graph-hash.ts:149-162`)
              // hashes `options`, `goal_node_id` and `goal_constraints` too, so the
              // frame write destroyed analysis-affecting content. The value-batch
              // write at `:367` had it right all along — same spread, same reason.
              graph: { ...base.raw, nodes: patched, edges: base.edges },
              ...(base.graph_hash !== '' ? { expected_graph_hash: base.graph_hash } : {}),
              /**
               * ⭐ AND THE IDENTITY EXPECTATION, from the SAME read these bytes
               * come from. Patching fresh nodes preserves an intervening rename;
               * this REFUSES outright if one lands in the window between that
               * read and the route's own — which the analysis-space hash cannot
               * see, because its projection excludes labels.
               *
               * ⚠ The route enforces this only once CEE #1810 lands. Until then
               * it is an unknown top-level field and is ignored (the register
               * route has no body schema), so sending it early is safe and makes
               * the two land in either order.
               */
              ...(base.graph_identity_hash !== ''
                ? { expected_graph_identity_hash: base.graph_identity_hash }
                : {}),
            });
            if (reg.status !== 200) {
              const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
              /**
               * ⛔⛔ "NOTHING WAS WRITTEN" WAS UNTRUE HERE, AND IT IS THE WORST
               * KIND OF UNTRUE: the values were already saved, in their own
               * registration, BEFORE this frame write was attempted. Telling the
               * user nothing landed invites them to redo a write that succeeded.
               *
               * The two outcomes are now reported SEPARATELY — what was saved,
               * and what was not attached — because they are separately true.
               * The unattached list is captured before `framed` is cleared;
               * clearing it was itself losing the only record of which factors
               * still have no range.
               */
              rangesNotAttached = [...framed];
              const savedSomething = landed.length > 0;
              if (code === 'GRAPH_STALE') {
                /**
                 * ⛔⛔ THE REFUSAL ESTABLISHES ONE THING ONLY: *THIS* FRAME WRITE
                 * DID NOT LAND. It establishes nothing about the current model.
                 *
                 * ⚠ CHANGES_REQUIRED on a6dc18be, accepted in full. My previous
                 * wording asserted that the approved values were "unchanged",
                 * that "only the range" was missing, and that the analysis was
                 * "still blocked" — then told the user not to re-enter anything.
                 * But GRAPH_STALE means a COMPETING WRITER moved the canonical
                 * graph after the `afterSet` read. That writer may have changed a
                 * value, attached a range, or removed the factor. Every one of
                 * those sentences was authority the stale read cannot support,
                 * and the last one is advice that could lose the user's work.
                 *
                 * So: RE-READ, and describe only what the fresh read shows. When
                 * the read is unavailable, report the HISTORICAL EVENT and say
                 * the current state is unknown — never advise on a state we could
                 * not observe.
                 */
                const fresh = await readGraph(ctx.scenario_id);
                if (fresh === null) {
                  // Nothing here is verified, so nothing is claimed: the list is
                  // dropped and the unknown marker travels in its place.
                  rangesNotAttached = [];
                  currentStateUnknown = true;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? /**
                       * ⚠ THE HISTORICAL FACT IS BOUND TO ITS OWN TENSE. I asked
                       * the reviewer whether to withhold it entirely; on
                       * reflection that is my call, and withholding it is worse —
                       * it is the one thing that stops a user redoing a write
                       * that was accepted. What matters is that it cannot be
                       * READ as a current-state claim, so the sentence says the
                       * writes were accepted AT THE TIME and that whether those
                       * values are still in the model is unknown, rather than
                       * stating a fact and an UNKNOWN side by side.
                       */
                      'the model changed while the range was being attached, and it could not be read back afterwards. This turn\u2019s value writes were accepted AT THE TIME, and its range write was refused. Whether those values are still in the model, whether they now carry a range, and whether the analysis can run are ALL UNKNOWN, because the model could not be read. Read it again before describing or advising anything \u2014 and do not tell the user their figures are safe.'
                      : 'the model changed while this was being prepared and could not be read back. No range was attached by this turn; the current state is unknown — read it again and propose afresh.',
                  });
                } else {
                  // Derived from the FRESH read, never from what we intended:
                  // a competing writer may already have supplied a range.
                  /**
                   * ⚠ KEYED ON `label`, NOT `id`. `framed.push({ factor: n.label … })`
                   * stores the LABEL (`:1324`), so an id-keyed lookup misses every
                   * entry, `frameOf(undefined)` is null, and EVERY factor reads as
                   * still-unranged — the exact false claim this repair exists to
                   * remove. Caught by the competing-writer control, which is what a
                   * discriminating control is for.
                   */
                  const byLabel = new Map<string, GraphRead['nodes'][number]>();
                  for (const n of fresh.nodes) {
                    const label = String((n as { label?: unknown }).label ?? '');
                    if (label !== '') byLabel.set(label, n);
                  }
                  /**
                   * ⛔⛔ AND A LABEL THAT IS NOT IN THE FRESH READ PROVES NOTHING.
                   * The join is on `label`, so a factor a competing writer RENAMED
                   * — the exact case GRAPH_STALE fires for — is simply absent from
                   * `byLabel`. `frameOf(undefined)` is null, so it survived the
                   * filter and was then printed BY ITS OLD LABEL as "still has no
                   * range": a present-state claim about a name the model no longer
                   * uses, from a read that never saw it. That is the same
                   * fabrication as the refusal copy this block was written to fix.
                   *
                   * So the three cases are separated. Found and unranged → named.
                   * Found and framed → dropped, someone supplied one. NOT FOUND →
                   * dropped from the named list and disclosed as unaccounted for,
                   * without asserting anything about it.
                   */
                  const unaccounted = rangesNotAttached.filter((f) => byLabel.get(f.factor) === undefined);
                  const stillUnranged = rangesNotAttached.filter(
                    (f) => byLabel.get(f.factor) !== undefined && frameOf(byLabel.get(f.factor)) === null,
                  );
                  rangesNotAttached = stillUnranged;
                  failures.push({
                    factor: 'scale_frame',
                    detail: savedSomething
                      ? 'the model changed while the range was being attached, so this turn attached none. Read back afterwards, ' +
                        (stillUnranged.length > 0
                          ? `these still have no range: ${stillUnranged.map((f) => f.factor).join(', ')}. Describe the values from that read, not from what was approved — someone else may have changed them.`
                          : 'every factor that could be found now has a range, so someone else supplied one. Describe the model from that read before advising anything.')
                        + (unaccounted.length > 0
                          ? ` ⚠ ${unaccounted.length} factor(s) this turn tried to frame could not be found in that read at all — they may have been renamed or removed, so nothing is claimed about them; read the model as it now stands.`
                          : '')
                      : 'the model changed while this was being prepared, so this turn attached no range. Read the model as it now stands before proposing again.',
                  });
                }
              } else {
                failures.push({
                  factor: 'scale_frame',
                  detail: `could not attach a range: http ${reg.status}`,
                });
              }
              framed.length = 0;
            }
          }
        }
        if (landed.length === applied.length) proposals.markApplied(decision.proposal.proposal_id, receipts);
        const rescaled = landed.filter((a) => a.recorded !== a.requested);
        return {
          ok: true, mutated: true, applied: true,
          proposal_id: decision.proposal.proposal_id,
          receipts,
          adopted_count: landed.length,
          requested_count: applied.length,
          values: applied,
          revision_before: before.graph_hash,
          revision_after: afterSet?.graph_hash ?? before.graph_hash,
          ...(failures.length > 0 ? { failures } : {}),
          ...(rescaled.length > 0
            ? { rescaled_by_the_model: rescaled, must_disclose_rescaling: true }
            : {}),
          ...(framed.length > 0 ? { ranges_added_for_analysis: framed } : {}),
          /**
           * ⭐ THE PARTIAL OUTCOME, STATED RATHER THAN IMPLIED. A value write and
           * a frame write are two registrations; the first can land and the
           * second refuse. Reporting only aggregate success let the reply claim
           * "applied" while the analysis was still blocked.
           *
           * `partially_applied` is this file's existing word for it (`:395`,
           * `:463`). Present only when it is true, so its presence is the signal.
           */
          // ⚠ PRESENT-STATE UNKNOWN, stated rather than implied by an absence.
          // Travels even when `ranges_not_attached` is empty, which is exactly
          // when a consumer must not advise.
          ...(currentStateUnknown ? { partially_applied: true, current_state_unknown: true } : {}),
          ...(rangesNotAttached.length > 0
            ? {
              partially_applied: true,
              ranges_not_attached: rangesNotAttached,
              // A factor whose amount has no range cannot be read against
              // anything, so the analysis stays blocked for it whatever else
              // landed. Named, so the Agent cannot report a clean success.
              // ⚠ DERIVED FROM THE FRESH READ, not from what this turn intended.
              // On GRAPH_STALE `rangesNotAttached` has already been filtered to
              // the factors a re-read shows STILL have no range; when the read
              // failed it is the unfiltered intent and the detail above says the
              // current state is unknown, so nothing here claims otherwise.
              analysis_still_blocked_for: rangesNotAttached.map((f) => f.factor),
            }
            : {}),
          not_represented:
            'These values are the user\u2019s adopted assumptions, not measurements, and the model records ' +
            'no mark distinguishing the two \u2014 so say so when you describe what changed' +
            (rescaled.length > 0 ? ', and state every value the model stored differently from the one approved.' : '.') +
            (rangesNotAttached.length > 0
              ? ' \u26a0 This turn could not attach a range to ' +
                rangesNotAttached.map((f) => f.factor).join(', ') +
                ' because the model changed underneath it. Describe those factors from the model as it now stands — ' +
                'another person may have changed a value or supplied a range — and do not tell the user their figures ' +
                'are safe or unchanged unless the current model shows it.'
              : '') +
            (framed.length > 0
              ? ' Some of them had no range to be read against, which would have stopped the analysis running ' +
                'at all, so a range was taken from the figure itself: ' +
                framed.map((f) => `${f.factor} 0 to ${f.range}`).join(', ') +
                '. That is a unit of measurement rather than a forecast or a limit, the approved figures are ' +
                'stored unchanged, and the user should be told and invited to correct any range that is wrong.'
              : ''),
        };
      }

      const op = ops[0];
      const [fromId, toId] = op.path.split('::');
      const direction = (op.value as { effect_direction: 'positive' | 'negative' }).effect_direction;
      /**
       * ⭐ THE OPERATION IDENTITY IS DERIVED, NOT MINTED.
       *
       * This was `randomUUID()`. A fresh id per authorisation means a retry of
       * the SAME authorisation is a different operation to every layer beneath
       * it, so `(scenario_id, turn_id)` can never match and the deployed
       * `append_turn_atomic_v5` replay arm is unreachable by construction.
       *
       * The proposal id is already the stable client/operation identity: it is
       * hashed over the scenario, the user, the base revision and the exact
       * operations, so the same authorisation of the same proposal yields the
       * same key, and a different mutation yields a different one.
       *
       * ⚠ This does NOT by itself deliver durable replay. At the served SHA,
       * `structural-add-edge.ts` computes the current hash and refuses
       * `BASE_HASH_DIVERGED` BEFORE `payload.turn_id` is read, so the app-level
       * gate answers first and the DB's replay-before-CAS arm is still not
       * reached. What this change does is make that boundary MEASURABLE rather
       * than masked by an identity that never repeats.
       */
      const operationId = authorisationTurnId(decision.proposal.proposal_id);
      const res = await dispatch('/orchestrate/v2/turn', {
        kind: 'system_event',
        turn_id: operationId,
        scenario_id: ctx.scenario_id,
        stage: 'frame',
        event: {
          kind: 'structural_add_edge',
          from: fromId,
          to: toId,
          // ⚠ REPRESENTATION LOSS, RECORDED IN THE RESULT. The wire REQUIRES a
          // magnitude and forbids `unknown`, so a direction-only authorisation
          // cannot be expressed. This number is the projection default, not the
          // user's claim, and the Agent is told so explicitly below.
          magnitude: 0.5,
          effect_direction: direction,
          base_graph_hash: decision.proposal.base_graph_identity_hash,
        },
      });

      const after = await readGraph(ctx.scenario_id);
      const confirmation = confirmEdgeWrite({
        revision_before: before.graph_hash,
        revision_after: after?.graph_hash ?? before.graph_hash,
        edgeExistsAfter: (after?.edges ?? []).some((e) => e.from === fromId && e.to === toId),
        system_message: String(res.json.assistant_text ?? ''),
      });
      if (!confirmation.applied) {
        return {
          ok: false, mutated: false, applied: false, refusal: 'not_applied',
          detail: describeOutcome(confirmation), http: res.status, operation_id: operationId,
        };
      }
      const edgeReceipt = receiptSummaryOf(res.json);
      const edgeReceipts = edgeReceipt.summary !== null ? [edgeReceipt.summary] : [];
      proposals.markApplied(decision.proposal.proposal_id, edgeReceipts);
      return {
        ok: true, mutated: true, applied: true,
        receipts: edgeReceipts,
        ...(edgeReceipt.unreadable ? { receipt_unreadable: true } : {}),
        // Olumi discloses this to the user deterministically; see disclosure.ts.
        placeholder_strength: true,
        proposal_id: decision.proposal.proposal_id,
        operation_id: operationId,
        revision_before: confirmation.revision_before,
        revision_after: confirmation.revision_after,
        not_represented:
          'The direction was recorded. No strength was stated by the user, so the model carries a ' +
          'placeholder strength that is not a measurement — say so if you describe the change.',
      };
    },

    async buildModelFromBrief(ctx, args): Promise<ToolResult> {
      if (callStructured === undefined) {
        return { ok: false, mutated: false, refusal: 'construction_unavailable' };
      }
      const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
      if (brief.length === 0) return { ok: false, mutated: false, refusal: 'empty_brief' };

      /**
       * ⭐ FIRST ASK WHETHER THIS CONSTRUCTION ALREADY COMMITTED — before the
       * populated-graph guard, and before any model call.
       *
       * ⛔ Independent review of #1691 at 84dadabb: after a build commits and its
       * response is lost, a retry hit the guard below first and answered
       * `model_already_exists`, so the derived operation id never reached the
       * registration replay arm. The model was saved; the Agent said it was not.
       *
       * If the version this brief's construction produced exists, recover its
       * receipt — no second model generation, no second version — and let the
       * SAME confirm-from-state block below report the model as it now stands.
       * A populated graph with no matching operation is a genuinely different
       * model, and keeps the refusal.
       */
      const prior = await findConstructionVersion(dispatch, ctx.scenario_id, brief);
      let built: ToolResult;
      if (prior !== null) {
        built = {
          ok: true, mutated: false, replayed: true, model_version: prior,
          detail: `This model was already built from this brief and saved as version ${prior.version_number}. Nothing was built twice.`,
        };
      } else {
        // ⛔ NEVER BUILD OVER A MODEL THAT ALREADY EXISTS. Registration replaces
        // the whole graph, so running this on a populated scenario would discard
        // work the user has already authorised.
        const before = await readGraph(ctx.scenario_id);
        if (before === null) return { ok: false, mutated: false, refusal: 'not_found' };
        if (before.nodes.length > 0) {
          return {
            ok: false, mutated: false, refusal: 'model_already_exists',
            detail: 'The model already has entities. Propose a change instead of rebuilding it.',
          };
        }
        built = await buildModelFromBrief(ctx.scenario_id, brief, dispatch, callStructured);
        if (built.ok !== true) return built;
      }

      // Confirmed from state, never from the write's own return value.
      const after = await readGraph(ctx.scenario_id);
      if (after === null || after.nodes.length === 0) {
        return { ok: false, mutated: false, refusal: 'model_not_readable_after_write' };
      }
      /**
       * ⭐ RETURN THE POST-BUILD STATE, so the Agent does not have to go and
       * fetch it. Measured on the preview path: the first turn called
       * `get_canonical_state`, then `build_model_from_brief`, then
       * `get_canonical_state` AGAIN, then `run_analysis` — four tool calls and
       * four model round trips, 85 s on the slowest sample against a 125 s
       * browser-proxy budget. The second read asks for something this call
       * already has in hand.
       */
      return {
        ...built,
        confirmed_entities: after.nodes.length,
        graph_revision: after.graph_hash,
        // The SAME projection get_canonical_state uses — see projectEntity.
        entities: after.nodes.map(projectEntity),
        structure: structuralFacts(after.nodes, after.edges),
      };
    },

    async runAnalysis(ctx, args): Promise<ToolResult> {
      const r = await dispatch('/orchestrate/v2/turn', {
        kind: 'message',
        // Deliberately NOT derived, unlike the authorised write above: asking
        // for the analysis twice is two operations the user actually made, and
        // collapsing them onto one identity would suppress the second.
        turn_id: randomUUID(),
        scenario_id: ctx.scenario_id,
        stage: 'analyse',
        turn_class: 'decide',
        source: 'chip_click',
        message: args.reason,
        chip: { id: AGENT_RUN_ANALYSIS_CHIP_ID, action_type: 'run_analysis' },
      });
      const ready = (r.json.analysis_ready ?? {}) as Record<string, unknown>;
      const blocks = (r.json.blocks as { type: string }[] | undefined) ?? [];
      const result = blocks.find((b) => b.type === 'analysis_result');
      onAnalysis?.({ analysis_ready: r.json.analysis_ready, blocks });
      return {
        ok: r.status === 200,
        mutated: false,
        ran: result !== undefined,
        status: ready.status ?? 'unknown',
        // Olumi's own words about what is missing. Not re-worded here.
        what_is_missing: String(r.json.assistant_text ?? ''),
        blockers: ready.blockers ?? [],
        options: ready.options ?? [],
        ...(result !== undefined ? { result } : {}),
      };
    },
  };
  return caps;
}
