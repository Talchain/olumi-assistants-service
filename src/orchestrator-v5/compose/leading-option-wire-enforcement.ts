/**
 * T1 claim safety — THE WIRE GATE. (ROADMAP 2.149.)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, live-confirmed 28 Jul and pinned by the estate's own
 * test as alarm-fires-only.
 *
 * `route-v2.ts` has NINETEEN `sendFinalised200` call sites. EIGHTEEN of them
 * return BEFORE `runTurnExecutor`, so eighteen of them never pass through
 * `finalizeRun`'s `enforceWithheldLeaderClaimGuard` (#755) — which is a function
 * nested inside `runTurnExecutor`, closed over run-local state, and therefore
 * not callable from the route at all. Three of those eighteen can carry
 * MODEL-AUTHORED text:
 *
 *   `:2310` chip_click ok      — decision_review enrichment prose
 *   `:3410` draft_graph        — LLM coaching prose
 *   `:4082` edit_graph MAIN    — the LLM edit lane; THE documented live harm
 *
 * On a turn whose constraint verdict WITHHELD the leading-option claim, the main
 * edit exit shipped, at HTTP 200:
 *
 *     "Added the risk. For context, Hire Marketing Manager leads at 72%
 *      against Hold at 28%."
 *
 * The Layer-3 alarm (`leading-option-egress-guard.ts`) saw it and logged it and
 * changed nothing, because `enforce: false` is the only mode wired. The estate's
 * own test asserted exactly that — status 200, one alarm, `hit_count > 0`, and
 * NO assertion on the body. The harm was pinned, not fixed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE DOES, AND — MORE IMPORTANTLY — WHAT IT REFUSES TO DO.
 *
 * SURGICAL, PER SENTENCE. It removes ONLY the unit of prose carrying the
 * designation and leaves every other byte alone. `"Added the risk."` survives
 * BYTE-IDENTICAL; only the leader sentence is substituted. This is not a style
 * preference — it is the #755 first-cut failure class, restated:
 *
 *   #755's first cut replaced the WHOLE answer at 39 executor exits. It
 *   destroyed a `run_analysis` receipt whose coaching sentence merely mentioned
 *   "the leading option" (`FIRST_ANALYSIS_COMPLETE`) — designating nothing —
 *   and took an honest compound-edit disclosure down with it. Two pre-existing
 *   tests caught it. `turn-executor.ts:10017-10054` records the whole episode.
 *
 * The in-repo instruction is explicit (`leading-option-egress-guard.ts`, the
 * closing comment of `guardLeadingOptionClaimsAtEgress`): the drop *"must be
 * per-field, not whole-response — blanking an envelope at egress trades one
 * dishonest answer for no answer at all"*. This module is per-field AND
 * per-sentence, using the same splitter the model-INPUT gate uses
 * (`compose/redactable-units.ts`).
 *
 * PERMIT-WINS IS THE FIRST LINE, not an afterthought. `mayNameLeadingOption ===
 * true` returns the input BY REFERENCE. Over-suppression is a failure here, not
 * a safe default: a blanket `false` at these exits would suppress leader prose
 * on every scenario that legitimately permits it, which is a WORSE product
 * defect than the one being fixed.
 *
 * IT MAKES NO CURRENCY CLAIM AND NO EXISTENCE CLAIM. The four substitution
 * inputs a RICH withheld explanation needs — `constraint_verdict_state`, the
 * ratified constraints, `conditionsAreCurrent`, `analysisExistenceProven` —
 * exist only inside `runTurnExecutor` (:10123-10138). They do not reach the
 * route seam, and this module does not invent them. It substitutes the ONE
 * shared sentence that is true on every withheld population regardless:
 * {@link WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL}. That is deliberate — it
 * sidesteps the F1 currency-referent split for the entire route population
 * rather than reproducing it (the executor-side split stays rowed as 2.151's
 * neighbour).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ SCOPE — STATED, NOT IMPLIED. What this gate does NOT cover.
 *
 * A chokepoint that claims to cover "the wire" and quietly covers less is the
 * guarantee-theatre class this programme exists to hunt. So, explicitly:
 *
 *   COVERED   `assistant_text` and `framing_question` — the two top-level
 *             unbounded prose surfaces, both rendered VERBATIM by the UI, and
 *             the surfaces that carry the model-authored ANSWER on all three
 *             model-text-capable pre-executor exits.
 *
 *   NOT COVERED, DELIBERATELY:
 *     - `blocks[].{title,body,signal,summary,…}` and every enrichment blob.
 *       These are PRODUCER-owned: `compose/withheld-claim-projection.ts` drops
 *       `decision_review` whole, projects `decision_brief` and `robustness`
 *       member-wise, nulls `blocks[].leading_option_id`, and `compose.ts` drops
 *       leader-presuming Phase-3 blocks. A SECOND, wire-level structured
 *       projection would be a second authority over the same question — the
 *       exact trap-#12 shape this estate has already paid for twice. The alarm
 *       keeps observing them, which is what keeps the producer defect visible
 *       instead of masked by a downstream repair.
 *     - STRUCTURED key designations (`leading_option_id`, `recommended_option_
 *       label`, …). There is no "unit" of a key to be surgical about; removing
 *       one is a schema decision, and the schema's own honest value (`null`) is
 *       already set by the producer.
 *     - `_reasoning`. VERBATIM extended-thinking text, ruled (ROADMAP 1.42) to
 *       bypass the egress claim-safety cage by design; containment is
 *       flag-default-off + collapsed UI + explicit label.
 *     - The SSE MID-STREAM frames (`GRAPH_READY`, `PROGRESS`). They ship before
 *       the turn completes and therefore before `sendFinalised200` exists to be
 *       a chokepoint. No leader-claim prose rides them today.
 *     - The three execute-intent receipts (`set_factor_value`, `add_constraint`,
 *       `adjust_edge_strength`), which are EXECUTOR-side and excluded by the
 *       #755 guard's own scope check (`turn-executor.ts:10112`).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { textAssertsLeadingOption, textNamesLeadingOption } from './leading-option-egress-guard.js';
import { replaceAssertingUnits } from './redactable-units.js';
import { WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL } from './withheld-explanation-answer.js';

/**
 * The sentence that replaces one offending unit.
 *
 * ⭐ IT IS THE SHARED CONSTANT, TRIMMED — not a new one. The estate's tail is a
 * LEADING-SPACE fragment by contract (it is appended to an answer); here it is a
 * standalone sentence inside prose, so the leading space goes and nothing else
 * does. Minting a route-level twin would have doubled the population of any
 * future copy defect and given the two gates different words for the same
 * refusal (CLAUDE.md trap #12).
 *
 * It says only what `mayNameLeadingOption === false` means. No currency claim,
 * no existence claim, no cause — the three things the route seam cannot know.
 */
