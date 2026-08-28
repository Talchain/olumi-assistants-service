/**
 * T1 claim safety — THE WIRE GATE. (ROADMAP 2.149.)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS CLOSES, live-confirmed 28 Jul and pinned by the estate's own
 * test as alarm-fires-only.
 *
 * `route-v2.ts` has a population of `sendFinalised200` call sites that GROWS.
 * The count is deliberately not written here: it said NINETEEN, was corrected to
 * TWENTY-ONE on 2026-08-17, and was TWENTY-TWO a day later. It is enumerated by
 * `__tests__/route-egress-analysis-state-freshness.drift.test.ts`; read that.
 * ALL BUT THE EXECUTE EXIT return BEFORE `runTurnExecutor`, so they
 * never pass through `finalizeRun`'s `enforceWithheldLeaderClaimGuard` (#755) —
 * which is a function nested inside `runTurnExecutor`, closed over run-local
 * state, and therefore not callable from the route at all. ⚠ The exact split is
 * a CONTROL-FLOW property and was NOT re-derived when the count was corrected;
 * the qualitative statement replaces the old numbers rather than a figure nobody
 * measured. Some of those exits can carry MODEL-AUTHORED text:
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
 * changed nothing, because that rail has no enforcing mode at all. The estate's
 * own test asserted exactly that — status 200, one alarm, `hit_count > 0`, and
 * NO assertion on the body. The harm was pinned, not fixed.
 *
 * ⚠ THIS SENTENCE USED TO READ "because `enforce: false` is the only mode
 * wired", which invited a reader to look for the flip. There was no flip to
 * find: that option gated no byte, and it was deleted in ROADMAP 2.1264. THIS
 * MODULE is the enforcement, and it is unconditional.
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
 *   destroyed a whole `run_analysis` receipt while trying to suppress its
 *   typed `FIRST_ANALYSIS_COMPLETE` leader nudge. The current gate removes that
 *   exact code-owned sentence when final permission is false, while preserving
 *   independently licensed analysis evidence and the surrounding receipt.
 *
 * The in-repo instruction is explicit (`leading-option-egress-guard.ts`, the
 * closing comment of `guardLeadingOptionClaimsAtEgress`): the drop *"must be
 * per-field, not whole-response — blanking an envelope at egress trades one
 * dishonest answer for no answer at all"*. This module is per-field AND
 * per-sentence, using the same splitter the model-INPUT gate uses
 * (`compose/redactable-units.ts`).
 *
 * PERMIT-WINS IS THE FIRST LINE, not an afterthought. A consistent final
 * `analysis_state` with `run_state.kind === 'complete_current'` and
 * `leader_claim.permitted === true` returns the input BY REFERENCE.
 * Over-suppression is a failure here, not a safe default: a blanket refusal at
 * these exits would suppress leader prose on every scenario that legitimately
 * permits it, which is a WORSE product defect than the one being fixed.
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
 *   DISTRIBUTED CLAIM. A claim can put the canonical NAME in one unit and the
 *   vocabulary in another: "Hire Marketing Manager is strong. It leads at
 *   72%." When no current analysis evidence is licensed, the field-level
 *   canonical-name anchor licenses removal of the vocabulary-bearing unit. In
 *   an evidence-only current state, however, the same shape can resemble
 *   recorded losing-option evidence ("Keep what we have ... It only comes out
 *   ahead in a tiny fraction"). Evidence-only deletion therefore requires name
 *   and designation in the same unit, or an exact canonical-joined comparison
 *   set from which this rail can build deterministic evidence-only copy. With
 *   neither, it stands down rather than inventing a referent.
 *
 * THE CRITERION THAT CLOSES BOTH. Enforcement needs TWO independent facts, and
 * neither alone is sufficient:
 *
 *   1. A CLAIM IS PRESENT — `textAssertsLeadingOption` at FIELD level (not unit
 *      level: a claim that straddles a sentence split must still count).
 *   2. A DESIGNATION IS POSSIBLE — the field NAMES one of the scenario's own
 *      options. Unstructured vocabulary with no option name cannot establish
 *      which option was designated, so it ships unchanged and the Layer-3
 *      alarm observes it. The exact code-owned FIRST_ANALYSIS_COMPLETE signal
 *      is the bounded exception: it asserts that a leader exists and is removed
 *      by exact identity rather than natural-language inference.
 *
 * Rule 2 is what spares the whole "sales leads" class, and it does NOT re-derive
 * "who is leading" (which would be a second authority beside the verdict —
 * CLAUDE.md trap #12). It derives only WHICH OPTIONS EXIST, from the graph the
 * exit is already shipping. Those are different questions.
 *
 * After surgery, cleanliness means no remaining designation in a strict
 * withheld state, and no remaining co-located name+designation in an
 * evidence-only state. A bare canonical option name may be a receipt or ordinary
 * evidence and survives. This is the corpus-derived correction: the prior
 * zero-name postcondition destroyed truthful qualified responses, while a
 * field-wide evidence-only pass destroyed a truthful losing-option explanation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ SCOPE — STATED, NOT IMPLIED. A chokepoint that claims to cover "the wire"
 * and quietly covers less is the guarantee-theatre class this programme hunts.
 *
 *   COVERED   `assistant_text` and `framing_question` — the two top-level
 *             unbounded prose surfaces — plus the typed `analysis_result`
 *             block. The structured block reuses the producer's existing
 *             withheld projection rather than maintaining a second key list.
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
 *     - Non-analysis block prose remains producer-owned. The typed
 *       `analysis_result` block is aligned here because final separation
 *       authority can be stricter than the fact's earlier constraint verdict.
 *     - `_reasoning`: verbatim, ruled to bypass the cage (ROADMAP 1.42).
 *     - SSE MID-STREAM frames: ship before `sendFinalised200` exists.
 *     - The three execute-intent receipts: EXECUTOR-side (`turn-executor.ts`).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { types as nodeUtilTypes } from 'node:util';

import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import type { FinalLeaderClaimEgressPolicy } from './analysis-state-v1.js';
import type { RawOptionComparisonSignal } from '../coaching/pick-raw-robustness.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';
import { COACHING_TEXT } from '../signals/coaching-signals.js';
import { textAssertsLeadingOption, textNamesLeadingOption } from './leading-option-egress-guard.js';
import { replaceAssertingUnits, splitIntoRedactableUnits } from './redactable-units.js';
import { WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL } from './withheld-explanation-answer.js';
import { sanitiseUserFacingText } from '../../orchestrator/shared/output-safety.js';
import { projectTransportEnrichmentForWithheldClaim } from './withheld-claim-projection.js';

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
const FIRST_ANALYSIS_COMPLETE_TEXT = COACHING_TEXT.FIRST_ANALYSIS_COMPLETE({});

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
export const WIRE_ENFORCED_STRUCTURED_FIELDS = ['analysis_result'] as const;
type WireEnforcedStructuredField = (typeof WIRE_ENFORCED_STRUCTURED_FIELDS)[number];
type WireEnforcedField = WireEnforcedProseField | WireEnforcedStructuredField;

/** How the designation was removed. Bounded — this is the telemetry cardinality. */
export type WireEnforcementMode =
  /** The normal path: only the vocabulary-bearing sentence(s) were replaced. */
  | 'surgical'
  /**
   * Defensive last resort. Field-level evidence entered the gate but no
   * redactable unit removed the residual designation (for example, vocabulary
   * straddled a soft-wrap boundary). Keeping it explicit makes that splitter
   * disagreement fail closed and observable.
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
 * consults an analysis fact. Designation permission still comes from one place:
 * the final composed `analysis_state.leader_claim`.
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
 * The scenario's OPTION ROSTER, read off the `analysis_ready` payload the exit
 * is already shipping — the FALLBACK source when no graph is in scope.
 *
 * ⭐ WHY THIS EXISTS. {@link optionRosterFromGraph} is the primary reader, and on
 * a graph-less exit it necessarily returns empty, which stands the gate down.
 * That is not a rare corner: `enforceLeadingOptionClaimsAtWire` has exactly ONE
 * call site (inside `sendFinalised200`), so the set of `sendFinalised200` exits
 * IS the population, and 17 of 23 of them pass a literal `graph: null`
 * (measured at `0d070df0` with the repo's own balanced-paren scan; a FLOOR, since
 * the remaining six pass nullable expressions). On every one of those the
 * withheld-leader claim shipped intact.
 *
 * ⚠ THIS IS NOT A SECOND VERDICT, and the distinction is the whole licence for
 * reading the payload here. It answers "which options exist" — never "which one
 * leads". `leader_claim.permitted` is untouched, and this module still refuses to
 * derive it (CLAUDE.md trap #12). Same rule as the graph reader it backs up.
 *
 * DELIBERATELY THE SAME NORMALISATION as {@link optionRosterFromGraph}: trimmed,
 * and dropped below {@link MIN_OPTION_LABEL_LENGTH}. Two roster readers that
 * disagreed about which labels count would be two authorities on "is this option
 * named", which is exactly the drift class this estate keeps paying for.
 */
