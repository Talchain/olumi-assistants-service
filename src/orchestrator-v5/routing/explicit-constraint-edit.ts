import { extractCompoundGoals } from '../../cee/compound-goal/index.js';
import { soleStatedQuantityInSpan } from '../../cee/factor-extraction/goal-label-target.js';
import { subjectBindsToLabel } from '../../cee/factor-extraction/stated-level.js';
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { sameUnit } from '../../utils/currency-alphabet.js';
import { valuesMatch } from '../../utils/reduction-framing.js';
import { buildWarrantDemotion } from '../compose/warrant-demotion.js';
import { ALLOWED_TARGET_KINDS } from '../tools/handlers/add-constraint.js';
import { buildMutationWarrantDemotionText, detectMutationWarrant } from './mutation-warrant.js';
import { buildTypedChipMutationProposal, type TypedChipGraphView } from './typed-chip-mutation-proposal.js';
import type { ProposalAction } from './types.js';

interface ConstraintEditNode {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly data?: { readonly unit?: unknown } | null;
  readonly observed_state?: { readonly unit?: unknown; readonly metadata?: { readonly unit?: unknown } | null } | null;
}

export type ExplicitConstraintEdit =
  | { readonly status: 'unmatched' }
  | { readonly status: 'clarify' }
  | { readonly status: 'ready'; readonly proposal: ProposalAction };

const completeText = (text: string): string => text.trim().replace(/[.!]\s*$/, '').trim();

const explicitConstraintCandidates = (message: string) =>
  extractCompoundGoals(message, { includeProxies: false }).constraints.filter((candidate) =>
    candidate.provenance === 'explicit' && !candidate.deadlineMetadata && candidate.valueFrame === 'level');

/** Decides only whether canonical binding needs a read; it grants no write authority. */
export function mayContainExplicitConstraintEdit(message: string): boolean {
  return explicitConstraintCandidates(message).length > 0;
}

/** A complete named requirement owns a constraint write, never a current-value edit. */
export function resolveExplicitConstraintEdit(
  message: string,
  graph: { readonly nodes: readonly ConstraintEditNode[]; readonly edges: TypedChipGraphView['edges'] } | null,
): ExplicitConstraintEdit {
  if (!graph) return { status: 'unmatched' };
  const candidates = explicitConstraintCandidates(message);
  const ready: ProposalAction[] = [];
  let claimed = false;
  for (const candidate of candidates) {
    const direct = completeText(candidate.sourceQuote) === completeText(message);
    const matches = graph.nodes.filter((node) => node.label &&
      subjectBindsToLabel(candidate.targetName.split(/\s+/), node.label));
    const target = matches.length === 1 ? matches[0] : undefined;
    const unit = candidate.unit;
    const value = classifyUnitScaleClass(unit) === 'percent' ? candidate.value * 100 : candidate.value;
    const built = target ? buildTypedChipMutationProposal('add_constraint', {
      target_id: target.id, constraint_type: candidate.operator === '>=' ? 'at_least' : 'at_most', value, unit,
    }, graph) : null;
    let adopted = false;
    let copiedOffer = false;
    {
      // Rendering can identify an unresolved offer, but can never bind its target.
      const renderingAction: ProposalAction = {
        handler_id: 'add_constraint',
        entity: { id: target?.id ?? 'unresolved', label: target?.label ?? candidate.targetName,
          kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
        parameters: [
          { name: 'constraint_type', value: candidate.operator === '>=' ? 'at_least' : 'at_most', source: 'user_explicit' },
          { name: 'value', value, source: 'user_explicit' },
          { name: 'unit', value: unit, source: 'user_explicit' },
        ], cited_context_fields: ['graph.nodes'],
      };
      const offer = buildWarrantDemotion(renderingAction, []);
      if (offer.ok) {
        const rendered = buildMutationWarrantDemotionText(offer.changeDescription, null);
        if (message.startsWith(rendered)) {
          copiedOffer = true;
          const remainder = message.slice(rendered.length).trim().replace(/^[-:]\s*/, '');
          // Local to a fully restated offer; this grants no bare-confirm authority.
          adopted = /^(?:make|apply)\s+(?:this|that)\s+(?:update|change|limit)[.!]?$/i.test(remainder);
        }
      }
    }
    if (!direct && !copiedOffer) continue;
    const warrant = detectMutationWarrant({ message, turnSource: 'message', chipActionType: undefined, isConfirmResume: false,
      modelNodeLabels: graph.nodes.flatMap((node) => node.label ? [node.label] : []) }, new Set());
    if (direct && !copiedOffer && !warrant.granted) continue;
    claimed = true;
    const quantity = soleStatedQuantityInSpan(message);
    const targetUnits = [target?.data?.unit, target?.observed_state?.unit, target?.observed_state?.metadata?.unit]
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if ((!direct && !adopted) || !warrant.granted || !target || !ALLOWED_TARGET_KINDS.includes(target.kind) || !built?.matched ||
        !quantity || !unit || !sameUnit(quantity.unit, unit) || !valuesMatch(quantity.value, value) ||
        targetUnits.some((existing) => !sameUnit(existing, unit))) continue;
    ready.push(built.proposal);
  }
  if (ready.length > 0 && new Set(ready.map((proposal) => JSON.stringify(proposal))).size === 1) {
    return { status: 'ready', proposal: ready[0]! };
  }
  return { status: claimed ? 'clarify' : 'unmatched' };
}