export const WIRE_WITHHELD_LEADER_REPLACEMENT = WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL.trim();

/**
 * The prose fields this gate edits. TWO, and the list is short on purpose — see
 * the SCOPE block in the module docstring for what is excluded and why.
 *
 * EXPORTED so a test can assert the covered surface directly instead of
 * inferring it from behaviour: a scope that is only implied by which arms happen
 * to exist is a scope that widens or narrows without anyone noticing.
 */
export const WIRE_ENFORCED_PROSE_FIELDS = ['assistant_text', 'framing_question'] as const;
type WireEnforcedProseField = (typeof WIRE_ENFORCED_PROSE_FIELDS)[number];

/** How the designation was removed. Bounded — this is the telemetry cardinality. */
export type WireEnforcementMode =
  /** The normal path: only the offending sentence(s) were replaced. */
  | 'surgical'
  /**
   * LAST RESORT. The field asserts a leader but NO single unit does — the match
   * straddles a unit boundary (e.g. `"the leading\noption"`, where the split is
   * on the newline). Surgery cannot localise it, and claim safety's failure
   * direction is suppression, never the claim, so the whole FIELD is replaced.
   * Separately coded precisely so it can never be mistaken for the normal path
   * on a dashboard: a non-trivial rate here means the splitter and the reader
   * disagree and the splitter needs work, not that the gate is doing its job.
   */
  | 'whole_field';

