/** Existing pending adoption records can prove a narrow unpressed offer. Origin alone proves no adoption history. */
import { isDeepStrictEqual } from 'node:util';
import { nodeIntroductionOf } from '../../../cee/provenance/provenance-of.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { isPendingActionExpired, parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { computeProposalId, type StructuredProposal } from '../proposal.js';
import { offeredApproveChipOnRow } from '../durable-proposal.js';
import { userStatementsOn } from '../../statement-door/statements.js';
import { STATEMENT_FIELDS, SUBJECT_KINDS, subjectKey } from '../../statement-door/subject.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** No new read/store: consume the same scenario's durable pending carrier and its existing proposal-integrity rule. */
export function unpressedRebuildOptions(raw: readonly unknown[], input: {
  scenario_id: string; user_id: string | null; graph_hash: string; graph: unknown;
}, now = Date.now()): { ids: string[]; records: PendingAction[] } {
  const nodes = rec(input.graph) && Array.isArray(input.graph.nodes) ? input.graph.nodes.filter(rec) : [];
  const ids: string[] = [], records: PendingAction[] = [];
  for (const value of raw) {
    const hold = parsePendingAction(value);
    if (!hold || hold.scenario_id !== input.scenario_id || isPendingActionExpired(hold, now)
      || hold.preconditions?.graph_hash !== input.graph_hash || hold.action.kind !== 'apply_proposed_change') continue;
    if (!offeredApproveChipOnRow([hold], input)) continue;
    const p = hold.action.inline_patch.agent_proposal;
    if (!rec(p) || p.scenario_id !== input.scenario_id || p.user_id !== input.user_id
      || p.base_graph_identity_hash !== input.graph_hash || typeof p.proposal_id !== 'string'
      || !Array.isArray(p.operations) || p.operations.length !== 1) continue;
    // This is the proposal store's own content hash, not a second signature or a semantic interpretation.
    try { if (computeProposalId(hold.action.inline_patch.agent_proposal as StructuredProposal) !== p.proposal_id) continue; } catch { continue; }
    const op = p.operations[0];
    if (!rec(op) || op.op !== 'adopt_olumi_option' || typeof op.path !== 'string' || !rec(op.value)) continue;
    const node = nodes.find(n => n.id === op.path);
    if (!node || node.kind !== 'option' || node.analysis_participation !== 'retained_excluded'
      || nodeIntroductionOf(node).origin !== 'olumi_added' || nodeIntroductionOf(node).adopted
      || op.value.label !== node.label) continue;
    // This receipt binds participation, label and levels. It cannot erase descriptions or other reasoning it never bound.
    const structural = new Set(['id', 'kind', 'label', 'ref', 'provenance', 'proposed_by', 'analysis_participation', 'interventions']);
    if (Object.keys(node).some(key => !structural.has(key))
      || (node.provenance !== undefined && node.provenance !== 'ai_inferred')) continue;
    // Preserve all existing human reasoning bound to this option, even when its record lives on another node.
    const referenced = nodes.some(holder => {
      const keys = new Set(SUBJECT_KINDS.flatMap(kind => STATEMENT_FIELDS.flatMap(field => [
        subjectKey({ kind, id: String(holder.id), option_id: String(node.id), field }),
        subjectKey({ kind, id: String(holder.id), to_id: String(node.id), field }),
        subjectKey({ kind, id: String(node.id), field }),
      ])));
      return userStatementsOn(holder).some(record => keys.has(record.subject_key));
    });
    const legacy = rec(input.graph) && Array.isArray(input.graph.options) && input.graph.options.some(n => rec(n) && n.id === node.id);
    if (referenced || legacy) continue;
    const levels = mergeInterventionSourceObjects(node as never);
    // An option's participation offer cannot prove that any of its existing values was never separately approved.
    if (Object.keys(levels).length !== 0 || !isDeepStrictEqual(op.value.expected_interventions, levels)) continue;
    ids.push(op.path); records.push(hold);
  }
  return { ids: [...new Set(ids)], records };
}