export function optionRosterFromAnalysisReady(analysisReady: unknown): readonly string[] {
  const options = (analysisReady as { readonly options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(options)) return [];
  const roster: string[] = [];
  for (const raw of options) {
    const option = raw as { readonly label?: unknown } | null;
    if (option === null || typeof option !== 'object') continue;
    if (typeof option.label !== 'string') continue;
    const label = option.label.trim();
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
 * The only model-authored comparative form retained when the final authority
 * withholds a categorical designation.
 *
 * This is deliberately not another leader vocabulary. It recognises the data
 * side of the shared contract's data-vs-designation boundary: an exact
 * canonical option identity + label, the exact percentage rendered from the
 * final producer-attested `option_comparison[].win_probability`, and a
 * reason-appropriate disclosure in the SAME redactable unit. The matched span
 * is masked and the shared leader reader is run over the residual; any
 * additional categorical language therefore keeps the unit enforceable.
 *
 * A model-authored label or number can never self-license. Ambiguous/duplicate
 * identities, a mismatched label, an invented percentage, or a disclosure in a
 * neighbouring sentence all fail closed for the evidence carve-out.
 */
const QUALIFIED_NEAR_TIE_DISCLOSURE =
  /\b(?:(?:this|it|the (?:result|comparison|ranking|order)|the options?) (?:is|are|remain|remains) (?:still )?(?:a close call|effectively tied|too close|not settled|not yet robust|within (?:the )?model uncertainty)|the analysis treats (?:this|the (?:result|comparison)) as (?:a close call|effectively tied|too close)|there is no clear (?:winner|leader)|options? (?:do|does) not separate|(?:the )?(?:result|ranking|order|options?) could shift)\b/i;

const CONSTRAINT_WITHHELD_DISCLOSURE =
  /\b(?:(?:the )?constraint(?:s| verdict)? (?:withhold|withholds|do not license|does not license|prevent|prevents) (?:a |the )?(?:leader|leading option|recommendation)|(?:leader|leading option|recommendation) (?:is|remains) withheld (?:by|because of) (?:the )?constraints?)\b/i;

const SEPARATION_UNAVAILABLE_DISCLOSURE =
  /\b(?:(?:the )?analysis (?:did not|could not|has not) establish whether (?:the )?options? separate|option separation (?:was|is|remains) (?:not established|unavailable|unknown)|whether (?:the )?options? separate (?:was|is|remains) (?:not established|unavailable|unknown))\b/i;

const LICENSED_EVIDENCE_SENTINEL = '#';

interface CanonicalOptionIdentity {
  readonly id: string;
  readonly label: string;
}

interface AttestedComparison {
  readonly id: string;
  readonly label: string;
  readonly renderedPercent: number;
}

function exactNonEmptyIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return null;
  }
  return value;
}

function optionIdentitiesFromGraph(graph: unknown): readonly CanonicalOptionIdentity[] | null {
  const nodes = (graph as { readonly nodes?: unknown } | null | undefined)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const identities: CanonicalOptionIdentity[] = [];
  for (const raw of nodes) {
    if (raw == null || typeof raw !== 'object') continue;
    const node = raw as { readonly id?: unknown; readonly kind?: unknown; readonly label?: unknown };
    if (node.kind !== 'option') continue;
    const id = exactNonEmptyIdentity(node.id);
    const label = exactNonEmptyIdentity(node.label);
    if (id === null || label === null || label.length < MIN_OPTION_LABEL_LENGTH) return null;
    identities.push({ id, label });
  }
  return identities;
}

function optionIdentitiesFromAnalysisReady(
  analysisReady: unknown,
): readonly CanonicalOptionIdentity[] | null {
  const options = (analysisReady as { readonly options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(options)) return null;
  const identities: CanonicalOptionIdentity[] = [];
  for (const raw of options) {
    if (raw == null || typeof raw !== 'object') return null;
    const option = raw as {
      readonly option_id?: unknown;
      readonly id?: unknown;
      readonly label?: unknown;
    };
    const id = exactNonEmptyIdentity(option.option_id) ?? exactNonEmptyIdentity(option.id);
    const label = exactNonEmptyIdentity(option.label);
    if (id === null || label === null || label.length < MIN_OPTION_LABEL_LENGTH) return null;
    identities.push({ id, label });
  }
  return identities;
}

function uniqueOptionIdentities(
  identities: readonly CanonicalOptionIdentity[] | null,
): readonly CanonicalOptionIdentity[] | null {
  if (identities === null || identities.length === 0) return null;
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const identity of identities) {
    const foldedLabel = identity.label.toLocaleLowerCase('en-US');
    if (ids.has(identity.id) || labels.has(foldedLabel)) return null;
    ids.add(identity.id);
    labels.add(foldedLabel);
  }
  return identities;
}

function canonicalOptionIdentities(
  graph: unknown,
  analysisReady: unknown,
): readonly CanonicalOptionIdentity[] | null {
  const graphNodes = (graph as { readonly nodes?: unknown } | null | undefined)?.nodes;
  if (graph !== null && graph !== undefined) {
    // A present graph is the canonical identity source. If it is empty,
    // malformed or ambiguous, fail closed; a readiness payload must never
    // repair or overrule a present canonical graph for evidence licensing.
    if (!Array.isArray(graphNodes)) return null;
    return uniqueOptionIdentities(optionIdentitiesFromGraph(graph));
  }
  return uniqueOptionIdentities(optionIdentitiesFromAnalysisReady(analysisReady));
}

function readAttestedComparisons(
  response: OlumiResponse,
  graph: unknown,
  analysisReady: unknown,
  selectedFactComparisons: readonly RawOptionComparisonSignal[] | null | undefined,
): readonly AttestedComparison[] {
  // Evidence must be joined to the same fact that supplied final freshness.
  // A validated body is not enough: it can still be a projection of a
  // different run. Absence therefore withholds the carve-out rather than
  // treating arbitrary response bytes as producer authority.
  if (selectedFactComparisons == null || selectedFactComparisons.length === 0) return [];
  const identities = canonicalOptionIdentities(graph, analysisReady);
  if (identities === null) return [];
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));

  // The selected fact is sufficient authority for a blockless follow-up: the
  // turn may discuss the current analysis without re-shipping its structured
  // analysis_result block. Join every selected comparison to the current
  // canonical roster first; no model-authored label or number can self-license.
  const selectedAttested: AttestedComparison[] = [];
  const selectedIds = new Set<string>();
  for (const selected of selectedFactComparisons) {
    const id = exactNonEmptyIdentity(selected.option_id);
    const label = exactNonEmptyIdentity(selected.option_label);
    const canonical = id === null ? undefined : identityById.get(id);
    const probability = selected.win_probability;
    if (
      id === null ||
      label === null ||
      canonical === undefined ||
      canonical.label !== label ||
      selectedIds.has(id) ||
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    ) {
      return [];
    }
    selectedIds.add(id);
    selectedAttested.push({ id, label, renderedPercent: Math.round(probability * 100) });
  }

  const blocks = (response as { readonly blocks?: unknown }).blocks;
  if (!Array.isArray(blocks)) return [];
  const analysisBlocks = blocks.filter(
    (block) =>
      block !== null &&
      typeof block === 'object' &&
      (block as { readonly type?: unknown }).type === 'analysis_result',
  );
  // A blockless follow-up uses the exact canonical-joined selected fact above.
  // A present block is an additional claim surface and must agree exactly;
  // multiple blocks are ambiguous and fail weak.
  if (analysisBlocks.length === 0) return selectedAttested;
  if (analysisBlocks.length !== 1) return [];
  const enrichment = (analysisBlocks[0] as { readonly enrichment?: unknown }).enrichment;
  if (enrichment === null || typeof enrichment !== 'object') return [];
  const enrichmentRecord = enrichment as Record<string, unknown>;
  // A present analysis block is itself a claim surface. Its feature-level
  // status must therefore be independently recommendable before its scalar
  // rows can corroborate the selected canonical fact. Exact numbers cannot
  // rehabilitate an explicitly failed/skipped comparison computation.
  if (
    !isRecommendableOption({
      status: enrichmentRecord['option_comparison_status'],
    })
  ) {
    return [];
  }
  const comparison = enrichmentRecord['option_comparison'];
  if (!Array.isArray(comparison) || comparison.length === 0) return [];
  if (comparison.length !== selectedFactComparisons.length) return [];

  const attested: AttestedComparison[] = [];
  const seenIds = new Set<string>();
  for (const [index, raw] of comparison.entries()) {
    if (raw === null || typeof raw !== 'object') return [];
    const row = raw as {
      readonly option_id?: unknown;
      readonly option_label?: unknown;
      readonly win_probability?: unknown;
      readonly status?: unknown;
    };
    const id = exactNonEmptyIdentity(row.option_id);
    const label = exactNonEmptyIdentity(row.option_label);
    const probability = row.win_probability;
    const selected = selectedFactComparisons[index];
    const canonical = id === null ? undefined : identityById.get(id);
    if (
      id === null ||
      label === null ||
      !isRecommendableOption(row as Record<string, unknown>) ||
      canonical === undefined ||
      canonical.label !== label ||
      seenIds.has(id) ||
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1 ||
      selected === undefined ||
      selected.option_id !== id ||
      selected.option_label !== label ||
      selected.win_probability !== probability
    ) {
      return [];
    }
    seenIds.add(id);
    attested.push({ id, label, renderedPercent: Math.round(probability * 100) });
  }
  return attested;
}