export interface WireLeaderClaimEnforcementOpts {
  readonly requestId: string;
  readonly exitPath: string;
  /**
   * The turn's OWN answer to "may a leading option be named", threaded from
   * `sendFinalised200`'s ctx — the SAME value the Layer-3 alarm is armed with,
   * and never re-derived here (CLAUDE.md trap #12). `true` ⇒ this gate is a
   * by-reference no-op.
   */
  readonly mayNameLeadingOption: boolean;
}

export interface WireLeaderClaimEnforcementResult {
  /** The projected response, or the INPUT REFERENCE when nothing was edited. */
  readonly response: OlumiResponse;
  /** True only when at least one field's bytes changed. */
  readonly changed: boolean;
  /** Which covered fields were edited. Bounded by {@link WIRE_ENFORCED_PROSE_FIELDS}. */
  readonly editedFields: readonly WireEnforcedProseField[];
}

function unchanged(response: OlumiResponse): WireLeaderClaimEnforcementResult {
  return { response, changed: false, editedFields: [] };
}

/**
 * Project ONE prose field. Returns `null` when the field is absent, empty, or
 * carries no unlicensed designation — `null` means "do not touch this field",
 * which is how byte-identity is preserved by construction rather than by test.
 */
function projectField(value: string): { text: string; mode: WireEnforcementMode } | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!textAssertsLeadingOption(value)) return null;

  const surgical = replaceAssertingUnits(
    value,
    textAssertsLeadingOption,
    WIRE_WITHHELD_LEADER_REPLACEMENT,
  );
  if (surgical !== value) return { text: surgical, mode: 'surgical' };

  // The field asserts but no unit does. See {@link WireEnforcementMode}.
  return { text: WIRE_WITHHELD_LEADER_REPLACEMENT, mode: 'whole_field' };
}

/**
 * Remove unlicensed leading-option designations from the prose the user reads.
 *
 * NEVER THROWS. Same house rule as the alarm and the finalise chokepoint:
 * throwing at egress surfaces a 500 instead of a curated answer, which is
 * strictly worse than the prose being suppressed. A failure is reported LOUDLY
 * (`log.error` + telemetry) and the response passes through unedited — the
 * alarm, which runs on the same bytes, still reports the leak, so a degraded
 * enforcer cannot make the estate go quiet.
 */
