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

import type { z } from 'zod';

import { CURRENCY_SYMBOL_TO_CODE } from '../../cee/extraction/numeric-parser.js';
import { deriveStatedConstraintFrame } from '../../cee/compound-goal/index.js';
import type { ProposalAction } from '../routing/types.js';
import type { ProposedChange, ProposedChangeIntent } from '../types/proposed-change.js';
import { isProposedChangeActionType } from '../types/proposed-change.js';
import { buildResidualConstraintDisclosure } from '../routing/mutation-warrant.js';
import {
  SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS,
  SetFactorValueValueSchema,
} from '../tools/handlers/set-factor-value.js';
import {
  isUnitAmbiguousConstraintValue,
  // ⭐ The handler's OWN unit precedence and operator map, imported rather than
  // restated. Restating both is what produced the false refusal this fixes.
  resolveConstraintUnit,
  TYPE_TO_OPERATOR,
} from '../tools/handlers/add-constraint.js';
import {
  AddConstraintTypeSchema,
  AddConstraintValueSchema,
} from '../tools/handlers/add-constraint.js';
import { AdjustEdgeStrengthSchema } from '../tools/handlers/adjust-edge-strength.js';
import { PARAMETER_USER_PHRASING } from './parameter-user-phrasing.js';

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

/**
 * ⭐⭐ IS THIS MESSAGE THE PRODUCT'S OWN OFFER COPY?
 *
 * The recogniser lives HERE, beside `CHIP_COPY`, because the producer is the
 * only honest owner of the question. Deriving the set from the constants this
 * module emits — rather than re-spelling the three strings at the consumer —
 * is what stops it becoming the hand-maintained mirror CLAUDE.md trap 12 is
 * about: edit the copy and the recogniser moves with it, in the same commit,
 * with no second list to remember.
 *
 * ⚠ WHAT MAKES AN EXACT MATCH SOUND HERE, DERIVED AT THE BYTES RATHER THAN
 * ASSUMED. `emitProposedChange` passes the message through VERBATIM to both the
 * wire chip (`compose/proposed-change.ts:260`) and the persisted pending's
 * `public_message` (`:289`) — no templating, no interpolation, no value folded
 * in. These three strings are digit-free and content-free BY DESIGN (see
 * `CHIP_COPY`'s own header), which is exactly why they are stable enough to
 * match on. A chip whose copy carried a value could not be recognised this way,
 * and none of these does.
 *
 * ⚠ AND WHAT THIS IS **NOT**. It is not a claim about routing, provenance or
 * transport, and it must never be confused with `payload.source` — that field
 * answers "does this turn carry a CEE-routable action_type?" and four CEE
 * readers already misread it as provenance. This asks one narrow question about
 * a STRING: *did we write it?* It is also NOT a field-targeting authority and
 * joins none of the five that exist; it never looks at a graph, a pair or a
 * handler.
 *
 * Normalisation matches the estate's own (`option-effect-write.ts`'s reader and
 * `outstanding-effect-ask-misroute.ts::readUserValue` both lower-case, collapse
 * runs of whitespace and trim), so a transport that re-wraps the copy cannot
 * make the product fail to recognise a sentence it wrote itself.
 */
export const PRODUCT_MINTED_OFFER_MESSAGES: readonly string[] = Object.freeze(
  Object.values(CHIP_COPY).map((c) => c.message),
);

/** The one normalisation, applied to both sides so they cannot diverge. */
function normaliseOfferCopy(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
}

const PRODUCT_MINTED_OFFER_MESSAGE_SET: ReadonlySet<string> = new Set(
  PRODUCT_MINTED_OFFER_MESSAGES.map(normaliseOfferCopy),
);

export function isProductMintedOfferCopy(message: string): boolean {
  if (typeof message !== 'string') return false;
  return PRODUCT_MINTED_OFFER_MESSAGE_SET.has(normaliseOfferCopy(message));
}

/** Read a named parameter off a proposal action. */
function param(action: ProposalAction, name: string): ProposalAction['parameters'][number] | undefined {
  return action.parameters.find((p) => p.name === name);
}

/** A graph node, as far as the target-kind precondition needs to read one. */
export interface TargetKindLookupNode {
  readonly id?: unknown;
  readonly kind?: unknown;
}

