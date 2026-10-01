/**
 * ⭐ THE SUM-TOTAL CARD — a saved total that should be the sum of its parts is offered as ONE card, and only the user's
 * yes writes it (DL 380e54 #85 5932495794 item 1, which REVERSES the earlier read-time instruction):
 *
 *   "A read-time `repairSumTotals` silently changes a VALUE, which makes a second hidden model. Instead: detect the broken
 *    total on read → ONE proposal card ("this total should be the sum of its parts") → the user confirms → durable commit
 *    through the F1 write path → the Run goes stale → rerun. Rows: Paul's `96c6f5f4` card; the pre-repair Run reads NOT
 *    current; shape-only normalisation stays silent."
 *
 * Paul's `96c6f5f4` was saved before #2445: "Total sprint capacity allocated" is a causal sink on Olumi's placeholder
 * links at Olumi's 0%, while its parts hold his 10% and 50%. Every read keeps returning exactly those stored bytes. What
 * changes is that the Agent is TOLD (`totalsNotSummed`, a line of the model context it reads) and can OFFER the card:
 *
 *  · DETECT (pure, 0 writes): `detectSumTotalRepair` (`sum-totals.ts`) over the STORED graph — the same shaping
 *    construction uses. Shape-only differences are silent (null → no field, no card, the tool refuses).
 *  · CARD: `proposeSumTotalRepair` holds ONE exact proposal (content-hashed, bound to scenario, user and the analysis hash
 *    it was read on) whose label says, in plain words, what the total becomes. Nothing is written.
 *  · COMMIT: `applySumTotalRepair`, on the user's approval only. The repair is re-detected on the graph as it is now and
 *    must be exactly what was approved (else `superseded`). ONE `/graph/register` of that graph, CAS-gated on the card's
 *    analysis hash (`expected_graph_hash`) and the read's identity: a 409 is `superseded` and nothing is written.
 *    "Saved" only when the stored graph, read back, holds the identity, the definitional part links and the level, and
 *    no longer needs this repair. The write moves the analysis hash (the total's level and identity are inside it), so a
 *    Run computed before reads NOT current and the user reruns.
 */
import { createProposal, type ProposalStore, type ReceiptSummary, type StructuredProposal } from './proposal.js';
import { detectSumTotalRepair, sumPartLinkMeaning, type SumTotalRepair } from './sum-totals.js';
import { registrationTurnId } from '../graph-registration/registration-identity.js';
import { sayFigureAsWritten } from './say-figure.js';
import type { AgentToolContext, ToolResult } from './runtime/agent-tools.js';

/** The proposal op: the total and its part links, set to the shape construction mints (`sum-totals.ts`). */
export const SUM_TOTAL_REPAIR_OP = 'repair_sum_total' as const;
export const SUM_TOTAL_REPAIR_TOOL = 'propose_sum_total_repair' as const;

type Rec = Record<string, unknown>;
type InternalDispatch = (path: string, body: unknown) => Promise<{ status: number; json: Record<string, unknown> }>;

/** The slice of a graph read this module needs — `agent-capabilities.ts`'s `GraphRead` satisfies it. */
export interface SumTotalRead {
  readonly graph_hash: string;
  readonly graph_identity_hash: string;
  readonly raw: Record<string, unknown>;
}

/** What the approval writes, byte for byte: the total node and its part links as repaired, and what it becomes. */
interface SumTotalRepairValue {
  readonly part_ids: readonly string[];
  readonly level_after: SumTotalRepair['level_after'];
  readonly total: Rec;
  readonly part_links: readonly Rec[];
}

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Every object's keys sorted at every depth: what the approval compares is content, never key order. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isRec(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** The proposal value for a detected repair: read off its `repaired_graph`, so the card carries exactly what is written. */
function repairValueOf(r: SumTotalRepair): SumTotalRepairValue {
  const nodes = (r.repaired_graph.nodes as unknown[]).filter(isRec);
  const edges = (r.repaired_graph.edges as unknown[]).filter(isRec);
  return {
    part_ids: [...r.part_ids],
    level_after: r.level_after,
    total: nodes.find((n) => n.id === r.total_id)!,
    part_links: r.part_ids.map((p) => edges.find((e) => e.from === p && e.to === r.total_id)!),
  };
}

const say = (raw: number, unit: string): string => sayFigureAsWritten(raw, unit);