function disclosureForPolicy(policy: FinalLeaderClaimEgressPolicy): RegExp | null {
  switch (policy) {
    case 'evidence_only_options_do_not_separate':
      return QUALIFIED_NEAR_TIE_DISCLOSURE;
    case 'evidence_only_constraint_verdict_withheld':
      return CONSTRAINT_WITHHELD_DISCLOSURE;
    case 'evidence_only_separation_unavailable':
      return SEPARATION_UNAVAILABLE_DISCLOSURE;
    default:
      return null;
  }
}

/**
 * Deterministic evidence-only replacement for an unstructured field whose
 * option identity and leader vocabulary are split across redactable units.
 *
 * The wire gate must not guess whether a pronoun in a later sentence refers to
 * the named option. When the exact freshness-selected comparison set has
 * already joined the canonical roster, however, it can preserve those typed
 * measurements without preserving the ambiguous model prose. This is not a
 * second analytical authority: ordering, labels and values all come from the
 * selected producer fact, and the final policy supplies only its already-
 * composed disclosure.
 */
function deterministicEvidenceSummary(
  policy: FinalLeaderClaimEgressPolicy,
  attested: readonly AttestedComparison[],
): string | null {
  if (attested.length === 0) return null;
  const measurements = attested
    .map(
      ({ label, renderedPercent }) =>
        `${label} came out ahead in ${renderedPercent}% of runs of this model`,
    )
    .join('; ');
  switch (policy) {
    case 'evidence_only_options_do_not_separate':
      return `${measurements}. The options do not separate.`;
    case 'evidence_only_constraint_verdict_withheld':
      return `${measurements}. The constraint verdict withholds a leading option.`;
    case 'evidence_only_separation_unavailable':
      return `${measurements}. The analysis did not establish whether the options separate.`;
    default:
      return null;
  }
}