/**
 * ⭐⭐ TARGET-KIND PRECONDITION — do not offer a chip the resumer must refuse.
 *
 * ── THE WITNESS (deployed staging, 1 Sep 2026) ────────────────────────────
 * A user asked to raise "Engineering Overstretch" to 75%. Turn 1 said
 * "Nothing has been changed. I want to confirm this with you before I edit the
 * model" and offered **"Set this value"**. Turn 2, on confirming: "I could not
 * update that value because the target or value was not valid" — naming
 * neither. Turn 3 finally told the truth: it is a `risk`, and no operation
 * sets a value on one directly.
 *
 * THE TRUTH WAS AVAILABLE AT TURN 1. The node's kind is in the graph this
 * branch already holds; only the offer never looked. Turn 2's opaque error and
 * turn 3's late truth are both DOWNSTREAM of a promise that could not be kept
 * — the user reached the handler only because the product invited them to.
 * Improving turn 2's wording would leave the invitation in place.
 *
 * ── WHY HERE, AND WHY IT IS NOT A NEW IDEA ────────────────────────────────
 * The demotion gate in `turn-executor.ts` ALREADY carries a sibling
 * precondition — the registry-executable check — whose stated reason is that
 * "a chip would promise a change the resumer could never honour". This is the
 * same rule; that check asked whether the HANDLER exists and never whether the
 * TARGET is one it accepts. This function sits beside it, deliberately, rather
 * than inside `buildWarrantDemotion`, so the two preconditions read as the
 * pair they are.
 *
 * ── DERIVED, NOT MIRRORED ─────────────────────────────────────────────────
 * The capability comes from each handler's OWN exported authority
 * (`SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`), never from a list re-spelled
 * here. A kind added to or removed from that constant moves this gate in the
 * same commit, with no second list to remember (CLAUDE.md trap 12). The gate
 * is therefore general over the whole node-kind domain — a guard that
 * special-cased `risk` would leave the identical defect one kind along.
 *
 * ── SCOPE, STATED NARROWLY ────────────────────────────────────────────────
 * Only `set_factor_value` is gated. `add_constraint` accepts four kinds
 * (factor / outcome / goal / risk) and rejecting decision / action / option at
 * offer time would need its own refusal copy naming its own working route —
 * a separate change with no witness behind it, deliberately not made here.
 * `adjust_edge_strength` targets an EDGE, so no node-kind authority applies;
 * it is absent from the map and never gated.
 *
 * ── FAIL-OPEN ON IGNORANCE, NEVER ON KNOWLEDGE ────────────────────────────
 * Returns non-null ONLY on positive knowledge that the resolved target's kind
 * is one the handler rejects. An unresolvable target, an empty graph, or an
 * intent with no node-kind authority all return null and leave the offer
 * exactly as it is today. Suppressing a legitimate edit would be a worse
 * defect than the one this closes, and confirm-before-write must survive
 * untouched.
 */
const TARGET_KIND_AUTHORITY: Partial<Record<ProposedChangeIntent, ReadonlySet<string>>> = {
  set_factor_value: new Set(SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS),
};

export function findUnsupportedOfferTargetKind(
  action: ProposalAction,
  graphNodes: readonly TargetKindLookupNode[],
): { readonly nodeKind: string; readonly label: string } | null {
  if (!isProposedChangeActionType(action.handler_id)) return null;
  const accepted = TARGET_KIND_AUTHORITY[action.handler_id];
  if (accepted === undefined) return null;

  const targetId = action.entity.id;
  if (typeof targetId !== 'string' || targetId.length === 0) return null;

  const targetNode = graphNodes.find(
    (n) => typeof n.id === 'string' && n.id === targetId,
  );
  // Target not in the graph we hold: we do not KNOW the kind, so we do not
  // refuse. Fail-open is the safe direction here (see header).
  if (targetNode === undefined) return null;

  const nodeKind = targetNode.kind;
  if (typeof nodeKind !== 'string' || nodeKind.length === 0) return null;
  if (accepted.has(nodeKind)) return null;

  const rawLabel = action.entity.label;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0
      ? rawLabel.trim()
      : targetId;
  return { nodeKind, label };
}

