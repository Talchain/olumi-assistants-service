/**
 * PER-ITEM APPROVAL ON THE READING CARD (D4, 26 Oct): the rows the person ticks on "Your situation as I understood it",
 * approved by the host with NO AI call, as ONE checked write:
 *  · only rows on that card, only records still proposed, and only while the model is the one the card was offered on;
 *  · each ticked record is accepted by the approving person (its `approval` and `author_id`, the host's own fields); who
 *    authored it, in whose words, and every other record stay exactly as saved, so an Olumi item is never made theirs;
 *  · saved with a new Run (approval is in the Run's digest) through the program's one save: CAS on the card's base, an
 *    operation id of this card and these rows (a resend is this save, never a second one), then an independent readback;
 *  · the card is then offered again for the rows still open, on the new model; with none open, no card.
 */
import type { ProposalStore, StructuredProposal } from '../agent-lane/proposal.js';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import { findOperationVersion } from '../path-b/tools/core-write.js';
import { isSavedRead, readSaved } from '../path-b/tools/context-tool.js';
import { ok, refused, type ToolOutcome } from '../path-b/tools/outcome.js';
import { readingOf, withApproved } from './postimage.js';
import { holdProgramCard, isProgramProposal, SAVE_REFUSED_AFTER_APPROVAL } from './program-tools.js';
import { programOperationId, savePostimage, withNewRun } from './program-save.js';
import { programReadOf } from './program-store.js';

type Ctx = { readonly scenario_id: string; readonly authenticated_user_id: string | null };

export interface ApprovedRows {
  readonly outcome: ToolOutcome;
  /** The card offered again for the rows still open, held on the saved model. */
  readonly card?: StructuredProposal;
}

export async function approveReadingRows(deps: { readonly dispatch: InternalDispatch; readonly proposals: ProposalStore }, ctx: Ctx,
  args: { readonly proposalId: string; readonly ids: readonly string[] }): Promise<ApprovedRows> {
  const p = deps.proposals.get(args.proposalId);
  if (!isProgramProposal(p) || p.reading !== true) return { outcome: refused('not_a_reading_card') };
  if (p.scenario_id !== ctx.scenario_id || p.user_id !== ctx.authenticated_user_id) return { outcome: refused('not_authorised') };
  const rows = new Set((p.changes ?? []).map((c) => c.id));
  const offCard = args.ids.filter((id) => !rows.has(id));
  if (args.ids.length === 0 || offCard.length > 0) return { outcome: refused('not_on_the_card', undefined, { ids: offCard }) };
  const operationId = programOperationId(ctx.scenario_id, `rows:${p.proposal_id}:${[...args.ids].sort().join(',')}`);
  const ownVersion = () => findOperationVersion(deps.dispatch, ctx.scenario_id, operationId);
  // These rows on this card already saved (a resend after a lost reply): that save, never a second one.
  const prior = await ownVersion().catch(() => null);
  if (prior !== null) return { outcome: ok({ already_saved: true, receipt: prior }, { mutated: false }) };
  const before = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(before)) return { outcome: before };
  const read = programReadOf(before.graph);
  if (read.kind !== 'program') return { outcome: refused('not_a_program_scenario') };
  if (p.base_model_identity !== before.identity) return { outcome: refused('superseded') };
  const program = read.program;
  const proposed = new Set(Object.values(program.canonical).flatMap((f): unknown[] => (Array.isArray(f) ? f : []))
    .flatMap((r) => { const x = r as { id?: unknown; approval?: unknown }; return typeof x.id === 'string' && x.approval === 'proposed' ? [x.id] : []; }));
  const settled = args.ids.filter((id) => !proposed.has(id));
  if (settled.length > 0) return { outcome: refused('not_proposed', undefined, { ids: settled }) };
  const approver = ctx.authenticated_user_id;
  const next = withNewRun({ ...program, canonical: withApproved(program.canonical, new Set(args.ids), approver) });
  const { write } = await savePostimage(deps.dispatch, { scenarioId: ctx.scenario_id, operationId, expectedIdentity: before.identity, ownVersion }, next.graph);
  if (write.status === 'unknown') return { outcome: write.outcome };
  if (write.status === 'stale') return { outcome: refused('superseded') };
  if (write.status === 'refused') return { outcome: refused('registration_refused', SAVE_REFUSED_AFTER_APPROVAL, { code: write.code, written: false }) };
  if (write.status === 'already_saved') return { outcome: ok({ already_saved: true, receipt: write.receipt }, { mutated: false }) };
  deps.proposals.markApplied(p.proposal_id, [write.receipt as never]);
  // What is still open: the card's rows not approved now, in its order, read again from the saved model; its approve
  // accepts exactly those, every record approved before keeping who approved it.
  const open = new Set([...rows].filter((id) => !args.ids.includes(id)));
  const reread = open.size === 0 || write.after.identity === null ? undefined : readingOf(next.program.canonical, { words: next.program.person_words, approver });
  const card = reread === undefined || !reread.ok ? undefined : holdProgramCard(deps.proposals,
    { scenarioId: ctx.scenario_id, userId: p.user_id ?? null, graphHash: write.after.graphHash, identity: write.after.identity! },
    { label: p.public_label, basis: p.provenance.basis ?? '', reading: true, changes: reread.changes.filter((c) => open.has(c.id)),
      program: withNewRun({ ...next.program, canonical: withApproved(next.program.canonical, open, approver) }).program });
  return { outcome: ok({ saved: true, receipt: write.receipt, approved: args.ids.length, still_open: open.size,
    revision: { graph_hash: write.after.graphHash, graph_identity_hash: write.after.identity } }, { mutated: true, ran: true }), ...(card !== undefined ? { card } : {}) };
}