export function enforceLeadingOptionClaimsAtWire(
  response: OlumiResponse,
  opts: WireLeaderClaimEnforcementOpts,
): WireLeaderClaimEnforcementResult {
  // PERMIT-WINS. Byte-identical, by reference, first line — same short-circuit
  // shape as the alarm (`guardLeadingOptionClaimsAtEgress`) and the finalise
  // chokepoint (`turn-executor.ts:10016`).
  if (opts.mayNameLeadingOption) return unchanged(response);

  try {
    const editedFields: WireEnforcedProseField[] = [];
    let modes: WireEnforcementMode = 'surgical';
    let originalLength = 0;
    let projectedLength = 0;
    let next = response;

    const answer = projectField(response.assistant_text);
    if (answer !== null) {
      originalLength += response.assistant_text.length;
      projectedLength += answer.text.length;
      if (answer.mode === 'whole_field') modes = 'whole_field';
      editedFields.push('assistant_text');
      next = { ...next, assistant_text: answer.text };
    }

    const framing = response.framing_question;
    if (typeof framing === 'string') {
      const projected = projectField(framing);
      if (projected !== null) {
        originalLength += framing.length;
        projectedLength += projected.text.length;
        if (projected.mode === 'whole_field') modes = 'whole_field';
        editedFields.push('framing_question');
        next = { ...next, framing_question: projected.text };
      }
    }

    if (editedFields.length === 0) return unchanged(response);

    emit(TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire, {
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      // Bounded field names and a bounded mode. LENGTHS only, never the matched
      // prose: this is the claim-safety boundary and the prose is the user's own
      // decision content.
      edited_fields: [...editedFields].sort().join(','),
      mode: modes,
      original_length: originalLength,
      projected_length: projectedLength,
    });

    return { response: next, changed: true, editedFields };
  } catch (err) {
    log.error(
      {
        event: 'v5.invariant_violation',
        invariant: 'leading_option_claim_wire_enforcement_failed',
        request_id: opts.requestId,
        exit_path: opts.exitPath,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 wire: the leading-option claim ENFORCER threw, so this response is shipping with ' +
        'whatever designation it carried. Fix the projector in compose/leading-option-wire-' +
        'enforcement.ts — it must be total over the envelope shape. Do not make it throw; a 500 ' +
        'is worse than the prose it suppresses. The Layer-3 alarm still reports the leak.',
    );
    emit(TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire, {
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      edited_fields: 'none',
      mode: 'enforcement_failed',
      original_length: 0,
      projected_length: 0,
    });
    return unchanged(response);
  }
}

/**
 * BUILD-TIME PROBE — the substituted copy must not itself trip either reader.
 *
 * If it did, the gate would be non-idempotent (a second pass would replace its
 * own replacement) AND it would inject, on every enforced turn, the exact
 * residue the Layer-3 alarm measures — an alarm rate nobody would have a reason
 * to look at. Same probe shape as `withheld-explanation-answer.ts`'s three,
 * including the POSITIVE CONTROL, because an absence check whose instrument
 * cannot see a presence proves nothing (CLAUDE.md trap #13).
 */
function assertReplacementIsInertAndNonVacuous(): void {
  if (WIRE_WITHHELD_LEADER_REPLACEMENT.length === 0) {
    throw new Error(
      'leading-option-wire-enforcement: the replacement is EMPTY. A replaced unit must be ' +
        'replaced, never deleted — an emptied assistant_text is a required schema field with no ' +
        'content, which is a worse answer than the one being repaired.',
    );
  }
  if (textAssertsLeadingOption(WIRE_WITHHELD_LEADER_REPLACEMENT)) {
    throw new Error(
      'leading-option-wire-enforcement: WIRE_WITHHELD_LEADER_REPLACEMENT trips the ENFORCEMENT ' +
        'reader, so this gate is not idempotent — a second pass would replace its own ' +
        'replacement. Reword the shared tail in compose/withheld-explanation-answer.ts.',
    );
  }
  if (textNamesLeadingOption(WIRE_WITHHELD_LEADER_REPLACEMENT)) {
    throw new Error(
      'leading-option-wire-enforcement: the replacement trips the ALARM vocabulary. The gate ' +
        'would inject the residue the alarm measures on every enforced turn.',
    );
  }
  // POSITIVE CONTROL — the probe above is vacuous if the readers see nothing.
  if (!textAssertsLeadingOption('Hire Marketing Manager leads at 72%.')) {
    throw new Error(
      'leading-option-wire-enforcement: the ENFORCEMENT reader cannot see a leader claim, so ' +
        'the inertness probes above pass by testing nothing (CLAUDE.md trap #13).',
    );
  }
  // SURGERY, exercised rather than argued: the receipt sentence must survive.
  const probe = `Added the risk. Hire Marketing Manager leads at 72%.`;
  const projected = replaceAssertingUnits(
    probe,
    textAssertsLeadingOption,
    WIRE_WITHHELD_LEADER_REPLACEMENT,
  );
  if (!projected.startsWith('Added the risk.')) {
    throw new Error(
      'leading-option-wire-enforcement: surgery destroyed the surviving sentence. This gate ' +
        'replaces the offending UNIT, never the whole answer — that is the #755 first-cut ' +
        'failure class (turn-executor.ts:10017-10054).',
    );
  }
  if (projected.includes('leads at 72%')) {
    throw new Error(
      'leading-option-wire-enforcement: surgery left the designation in place. A gate that sees ' +
        'a hit and produces no removal is theatre.',
    );
  }
}

assertReplacementIsInertAndNonVacuous();