/**
 * ⭐⭐ UNIT-SUFFICIENCY PRECONDITION — the FOURTH sibling, and the one the
 * measured failure needed.
 *
 * ── THE WITNESS (deployed staging, 20 Sep 2026) ───────────────────────────
 * The product offered "a limit keeping <a risk> at or below 30 … Say the word
 * and I will make it." The user replied *"Yes, treat it as a 0-1 fraction of
 * revenue at risk, so 30% is 0.3. Please go ahead."* — and nothing happened;
 * the graph hash never moved and the held change lapsed two turns later.
 *
 * The obvious reading was that the confirmation predicate was too narrow. It
 * is not: a held change replays from its STORED parameters and never re-reads
 * the message, so honouring that sentence as a bare "yes" would have written
 * 30 and discarded the user's 0.3. The gate was right to refuse it.
 *
 * ⛔ THE REAL DEFECT IS ONE TURN EARLIER: **the offer could not have been
 * honoured by ANY answer.** `add_constraint`'s Gate-1 throws on a unit-less
 * value outside [0,1] targeting a probability-domain node, and `formatBound`
 * renders a stored unit — the offer read "at or below 30", bare — so a plain
 * "yes" would have reached the handler and thrown. The user supplied the unit
 * unprompted because the offer's own wording left it missing. **They were
 * answering a question the product had not asked.**
 *
 * ── WHY NOT `OFFER_REQUIRED_PARAMETERS` ───────────────────────────────────
 * Because that was already considered and rejected, in terms: its comment
 * records that `unit` is "deliberately NOT required, because requiring them
 * would suppress legitimate offers". That judgement is correct and stands — a
 * unit-less "at most 30" on a headcount factor is perfectly good. The
 * condition here is not "unit is missing"; it is the handler's own compound
 * precondition, which is false for exactly those legitimate offers.
 *
 * ── DERIVED, NOT MIRRORED ─────────────────────────────────────────────────
 * The predicate is `isUnitAmbiguousConstraintValue`, IMPORTED from the handler
 * that throws on it. One expression, two callers; a change to the rule moves
 * both in the same commit (CLAUDE.md trap 12). Same shape as
 * `findUnsupportedOfferTargetKind` consuming
 * `SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS`.
 *
 * ── FAIL-OPEN ON IGNORANCE, NEVER ON KNOWLEDGE ────────────────────────────
 * Returns non-null ONLY on positive knowledge that the resumer would throw.
 * Four fail-opens, each because this site cannot know the answer:
 *   · target not in the graph we hold — the kind is unknown;
 *   · value not a number — `findInsufficientOfferParameters` already owns it;
 *   · a goal with `at_least` — the handler may stamp a threshold cap that
 *     EXEMPTS the value (`capToStamp`), and that computation lives in the
 *     handler. Not knowing, this does not refuse;
 *   · any other intent.
 * Suppressing a legitimate offer would be a worse defect than the one this
 * closes.
 */
export interface UnitLookupNode {
  readonly id?: unknown;
  readonly kind?: unknown;
  /** ⚠ `unit` was ABSENT from this type, which is why the corpus could not
   *  observe the false-refusal class: the handler resolves the unit from
   *  here, and this side could not even see the field. */
  readonly observed_state?: { readonly cap?: unknown; readonly unit?: unknown } | null;
  readonly goal_threshold_cap?: unknown;
  /** The node's own goal-threshold channel — the handler's
   *  `nodeChannelUnchanged` limb reads exactly these two. */
  readonly goal_threshold_raw?: unknown;
  readonly goal_threshold_unit?: unknown;
}

/** The action's declared constraint type, or undefined when absent/unknown.
 *  Kept beside the caller because it is two lines and the mapping it feeds is
 *  the handler's, imported. */
function constraintTypeOf(action: ProposalAction): 'at_least' | 'at_most' | undefined {
  const raw = param(action, 'constraint_type')?.value;
  return raw === 'at_least' || raw === 'at_most' ? raw : undefined;
}

