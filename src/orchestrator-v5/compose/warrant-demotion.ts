/**
 * ⭐⭐ WARRANT DEMOTION (INV-1, ROADMAP 2.652) — turn a warrantless mutating
 * proposal into an OFFER.
 *
 * When the action layer finds a graph-mutating proposal on a turn the user
 * never asked to change anything (see `routing/mutation-warrant.ts`), the
 * proposal is neither executed nor dropped: it is converted into the
 * `ProposedChange` the existing propose-confirm channel already knows how to
 * emit (`compose/proposed-change.ts::emitProposedChange` → chip + pending),
 * and offered.
 *
 * Factored out of the turn-executor for the same reason `flip-proposal.ts`
 * is: the round-trip below is the part that can silently be WRONG, and it is
 * unit-testable here without the full turn harness.
 *
 * ── THE ROUND-TRIP, AND WHY IT IS THE RISK ────────────────────────────────
 * `ProposalAction.parameters` is an ARRAY of `{name, value, operator?, unit?}`.
 * `PendingAction.action.inline_patch.params` is a RECORD. On resume,
 * `routing/proposed-change-synthesis.ts::buildHandlerParameters` converts the
 * record BACK into an array — and it is NOT a naive per-key map: for
 * `set_factor_value` it builds at most ONE `value` parameter and folds
 * `unit`/`cap`/`operator` into it as siblings, precisely because a naive
 * flatten misshapes that handler.
 *
 * So this module's job is to be `buildHandlerParameters`'s exact INVERSE for
 * the three mutating handlers. A wrong inverse would not fail loudly — it
 * would emit a chip that, when clicked, applied a DIFFERENT change from the
 * one described. `__tests__/warrant-demotion.test.ts` pins the round-trip
 * against the real `buildHandlerParameters` rather than against a copy, so
 * the two cannot fork.
 */

import type { ProposalAction } from '../routing/types.js';
import type { ProposedChange, ProposedChangeIntent } from '../types/proposed-change.js';
import { isProposedChangeActionType } from '../types/proposed-change.js';
import { buildResidualConstraintDisclosure } from '../routing/mutation-warrant.js';

/**
 * Chip copy per intent.
 *
 * Deliberately GENERIC and digit-free. `emitProposedChange` refuses copy that
 * carries a `SAFETY_FORBIDDEN_TOKENS` match (which includes every handler id)
 * or a raw decimal, and a refusal here would DROP the change rather than
 * offer it — the one outcome INV-1 forbids. The specifics (which factor,
 * which bound, which value) live in the assistant text, which is not subject
 * to the chip filter and can therefore be honest about numbers.
 */
const CHIP_COPY: Readonly<Record<ProposedChangeIntent, { label: string; message: string }>> = {
  add_constraint: { label: 'Add this limit', message: 'Add that limit to my model.' },
  set_factor_value: { label: 'Set this value', message: 'Set that value in my model.' },
  adjust_edge_strength: { label: 'Adjust this link', message: 'Adjust that link in my model.' },
};

/** Read a named parameter off a proposal action. */
function param(action: ProposalAction, name: string): ProposalAction['parameters'][number] | undefined {
  return action.parameters.find((p) => p.name === name);
}

/**
 * INVERSE of `buildHandlerParameters`. See the header for why this is the
 * load-bearing part.
 */
export function proposalParamsToRecord(
  intent: ProposedChangeIntent,
  action: ProposalAction,
): Readonly<Record<string, unknown>> {
  if (intent === 'set_factor_value') {
    const valueParam = param(action, 'value');
    if (valueParam === undefined) return {};
    // `buildHandlerParameters` passes a structured `{value, unit?, cap?}`
    // through VERBATIM, so storing the parameter's value field verbatim
    // round-trips for both the structured and the bare-numeric shape.
    return {
      value: valueParam.value,
      ...(valueParam.operator !== undefined ? { operator: valueParam.operator } : {}),
      ...(valueParam.unit !== undefined ? { unit: valueParam.unit } : {}),
    };
  }
  // add_constraint / adjust_edge_strength: one record key per parameter,
  // matching the per-key map on the rebuild side.
  const record: Record<string, unknown> = {};
  for (const p of action.parameters) {
    record[p.name] = p.value;
  }
  return record;
}