/** The card's words — what the user is shown and approves. */
export function sumTotalCardWords(r: SumTotalRepair): string {
  const figure = say(r.level_after.raw_value, r.unit);
  return `Make "${r.total_label}" the sum of its parts (${r.part_labels.join(' + ')}): ` +
    (r.changes.level ? `it becomes ${figure}` : `it stays ${figure}`);
}

/**
 * ⭐ THE ONE LINE THE AGENT READS (`projectModelContext`): present ONLY when a total needs the card, so a model in shape
 * costs nothing. Names, figures in the total's unit, never ids.
 */
export function totalsNotSummed(raw: unknown): { totals_not_summed: { label: string; parts: string[]; would_be: string }[] } | Record<string, never> {
  const r = detectSumTotalRepair(raw);
  return r === null ? {} : {
    totals_not_summed: [{ label: r.total_label, parts: [...r.part_labels], would_be: say(r.level_after.raw_value, r.unit) }],
  };
}

export function isSumTotalRepairProposal(p: StructuredProposal): boolean {
  return p.operations.length === 1 && p.operations[0]!.op === SUM_TOTAL_REPAIR_OP;
}

/**
 * ⭐ THE CARD. Reads the stored graph itself (no free-text argument names the total), and offers ONE proposal or refuses
 * `no_repair_needed`. Nothing is written.
 */
export async function proposeSumTotalRepair(
  deps: { readonly readGraph: (scenarioId: string) => Promise<SumTotalRead | null>; readonly proposals: ProposalStore },
  ctx: AgentToolContext,
): Promise<ToolResult> {
  const g = await deps.readGraph(ctx.scenario_id);
  if (g === null || g.graph_hash === '') {
    return { ok: false, mutated: false, refusal: 'unreadable_model', detail: 'The model could not be read, so nothing was offered. Nothing was changed.' };
  }
  const r = detectSumTotalRepair(g.raw);
  if (r === null) {
    return { ok: false, mutated: false, refusal: 'no_repair_needed',
      detail: 'Every total in the model that should be the sum of its parts already is. Nothing was offered; say nothing about one.' };
  }
  const proposal = deps.proposals.put(createProposal({
    scenario_id: ctx.scenario_id,
    user_id: ctx.authenticated_user_id,
    base_graph_identity_hash: g.graph_hash,
    operations: [{ op: SUM_TOTAL_REPAIR_OP, path: r.total_id, value: repairValueOf(r) }],
    provenance: { authored_by: 'model_proposed', basis: 'Olumi’s reading: the total is the sum of its parts (the construction rule since #2445)' },
    validation: { admitted: true, loss_count: 0, refusals: [] },
    public_label: sumTotalCardWords(r),
  }));
  return {
    ok: true, mutated: false,
    proposal_id: proposal.proposal_id,
    public_label: proposal.public_label,
    base_revision: g.graph_hash,
    total: r.total_label,
    parts: [...r.part_labels],
    becomes: { value: r.level_after.raw_value, unit: r.unit },
    ...(r.level_before !== null ? { now: { value: r.level_before, unit: r.unit } } : {}),
    note: 'Nothing has changed yet. Show the user `public_label` exactly: Olumi reads this total as the sum of its parts, so it is '
      + 'worked out from them and moves when they do. Its parts keep their own figures. Never show the id. Call authorise_change '
      + 'with this proposal_id only once they agree; if they say no, nothing changes.',
  };
}