export function findUnitAmbiguousOffer(
  action: ProposalAction,
  graphNodes: readonly UnitLookupNode[],
  existingConstraints: readonly PersistedConstraintRow[] = [],
): { readonly label: string; readonly value: number } | null {
  if (action.handler_id !== 'add_constraint') return null;

  const rawUnit = param(action, 'unit')?.value;
  const paramUnit =
    typeof rawUnit === 'string' && rawUnit.trim().length > 0 ? rawUnit.trim() : undefined;

  const value = param(action, 'value')?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  const targetId = action.entity.id;
  if (typeof targetId !== 'string' || targetId.length === 0) return null;
  const targetNode = graphNodes.find((n) => typeof n.id === 'string' && n.id === targetId);
  if (targetNode === undefined) return null;
  const targetKind = targetNode.kind;
  if (typeof targetKind !== 'string' || targetKind.length === 0) return null;

  // ⛔⛔ THE UNIT IS RESOLVED THE HANDLER'S WAY, NOT READ OFF THE PARAMETER —
  // and the comment that used to sit further down, asserting the divergence
  // was "benign in the only direction that matters", was MEASURED FALSE.
  //
  // A reviewer ran this predicate beside the real handler:
  //   NODE_UNIT_PRESENT   offerRefuses=true   handlerThrew=false  ← FALSE REFUSAL
  //   NODE_UNIT_ABSENT    offerRefuses=true   handlerThrew=true   ← control
  //   existing-row        offerRefuses=true   handlerThrew=false  ← FALSE REFUSAL
  // "raise my ARR floor 250k → 300k" — an ordinary phrasing whose unit the
  // handler resolves from the existing row — had its offer withheld.
  //
  // ⛔ That is the trade this estate rejects: a disclosed refusal bought with a
  // silent capability loss. This function exists to refuse EXACTLY where the
  // handler would refuse; reading one of its four sources made it refuse more.
  //
  // ⚠ And my own corpus could not see it: no fixture carried
  // `observed_state.unit`, and `UnitLookupNode` did not declare the field. A
  // corpus that omits a class cannot certify the code over that class.
  //
  // The precedence is IMPORTED from the handler, never restated — restating is
  // what broke it (trap 12).
  const existingRowForTarget = existingConstraints.find(
    (row) =>
      row.node_id === targetId &&
      row.operator === TYPE_TO_OPERATOR[constraintTypeOf(action) ?? 'at_least'],
  );
  const unit = resolveConstraintUnit({
    paramUnit,
    existingUnit: typeof existingRowForTarget?.unit === 'string' ? existingRowForTarget.unit : undefined,
    // ⚠ KNOWN-UNRESOLVED: the handler's third source is a MOVED row
    // (`corrects_node_id`), whose prior state this site cannot load. Left
    // undefined deliberately, so the residue is a possible FALSE OFFER on a
    // correction — the permissive direction, which costs a clarifying
    // round-trip rather than a lost capability. Named, not hidden.
    sourceRowUnit: undefined,
    observedUnit:
      typeof targetNode.observed_state?.unit === 'string' ? targetNode.observed_state.unit : undefined,
  });

  // ⭐⭐ THE GOAL + `at_least` FAIL-OPEN, NARROWED — it was too wide, and the
  // review is right about why.
  //
  // The handler throws on `isUnitAmbiguousConstraintValue(...) && capToStamp
  // === null` (`add-constraint.ts:1084-1093`), and `capToStamp` is non-null
  // ONLY when `stampGoalThreshold` is true — which is
  // `ownsGoalThresholdChannel && !valueUnchanged` (`:1037`). My first version
  // returned null for EVERY goal + `at_least` action on the grounds that this
  // site cannot compute the stamp. But one limb of it IS computable here, and
  // it is the limb that decides: `valueUnchanged`.
  //
  // A VALUE-IDENTICAL RESTATEMENT sets `valueUnchanged` true, so
  // `stampGoalThreshold` is false, so `capToStamp` is null, so the handler
  // throws — and the old blanket return let the product offer that change
  // anyway. The handler's comment says so in terms: the guard "deliberately
  // fires even when the ambiguous row is ALREADY persisted and the turn is a
  // value-identical restatement".
  //
  // So the fail-open now survives only where a stamp is still POSSIBLE (the
  // value would genuinely change). `ownsGoalThresholdChannel` depends on
  // turn machinery this site has no access to, so its absence can still make a
  // permitted offer un-appliable — that residue is unchanged and is the only
  // remaining fail-open in this branch, deliberately in the permissive
  // direction (a false refusal costs a clarifying round-trip; a false offer
  // costs a change no answer can apply).
  //
  // ⚠ The two limbs below mirror the handler's own `rowValueUnchanged` /
  // `nodeChannelUnchanged` (`:1011-1023`), read from the SAME persisted
  // sources the resuming handler will load.
  if (targetKind === 'goal' && param(action, 'constraint_type')?.value === 'at_least') {
    // ⛔ WAS `row.operator === 'at_least'` — a string a persisted row NEVER
    // carries. `TYPE_TO_OPERATOR` maps it to `'>='`, so this lookup could not
    // hit and the whole limb was dead. The fixtures encoded the same wrong
    // vocabulary, so the suite agreed with the defect.
    const existingRow = existingRowForTarget;
    const rowValueUnchanged =
      existingRow !== undefined && existingRow.value === value && existingRow.unit === unit;
    const nodeChannelUnchanged =
      typeof targetNode.goal_threshold_raw === 'number' &&
      targetNode.goal_threshold_raw === value &&
      targetNode.goal_threshold_unit === unit;
    // ⚠ WITHDRAWN: this said the parameter-only read was "benign in the only
    // direction that matters". It was measured FALSE — see the block above.
    // Both limbs now compare against the RESOLVED unit, which is what the
    // handler's own `rowValueUnchanged` compares (`newConstraint.unit`).
    if (!(rowValueUnchanged || nodeChannelUnchanged)) return null;
    // Falls through: the restatement cannot stamp, so the handler will throw
    // unless the ambiguity check below clears it on its own terms.
  }

  if (
    !isUnitAmbiguousConstraintValue({
      unit,
      value,
      targetKind,
      observedCap: targetNode.observed_state?.cap,
      goalThresholdCap: targetNode.goal_threshold_cap,
    })
  ) {
    return null;
  }

  const rawLabel = action.entity.label;
  const label =
    typeof rawLabel === 'string' && rawLabel.trim().length > 0 ? rawLabel.trim() : targetId;
  return { label, value };
}