function hasAffirmativeTerminalDisclosure(
  unit: string,
  measuredComparisonEnd: number,
  disclosure: RegExp,
): boolean {
  const tail = unit.slice(measuredComparisonEnd);
  const match = disclosure.exec(tail);
  if (match === null || match.index === undefined) return false;
  const prefix = tail.slice(0, match.index);
  // The disclosure must be the direct conjunct following the exact measured
  // comparison. Arbitrary prose before it can negate/retract the apparent
  // caveat ("but it is not true that this is a close call").
  if (
    !/^\s*(?:[,;:\u2014-]\s*)?(?:(?:but|while|although|and|yet|because)\s+)?$/iu.test(
      prefix,
    )
  ) {
    return false;
  }
  const suffix = tail.slice(match.index + match[0].length).trim();
  // A question or any trailing clause can retract/qualify the apparent
  // disclosure ("close call? No", "close call, incorrectly"). Only an
  // affirmative terminal statement licenses the evidence carve-out.
  return suffix.length === 0 || /^[.!]+$/u.test(suffix);
}

function maskAttestedEvidence(
  value: string,
  policy: FinalLeaderClaimEgressPolicy,
  attested: readonly AttestedComparison[],
): string {
  const disclosure = disclosureForPolicy(policy);
  if (disclosure === null || attested.length === 0) return value;
  let changed = false;
  const masked = splitIntoRedactableUnits(value).map((unit) => {
    let next = unit;
    let unitChanged = false;
    for (const evidence of attested) {
      const labelPattern = escapeForRegExp(evidence.label).replace(/\s+/g, '\\s+');
      const measuredComparison = new RegExp(
        `(?<![\\p{L}\\p{N}_])${labelPattern}(?![\\p{L}\\p{N}_])` +
          `\\s+(?:came|comes?)\\s+out\\s+ahead\\s+in\\s+${evidence.renderedPercent}%` +
          `\\s+of\\s+(?:runs|simulations)(?:\\s+of\\s+this\\s+model)?`,
        'giu',
      );
      const measuredMatch = measuredComparison.exec(unit);
      if (
        measuredMatch === null ||
        measuredMatch.index === undefined ||
        !hasAffirmativeTerminalDisclosure(
          unit,
          measuredMatch.index + measuredMatch[0].length,
          disclosure,
        )
      ) {
        continue;
      }
      const replaced = next.replace(measuredComparison, LICENSED_EVIDENCE_SENTINEL);
      if (replaced !== next) unitChanged = true;
      next = replaced;
    }
    if (unitChanged) {
      changed = true;
      // The caveat is part of the licensed evidence unit. Mask it for the
      // designation reader as well: phrases such as “no clear leader” and “the
      // constraint verdict withholds a leading option” contain the shared
      // vocabulary but assert the opposite of a designation. The output bytes
      // are untouched; this is only the residual inspected by the guard.
      next = next.replace(disclosure, LICENSED_EVIDENCE_SENTINEL);
    }
    return next;
  });
  return changed ? masked.join('') : value;
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
   * The response's final answer to "may a categorical leading option be
   * designated", read from the final composed `analysis_state` at
   * `sendFinalised200` and never re-derived here (CLAUDE.md trap #12).
   * `designation_permitted` ⇒ a by-reference no-op. Evidence-only policies
   * permit exact producer-attested comparisons with a truthful same-unit caveat
   * or deterministic copy from the exact selected comparison set; they never
   * permit categorical designation.
   */
  readonly leaderClaimPolicy: FinalLeaderClaimEgressPolicy;
  /**
   * The authoritative reasoning/dispatch graph selected at the route's final
   * egress seam, read ONLY for the option ROSTER — see
   * {@link optionRosterFromGraph} for why that is not a second derivation of
   * the verdict.
   *
   * Typed `unknown` on purpose: this module lives in `compose/` and must not
   * take a dependency on the route's `GraphV3T` alias to read two fields
   * defensively.
   *
   * A null graph may use the response's readiness roster below. A PRESENT
   * graph is authoritative even when malformed, ambiguous or empty: readiness
   * must not repair it, because that would let a stale projection decide which
   * option name to delete. Such a present-but-unusable graph stands down loudly
   * (`mode: 'roster_unavailable'`).
   *
   * It is the same epistemic position as "no option name in the field": we
   * cannot establish that a designation is present, so we do not delete the
   * user's prose. The Layer-3 alarm still reports the leak.
   */
  readonly graph: unknown;
  /**
   * The `analysis_ready` payload this exit is shipping (`ctx.analysisReady`),
   * read ONLY for the option ROSTER when {@link graph} is absent — see
   * {@link optionRosterFromAnalysisReady}.
   *
   * A graph-less exit that carries readiness can therefore still enforce. A
   * present graph never falls through to this secondary source.
   *
   * Optional, and absence is honest: an exit carrying NEITHER a graph NOR a
   * readiness payload still stands down (`mode: 'roster_unavailable'`), because
   * the epistemic position is unchanged — we cannot establish that a designation
   * is present, so we do not delete the user's prose.
   */
  readonly analysisReady?: unknown;
  /**
   * Exact option comparisons from the SAME run-analysis fact selected by final
   * freshness. Required for the numerical-evidence carve-out; absence, or any
   * disagreement in a present analysis-result body, fails weak to no evidence
   * licence. A blockless follow-up can use the selected fact alone.
   */
  readonly selectedFactComparisons?: readonly RawOptionComparisonSignal[] | null;
}

export interface WireLeaderClaimEnforcementResult {
  /** The projected response, or the INPUT REFERENCE when nothing was edited. */
  readonly response: OlumiResponse;
  /** True only when at least one field's bytes changed. */
  readonly changed: boolean;
  /** Which covered fields were edited. Both sets are closed, exported contracts. */
  readonly editedFields: readonly WireEnforcedField[];
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
 * "Claim present" and "canonical name present" are read at FIELD level. Strict
 * withheld states then remove every designation-bearing unit. Evidence-only
 * states remove only units where canonical identity and designation co-occur.
 * If identity and designation are distributed across units, the gate never
 * invents a pronoun referent: it replaces the field only when exact selected-
 * fact comparisons can produce a deterministic evidence-only summary.
 *
 * ⭐ THE POST-CHECK, and why the residual is re-read at all. Removing the
 * vocabulary unit can leave a distributed claim behind. So after each pass the
 * residual must assert no unlicensed designation. A bare option name is NOT
 * contamination: it may be a receipt, a losing-option comparison, or ordinary
 * model evidence. Requiring zero names here was the corpus-proven
 * over-suppression defect.
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
  policy: FinalLeaderClaimEgressPolicy,
  attested: readonly AttestedComparison[],
): { text: string; mode: WireEnforcementMode } | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const withoutLicensedEvidence = (candidate: string): string =>
    maskAttestedEvidence(candidate, policy, attested);
  const assertsUnlicensedDesignation = (candidate: string): boolean =>
    textAssertsLeadingOption(withoutLicensedEvidence(candidate));
  const isEvidenceOnly = policy.startsWith('evidence_only_');
  const shouldRemoveUnit = (unit: string): boolean =>
    assertsUnlicensedDesignation(unit) &&
    // Identity is established from the ORIGINAL unit. Masking the measured
    // comparison removes its canonical label as well as its numbers; reading
    // identity from that masked residual would let a same-unit pronoun claim
    // piggyback on licensed evidence ("...close call; it still leads").
    (!isEvidenceOnly || textNamesAnOption(unit, roster));
  // (1) A CLAIM IS PRESENT — field level, so distributed and wrapped claims
  //     cannot evade the deleting arm merely by splitting name from vocabulary.
  if (!assertsUnlicensedDesignation(value)) return null;
  // (2) A DESIGNATION IS POSSIBLE — the field names one of this scenario's own
  //     options. Vocabulary with no name designates nobody.
  if (!textNamesAnOption(value, roster)) return null;
  // (3) Evidence-only turns preserve distributed evidence without preserving
  //     an ambiguous distributed designation. If no single unit proves
  //     identity + designation, use the exact selected-fact comparison set as
  //     a typed fallback. With no such authority, stand down and let the alarm
  //     retain the residue for producer repair rather than guessing.
  if (isEvidenceOnly && !splitIntoRedactableUnits(value).some(shouldRemoveUnit)) {
    const fallback = deterministicEvidenceSummary(policy, attested);
    return fallback === null ? null : { text: fallback, mode: 'whole_field' };
  }
  const isClean = (candidate: string): boolean =>
    isEvidenceOnly
      ? !splitIntoRedactableUnits(candidate).some(shouldRemoveUnit)
      : !assertsUnlicensedDesignation(candidate);

  const surgical = replaceAssertingUnits(
    value,
    shouldRemoveUnit,
    WIRE_WITHHELD_LEADER_REPLACEMENT,
  );
  if (isClean(surgical)) return { text: surgical, mode: 'surgical' };

  // Defensive only: if the field-level reader still sees a designation after
  // surgery, do not ship the unresolved field.
  return { text: WIRE_WITHHELD_LEADER_REPLACEMENT, mode: 'whole_field' };
}