/** The stored graph holds this repair: the identity, every part link as approved, the level, and no repair left for it. */
function holdsRepair(raw: unknown, totalId: string, v: SumTotalRepairValue): boolean {
  if (!isRec(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) return false;
  const total = (raw.nodes as unknown[]).filter(isRec).find((n) => n.id === totalId);
  const os = isRec(total?.observed_state) ? total!.observed_state : undefined;
  const identity = isRec(total?.nonlinear_identity) ? total!.nonlinear_identity : undefined;
  const edges = (raw.edges as unknown[]).filter(isRec);
  return identity !== undefined && stable(identity) === stable(v.total.nonlinear_identity)
    && os !== undefined && os.raw_value === v.level_after.raw_value && os.value === v.level_after.value
    // Each part link holds its definition as approved (what a reader computes with; the route may add its own refs).
    && v.part_links.every((want) => {
      const held = edges.find((e) => e.from === want.from && e.to === totalId);
      return held !== undefined && sumPartLinkMeaning(held) === sumPartLinkMeaning(want);
    })
    && detectSumTotalRepair(raw)?.total_id !== totalId;
}

/**
 * Apply an APPROVED sum-total card: re-detected on `approved` (the read the authorisation was decided on) and required to
 * be exactly the stored proposal, then ONE CAS-gated registration. Never a partial write, never a regenerated change.
 */
export async function applySumTotalRepair(
  deps: {
    readonly dispatch: InternalDispatch;
    readonly readGraph: (scenarioId: string) => Promise<SumTotalRead | null>;
    readonly proposals: ProposalStore;
    readonly operationId: (key: string) => string;
  },
  ctx: AgentToolContext,
  proposal: StructuredProposal,
  approved: SumTotalRead,
): Promise<ToolResult> {
  const pid = proposal.proposal_id;
  const op = proposal.operations[0]!;
  const v = op.value as SumTotalRepairValue;
  const superseded = (detail: string): ToolResult => ({ ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'superseded', detail });
  // ⛔ RE-DETECTED AT APPLY TIME, and it must be exactly what the user approved — else nothing is written.
  const now = detectSumTotalRepair(approved.raw);
  if (now === null || now.total_id !== op.path || stable(repairValueOf(now)) !== stable(v)) {
    return superseded('The total or its parts changed after this was offered, so nothing was written. Read the model again before offering it afresh.');
  }
  // The STORED change, applied to the graph as it is now: the total node and its part links, every other byte as stored.
  const graph = {
    ...approved.raw,
    nodes: (approved.raw.nodes as unknown[]).map((n) => (isRec(n) && n.id === op.path ? v.total : n)),
    edges: (approved.raw.edges as unknown[]).map((e) => {
      if (!isRec(e) || e.to !== op.path) return e;
      return v.part_links.find((l) => l.from === e.from) ?? e;
    }),
  };
  const operationId = deps.operationId(`${pid}#sum_total_repair`);
  const reg = await deps.dispatch(`/assist/v1/scenarios/${ctx.scenario_id}/graph/register`, {
    graph,
    expected_graph_hash: proposal.base_graph_identity_hash,
    ...(approved.graph_identity_hash !== '' ? { expected_graph_identity_hash: approved.graph_identity_hash } : {}),
    operation_id: operationId,
  });
  if (reg.status !== 200) {
    const code = String((reg.json.details as { code?: unknown } | undefined)?.code ?? reg.json.code ?? '');
    return reg.status === 409 || code === 'GRAPH_STALE'
      ? superseded('The model changed just before this was written, so nothing was written. Read it again before offering it afresh.')
      : { ok: false, mutated: false, applied: false, proposal_id: pid, refusal: 'not_applied', detail: `The total could not be saved (http ${reg.status}). Nothing was written.` };
  }
  const receipts: ReceiptSummary[] = [];
  const mv = reg.json.model_version as { version_number?: unknown; version_id?: unknown; mutation_id?: unknown } | undefined;
  if (mv !== undefined && typeof mv.version_id === 'string') {
    receipts.push({
      version: Number(mv.version_number), version_id: mv.version_id,
      mutation_id: typeof mv.mutation_id === 'string' ? mv.mutation_id : '',
      source_turn_id: registrationTurnId(ctx.scenario_id, operationId),
    });
  }
  // ⛔ CONFIRMED FROM STATE: the stored graph, read back, holds exactly this repair.
  const after = await deps.readGraph(ctx.scenario_id);
  if (after === null || !holdsRepair(after.raw, op.path, v)) {
    return {
      ok: false, mutated: true, applied: false, proposal_id: pid, refusal: 'not_verified', receipts,
      detail: 'The total was saved, but what the model now holds could not be confirmed. Read the model again before saying what it holds.',
    };
  }
  deps.proposals.markApplied(pid, receipts);
  const label = typeof v.total.label === 'string' ? v.total.label : op.path;
  return {
    ok: true, mutated: true, applied: true, proposal_id: pid, operation_id: operationId, receipts,
    total: label,
    recorded: { value: v.level_after.raw_value, unit: v.level_after.unit },
    revision_before: approved.graph_hash,
    revision_after: after.graph_hash,
    follow_up: `"${label}" is now worked out as the sum of its parts: ${say(v.level_after.raw_value, v.level_after.unit)}. `
      + 'Any earlier result was calculated before this change; run the analysis again to see it.',
    note: 'The total is now the sum of its parts and moves when they do. Any analysis on screen predates this change. Offer to run it again; never run it yourself.',
  };
}