/**
 * ⭐⭐ PARAMETER-SUFFICIENCY PRECONDITION — the THIRD sibling of the
 * registry-executable and target-kind checks above, asking the one question
 * neither of them asks: are the PARAMETERS ones the handler accepts?
 *
 * ── THE WITNESS (CEE staging `8e4efce0`, reported 2026-09-14) ─────────────
 * A user stated a churn limit, was offered "Add this limit", said so again,
 * and was offered "Add this limit" a SECOND time. "do it" then produced
 * "I have more than one change waiting for your go-ahead... 1) Add this limit
 * 2) Add this limit" with the graph hash UNCHANGED. Two identical strings,
 * nothing applied, and no way to choose between them.
 *
 * ── WHY THERE WERE TWO, AND WHY THE SECOND ONE WAS NEVER APPLIABLE ────────
 * The `prop_<hex>` handle is NOT content-derived: `CHIP_COPY` above is a
 * per-intent CONSTANT, so the copy cannot vary. `computeProposalId` hashes
 * `{scenario_id, intent, params, graph_hash, target_entity_ids}`, and the
 * pending's `preconditions.graph_hash` is that SAME hash, so a proposal
 * minted against a moved graph is dropped by the carry-forward's hash rule.
 * Two survivors at one graph hash therefore differ in `params` — nothing
 * else can make them differ, and the supersede rule keys on `chip_id`, so it
 * cannot fire.
 *
 * The reported second offer described its bound as "at or below THAT LEVEL".
 * `formatBound` returns that string, and only that string, when the value is
 * not a finite number. Reproduced here at pristine: a proposal carrying only
 * `constraint_type` builds `params: { constraint_type: 'at_most' }` and
 * `changeDescription: 'a limit keeping "Churn Rate" at or below that level'`
 * — a DIFFERENT params record, a DIFFERENT id, a second live pending, and a
 * change the resumer must refuse (`add_constraint` throws PARAMETER_INVALID
 * without a `value`).
 *
 * ── WHY `validateToolCall` DOES NOT CATCH IT ──────────────────────────────
 * It validates the parameters that ARE present and never asserts that the
 * required ones are. Its own comment says so and defers "required-parameter
 * enforcement" to a future brief (`routing/validator.ts`). So the residual
 * gap is PRESENCE, and that is what this gate closes. Present values are
 * re-checked against the SAME schemas `validation-registry.ts` declares, so
 * this can never be stricter than the validator already is.
 *
 * ── WHY THIS IS NOT A SUPERSEDE RULE, DELIBERATELY ────────────────────────
 * Superseding one live consent-expecting pending with another would have the
 * product choose on the user's behalf, which the consent-clarity amendment
 * forbids. This gate removes ONLY offers the resumer must refuse, so it
 * cannot collapse two genuinely different proposals: the negative control
 * holds by construction rather than by tuning. A duplicate whose params are
 * all valid and differ only cosmetically is NOT closed by this change and is
 * reported as a residual rather than quietly folded in here.
 *
 * ── DERIVED, NOT MIRRORED ─────────────────────────────────────────────────
 * The schemas are the handlers' OWN exports — the identical objects
 * `validation-registry.ts` imports — so a bound that moves in a handler
 * moves this gate in the same commit. The genuinely new fact is only WHICH
 * parameters are required, and that is pinned against the real handlers, by
 * EXECUTION and in BOTH directions, in
 * `__tests__/offer-sufficiency-handler-biconditional.test.ts`. That guard
 * probes each handler for its own required set rather than reading this
 * table, and asserts EQUALITY, so all four drift directions RED: a handler
 * gaining or dropping a requirement, and this table going short or long. Its
 * first version iterated this table instead and a mutant proved it blind to
 * a SHORT table — see the ⛔ note in that file.
 *
 * ── FAIL-OPEN ON IGNORANCE ────────────────────────────────────────────────
 * An intent this table has no authority over returns null and leaves the
 * offer exactly as it is today, matching `findUnsupportedOfferTargetKind`.
 */
