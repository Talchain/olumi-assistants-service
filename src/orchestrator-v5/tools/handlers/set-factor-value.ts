/**
 * V5 D1 — `set_factor_value` handler.
 *
 * Mutates a factor node's `observed_state.{value, raw_value}` deterministically
 * from a validated proposal. Sonnet supplies user-unit components via the
 * structured parameter shape `{ value, unit?, cap? }`; the handler
 * applies the operator and normalises model units. (`raw_value` was an
 * optional field on the structured shape pre-A3.1 but was never read by
 * the handler — removed in A3.1 Task 4. Strict Zod rejects it now.)
 *
 * Per F.6: no LLM calls inside the handler. No re-parsing of user text — the
 * proposal parameters are the source of truth (the validator already passed
 * them through the registered Zod schema).
 *
 * Returns:
 *   - `mutated_graph` — post-mutation graph (validated). Carries the
 *     full ingress top-level shape with mutated `nodes`/`edges`/
 *     `goal_constraints` stamped in (A3.1 Task 2). Replaces the
 *     ingress graph at commit time so append_turn_atomic persists
 *     the new state.
 *   - `handler_facts` — single SetFactorValueHandlerFact carrying
 *     {target_id, status, before, after}. Compose maps this to the
 *     boundary `graph_patch` block so the UI sees the change.
 *   - `assistant_text` — decision-language confirmation (no raw decimals,
 *     no spaces before %).
 */

import { z } from 'zod';

import { SetFactorValueHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { SetFactorValueHandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { synthesiseDisplayValue } from '../../../cee/factor-extraction/display-value.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import {
  applyFactorValueOperator,
  canonicaliseUnit,
  evaluateFactorValueProposal,
  resolveExistingRawValue,
} from './d1-shared/evaluate-factor-value-proposal.js';
import {
  formatFactorChange,
  formatFactorValueSet,
  formatFactorValueUnchanged,
  formatValueWithUnit,
} from './d1-shared/format-confirmation.js';
import { normaliseFactorValue } from './d1-shared/normalise-factor-value.js';
import { renormaliseOptionInterventionsForCapChange } from './d1-shared/renormalise-interventions-for-cap-change.js';
import { SET_FACTOR_VALUE_USER_GUIDANCE } from './d1-shared/user-guidance.js';
import { isSuccessfulRunAnalysisFact } from '../../context/freshness.js';
import { log } from '../../../utils/telemetry.js';

/**
 * P0 V5 golden-path repair (Wave 2): staleness narrative appended to a
 * successful set_factor_value receipt when a prior successful
 * run_analysis fact existed. Closes the UX loop required by the brief:
 * (1) what changed, (2) what does it affect, (3) is analysis fresh or
 * stale, (4) what should the user do next. The chip-generator's
 * stale-rerun rule emits the matching "Re-run analysis" chip when the
 * post-dispatch freshness re-derivation flips the verdict.
 *
 * British English, no internal terms (no graph hash, no fact_type, no
 * patch language). Suppressed on noop applies (raw_value unchanged) and
 * when no prior analysis existed (the model is being built; nothing to
 * stale yet).
 *
 * SCOPE — this "suppressed on noop" note governs THIS constant only.
 * It never covered the receipt sentence (`changeText`), which ignored
 * `noop` and narrated "Updated X from 0.8 to 0.8." until the Gate-1 fix
 * below, nor the Step 5 coaching signal, which is a separate channel in
 * `signals/coaching-signals.ts` and emitted its own false staleness
 * claim ("This change affects the model...") on the same no-op turn.
 * Three channels, three independent noop gates — do not read a
 * suppression note on one as covering the others.
 */
// V5 stale-aware explain recovery — the phrase "previous analysis"
// is on the brief's hard-fail list. The narrative uses "last analysis"
// (not on the forbidden list) so the deterministic narrative emits
// brief-aligned copy at source. The finaliser-level egress guard
// would otherwise rewrite this to a neutral fallback and emit a
// telemetry signal — better to use clean wording at source.
//
// "results" is used in place of any prescription-shaped noun (the
// foamy-bee UI handoff brief bans `recommended`, `winner`, `winning`
// from user-facing copy; the noun form `recommendation` is treated
// in scope by the same rule).
export const STALENESS_NARRATIVE =
  ' This makes the last analysis stale. Re-run analysis to see how this affects the results.';

/**
 * Parameter Zod schema registered with the validator. Exported so the
 * validation registry can reference the same schema (single source of
 * truth — the validator and the handler check the same shape).
 *
 * Sonnet's tool schema accepts either a primitive or a structured
 * object `{ value, unit?, cap? }` for `parameters.value`; we accept
 * both here. When the value arrives as a primitive number we treat
 * it as a bare-number proposal (no unit) and the handler defers to
 * the factor's stored unit/cap; when structured, the proposal carries
 * explicit unit/cap. The structured object is `.strict()`, so unknown
 * keys (notably `raw_value`, removed in A3.1 Task 4 because it was
 * dead documentation that risked silent double-normalisation) fail
 * validation loudly.
 */
/**
 * Graph node kinds this handler will set a value on. Exported as the SINGLE
 * source of truth for `set_factor_value`'s target-kind capability: the
 * execute-time gate below reads it, and
 * `routing/__tests__/registry-handler-kind-drift.test.ts` projects it through
 * `toEntityKind` and asserts the routing registry's `accepted_entity_kinds`
 * matches exactly. Without that derivation the registry is a hand-maintained
 * mirror of this list, and a mirror drifts silently in the direction that
 * reads as green — refusing requests this handler would have served.
 */
export const SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS: readonly string[] = ['factor'];
const SET_FACTOR_VALUE_ALLOWED_TARGET_KIND_SET: ReadonlySet<string> = new Set(
  SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS,
);

// W2E-2: `.finite()` on every number — factor values are contract-silent on
// range (no bound invented) but NaN/±Infinity must never enter the graph.
// A failure here rides the existing proposal-validation rejection mechanism.
export const SetFactorValueValueSchema = z.union([
  z.number().finite(),
  z
    .object({
      // V5 D1 golden-path closure (A3.1 Task 4): `raw_value` was
      // previously declared optional but ignored by `parseProposalValue`
      // — it never reached the handler logic. Removing it from the
      // schema closes the silent-strip footgun: a proposal carrying
      // `{ value: 5, raw_value: 0.05 }` now fails Zod validation with
      // "Unrecognized key(s)" rather than silently picking `value`.
      value: z.number().finite(),
      unit: z.string().optional(),
      cap: z.number().finite().optional(),
    })
    .strict(),
]);

interface ParsedValue {
  /** The numeric value the user is supplying (operator's right-hand side). */
  readonly numeric: number;
  /** Explicit unit on the proposal, if any. */
  readonly unit?: string;
  /** Explicit cap on the proposal, if any. */
  readonly cap?: number;
  /** True when the proposal supplied an explicit unit (anywhere). */
  readonly inputHasUnit: boolean;
}

function parseProposalValue(raw: unknown): ParsedValue {
  if (typeof raw === 'number') {
    return { numeric: raw, inputHasUnit: false };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { value: number; unit?: string; cap?: number };
    // An empty / whitespace-only unit is NOT a unit — canonicalise it away here
    // so it can never be PERSISTED by `after.unit = parsed.unit ?? before.unit`.
    // `inputHasUnit` already treated `''` as no-unit; carrying `''` in `unit`
    // while saying "no unit" in `inputHasUnit` is the disagreement that let a
    // `unit: ''` write through. See `canonicaliseUnit`.
    const unit = canonicaliseUnit(obj.unit);
    return {
      numeric: obj.value,
      ...(unit !== undefined ? { unit } : {}),
      ...(obj.cap !== undefined ? { cap: obj.cap } : {}),
      inputHasUnit: unit !== undefined,
    };
  }
  throw new D1HandlerError(
    'PARAMETER_INVALID',
    'set_factor_value: value must be a number or { value, unit?, cap? }.',
    { details: { received: raw }, userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE },
  );
}

// (Local `applyOperator` removed — single source of truth lives in
// `d1-shared/evaluate-factor-value-proposal.ts` as
// `applyFactorValueOperator`, imported above. This handler and the
// shared predicate now compute identical effectiveRaw values by
// construction, closing the review feedback NB #1.)

interface ObservedSnapshot {
  readonly value?: number;
  readonly raw_value?: number;
  readonly unit?: string;
  readonly cap?: number;
  /**
   * 0.40.0 — the provenance stamp, carried on the `after` side ONLY.
   *
   * ⚠ WITHOUT THIS THE ATTRIBUTION IS INVISIBLE UNTIL A RELOAD, which would make
   * "visible consequence" a claim the product could not honour on the turn that
   * produced it. The `graph_patch` block's `after` is what the UI applicator
   * spreads into `node.data.observedState`; a snapshot that stops at
   * value/raw_value/unit/cap leaves the canvas pill reading whatever it read
   * before, so an owner who just applied Grace's number would still see "AI
   * estimate" until they refreshed. Both hops were probed at the 0.40.0 bytes
   * before this was widened: `SetFactorValueHandlerFactSchema` and the boundary
   * `GraphPatchBlockSchema` both accept these keys inside `after` (each with a
   * minimal-`after` control, so the pass is not vacuous).
   *
   * `before` never carries them — it is a snapshot of what was there, and the
   * pre-edit provenance is not what this event is reporting.
   */
  readonly source?: string;
  /**
   * ⚠ 0.41.0 — `evidence_event_id` IS DECLARED HERE DELIBERATELY, EVEN THOUGH
   * NOTHING WOULD HAVE FAILED WITHOUT IT. The stamp sites below SPREAD
   * `appliedProvenance.elicited_from` wholesale, so the member already reaches
   * the wire at runtime whatever this type says; a narrower declaration would
   * simply have been a lie that typechecked, and the next reader would have
   * concluded from it that the citation does not travel on this hop.
   */
  readonly elicited_from?: {
    readonly round_id: string;
    readonly participant_id: string;
    readonly evidence_event_id?: string;
  };
}

function snapshotObservedState(node: GraphV3T['nodes'][number]): ObservedSnapshot {
  const obs = node.observed_state;
  if (!obs) return {};
  return {
    ...(obs.value !== undefined ? { value: obs.value } : {}),
    ...(obs.raw_value !== undefined ? { raw_value: obs.raw_value } : {}),
    ...(obs.unit !== undefined ? { unit: obs.unit } : {}),
    ...(obs.cap !== undefined ? { cap: obs.cap } : {}),
  };
}

export function createSetFactorValueHandler(): HandlerFn {
  return async function setFactorValueHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    return runD1Handler('set_factor_value', async () => {
    const proposal = invocation.proposal;
    if (!proposal) {
      throw new HandlerInvocationFailedError(
        'set_factor_value invoked without a proposal',
        {
          cause_kind: 'parameter_invalid_at_execute',
          retryable: false,
          details: { handler_id: 'set_factor_value' },
        },
      );
    }

    // The verified panel attribution for this write, if any. Read once here so
    // the stamp site below reads as a single expression; `undefined` on every
    // path except a verified panel apply.
    const appliedProvenance = invocation.appliedProvenance;

    const rawGraph = invocation.graphForTurn ?? invocation.context.persistedGraph ?? null;
    if (!rawGraph) {
      throw new D1HandlerError(
        'PRECONDITION_UNMET',
        'set_factor_value requires a graph — none was supplied for this turn.',
        {
          details: { handler_id: 'set_factor_value' },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    const graphParse = GraphV3.safeParse(rawGraph);
    if (!graphParse.success) {
      throw new D1HandlerError(
        'GRAPH_INVARIANT_VIOLATED',
        'set_factor_value: ingress graph failed schema validation.',
        {
          details: {
            handler_id: 'set_factor_value',
            first_issue: graphParse.error.issues[0]?.message,
          },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    const graph = graphParse.data;

    const targetId = proposal.entity.id;
    const targetNode = graph.nodes.find((n) => n.id === targetId);
    if (!targetNode) {
      throw new D1HandlerError(
        'ENTITY_NOT_FOUND',
        `Factor "${targetId}" was not found in the graph.`,
        {
          details: { handler_id: 'set_factor_value', target_id: targetId },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }
    if (!SET_FACTOR_VALUE_ALLOWED_TARGET_KIND_SET.has(targetNode.kind)) {
      throw new D1HandlerError(
        'ENTITY_KIND_MISMATCH',
        `Cannot set value on a ${targetNode.kind} — set_factor_value only accepts factors.`,
        {
          details: {
            handler_id: 'set_factor_value',
            target_id: targetId,
            actual_kind: targetNode.kind,
            accepted_kinds: [...SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS],
          },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }

    const valueParam = proposal.parameters.find((p) => p.name === 'value');
    if (!valueParam) {
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        'set_factor_value requires a "value" parameter.',
        {
          details: { handler_id: 'set_factor_value' },
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        },
      );
    }

    const parsed = parseProposalValue(valueParam.value);
    const operator = valueParam.operator ?? 'set';
    const before = snapshotObservedState(targetNode);

    // The "current value" against which delta operators apply is the
    // USER-UNIT raw value. `resolveExistingRawValue` de-normalises it (the
    // inverse of normaliseFactorValue): `raw_value` when present, else
    // `value * cap` for a capped factor, else `value` for an uncapped factor;
    // it returns `ambiguous`/`missing` when the scale cannot be recovered (a
    // legacy `{ value: 0.4, cap: 100000 }` = £40,000 must apply the operator
    // against 40,000, not 0.4, or "× 0.3" corrupts to £0.12 instead of
    // £12,000). Shared with the validator + executor precheck so all three
    // resolve the LHS identically; only a `resolved` value is a usable LHS.
    const existing = resolveExistingRawValue(before);

    // Defense-in-depth parity (review follow-up). The handler pre-applies
    // the operator below and then calls `normaliseFactorValue` with the
    // POST-operator value — so guards that read the user's STATED right-hand
    // side (notably `bare_ratio_on_unit_factor`, which gates on `rawInput`,
    // and the delta guards) never see the original operator/RHS at the
    // handler. A direct handler call to "increase £40,000 by 0.3" would
    // otherwise evaluate 40,000.3 and slip past the guard, mutating despite
    // the validator/precheck rejecting the same proposal. Run the shared
    // predicate here against the ORIGINAL operator + RHS so the handler
    // enforces exactly what the validator and executor precheck do (AC.1).
    // A non-`resolved` existing value omits `factorExistingRaw`, so any delta
    // fails closed via `delta_no_existing_value`.
    const preEvaluation = evaluateFactorValueProposal({
      rawInput: parsed.numeric,
      operator,
      ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
      ...(parsed.cap !== undefined ? { proposalCap: parsed.cap } : {}),
      ...(before.cap !== undefined ? { factorCap: before.cap } : {}),
      ...(before.unit !== undefined ? { factorUnit: before.unit } : {}),
      ...(existing.kind === 'resolved' ? { factorExistingRaw: existing.raw } : {}),
      // ROADMAP 2.159 — the STORED model value / raw_value, un-inverted, so the
      // predicate can tell a scale REDECLARATION from a first-time declaration.
      // Distinct from `factorExistingRaw` (the de-normalised delta LHS).
      ...(before.value !== undefined ? { factorObservedValue: before.value } : {}),
      ...(before.raw_value !== undefined
        ? { factorObservedRawValue: before.raw_value }
        : {}),
      inputHasUnit: parsed.inputHasUnit,
    });
    if (!preEvaluation.ok) {
      throw new D1HandlerError('PARAMETER_INVALID', preEvaluation.specific_issue, {
        details: {
          handler_id: 'set_factor_value',
          target_id: targetId,
          rejection_reason: preEvaluation.reason,
        },
        userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
      });
    }

    // Only reached for `set` when `existing` is non-resolved (deltas already
    // rejected above); `set` ignores the LHS, so 0 is a safe unused default.
    const currentRaw = existing.kind === 'resolved' ? existing.raw : 0;

    const newRaw = applyFactorValueOperator(currentRaw, operator, parsed.numeric);

    const normalised = normaliseFactorValue({
      rawInput: newRaw,
      ...(parsed.unit !== undefined ? { unit: parsed.unit } : {}),
      ...(parsed.cap !== undefined ? { proposalCap: parsed.cap } : {}),
      ...(before.cap !== undefined ? { factorCap: before.cap } : {}),
      ...(before.unit !== undefined ? { factorUnit: before.unit } : {}),
      // ROADMAP 2.159 — same two fields as `preEvaluation` above, so the
      // execute-time re-check enforces the same redeclaration gates rather
      // than a weaker rule set (the AC.1 parity invariant).
      ...(before.value !== undefined ? { factorObservedValue: before.value } : {}),
      ...(before.raw_value !== undefined
        ? { factorObservedRawValue: before.raw_value }
        : {}),
      // The ambiguity guard only fires when the PROPOSAL itself omits the
      // unit. The factor's stored unit is irrelevant to the user's intent —
      // a bare-number proposal "200" against a cap=100 factor is ambiguous
      // regardless of whether the factor's existing observed_state.unit is
      // "%". Refuse rather than guess; the user must clarify.
      inputHasUnit: parsed.inputHasUnit,
    });

    const after: ObservedSnapshot = {
      value: normalised.value,
      raw_value: normalised.raw_value,
      // The SAME provenance the merged node is stamped with below, so the wire
      // patch and the persisted graph cannot disagree about who owns the number.
      //
      // CONDITIONAL, so the ORDINARY edit path's `after` stays byte-identical:
      // the UI already stamps `user_override` locally for its own edits, so
      // adding it here would change an existing payload for no gain. Only a
      // verified panel apply — which the UI CANNOT stamp for itself, because it
      // is a server fact — widens the snapshot.
      ...(appliedProvenance !== undefined
        ? {
            source: appliedProvenance.source,
            elicited_from: appliedProvenance.elicited_from,
          }
        : {}),
      ...(parsed.unit !== undefined
        ? { unit: parsed.unit }
        : before.unit !== undefined
          ? { unit: before.unit }
          : {}),
      ...(parsed.cap !== undefined
        ? { cap: parsed.cap }
        : before.cap !== undefined
          ? { cap: before.cap }
          : {}),
    };

    // 1.16 item A2 — consented cap change detection. An explicit proposal
    // cap that differs from the stored cap rescales the factor's SCALE:
    // option interventions on this factor are stored as normalised
    // multiples of the cap (value = raw / cap — see
    // d1-shared/renormalise-interventions-for-cap-change.ts for the
    // verified convention), so leaving them untouched would silently
    // change every option's ABSOLUTE configuration. Renormalise them by
    // old_cap/new_cap inside the same mutation.
    const capChanged =
      before.cap !== undefined && after.cap !== undefined && after.cap !== before.cap;
    let rescaledInterventionCount = 0;

    // Apply the mutation to a clone and Zod-parse the result.
    const result = applyAndValidateMutation(rawGraph, (clone) => {
      const node = clone.nodes.find((n) => n.id === targetId);
      if (!node) {
        // Should be impossible — we found it on `graph` and clone is a deep
        // copy. Defensive throw for completeness.
        throw new D1HandlerError('ENTITY_NOT_FOUND', `Node ${targetId} disappeared during clone.`, {
          userGuidance: SET_FACTOR_VALUE_USER_GUIDANCE,
        });
      }
      const merged = {
        ...(node.observed_state ?? {}),
        value: normalised.value,
        raw_value: normalised.raw_value,
        ...(after.unit !== undefined ? { unit: after.unit } : {}),
        ...(after.cap !== undefined ? { cap: after.cap } : {}),
        // 2.396(b) — the pill-earning stamp. The provenance stamp below is
        // CLOBBERED by the V3 response transform (schema-v3.ts recomputes
        // node.provenance from extractionType), so `observed_state.source` is
        // the carrier that actually reaches the UI's isReviewedByUser rungs.
        // Overrides any producer stamp deliberately: this write IS the user's.
        //
        // ⭐ 0.40.0 — UNLESS THE SERVER HAS VERIFIED THAT IT IS SOMEBODY ELSE'S.
        // `appliedProvenance` is present only after `verifyAppliedFrom` has
        // checked an `applied_from` claim against CEE's own collab store, so
        // this branch stamps a fact the server established, never one the
        // client asserted. It exists because the alternative — the owner
        // retyping a colleague's revealed number — stamps `user_override` and
        // renders as "User edited", i.e. the product relabels Grace's
        // expertise as the owner's own work. Absence keeps today's behaviour
        // byte-for-byte; absence means "an ordinary edit", never "attribution
        // lost".
        source: appliedProvenance?.source ?? USER_EDIT_SOURCE,
        // Ids only. A display name here would sit inside `scenarios.graph`,
        // beyond the reach of the R-2 redaction routine; the label is resolved
        // at render from round data instead.
        ...(appliedProvenance !== undefined
          ? { elicited_from: appliedProvenance.elicited_from }
          : {}),
      };

      // ⭐⭐ AND THE ABSENT BRANCH MUST *CLEAR* IT, NOT MERELY DECLINE TO SET IT.
      //
      // `merged` SPREADS the prior `observed_state`, so a node that already
      // carries `elicited_from` keeps it unless this deletes it. Without this
      // line the sequence "apply Grace's 0.85, then retype 0.5 by hand" leaves
      // `{ source: 'user_override', elicited_from: { participant_id: <Grace> } }`
      // — the owner's own typed number, still carrying Grace's identity. The
      // contract explicitly sanctions consumers keying identity off
      // `elicited_from` ("a consumer may key display off either, but only
      // `elicited_from` carries the identity"), so this is not a cosmetic
      // leftover: it attributes to a named colleague a number she never gave.
      //
      // That is the MIRROR of the untruth this whole slice exists to end, and
      // shipping it inside the fix would have been worse than the original —
      // the original mislabelled a colleague's number as the owner's, this
      // mislabels the owner's number as a colleague's, and only this one
      // invents a quote.
      //
      // `delete` rather than `elicited_from: undefined`: the key must be ABSENT,
      // because absence is the contract's declared semantics ("absent means this
      // value was not applied from a panel round"), and a present-but-undefined
      // key survives structuredClone and object spreads while reading as present
      // to `in` and `Object.keys`.
      if (appliedProvenance === undefined) {
        delete (merged as { elicited_from?: unknown }).elicited_from;
      }

      node.observed_state = merged;

      // V5 D1 golden-path closure (A3.1 Task 3): recompute display_value
      // from the post-mutation observed_state via the canonical pure
      // formatter. Without this the persisted node carries a stale
      // display string ("£40,000" after we just mutated raw_value to
      // 50000). `synthesiseDisplayValue` returns undefined when input
      // is insufficient — callers who relied on absence handle that
      // path; we normalise back to undefined-meaning-cleared rather
      // than persisting the prior value.
      const recomputedDisplay = synthesiseDisplayValue({
        value: normalised.value,
        raw_value: normalised.raw_value,
        ...(after.unit !== undefined ? { unit: after.unit } : {}),
        ...(node.factor_type !== undefined ? { factor_type: node.factor_type } : {}),
        ...(after.cap !== undefined ? { cap: after.cap } : {}),
      });
      if (recomputedDisplay !== undefined) {
        node.display_value = recomputedDisplay;
      } else if (node.display_value !== undefined) {
        // Clear the stale display string when the formatter declines
        // to produce a new one.
        delete (node as { display_value?: string }).display_value;
      }

      // Stamp provenance so downstream consumers know the value was
      // user-set (NodeV3.provenance enum supports 'user_set' directly).
      node.provenance = 'user_set';

      // 1.16 item A2 — preserve option-intervention absolutes across the
      // cap change. Runs inside the mutation clone so the rewritten
      // option NODES flow through the same nodes-stamping persistence
      // merges as the factor mutation itself.
      if (capChanged) {
        rescaledInterventionCount = renormaliseOptionInterventionsForCapChange(
          clone,
          targetId,
          before.cap,
          after.cap,
        );
      }

      return { before, after };
    });

    const noop =
      before.value === after.value &&
      before.raw_value === after.raw_value &&
      before.unit === after.unit &&
      before.cap === after.cap;

    const fact: SetFactorValueHandlerFact = {
      fact_type: 'set_factor_value',
      fact_version: 1,
      noop,
      result: {
        target_id: targetId,
        status: noop ? 'noop' : 'applied',
        before: before as Record<string, unknown>,
        after: after as Record<string, unknown>,
      },
    };

    const factCheck = SetFactorValueHandlerFactSchema.safeParse(fact);
    if (!factCheck.success) {
      throw new HandlerResultInvalidError(
        'SetFactorValueHandlerFact failed schema validation',
        factCheck.error,
      );
    }

    const label = targetNode.label;
    // Narration uses the DE-NORMALISED user-unit value via the same
    // `resolveExistingRawValue` the operator LHS uses, rendering the honest
    // user-unit amount — e.g. a legacy capped `{ value: 0.4, cap: 100000, £ }`
    // narrates "£40,000", not a fabricated "£0.4" (the normalised ratio).
    // The AFTER value is always `resolved` (normaliseFactorValue wrote
    // raw_value). The BEFORE value may be `missing`/`ambiguous`: in that case
    // we must NOT fabricate a numeric "from" (a "from 0" would be a false
    // claim) — emit a one-sided "Updated X to Y." receipt instead. Only `set`
    // reaches narration with a non-resolved before (deltas already rejected).
    const narrationSide = (
      snap: ObservedSnapshot,
    ): { readonly raw_value: number; readonly unit?: string } => {
      const res = resolveExistingRawValue(snap);
      const raw = res.kind === 'resolved' ? res.raw : 0;
      return snap.unit !== undefined ? { raw_value: raw, unit: snap.unit } : { raw_value: raw };
    };
    const beforeResolution = resolveExistingRawValue(before);
    // Gate-1 claim integrity: the fact channel decided this was a no-op
    // above; the text channel must agree. Narrating `formatFactorChange`
    // here produced the self-refuting "Updated X from 0.8 to 0.8." plus
    // an implied commit that never happened. Checked FIRST because both
    // change-shaped receipts below assert a change.
    //
    // `after` is the narration side on the no-op path: on a no-op it is
    // equal to `before` by construction (the noop predicate compares
    // value/raw_value/unit/cap), and `after` is always `resolved`
    // (normaliseFactorValue writes raw_value), so this cannot fabricate
    // a value the way a non-resolved `before` could.
    const changeText = noop
      ? formatFactorValueUnchanged({ label, after: narrationSide(after) })
      : beforeResolution.kind === 'resolved'
        ? formatFactorChange({ label, before: narrationSide(before), after: narrationSide(after) })
        : formatFactorValueSet({ label, after: narrationSide(after) });

    // 1.16 item A2 — honest receipt for a consented scale change: the user
    // agreed to extend (or otherwise move) the factor's scale, so the
    // receipt says so explicitly. Redacted telemetry (counts + ids only,
    // never magnitudes) records how many option interventions were
    // renormalised to preserve their absolute values.
    if (capChanged) {
      log.info(
        {
          event: 'v5.d1.set_factor_value.cap_changed',
          target_id: targetId,
          rescaled_intervention_count: rescaledInterventionCount,
        },
        'set_factor_value applied an explicit cap change; option interventions renormalised to preserve absolutes',
      );
    }
    const scaleNote =
      capChanged && after.cap !== undefined
        ? ` The scale for this factor now allows values up to ${formatValueWithUnit(after.cap, after.unit)}.`
        : '';
    const baseText = `${changeText}${scaleNote}`;

    // P0 V5 golden-path repair (Wave 2): when a prior successful analysis
    // exists and this turn actually mutated the factor (non-noop), append
    // the staleness narrative so the assistant_text answers all four
    // user-facing questions (what changed, what it affects, is analysis
    // stale, what to do next). Suppressed on noop and pre-analysis
    // mutations.
    const hasPriorSuccessfulAnalysis = invocation.context.prior_facts.some(
      isSuccessfulRunAnalysisFact,
    );
    const assistantText =
      !noop && hasPriorSuccessfulAnalysis ? `${baseText}${STALENESS_NARRATIVE}` : baseText;

    return {
      assistant_text: assistantText,
      handler_facts: [factCheck.data],
      llm_calls_used: 0,
      mutated_graph: result.mutatedGraph,
    };
    });
  };
}