/** A constraint row as persisted by the `add_constraint` handler. */
export interface PersistedConstraintRow {
  readonly node_id?: unknown;
  readonly operator?: unknown;
  readonly label?: unknown;
}

export type WarrantDemotionBuild =
  | {
      readonly ok: true;
      readonly intent: ProposedChangeIntent;
      readonly proposal: ProposedChange;
      /** Human phrase for the assistant text, e.g. `a limit keeping "Churn" at or below 3%`. */
      readonly changeDescription: string;
      /** INV-2 sentence, or null when no defective row would survive. */
      readonly residualDisclosure: string | null;
    }
  | { readonly ok: false; readonly reason: 'not_a_proposable_mutation' };

/**
 * Currency units → their display symbol.
 *
 * ⚠ HAND-WRITTEN, AND SAID PLAINLY (CLAUDE.md trap 12d). The repo has two
 * other copies of this knowledge — `CURRENCY_MAP` in `cee/signals/
 * currency-signal.ts` and `currencyPrefix` in `cee/factor-extraction/
 * display-value.ts` — and BOTH ARE MODULE-PRIVATE, so there is nothing to
 * derive from without exporting across the `cee/` ↔ `orchestrator-v5/`
 * boundary, which is a wider change than this copy fix earns. The mitigation
 * is the one trap 12d prescribes for a list that cannot be derived: a
 * hand-written corpus test over real unit spellings, not a self-consistency
 * check. ISO currency symbols do not drift; the risk here is a MISSING entry,
 * which degrades to the pre-existing `200000 GBP` rendering rather than to a
 * wrong number.
 */
const CURRENCY_SYMBOL_BY_UNIT: Readonly<Record<string, string>> = Object.freeze({
  '£': '£',
  GBP: '£',
  $: '$',
  USD: '$',
  '€': '€',
  EUR: '€',
});

/**
 * Thousands separators, computed rather than delegated to `toLocaleString`,
 * so the output cannot vary with the host's ICU build or default locale — a
 * confirmation sentence must render identically everywhere.
 *
 * Falls back to the plain spelling above 1e21, where `Number.prototype
 * .toString` switches to exponential notation and grouping would be
 * meaningless.
 */