interface OfferRequiredParameter {
  readonly name: string;
  readonly schema: z.ZodType;
}

export const OFFER_REQUIRED_PARAMETERS: Readonly<
  Record<ProposedChangeIntent, readonly OfferRequiredParameter[]>
> = Object.freeze({
  // `add_constraint` throws PARAMETER_INVALID without either of these; `label`
  // and `unit` are optional there and are deliberately NOT required, because
  // requiring them would suppress legitimate offers.
  add_constraint: Object.freeze([
    { name: 'constraint_type', schema: AddConstraintTypeSchema },
    { name: 'value', schema: AddConstraintValueSchema },
  ]),
  set_factor_value: Object.freeze([{ name: 'value', schema: SetFactorValueValueSchema }]),
  adjust_edge_strength: Object.freeze([{ name: 'strength', schema: AdjustEdgeStrengthSchema }]),
});

export function findInsufficientOfferParameters(
  action: ProposalAction,
): { readonly parameterName: string } | null {
  if (!isProposedChangeActionType(action.handler_id)) return null;
  for (const required of OFFER_REQUIRED_PARAMETERS[action.handler_id]) {
    const supplied = param(action, required.name);
    if (supplied === undefined) return { parameterName: required.name };
    if (!required.schema.safeParse(supplied.value).success) {
      return { parameterName: required.name };
    }
  }
  return null;
}

/**
 * The refusal copy for an offer we decline to mint.
 *
 * ⛔ IT MUST NOT BORROW `buildMutationWarrantDemotionText`, whose closing
 * sentence is "Say the word and I will make it." — a promise with no chip
 * behind it. Saying that here would rebuild the dead end by another door:
 * the whole point is that there is nothing to say the word TO.
 *
 * The "what to do instead" sentence is the parameter's OWN ratified phrasing
 * (`PARAMETER_USER_PHRASING`), so this introduces no new vocabulary for
 * talking to users about a parameter, and it names a move the user can
 * actually make. Schema key names never reach the copy.
 */
