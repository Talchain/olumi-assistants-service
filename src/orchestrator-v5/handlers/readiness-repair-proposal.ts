/**
 * Multi-blocker readiness repair: one reviewed proposal, one canonical
 * candidate, one commit. This module is pure with respect to storage; the
 * TurnExecutor owns the existing hash/CAS-backed durable writer.
 *
 * Only value-preserving intervention-carrier canonicalisations can appear in
 * `changes`. Missing relationships, units, bounds, and scalar values remain
 * typed `unresolved_inputs`; this path never guesses them.
 */
import { createHash, randomUUID } from 'node:crypto';

import { GraphV3 } from '../../schemas/cee-v3.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import {
  assessCanonicalAnalysisReadiness,
  type CanonicalReadinessAssessment,
  type CanonicalReadinessRepairProposal,
} from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  isObligationClass,
  isStructureProvenance,
} from '../../cee/graph-readiness/obligation-provenance.js';
import {
  buildGenericEditGraphHandlerFact,
} from './edit-graph-fact-builder.js';
import type { PendingAction } from '../session/pending-action.js';
import { PENDING_ACTION_DEFAULT_WALL_TTL_MS } from '../session/pending-action.js';
import { GM_HELD_PENDING_TURN_TTL } from './edit-graph-referee-gate.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';

export const READINESS_REPAIR_HANDLER_ID = 'readiness_multi_repair_v1';

export interface ReadinessRepairChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly detail?: string;
}

export interface ReadinessRepairOffer {
  readonly pending: PendingAction;
  readonly chip: ReadinessRepairChip;
}