/**
 * Align the structured analysis block with the same final designation policy.
 * `leading_option_id` is nulled, and the existing producer-owned withheld
 * projection removes leader-designating members from nested enrichment while
 * retaining independent numerical evidence. The block summary uses the same
 * evidence-preserving projector as the user-facing fields; without a usable
 * roster, only an unambiguous leader assertion is replaced.
 */
function projectAnalysisResultBlocks(
  response: OlumiResponse,
  roster: readonly string[],
  policy: FinalLeaderClaimEgressPolicy,
  attested: readonly AttestedComparison[],
): OlumiResponse | null {
  if (!Array.isArray(response.blocks) || response.blocks.length === 0) return null;
  let changed = false;
  const blocks = response.blocks.map((block) => {
    if (block.type !== 'analysis_result') return block;
    let projected = block;
    if (block.leading_option_id !== null && block.leading_option_id !== undefined) {
      projected = { ...projected, leading_option_id: null };
      changed = true;
    }
    if (block.enrichment !== undefined) {
      let projectedEnrichment: Record<string, unknown> | undefined;
      try {
        // Snapshot permissive input exactly once into inert enumerable data.
        // The projector and equality check then operate only on this snapshot,
        // never on a potentially stateful Proxy/getter/toJSON object.
        const enrichmentSnapshot = snapshotEnumerableData(
          block.enrichment,
        );
        projectedEnrichment = projectTransportEnrichmentForWithheldClaim(
          enrichmentSnapshot.value as Record<string, unknown>,
        );
        if (
          !enrichmentSnapshot.untrustedIdentity &&
          sameProjectionData(projectedEnrichment, enrichmentSnapshot.value)
        ) {
          projectedEnrichment = block.enrichment as Record<string, unknown>;
        }
      } catch {
        // A hostile permissive subtree must not make the entire final authority
        // fail open. Omit this optional enrichment while still nulling the typed
        // designation and projecting the summary.
        projectedEnrichment = undefined;
      }
      // A stateful Proxy can present harmless keys to one inspection and reveal
      // a designation during later JSON serialisation, so its inert projection
      // is always installed. Ordinary plain data whose projection is unchanged
      // retains exact response identity. Permit-wins remains the first-line
      // no-op for all input classes.
      const { enrichment: _removed, ...withoutEnrichment } = projected;
      if (projectedEnrichment !== block.enrichment) {
        projected =
          projectedEnrichment === undefined
            ? withoutEnrichment
            : { ...withoutEnrichment, enrichment: projectedEnrichment };
        changed = true;
      }
    }
    if (typeof block.summary === 'string' && block.summary.length > 0) {
      const summaryProjection =
        roster.length > 0
          ? projectField(block.summary, roster, policy, attested)
          : textAssertsLeadingOption(block.summary)
            ? { text: WIRE_WITHHELD_LEADER_REPLACEMENT, mode: 'whole_field' as const }
            : null;
      if (summaryProjection !== null && summaryProjection.text !== block.summary) {
        projected = { ...projected, summary: summaryProjection.text };
        changed = true;
      }
    }
    return projected;
  });
  return changed ? { ...response, blocks } : null;
}