export function buildIncompleteOfferRefusalText(
  parameterName: string,
  entityLabel: string | undefined,
): string {
  const guidance =
    PARAMETER_USER_PHRASING[parameterName]?.guidance ??
    'Tell me what you would like it to be and I will set it up.';
  return (
    `Nothing has been changed. I did not have enough detail to offer that ` +
    `change to ${quoted(entityLabel)}. ${guidance}`
  );
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
  /** Present on real rows; read by the unit-sufficiency precondition to
   *  reproduce the handler's `rowValueUnchanged` test. */
  readonly value?: unknown;
  readonly unit?: unknown;
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
  | { readonly ok: false; readonly reason: 'not_a_proposable_mutation' }
  | {
      readonly ok: false;
      /**
       * The handler requires a parameter this proposal does not usably carry,
       * so an offer would promise a change the resumer must refuse. See
       * `findInsufficientOfferParameters`.
       */
      readonly reason: 'required_parameter_missing';
      /** The schema key. NEVER shown to the user — see `buildIncompleteOfferRefusalText`. */
      readonly parameterName: string;
    };

/**
 * Currency units → their display symbol, DERIVED from the one canonical
 * currency vocabulary (`CURRENCY_SYMBOL_TO_CODE`, ROADMAP 2.972).
 *
 * ⭐ THIS WAS A HAND-WRITTEN MAP OF SIX ENTRIES AND THE UNION GUARD CAUGHT IT.
 * `cee/extraction/__tests__/currency-vocabulary.union.test.ts` failed this
 * file by name with the instruction to derive from the canonical list or
 * justify an exception at the bytes — which is precisely the trap-12d
 * completeness check working exactly as designed, on a list I had already
 * written a "this cannot be derived" comment above. It could. I had searched
 * two of the three copies and not the registry.
 *
 * Deriving costs nothing and buys five currencies the hand-written map did not
 * have (JPY, INR, AUD, CAD, NZD, CHF, SEK). Both directions are accepted
 * because both reach this function on the wire: the drafter prompt stores
 * `unit: "£"` (`defaults-v15.ts`) while `parseNumericValue` yields
 * `unit: "GBP"` (`provenance/stated-amounts.ts`).
 */
const CURRENCY_SYMBOL_BY_UNIT: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(CURRENCY_SYMBOL_TO_CODE).flatMap(([symbol, code]) => [
      [symbol, symbol],
      [code, symbol],
    ]),
  ),
);

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
  sourceMessage?: string,
): WarrantDemotionBuild {
  if (!isProposedChangeActionType(action.handler_id)) {
    // Not one of the three proposable mutations. The caller must NOT execute
    // it either — it refuses instead, which is the fail-safe direction.
    return { ok: false, reason: 'not_a_proposable_mutation' };
  }
  // Do not build an offer for a change the resumer must refuse. This runs
  // BEFORE the copy is composed, because `formatBound` renders an unusable
  // bound as "that level" and would otherwise describe, and offer, a change
  // the product cannot make.
  const insufficient = findInsufficientOfferParameters(action);
  if (insufficient !== null) {
    return {
      ok: false,
      reason: 'required_parameter_missing',
      parameterName: insufficient.parameterName,
    };
  }
  const intent: ProposedChangeIntent = action.handler_id;
  const copy = CHIP_COPY[intent];
  const entityLabel = quoted(action.entity.label);
  const targetId = action.entity.id;

  let changeDescription: string;
  let residualDisclosure: string | null = null;
  let constraintValueFrame: ProposedChange['constraint_value_frame'];

  if (intent === 'add_constraint') {
    const constraintType = param(action, 'constraint_type')?.value;
    const operator =
      typeof constraintType === 'string' && constraintType in CONSTRAINT_TYPE_TO_OPERATOR
        ? CONSTRAINT_TYPE_TO_OPERATOR[constraintType]!
        : null;
    const bound = formatBound(param(action, 'value')?.value, param(action, 'unit')?.value);
    const value = param(action, 'value')?.value;
    if (operator !== null && typeof value === 'number') {
      constraintValueFrame = deriveStatedConstraintFrame(sourceMessage, operator, value);
    }
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
      ...(constraintValueFrame !== undefined ? { constraint_value_frame: constraintValueFrame } : {}),
    },
    changeDescription,
    residualDisclosure,
  };
}
