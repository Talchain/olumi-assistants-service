/**
 * Reconstruct a `ValueBatchProposal` from a persisted `PendingAction`.
 *
 * The sibling `readiness_multi_repair_v1` has `readReadinessRepairResume`; this
 * batch had no equivalent, so its `executeValueBatch` could never be reached
 * from a chip click — the proposal crosses a JSON/JSONB boundary on the way to
 * the user and nothing brought it back.
 *
 * ⚠ REJECT UNKNOWN KEYS BEFORE RECONSTRUCTING, exactly as the sibling does. A
 * pending action's property surface after a round trip is own, enumerable
 * string keys; anything else never survived. Accepting an unrecognised key here
 * would let a normalisation weaken the membership comparison that
 * `executeValueBatch` performs at apply time, which is the check standing
 * between a reviewed batch and a graph the user did not review.
 *
 * ⛔ IT VALIDATES, IT DOES NOT REPAIR. Every failure returns `invalid` rather
 * than a partially reconstructed proposal. A batch is an ALL-OR-NOTHING apply,
 * so a proposal that is 90% recoverable is not 90% applicable — it is a
 * different proposal, and applying it would write cells the user never saw.
 */

import {
  READINESS_VALUE_BATCH_HANDLER_ID,
  READINESS_VALUE_BATCH_PROPOSAL_VERSION,
  type ValueBatchProposal,
  type ValueBatchProposedCell,
  type ValueBatchUnsettable,
} from './readiness-value-batch.js';
import type { PendingAction } from '../session/pending-action.js';

type Dict = Record<string, unknown>;

const isRecord = (v: unknown): v is Dict =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Optional string: absent is fine, present-but-empty is not. */
const optionalString = (v: unknown): boolean => v === undefined || nonEmpty(v);

const PROPOSAL_KEYS: ReadonlySet<string> = new Set([
  'proposal_version',
  'complete',
  'cells',
  'unsettable',
]);

const CELL_KEYS: ReadonlySet<string> = new Set([
  'issue_id',
  'option_id',
  'factor_id',
  'option_label',
  'factor_label',
  'prompt',
  'obligation',
  'provenance',
  'value',
  'reasoning',
  'confidence',
  'declined_reason',
]);

const UNSETTABLE_KEYS: ReadonlySet<string> = new Set([
  'issue_id',
  'reason',
  'option_id',
  'option_label',
  'prompt',
]);

const CONFIDENCES: ReadonlySet<string> = new Set(['high', 'medium', 'low']);

const hasOnlyJsonOwnKeys = (value: Dict, allowed: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => allowed.has(key));

function parseCell(raw: unknown): ValueBatchProposedCell | null {
  if (!isRecord(raw) || !hasOnlyJsonOwnKeys(raw, CELL_KEYS)) return null;
  if (!nonEmpty(raw.issue_id) || !nonEmpty(raw.option_id) || !nonEmpty(raw.factor_id)) return null;
  if (!nonEmpty(raw.prompt)) return null;
  if (!optionalString(raw.option_label) || !optionalString(raw.factor_label)) return null;

  // ⭐ THE HONESTY INVARIANT, RE-ASSERTED ON THE WAY BACK IN. `value: null`
  // means "could not estimate defensibly" and is only meaningful beside a
  // reason. A round trip that dropped the reason would turn an honest refusal
  // into a silent blank — so a null without one is rejected here, not repaired.
  const value = raw.value;
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return null;
  if (value !== null && (value < 0 || value > 1)) return null;
  if (value === null && !nonEmpty(raw.declined_reason)) return null;

  if (!optionalString(raw.reasoning) || !optionalString(raw.declined_reason)) return null;
  if (raw.confidence !== undefined && !(typeof raw.confidence === 'string' && CONFIDENCES.has(raw.confidence))) {
    return null;
  }

  return {
    issue_id: raw.issue_id,
    option_id: raw.option_id,
    factor_id: raw.factor_id,
    option_label: nonEmpty(raw.option_label) ? raw.option_label : undefined,
    factor_label: nonEmpty(raw.factor_label) ? raw.factor_label : undefined,
    prompt: raw.prompt,
    obligation: raw.obligation as ValueBatchProposedCell['obligation'],
    provenance: raw.provenance as ValueBatchProposedCell['provenance'],
    value,
    reasoning: nonEmpty(raw.reasoning) ? raw.reasoning : undefined,
    confidence: raw.confidence as ValueBatchProposedCell['confidence'],
    declined_reason: nonEmpty(raw.declined_reason) ? raw.declined_reason : undefined,
  };
}

function parseUnsettable(raw: unknown): ValueBatchUnsettable | null {
  if (!isRecord(raw) || !hasOnlyJsonOwnKeys(raw, UNSETTABLE_KEYS)) return null;
  if (!nonEmpty(raw.issue_id) || !nonEmpty(raw.option_id) || !nonEmpty(raw.prompt)) return null;
  if (raw.reason !== 'factor_unknown') return null;
  if (!optionalString(raw.option_label)) return null;
  return {
    issue_id: raw.issue_id,
    reason: 'factor_unknown',
    option_id: raw.option_id,
    option_label: nonEmpty(raw.option_label) ? raw.option_label : undefined,
    prompt: raw.prompt,
  };
}

function parseProposal(value: unknown): ValueBatchProposal | null {
  if (!isRecord(value) || !hasOnlyJsonOwnKeys(value, PROPOSAL_KEYS)) return null;
  if (value.proposal_version !== READINESS_VALUE_BATCH_PROPOSAL_VERSION) return null;
  // `complete` is a claim about MEMBERSHIP. A resumed proposal that does not
  // carry it is not a batch this module ever built.
  if (value.complete !== true) return null;
  if (!Array.isArray(value.cells) || value.cells.length === 0) return null;
  if (!Array.isArray(value.unsettable)) return null;

  const cells: ValueBatchProposedCell[] = [];
  for (const raw of value.cells) {
    const cell = parseCell(raw);
    if (!cell) return null;
    cells.push(cell);
  }
  const unsettable: ValueBatchUnsettable[] = [];
  for (const raw of value.unsettable) {
    const item = parseUnsettable(raw);
    if (!item) return null;
    unsettable.push(item);
  }

  // A duplicate cell would make the membership comparison at apply time
  // ambiguous, and `buildValueBatchProposal` already refuses to mint one — so a
  // resumed proposal carrying one did not come from here.
  const seen = new Set<string>();
  for (const c of cells) {
    const key = `${c.option_id}|${c.factor_id}`;
    if (seen.has(key)) return null;
    seen.add(key);
  }

  return {
    proposal_version: READINESS_VALUE_BATCH_PROPOSAL_VERSION,
    complete: true,
    cells,
    unsettable,
  };
}

export type ValueBatchResumeRead =
  | { readonly kind: 'not_value_batch' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'ok'; readonly proposal: ValueBatchProposal };

export function readValueBatchResume(pending: PendingAction): ValueBatchResumeRead {
  if (pending.action.kind !== 'apply_proposed_change') return { kind: 'not_value_batch' };
  const patch = pending.action.inline_patch;
  if (!isRecord(patch) || patch.handler_id !== READINESS_VALUE_BATCH_HANDLER_ID) {
    return { kind: 'not_value_batch' };
  }
  const proposal = parseProposal(patch.proposal);
  return proposal ? { kind: 'ok', proposal } : { kind: 'invalid' };
}