function proposalRef(scenarioId: string, graphHash: string): string {
  const digest = createHash('sha256')
    .update(`${scenarioId}:${graphHash}:${READINESS_REPAIR_HANDLER_ID}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return `rrp_${digest}`;
}

export function buildReadinessRepairOffer(input: {
  readonly assessment: CanonicalReadinessAssessment;
  readonly currentGraphHash: string;
  readonly scenarioId: string;
}): ReadinessRepairOffer | null {
  const proposal = input.assessment.repairProposal;
  if (!proposal || proposal.changes.length === 0 || input.assessment.proposedGraph === null) {
    return null;
  }
  const ref = proposalRef(input.scenarioId, input.currentGraphHash);
  const count = proposal.changes.length;
  const label = count === 1 ? 'Apply the safe model fix' : `Apply ${count} safe model fixes`;
  const detail = proposal.changes.map((change) => change.description).join(' ');
  const message = count === 1
    ? 'Yes, apply the safe model fix.'
    : `Yes, apply all ${count} safe model fixes.`;
  const now = Date.now();
  const pending: PendingAction = {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: ref,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: ref,
      inline_patch: {
        handler_id: READINESS_REPAIR_HANDLER_ID,
        proposal,
        params: {},
        target_entity_ids: proposal.changes.map((change) => change.option_id),
      },
      public_label: label,
      public_message: message,
    },
    preconditions: { graph_hash: input.currentGraphHash },
    expires_at_turn_count: GM_HELD_PENDING_TURN_TTL,
    expires_at_iso: new Date(now + PENDING_ACTION_DEFAULT_WALL_TTL_MS).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
  };
  return {
    pending,
    chip: {
      id: ref,
      label,
      message,
      ...(detail.length > label.length ? { detail } : {}),
    },
  };
}

type Dict = Record<string, unknown>;
function isRecord(value: unknown): value is Dict {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

type ReadinessRequiredInputKind =
  CanonicalReadinessRepairProposal['unresolved_inputs'][number]['kind'];
const READINESS_REQUIRED_INPUT_KINDS: ReadonlySet<ReadinessRequiredInputKind> = new Set([
  'model_structure',
  'option_mapping',
  'option_effect_value',
  'value_scale',
  'constraint_review',
]);
const READINESS_REPAIR_PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'proposal_version',
  'complete',
  'issue_ids',
  'changes',
  'unresolved_inputs',
]);
const READINESS_REPAIR_CHANGE_KEYS: ReadonlySet<string> = new Set([
  'change_id',
  'kind',
  'option_id',
  'option_label',
  'description',
]);
const READINESS_REQUIRED_INPUT_KEYS: ReadonlySet<string> = new Set([
  'issue_id',
  'kind',
  'prompt',
  'option_id',
  'factor_id',
  // ⭐ INV-P6 — whose gap it is, and whether it may be demanded. Additive, and it
  // MUST be listed here: this allowlist rejects unrecognised JSON keys by design
  // (see `hasOnlyJsonOwnKeys`), so an additive field that skips it turns a healthy
  // resume into `invalid` and the later exact proposal-equality check can never
  // pass. The guard is one seam past where the field was added, which is exactly
  // where this class of defect lives.
  'obligation',
  'provenance',
]);

function isReadinessRequiredInputKind(value: unknown): value is ReadinessRequiredInputKind {
  return typeof value === 'string'
    && READINESS_REQUIRED_INPUT_KINDS.has(value as ReadinessRequiredInputKind);
}

/**
 * Pending actions cross a JSON/JSONB boundary, whose property surface is own,
 * enumerable string keys. Symbols, non-enumerable properties, and inherited
 * properties cannot survive that boundary and are therefore outside this
 * parser's contract. Reject every unknown JSON key before reconstruction so
 * normalisation cannot weaken the later exact proposal-equality check.
 */
function hasOnlyJsonOwnKeys(value: Dict, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseProposal(value: unknown): CanonicalReadinessRepairProposal | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyJsonOwnKeys(value, READINESS_REPAIR_PROPOSAL_KEYS)) return null;
  if (value.proposal_version !== 'readiness_repair_v1' || value.complete !== true) return null;
  if (!Array.isArray(value.issue_ids) || value.issue_ids.length < 2 || !value.issue_ids.every(nonEmpty)) {
    return null;
  }
  if (!Array.isArray(value.changes) || value.changes.length === 0) return null;
  const changes: CanonicalReadinessRepairProposal['changes'] = [];
  for (const change of value.changes) {
    if (
      !isRecord(change)
      || !hasOnlyJsonOwnKeys(change, READINESS_REPAIR_CHANGE_KEYS)
      || change.kind !== 'canonicalise_option_interventions'
      || !nonEmpty(change.change_id)
      || !nonEmpty(change.option_id)
      || !nonEmpty(change.option_label)
      || !nonEmpty(change.description)
    ) return null;
    changes.push({
      change_id: change.change_id,
      kind: change.kind,
      option_id: change.option_id,
      option_label: change.option_label,
      description: change.description,
    });
  }
  if (!Array.isArray(value.unresolved_inputs)) return null;
  const unresolvedInputs: CanonicalReadinessRepairProposal['unresolved_inputs'] = [];
  for (const unresolved of value.unresolved_inputs) {
    if (
      !isRecord(unresolved)
      || !hasOnlyJsonOwnKeys(unresolved, READINESS_REQUIRED_INPUT_KEYS)
      || !nonEmpty(unresolved.issue_id)
      || !nonEmpty(unresolved.prompt)
    ) {
      return null;
    }
    if (!isReadinessRequiredInputKind(unresolved.kind)) return null;
    if (
      (unresolved.option_id !== undefined && !nonEmpty(unresolved.option_id))
      || (unresolved.factor_id !== undefined && !nonEmpty(unresolved.factor_id))
    ) return null;
    // Validated against the DERIVED vocabularies, so an unknown value is rejected
    // rather than reconstructed — and a new member of either vocabulary breaks the
    // build at its declaration rather than being silently refused here.
    if (unresolved.obligation !== undefined && !isObligationClass(unresolved.obligation)) return null;
    if (unresolved.provenance !== undefined && !isStructureProvenance(unresolved.provenance)) return null;
    unresolvedInputs.push({
      issue_id: unresolved.issue_id,
      kind: unresolved.kind,
      prompt: unresolved.prompt,
      ...(unresolved.option_id ? { option_id: unresolved.option_id } : {}),
      ...(unresolved.factor_id ? { factor_id: unresolved.factor_id } : {}),
      // Reconstructed, not dropped: the later check is EXACT proposal equality
      // against a freshly computed assessment, so a field silently lost here would
      // fail that comparison rather than degrade quietly.
      ...(unresolved.obligation !== undefined ? { obligation: unresolved.obligation } : {}),
      ...(unresolved.provenance !== undefined ? { provenance: unresolved.provenance } : {}),
    });
  }
  return {
    proposal_version: 'readiness_repair_v1',
    complete: true,
    issue_ids: [...value.issue_ids],
    changes,
    unresolved_inputs: unresolvedInputs,
  };
}

export type ReadinessRepairResumeRead =
  | { readonly kind: 'not_readiness_repair' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly proposal: CanonicalReadinessRepairProposal };

export function readReadinessRepairResume(
  pending: PendingAction,
): ReadinessRepairResumeRead {
  if (pending.action.kind !== 'apply_proposed_change') {
    return { kind: 'not_readiness_repair' };
  }
  const patch = pending.action.inline_patch;
  if (!isRecord(patch) || patch.handler_id !== READINESS_REPAIR_HANDLER_ID) {
    return { kind: 'not_readiness_repair' };
  }
  const proposal = parseProposal(patch.proposal);
  return proposal ? { kind: 'ok', proposal } : { kind: 'invalid' };
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

function issueKey(issue: CanonicalReadinessAssessment['blockingIssues'][number]): string {
  return [issue.code, issue.option_id ?? '', issue.factor_id ?? ''].join(':');
}

export type ReadinessRepairExecuteOutcome =
  | { readonly status: 'invalid'; readonly reason: 'proposal_mismatch' | 'candidate_invalid' | 'no_progress' | 'new_issue' | 'fact_unavailable' }
  | {
      readonly status: 'executed';
      readonly mutatedGraph: unknown;
      readonly appliedGraph: import('../../schemas/cee-v3.js').GraphV3T;
      readonly fact: NonNullable<ReturnType<typeof buildGenericEditGraphHandlerFact>>;
      readonly assessmentAfter: CanonicalReadinessAssessment;
    };

/** Build and reassess exactly one candidate. Never writes, never partially applies. */
export function executeReadinessRepair(input: {
  readonly proposal: CanonicalReadinessRepairProposal;
  readonly currentGraph: unknown;
  readonly hasExistingAnalysis: boolean;
}): ReadinessRepairExecuteOutcome {
  const before = assessCanonicalAnalysisReadiness(input.currentGraph);
  if (!before.repairProposal || !sameJson(before.repairProposal, input.proposal)) {
    return { status: 'invalid', reason: 'proposal_mismatch' };
  }
  const candidate = before.proposedGraph;
  if (candidate === null || sameJson(candidate, input.currentGraph)) {
    return { status: 'invalid', reason: 'no_progress' };
  }
  const preParsed = GraphV3.safeParse(input.currentGraph);
  const candidateParsed = GraphV3.safeParse(candidate);
  if (!preParsed.success || !candidateParsed.success) {
    return { status: 'invalid', reason: 'candidate_invalid' };
  }
  const after = assessCanonicalAnalysisReadiness(candidate);
  const remainingChanges = new Set(
    after.repairProposal?.changes.map((change) => change.option_id) ?? [],
  );
  if (input.proposal.changes.some((change) => remainingChanges.has(change.option_id))) {
    return { status: 'invalid', reason: 'no_progress' };
  }
  const beforeIssueKeys = new Set(before.blockingIssues.map(issueKey));
  if (after.blockingIssues.some((issue) => !beforeIssueKeys.has(issueKey(issue)))) {
    return { status: 'invalid', reason: 'new_issue' };
  }

  // Fact-only operation projection: the candidate itself comes from the
  // canonical encoder above. These operations document which option carriers
  // moved; they are not a second applier.
  const operations: PatchOperation[] = input.proposal.changes.map((change) => ({
    op: 'update_node',
    path: change.option_id,
    value: { interventions: {} },
  }));
  const fact = buildGenericEditGraphHandlerFact({
    editResult: {
      blocks: [],
      assistantText: null,
      latencyMs: 0,
      appliedGraph: candidateParsed.data,
      wasRejected: false,
      operations,
    },
    preEditGraph: preParsed.data,
    hasExistingAnalysis: input.hasExistingAnalysis,
  });
  if (!fact) return { status: 'invalid', reason: 'fact_unavailable' };
  return {
    status: 'executed',
    mutatedGraph: candidate,
    appliedGraph: candidateParsed.data,
    fact,
    assessmentAfter: after,
  };
}