/**
 * Copy enumerable JSON-like data without invoking accessors or user hooks.
 * Cycles, functions, symbols, BigInt, exotic prototypes and accessors are not
 * safe optional enrichment at the final authority boundary and make the
 * caller omit the subtree. `Object.getOwnPropertyDescriptors` is deliberately
 * the sole own-key inspection of an input object; stateful Proxies cannot make
 * a later comparison fail open because comparisons see only the plain copy.
 */
interface EnumerableDataSnapshot {
  readonly value: unknown;
  readonly untrustedIdentity: boolean;
}

function snapshotEnumerableData(
  value: unknown,
  ancestors = new WeakSet<object>(),
): EnumerableDataSnapshot {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return { value, untrustedIdentity: false };
  }
  if (typeof value !== 'object') throw new TypeError('non_data_value');
  if (ancestors.has(value)) throw new TypeError('cyclic_value');
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== null &&
    prototype !== Array.prototype
  ) {
    throw new TypeError('exotic_prototype');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownToJson = descriptors['toJSON'];
  if (ownToJson !== undefined) throw new TypeError('custom_to_json');
  ancestors.add(value);
  try {
    let untrustedIdentity = nodeUtilTypes.isProxy(value);
    const out: Record<string, unknown> | unknown[] = Array.isArray(value)
      ? []
      : Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string') {
        if (descriptors[key]?.enumerable === true) throw new TypeError('symbol_key');
        continue;
      }
      const descriptor = descriptors[key];
      if (descriptor?.enumerable !== true) continue;
      if (!('value' in descriptor)) throw new TypeError('accessor_value');
      const nested = snapshotEnumerableData(descriptor.value, ancestors);
      untrustedIdentity ||= nested.untrustedIdentity;
      Object.defineProperty(out, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: nested.value,
      });
    }
    return { value: out, untrustedIdentity };
  } finally {
    ancestors.delete(value);
  }
}

