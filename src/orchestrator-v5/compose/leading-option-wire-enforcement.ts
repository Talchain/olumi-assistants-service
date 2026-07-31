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
 * ⭐ THE ENTRY CRITERION, AND WHY VOCABULARY ALONE WAS THE WRONG ONE.
 *
 * The first cut of this gate entered on VOCABULARY alone: any unit that tripped
 * `textAssertsLeadingOption` was replaced. Adversarial review reproduced two
 * defects from that, and they pull in OPPOSITE directions — which is why the
 * answer is a redesigned criterion and not two patches.
 *
 *   OVER-SUPPRESSION. Ordinary decision vocabulary feeds the DELETING reader:
 *   "sales leads improved", "lead time is down", "who leads this?", "ahead of
 *   plan". None designates anything. All were destroyed on any withheld turn.
 *   Worse, `compose/terminology-rewrite.ts` MANUFACTURES "leading option(s)"
 *   upstream of this seam, so the estate's own safety pass fed the deleter.
 *   This is #755's canary class — an honest receipt destroyed by a guard —
 *   reopened at a new address.
 *
 *   LEAK. A distributed claim defeats sentence surgery: "Hire Marketing Manager
 *   is strong. It leads at 72%." The vocabulary sits in unit 2 and the NAME in
 *   unit 1, so surgery removed unit 2 and shipped the designation.
 *
 * THE CRITERION THAT CLOSES BOTH. Enforcement needs TWO independent facts, and
 * neither alone is sufficient:
 *
 *   1. A CLAIM IS PRESENT — `textAssertsLeadingOption` at FIELD level (not unit
 *      level: a claim that straddles a sentence split must still count).
 *   2. A DESIGNATION IS POSSIBLE — the field NAMES one of the scenario's own
 *      options. Vocabulary with no option name designates nobody: "one option
 *      leads" is not a claim about which. No name ⇒ ship unchanged, and the
 *      Layer-3 alarm observes it.
 *
 * Rule 2 is what spares the whole "sales leads" class, and it does NOT re-derive
 * "who is leading" (which would be a second authority beside the verdict —
 * CLAUDE.md trap #12). It derives only WHICH OPTIONS EXIST, from the graph the
 * exit is already shipping. Those are different questions.
 *
 * Then, having entered, the residual is POST-CHECKED and escalated stepwise —
 * because removing the vocabulary unit is exactly what leaves a distributed
 * claim's naming half behind. See {@link projectField}.
 *
 * ⚠ THE COST OF ESCALATION, PRICED RATHER THAN HIDDEN. On a field that both
 * names an option AND asserts a leader, escalation removes the NAME-BEARING
 * units too — so an edit receipt in such an answer ("Added a risk to Hire
 * Marketing Manager. It leads at 72%.") loses the receipt as well as the claim.
 * That is a real cost and it is pinned by a test rather than discovered later.
 * It is also NOT worse than the estate's proven design: #755's chokepoint
 * replaces the WHOLE answer on exactly these inputs. This gate is strictly more
 * conservative everywhere else — a receipt with no leader vocabulary, or leader
 * vocabulary with no option name, is untouched.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ SCOPE — STATED, NOT IMPLIED. A chokepoint that claims to cover "the wire"
 * and quietly covers less is the guarantee-theatre class this programme hunts.
 *
 *   COVERED   `assistant_text` and `framing_question` — the two top-level
 *             unbounded prose surfaces, both rendered VERBATIM by the UI, and
 *             the surfaces that carry the model-authored ANSWER on all three
 *             model-text-capable pre-executor exits.
 *
 * ⚠⚠ THE CEILING — READ THIS BEFORE QUOTING THE HEADLINE. What this gate closes
 * is BOUNDED on THREE axes, and the headline must name all three or it over-reads
 * (which is the trap-class this programme hunts — the over-read is a worse defect
 * than the residual it hides).
 *
 * This gate suppresses a withheld leader claim only when the field BOTH
 *   (a) uses the shared leader VOCABULARY, AND
 *   (b) names a roster option as an EXACT token sequence (whitespace-flexible).
 *
 * The stated residual — leak surface, NOT closed here, observed by the alarm:
 *
 *   1. VOCABULARY-FREE designations — "your strongest bet", "the frontrunner",
 *      "go with the first one". No shared vocabulary ⇒ neither reader sees it.
 *      Pre-existing and SHARED: the Layer-3 alarm and the #755 executor
 *      chokepoint are blind to these too. Positional designation in PROSE
 *      ("the first option") sits here. (Positional designation in STRUCTURED
 *      data does NOT — the producer drops `rank` and re-orders
 *      `decision_brief.options[]` by `option_id`, so ordinal and array order
 *      carry no designation by the time a body reaches this seam.)
 *
 *   2. SHORT FORMS — "Marketing Manager" for a roster label "Hire Marketing
 *      Manager". The exact-sequence matcher misses them, deliberately: see
 *      {@link textNamesAnOption}'s note on why partial matching is refused (it
 *      re-opens P1-OVERSUPPRESS). This is the REALISTIC residual — models shorten
 *      multi-word labels. A wrapped name whose claim unit is surgically removed
 *      can also LEAVE a claimless short-form fragment ("Hire Marketing" once
 *      "…Manager leads at 72%." is gone) — same residual class: a partial label
 *      with NO claim attached to it.
 *
 *   3. PARAPHRASES — a naming that is neither the exact label nor shares the
 *      vocabulary.
 *
 * The fix path for 2 and 3 is a semantic judge — ROADMAP 2.198, converging with
 * the harness eval track — NOT a fuzzy matcher here. The honest headline is
 * therefore: "a withheld leader claim naming a roster option in RECOGNISABLE
 * FORM (shared vocabulary + exact whitespace-flexible label) no longer ships at
 * these exits; short-form / paraphrase / vocabulary-free designations remain the
 * stated ceiling (2.197 / 2.198)." Never the bare "the withheld leader claim no
 * longer ships".
 *
 * ── The seam's own exclusions (structural, not the ceiling above) ──
 *     - `blocks[].{title,body,signal,summary,…}` and every enrichment blob:
 *       PRODUCER-owned (`compose/withheld-claim-projection.ts`). A second,
 *       wire-level structured projection is a second authority over one question
 *       (trap #12). The alarm keeps observing them.
 *     - STRUCTURED key designations (`leading_option_id`, …): no prose "unit" to
 *       be surgical about; the producer already nulls them.
 *     - `_reasoning`: verbatim, ruled to bypass the cage (ROADMAP 1.42).
 *     - SSE MID-STREAM frames: ship before `sendFinalised200` exists.
 *     - The three execute-intent receipts: EXECUTOR-side (`turn-executor.ts`).
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
  /** The normal path: only the vocabulary-bearing sentence(s) were replaced. */
  | 'surgical'
  /**
   * The DISTRIBUTED-CLAIM path. Surgery removed the vocabulary, and the residual
   * STILL named the option — "Hire Marketing Manager is strong. It leads at
   * 72%." So the name-bearing units went too. This is the mode that closes the
   * leak sentence surgery trades away, and it is the mode that costs a receipt
   * when one shares a field with a leader claim.
   */
  | 'surgical_escalated'
  /**
   * LAST RESORT. Two escalations and the residual still names or asserts. Now
   * NAME-GATED: it cannot fire on a field that never named an option, which is
   * what previously let ordinary prose reach it through a straddling match.
   * Separately coded precisely so it can never be mistaken for the normal path
   * on a dashboard: a non-trivial rate here means the splitter and the readers
   * disagree and the splitter needs work, not that the gate is doing its job.
   */
  | 'whole_field';

/**
 * Shortest option label this gate will treat as NAME EVIDENCE.
 *
 * Matching is already word-boundaried, so a short label cannot match inside a
 * longer word — but a one- or two-character label ("A", "B", "US") collides with
 * ordinary prose as a whole token far too easily, and a false name-match is what
 * opens the gate on an honest receipt. Below this length the roster entry is
 * simply not used as evidence: the field is treated as naming nothing, and the
 * alarm observes. Fails toward the receipt, which is the direction the
 * over-suppression finding demands.
 */
const MIN_OPTION_LABEL_LENGTH = 3;

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The scenario's OPTION ROSTER, read off the graph the exit is already shipping.
 *
 * ⚠ THIS IS NOT A SECOND DERIVATION OF THE VERDICT, and the distinction is the
 * whole licence for reading the graph here. `context/withheld-history-
 * redaction.ts` deliberately refuses to anchor on option labels, because there
 * the reader would have had to decide WHO IS LEADING — a second authority beside
 * the constraint verdict (CLAUDE.md trap #12). This function decides only WHICH
 * OPTIONS EXIST. It never ranks them, never reads a win probability, and never
 * consults an analysis fact. The permission still comes from one place:
 * `ctx.mayNameLeadingOption`.
 *
 * Shape read defensively, mirroring the in-repo precedent at
 * `turn-executor.ts:1900-1907` (filter to `kind === 'option'`, take `label` only
 * when it is a string).
 */
export function optionRosterFromGraph(graph: unknown): readonly string[] {
  const nodes = (graph as { readonly nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return [];
  const roster: string[] = [];
  for (const raw of nodes) {
    const node = raw as { readonly kind?: unknown; readonly label?: unknown } | null;
    if (node === null || typeof node !== 'object') continue;
    if (node.kind !== 'option') continue;
    if (typeof node.label !== 'string') continue;
    const label = node.label.trim();
    if (label.length < MIN_OPTION_LABEL_LENGTH) continue;
    roster.push(label);
  }
  return roster;
}

/**
 * Does this text NAME one of the scenario's options?
 *
 * Whole-token, case-insensitive. The boundaries are written as Unicode
 * lookarounds rather than `\b` because `\b` is defined against ASCII word
 * characters and silently mis-anchors on a label that starts or ends with
 * punctuation ("Hire (Senior)") or carries non-ASCII letters.
 *
 * ⚠ WHITESPACE INSIDE THE LABEL IS NORMALISED TO `\s+`, AND THAT IS LOAD-BEARING
 * — the same soft-wrap defect the vocabulary side and the splitter already fixed,
 * left on the name matcher until an adversarial re-verify of the redesign caught
 * it (31 Jul). Model prose soft-wraps: "Hire Marketing\nManager leads at 72%."
 * carries the roster label "Hire Marketing Manager" across a newline. With the
 * space escaped as a LITERAL space, the name check missed, the field fell to the
 * "asserts but names nobody ⇒ ship unchanged" row, and the withheld designation
 * shipped byte-identical. It is NOT the vocabulary-bounded ceiling (that is a
 * designation using no vocabulary at all): here the vocabulary IS present and the
 * option IS named — only the matcher was brittle. Normalising every internal
 * whitespace run to `\s+` matches a label however the prose happened to wrap.
 */
export function textNamesAnOption(value: string, roster: readonly string[]): boolean {
  if (typeof value !== 'string' || value.length === 0 || roster.length === 0) return false;
  return roster.some((label) => {
    // Escape metacharacters FIRST (so a label's own `.`/`(` is literal), then
    // relax the already-escaped inter-word whitespace to `\s+`. `escapeForRegExp`
    // does not touch space characters, so this rewrite cannot corrupt an escape.
    const pattern = escapeForRegExp(label).replace(/\s+/g, '\\s+');
    return new RegExp(`(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`, 'iu').test(value);
  });
}

/**
 * ⚠ WHY THIS IS AN EXACT TOKEN SEQUENCE AND NOT A FUZZY / PARTIAL MATCH — an
 * ARCHITECT CALL, recorded so the next reader does not "fix" it into the defect
 * it is avoiding. (ROADMAP 2.149, adjudicated 31 Jul.)
 *
 * The matcher above requires the roster label as a whole, whitespace-flexible
 * token SEQUENCE. It therefore MISSES short forms ("Marketing Manager" for a
 * roster label "Hire Marketing Manager") and paraphrases. Models do shorten
 * multi-word labels, so this is a real residual, not a contrived one.
 *
 * Closing it would mean fuzzy or partial-token matching — and that RE-OPENS the
 * exact over-suppression the name gate was added to close. A partial matcher
 * that fired on "Marketing" would destroy "the marketing budget improved" on
 * every withheld turn; one that fired on "Hire" would destroy "we should hire
 * two engineers". The gate would be back to deleting honest receipts, which is
 * P1-OVERSUPPRESS rebuilt.
 *
 * So the call is: DO NOT fuzzy-match here. The strict matcher is a real net gain
 * for pass-condition 2 — it reduces the leak surface from "every non-execute
 * exit ships the claim" to "short-form / paraphrase / vocabulary-free only", and
 * an exact runner-up naming is still caught by escalation. The complete fix is a
 * semantic judge (heavier, separate, converging with the harness eval track) —
 * ROADMAP 2.198. Perfect must not block the strict improvement; the only
 * unacceptable thing is OVER-CLAIMING what this closes, which is why the ceiling
 * is stated in the SCOPE block and in the headline, not left implicit.
 */

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
  /**
   * The graph this exit is shipping (`ctx.graph`), read ONLY for the option
   * ROSTER — see {@link optionRosterFromGraph} for why that is not a second
   * derivation of the verdict.
   *
   * Typed `unknown` on purpose: this module lives in `compose/` and must not
   * take a dependency on the route's `GraphV3T` alias to read two fields
   * defensively.
   *
   * ⚠ A NULL GRAPH MEANS NO ROSTER MEANS NO ENFORCEMENT, and the hole is real:
   * **13 of `route-v2.ts`'s 19 exits pass `graph: null`** (derived at
   * `16d0d704`, not assumed). They are exactly the deterministic-copy exits —
   * all three model-text-capable exits (`chip_click` ok `:2420`, `draft_graph`
   * `:3520`, MAIN edit `:4192`) and the executor exit `:4650` thread a real
   * graph. But a dispatch that returns a null graph on some branch disarms this
   * gate for that turn, so the stand-down is REPORTED
   * (`mode: 'roster_unavailable'`) rather than silent.
   *
   * It is the same epistemic position as "no option name in the field": we
   * cannot establish that a designation is present, so we do not delete the
   * user's prose. The Layer-3 alarm still reports the leak.
   */
  readonly graph: unknown;
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
 * Project ONE prose field. Returns `null` when the field must not be touched —
 * and `null` means the caller returns the input BY REFERENCE, which is how
 * byte-identity is preserved by construction rather than by test.
 *
 * ⭐ THE DECISION TABLE, in the order the code evaluates it:
 *
 * | claim present | names an option | outcome                                  |
 * |---------------|-----------------|------------------------------------------|
 * | no            | no              | untouched                                |
 * | no            | YES             | untouched — a receipt naming the option   |
 * |               |                 | the user just edited is not a claim       |
 * | YES           | no              | untouched — "sales leads improved" and    |
 * |               |                 | the terminology-rewrite's manufactured    |
 * |               |                 | "leading option" designate nobody         |
 * | YES           | YES             | ENTER: surgery, then post-check           |
 *
 * "Claim present" is read at FIELD level, deliberately: a claim that straddles a
 * sentence split ("the leading\noption") trips no single unit, and a unit-level
 * entry test would miss exactly the case the escalation exists for.
 *
 * ⭐ THE POST-CHECK, and why the residual is re-read at all. Removing the
 * vocabulary unit is precisely what leaves a distributed claim's naming half
 * behind. So after each pass the residual must satisfy BOTH:
 *   - it asserts no leader (`textAssertsLeadingOption` — the ENFORCER reader),
 *   - it names no option (`textNamesAnOption`).
 * Failing either escalates: first the name-bearing units go too, then, if the
 * residual STILL fails, the whole field.
 *
 * ⚠ THE POST-CHECK DELIBERATELY DOES NOT USE `textNamesLeadingOption` (the wide
 * ALARM reader), and the review shape that proposed it is refuted here rather
 * than silently dropped. The only strings the wide reader sees and the narrow
 * one does not are the two documented carve-outs — causal "leads to" and
 * job-title "team/tech/engineering/project/squad lead(s)" — and NEITHER CAN
 * DESIGNATE ANYTHING. Escalating on them would delete ordinary English inside an
 * entered field:
 *
 *     "Hire Marketing Manager is the option. Higher capacity leads to faster
 *      delivery."
 *
 * Under a wide post-check the causal clause forces `whole_field` and the user
 * loses a true, useful sentence — the over-suppression finding rebuilt one layer
 * in. The narrow reader is the ENFORCER's reader by the module's own
 * cost-function doctrine, and `assertEnforcerIsNarrowerThanAlarm` now pins
 * narrow ⊆ wide, so nothing designating can hide in the gap.
 */
function projectField(
  value: string,
  roster: readonly string[],
): { text: string; mode: WireEnforcementMode } | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  // (1) A CLAIM IS PRESENT — field level, so a straddling match still counts.
  if (!textAssertsLeadingOption(value)) return null;
  // (2) A DESIGNATION IS POSSIBLE — the field names one of this scenario's own
  //     options. Vocabulary with no name designates nobody.
  if (!textNamesAnOption(value, roster)) return null;

  const isClean = (candidate: string): boolean =>
    !textAssertsLeadingOption(candidate) && !textNamesAnOption(candidate, roster);

  const surgical = replaceAssertingUnits(
    value,
    textAssertsLeadingOption,
    WIRE_WITHHELD_LEADER_REPLACEMENT,
  );
  if (isClean(surgical)) return { text: surgical, mode: 'surgical' };

  // ⚠ ESCALATION RUNS FROM THE ORIGINAL VALUE, NOT FROM `surgical`. Running it
  // over the surgical output leaves the replacement sentence sitting in the text
  // as ORDINARY PROSE — it neither asserts nor names, so the collapse logic
  // cannot see it as a replacement, and a name-bearing neighbour that is
  // replaced next lands the SAME sentence twice in a row ("No single option can
  // be put forward yet. No single option can be put forward yet."). Re-deriving
  // from the original makes the two removals one contiguous run, which is
  // exactly what the collapse rule is for.
  const escalated = replaceAssertingUnits(
    value,
    (unit) => textAssertsLeadingOption(unit) || textNamesAnOption(unit, roster),
    WIRE_WITHHELD_LEADER_REPLACEMENT,
  );
  if (isClean(escalated)) return { text: escalated, mode: 'surgical_escalated' };

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
    const roster = optionRosterFromGraph(opts.graph);

    if (roster.length === 0) {
      // STAND DOWN, LOUDLY. Without a roster the gate cannot establish that any
      // designation is possible, so deleting prose would be a guess. Reported
      // rather than silent, because a silent stand-down is how a guarantee turns
      // into theatre: a reader of the dashboard must be able to see the
      // difference between "nothing to do" and "could not look".
      const couldHaveMattered =
        textAssertsLeadingOption(response.assistant_text) ||
        (typeof response.framing_question === 'string' &&
          textAssertsLeadingOption(response.framing_question));
      if (couldHaveMattered) {
        emit(TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire, {
          request_id: opts.requestId,
          exit_path: opts.exitPath,
          edited_fields: 'none',
          mode: 'roster_unavailable',
          original_length: 0,
          projected_length: 0,
        });
      }
      return unchanged(response);
    }

    const editedFields: WireEnforcedProseField[] = [];
    // The LOUDEST mode wins the report: `whole_field` over `surgical_escalated`
    // over `surgical`. A field edited surgically must never mask a sibling field
    // that needed the last resort.
    let modes: WireEnforcementMode = 'surgical';
    const escalate = (mode: WireEnforcementMode): void => {
      if (mode === 'whole_field') modes = 'whole_field';
      else if (mode === 'surgical_escalated' && modes === 'surgical') modes = 'surgical_escalated';
    };
    let originalLength = 0;
    let projectedLength = 0;
    let next = response;

    const answer = projectField(response.assistant_text, roster);
    if (answer !== null) {
      originalLength += response.assistant_text.length;
      projectedLength += answer.text.length;
      escalate(answer.mode);
      editedFields.push('assistant_text');
      next = { ...next, assistant_text: answer.text };
    }

    const framing = response.framing_question;
    if (typeof framing === 'string') {
      const projected = projectField(framing, roster);
      if (projected !== null) {
        originalLength += framing.length;
        projectedLength += projected.text.length;
        escalate(projected.mode);
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