function groupThousands(value: number): string {
  if (Math.abs(value) >= 1e21) return String(value);
  const sign = value < 0 ? '-' : '';
  const [whole, fraction] = Math.abs(value).toString().split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${grouped}${fraction !== undefined ? `.${fraction}` : ''}`;
}

/**
 * Format a bound for the assistant text. Kept out of the chip copy (see
 * `CHIP_COPY`) so the raw-decimal chip filter never sees it.
 *
 * ⚠ 2026-08-16 (P2) — THIS EMITTED RAW MACHINE NUMBERS INTO PROSE. Paul's
 * manual test caught the sentence
 *
 *   "a limit keeping Hiring spend at or below 200000 GBP"
 *
 * Two things are wrong with it and both are this function's: the ISO CODE is
 * printed where the SYMBOL belongs, and a six-figure amount is printed with no
 * thousands separators, so a reader has to count digits to find out what their
 * own limit is. It now renders `£200,000`.
 *
 * Grouping applies to non-currency bounds too — `200000 users` is exactly as
 * unreadable as `200000 GBP`, and grouping is invisible below 1,000, so every
 * percentage and strength value in the suite is untouched.
 */
function formatBound(value: unknown, unit: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'that level';
  const suffix = typeof unit === 'string' && unit.trim().length > 0 ? unit.trim() : '';
  const symbol = CURRENCY_SYMBOL_BY_UNIT[suffix] ?? CURRENCY_SYMBOL_BY_UNIT[suffix.toUpperCase()];
  if (symbol !== undefined) {
    // Sign OUTSIDE the symbol: "-£5,000", never "£-5,000".
    return value < 0 ? `-${symbol}${groupThousands(Math.abs(value))}` : `${symbol}${groupThousands(value)}`;
  }
  const num = groupThousands(value);
  return suffix === '%' ? `${num}%` : suffix.length > 0 ? `${num} ${suffix}` : num;
}

function quoted(label: string | undefined): string {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  return trimmed.length > 0 ? `"${trimmed}"` : 'that part of the model';
}

/**
 * ⚠ INV-2 (ROADMAP 2.659 rider) — WOULD THIS "REPAIR" LEAVE THE BROKEN ROW
 * BEHIND?
 *
 * The `add_constraint` idempotency key is `(node_id, operator)`: a proposal
 * whose operator DIFFERS from a constraint already on the same node cannot
 * update it, only append. The walk witnessed exactly that — an inverted floor
 * (`>=`) was "repaired" by appending a ceiling (`<=`), and the user was left
 * with two unevaluable constraints, both blamed on "conditions you set".
 *
 * Returns the surviving row's label when the proposal would append beside a
 * differently-signed constraint on the same node; null otherwise. Same-operator
 * proposals DO update in place, so they disclose nothing — that would be a
 * false alarm, and a disclosure that fires when nothing survives teaches the
 * user to ignore it.
 */
export function findSurvivingConstraint(
  nodeId: string,
  proposedOperator: '>=' | '<=' | null,
  existingConstraints: readonly PersistedConstraintRow[],
): { readonly label: string | null } | null {
  if (proposedOperator === null) return null;
  for (const row of existingConstraints) {
    if (typeof row.node_id !== 'string' || row.node_id !== nodeId) continue;
    if (row.operator === proposedOperator) continue; // updates in place — nothing survives
    return { label: typeof row.label === 'string' ? row.label : null };
  }
  return null;
}

const CONSTRAINT_TYPE_TO_OPERATOR: Readonly<Record<string, '>=' | '<='>> = {
  at_least: '>=',
  at_most: '<=',
};

/**
 * Build the demotion: the `ProposedChange` to emit, the phrase describing it,
 * and the INV-2 residual disclosure when one is owed.
 */
export function buildWarrantDemotion(
  action: ProposalAction,
  existingConstraints: readonly PersistedConstraintRow[],
): WarrantDemotionBuild {
  if (!isProposedChangeActionType(action.handler_id)) {
    // Not one of the three proposable mutations. The caller must NOT execute
    // it either — it refuses instead, which is the fail-safe direction.
    return { ok: false, reason: 'not_a_proposable_mutation' };
  }
  const intent: ProposedChangeIntent = action.handler_id;
  const copy = CHIP_COPY[intent];
  const entityLabel = quoted(action.entity.label);
  const targetId = action.entity.id;

  let changeDescription: string;
  let residualDisclosure: string | null = null;

  if (intent === 'add_constraint') {
    const constraintType = param(action, 'constraint_type')?.value;
    const operator =
      typeof constraintType === 'string' && constraintType in CONSTRAINT_TYPE_TO_OPERATOR
        ? CONSTRAINT_TYPE_TO_OPERATOR[constraintType]!
        : null;
    const bound = formatBound(param(action, 'value')?.value, param(action, 'unit')?.value);
    const direction = operator === '>=' ? 'at or above' : 'at or below';
    changeDescription = `a limit keeping ${entityLabel} ${direction} ${bound}`;
    const surviving = findSurvivingConstraint(targetId, operator, existingConstraints);
    if (surviving !== null) {
      residualDisclosure = buildResidualConstraintDisclosure(surviving.label);
    }
  } else if (intent === 'set_factor_value') {
    const raw = param(action, 'value')?.value;
    const structured =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as { value?: unknown; unit?: unknown })
        : null;
    const bound =
      structured !== null
        ? formatBound(structured.value, structured.unit)
        : formatBound(raw, param(action, 'value')?.unit);
    changeDescription = `setting ${entityLabel} to ${bound}`;
  } else {
    const bound = formatBound(param(action, 'strength')?.value, undefined);
    changeDescription = `changing the strength of ${entityLabel} to ${bound}`;
  }

  return {
    ok: true,
    intent,
    proposal: {
      intent,
      label: copy.label,
      message: copy.message,
      params: proposalParamsToRecord(intent, action),
      target_entity_ids: [targetId],
    },
    changeDescription,
    residualDisclosure,
  };
}