/** Compare only inert snapshots/projector output; never call this on wire input. */
function sameProjectionData(
  left: unknown,
  right: unknown,
  seen = new WeakMap<object, object>(),
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) !== Array.isArray(right)
  ) {
    return false;
  }
  const prior = seen.get(left);
  if (prior !== undefined) return prior === right;
  seen.set(left, right);
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]!;
    if (rightKeys[index] !== key) return false;
    if (
      !sameProjectionData(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        seen,
      )
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Pre-commit companion to the route chokepoint. It resolves raw entity ids in
 * exactly the fields the leader projector reads, then applies the same final
 * policy. This keeps durable conversation rows from retaining a designation
 * the eventual wire removes, without running the full egress pipeline early.
 */
export function projectLeaderClaimForDurableCommit(
  response: OlumiResponse,
  opts: WireLeaderClaimEnforcementOpts,
): WireLeaderClaimEnforcementResult {
  const label = (value: string): string =>
    sanitiseUserFacingText(value, opts.graph as never).text;
  const labelledBlocks = response.blocks.map((block) =>
    block.type === 'analysis_result' && typeof block.summary === 'string'
      ? { ...block, summary: label(block.summary) }
      : block,
  );
  const labelled: OlumiResponse = {
    ...response,
    assistant_text: label(response.assistant_text),
    ...(typeof response.framing_question === 'string'
      ? { framing_question: label(response.framing_question) }
      : {}),
    blocks: labelledBlocks,
  };
  return enforceLeadingOptionClaimsAtWire(labelled, opts);
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
  if (opts.leaderClaimPolicy === 'designation_permitted') return unchanged(response);

  try {
    // This is a typed, code-owned coaching signal, so its exact bytes can be
    // removed without guessing at natural language. Unlike ordinary generic
    // vocabulary, it affirmatively tells the user that a leading option
    // exists. Final `permitted=false` therefore suppresses it even though it
    // names no roster option. The source constant is imported directly so a
    // copy change and its enforcement cannot drift apart.
    const typedSignalProjection = (value: string): string =>
      value.includes(FIRST_ANALYSIS_COMPLETE_TEXT)
        ? value.replaceAll(FIRST_ANALYSIS_COMPLETE_TEXT, WIRE_WITHHELD_LEADER_REPLACEMENT)
        : value;
    let next = response;
    const editedFields = new Set<WireEnforcedField>();
    const projectedAnswer = typedSignalProjection(response.assistant_text);
    if (projectedAnswer !== response.assistant_text) {
      editedFields.add('assistant_text');
      next = { ...next, assistant_text: projectedAnswer };
    }
    if (typeof response.framing_question === 'string') {
      const projectedFraming = typedSignalProjection(response.framing_question);
      if (projectedFraming !== response.framing_question) {
        editedFields.add('framing_question');
        next = { ...next, framing_question: projectedFraming };
      }
    }

    // PRESENT GRAPH OR ABSENT GRAPH — never "graph yielded nothing, so repair it
    // from readiness". A present graph is the canonical roster authority even
    // when it is empty/malformed/ambiguous; falling through would let a stale
    // readiness projection delete prose about identities the graph does not
    // establish. Neither source supplies a verdict — both answer only "which
    // options exist".
    const graphRoster = optionRosterFromGraph(opts.graph);
    const roster =
      opts.graph === null || opts.graph === undefined
        ? optionRosterFromAnalysisReady(opts.analysisReady)
        : graphRoster;
    const attestedComparisons = readAttestedComparisons(
      next,
      opts.graph,
      opts.analysisReady,
      opts.selectedFactComparisons,
    );
    const projectedBlocks = projectAnalysisResultBlocks(
      next,
      roster,
      opts.leaderClaimPolicy,
      attestedComparisons,
    );
    if (projectedBlocks !== null) {
      editedFields.add('analysis_result');
      next = projectedBlocks;
    }
    const lengthFor = (body: OlumiResponse, field: WireEnforcedField): number => {
      if (field === 'assistant_text') return body.assistant_text.length;
      if (field === 'framing_question') return body.framing_question?.length ?? 0;
      try {
        return JSON.stringify(
          body.blocks.filter((block) => block.type === 'analysis_result'),
        ).length;
      } catch {
        return 0;
      }
    };

    if (roster.length === 0) {
      // STAND DOWN, LOUDLY, for free response prose. Structured analysis
      // designations above remain enforceable from their own typed fields even
      // without a roster; arbitrary assistant prose does not.
      const couldHaveMattered =
        textAssertsLeadingOption(next.assistant_text) ||
        (typeof next.framing_question === 'string' &&
          textAssertsLeadingOption(next.framing_question));
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
      if (editedFields.size === 0) return unchanged(response);
      const fields = [...editedFields].sort();
      emit(TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire, {
        request_id: opts.requestId,
        exit_path: opts.exitPath,
        edited_fields: fields.join(','),
        mode: 'surgical',
        original_length: fields.reduce((sum, field) => sum + lengthFor(response, field), 0),
        projected_length: fields.reduce((sum, field) => sum + lengthFor(next, field), 0),
      });
      return { response: next, changed: true, editedFields: fields };
    }

    // The LOUDEST mode wins the report. A field edited surgically must never
    // mask a sibling field that needed the defensive last resort.
    let modes: WireEnforcementMode = 'surgical';
    const escalate = (mode: WireEnforcementMode): void => {
      if (mode === 'whole_field') modes = 'whole_field';
    };
    const answer = projectField(
      next.assistant_text,
      roster,
      opts.leaderClaimPolicy,
      attestedComparisons,
    );
    if (answer !== null) {
      escalate(answer.mode);
      editedFields.add('assistant_text');
      next = { ...next, assistant_text: answer.text };
    }

    const framing = next.framing_question;
    if (typeof framing === 'string') {
      const projected = projectField(
        framing,
        roster,
        opts.leaderClaimPolicy,
        attestedComparisons,
      );
      if (projected !== null) {
        escalate(projected.mode);
        editedFields.add('framing_question');
        next = { ...next, framing_question: projected.text };
      }
    }

    if (editedFields.size === 0) return unchanged(response);
    const fields = [...editedFields].sort();

    emit(TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire, {
      request_id: opts.requestId,
      exit_path: opts.exitPath,
      // Bounded field names and a bounded mode. LENGTHS only, never the matched
      // prose: this is the claim-safety boundary and the prose is the user's own
      // decision content.
      edited_fields: fields.join(','),
      mode: modes,
      original_length: fields.reduce((sum, field) => sum + lengthFor(response, field), 0),
      projected_length: fields.reduce((sum, field) => sum + lengthFor(next, field), 0),
    });

    return { response: next, changed: true, editedFields: fields };
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
