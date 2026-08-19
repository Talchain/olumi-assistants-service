/**
 * ⭐⭐ ROADMAP 2.1266 — THE OPTION-EFFECT WRITE PATH.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT — the product advises a sentence it cannot execute (P8).
 *
 * Reproduced on deployed `293da07`. The repair copy says, verbatim:
 *
 *   "Tell me what it changes, like this: Set the Open Leeds location next
 *    quarter as planned option's effect on Capital expenditure … to 0.6"
 *
 * Send exactly that and the reply is "…still has no effect value…", with
 * nothing written. **No wire verb on the build can set an option's effect
 * value at all.** None of the nine `system_event` types carries option
 * interventions (`factor_value_edit` moves a FACTOR's
 * `observed_state.value` — a different entity), and the conversational
 * `edit_graph` path depends on the edit LLM emitting the sanctioned
 * `update_node` at `/nodes/<opt>/data/interventions/<factor_id>`. When it
 * emits a factor-baseline `parameter_update` instead — the wire-witnessed
 * J4 t5 shape — #1016's write guard correctly WITHHOLDS, and the loop the
 * `configure-option-chip-text.ts` advised format was written to end stays
 * open.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS, AND WHAT IT REFUSES TO BE.
 *
 * It is a RESOLVER, not a parser. It adds NO new natural-language predicate:
 * intent comes from the shipped `detectConfigureOptionIntent` classifier, and
 * identity comes from exact, word-bounded label matching against the
 * PERSISTED graph through `phraseOccurrences` — the same boundary rule
 * `containsPhrase` applies (and is now derived from), so this resolver and
 * `configure-option-intent.ts` / `configure-option-clarify.ts` can never
 * disagree about what counts as a match. Four
 * rounds of open-ended predicate tuning oscillated on a neighbouring seam
 * (CLAUDE.md trap 22f); the exit named there is to make the ambiguity the
 * product, which is what `kind: 'ask'` below does.
 *
 * ⭐ IT CLAIMS ONLY WHAT THE EDIT LANE WOULD OTHERWISE HAVE TAKEN. The single
 * call site sits inside route-v2's `isEditGraphShape` block, so every gate
 * that already decides "this turn goes to the edit lane" still decides it.
 * The blast radius is exactly: turns the edit LLM would have been asked to
 * perform, and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE BINDING PREDICATE, stated once, in full (trap 19 — identity, never a
 * value predicate another entity could satisfy):
 *
 *   1. `detectConfigureOptionIntent` matched with an EFFECT-FRAMED trigger —
 *      `effect_vocab`, `intervention_vocab` or `configure_vocab`.
 *      ⚠ `option_value_set` is EXCLUDED, and that exclusion IS acceptance
 *      criterion 3. It is the trigger the W1 ambiguity class lands on: *"For
 *      the <option> option, our <factor> assumption is stale — change the
 *      <factor> baseline to 0.3"* names an option, names a factor the option
 *      is wired to, and carries a value, yet asks for a FACTOR BASELINE.
 *      At the graph that shape and the witnessed wrong-entity write are
 *      indistinguishable (see `option-intervention-write-guard.ts`'s header);
 *      the honest move is not to claim it. `chip_prefix` is likewise excluded
 *      — the bare configure chip carries no value and `L16`'s intercept owns
 *      it.
 *   2. The message carries EXACTLY ONE plain-number value assignment on the
 *      0–1 scale (`readOptionEffectValue`). A currency symbol, a `%`, an
 *      attached unit, a thousands separator or a second assignment all
 *      DECLINE — this writer performs no unit conversion and no cap
 *      normalisation, so it may only write a value that is already in the
 *      model's own units. The prompt block that generates the advised format
 *      states the scale (`src/prompts/edit-graph-v6.ts`: "effect values are
 *      on the 0-1 scale") — P7: derived from the PRODUCER's instruction, not
 *      from a corpus.
 *   3. EXACTLY ONE option node's label appears in the message, word-bounded —
 *      OR, when NO option label appears at all, the option is resolved from
 *      THE PRODUCT'S OWN OUTSTANDING ASK (rule 3b below).
 *   4. EXACTLY ONE of THAT OPTION'S LINKED factors' labels appears in the
 *      message, word-bounded. "Linked" reads `edge.from === optionId` and
 *      `kind === 'factor'` — byte-identical to `collectCandidateFactorLabels`
 *      in `configure-option-clarify.ts`, the shipped reader whose labels
 *      become the recovery copy, so the writer and the copy can never
 *      disagree about which factors belong to the option (trap 12).
 *
 * TWO or more candidates on (3) or (4) → `ask`. Anything else → decline, and
 * a decline is byte-identical to today: the edit LLM gets the turn exactly as
 * it does now, #1016 still guards its output.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ RULE 3b — WHEN THE USER CANNOT TYPE THE OPTION'S LABEL, THE PRODUCT'S
 * OWN OUTSTANDING ASK RESOLVES IT. (Added after the 18 Aug 2026 composed
 * model-compiler journey witness, `585f8dce` / UI `dd089a50`.)
 *
 * WHAT WAS WITNESSED, on the deployed product, driven as a fresh guest. Olumi
 * asked, on screen:
 *
 *   "Next, choose the missing effect value for "double down on enterprise
 *    sales (higher…" on "Sales Headcount - Hybrid Maintained" so the
 *    comparison can be prepared."
 *
 * The user answered it (turn 5, verbatim): *"I meant the option's effect. For
 * the enterprise sales option, set Sales Headcount - Hybrid Maintained to
 * 0.8."* — effect-framed, one 0–1 value, the factor named IN FULL, exactly as
 * asked. **This resolver declined `option_not_named`**, the turn fell to the
 * edit LLM, and a FACTOR BASELINE was written instead: `interventions` stayed
 * `0` on all four options, the `MISSING_OPTION_VALUE` blocker survived BY
 * IDENTITY (`4abad64d` × `4d3256b4`), and the only thing that moved was the
 * fabricated constant in the blocker copy, `0.5` → `0.8`.
 *
 * ⚠⚠ THE ROOT CAUSE IS NOT THIS MODULE ALONE — IT IS ONE READER SHARED BY
 * THREE SURFACES, AND IT WAS MEASURED, NOT REASONED ABOUT. Every path that
 * needs to know WHICH OPTION the user means resolves it by requiring the
 * option's FULL label word-bounded in the message. On the witnessed graph the
 * drafter had minted 84- and 101-character option labels (they ARE the user's
 * own brief fragments), and the product renders them TRUNCATED
 * (*"double down on enterprise sales (higher…"*). So on that turn:
 *
 *   this resolver                         → `option_not_named`   (no write)
 *   `configure-option-clarify.ts`'s
 *     `buildConfigureOptionRecoveryCopy`  → `option_not_identified` (no copy)
 *   `configure-option-outcome.ts`, and
 *     through it #1016's write guard      → skip → **allow** the wrong entity
 *
 * — three guards, one blind spot, and the product asks a question whose answer
 * it structurally cannot accept (P8). Reproduced at pristine `b5f9aa2e`
 * against the captured identities; see `__tests__/option-effect-write.test.ts`
 * block `W5`.
 *
 * THE RULE, and why it cannot become the defect it removes. When the message
 * names NO option label at all, the option is taken from
 * `deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(graph))` —
 * the estate's ONE OWNER of *"which option × factor pairs is the product
 * currently saying it has no value for"* (`repair-value-binding.ts`), and the
 * SAME payload the blocker sentence the user is answering was composed from.
 * Three conjuncts, each load-bearing:
 *
 *   (a) NO option label matched. A message that names an option in full is
 *       untouched by this rule — it takes path (3) exactly as before.
 *   (b) EXACTLY ONE factor is named, word-bounded, AND that factor is one the
 *       product is CURRENTLY ASKING ABOUT. Factors outside the outstanding ask
 *       are not candidates, so this rule can only ever bind a pair the product
 *       itself put on screen. It cannot reach a pair nobody asked about.
 *   (c) EXACTLY ONE outstanding pair carries that factor. Two or more → `ask`,
 *       with one chip per candidate carrying the full-label advised format.
 *       The ambiguity becomes the product (trap 22f); it is never guessed.
 *
 * ⚠ WHAT IT STILL CANNOT DO, stated rather than papered over (trap 22's
 * limit). If the user means an option that is NOT in the outstanding set for
 * the factor they named — *"For the hybrid option, set <factor> to 0.8"*,
 * where only the enterprise option is outstanding on that factor — this rule
 * binds the outstanding one. That is a bounded residual, not a silent one:
 * `formatOptionEffectWriteAck` names the option it wrote BY LABEL, so the user
 * reads which entity moved. The witnessed defect had the opposite shape — a
 * wrong entity written while the reply said nothing had changed. Pinned as
 * `OPTION_EFFECT_WRITE_ASK_RESOLVED_LIMIT`.
 *
 * ⚠ NOT WIDENED, DELIBERATELY: the effect-framed trigger set, the
 * `option_value_set` / `chip_prefix` exclusions, the `baseline` suppressor and
 * the 0–1 single-value grammar are ALL untouched. This rule changes only how
 * an option's IDENTITY is resolved once every one of those gates has already
 * said yes. The W1 class (*"…change the <factor> baseline to 0.3"*) is still
 * suppressed on the word "baseline" and is still in
 * `OPTION_EFFECT_WRITE_KNOWN_DROPPED`; so is the witnessed turn 6, which
 * carries that word. A genuine factor-baseline edit ("Set <factor> to 0.3")
 * never reaches this module at all — `detectConfigureOptionIntent` does not
 * match it — and its twin is pinned.
 *
 * ⚠ THE `baseline` SUPPRESSOR — a CLOSED single-token narrowing, not a
 * predicate. A message containing the word "baseline" is never claimed, even
 * when effect-framed. In this product's vocabulary "baseline" names a
 * factor's own observed value — a different entity from an option's effect on
 * it — and a sentence carrying both framings is exactly the ambiguity this
 * module must not resolve by guessing. It can only ever narrow the claim
 * (the turn falls through to today's route), and it is pinned by
 * `OPTION_EFFECT_WRITE_KNOWN_DROPPED`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OPERATION IS THE PRODUCER'S OWN VOCABULARY, NOT A SECOND SPELLING.
 *
 * `buildOptionEffectRawOperation` emits the served edit prompt's EXAMPLE 2
 * shape verbatim (`src/prompts/edit-graph-v6.ts` — `update_node` at
 * `/nodes/<opt>/data/interventions/<factor_id>`, object leaf, `old_value:
 * null`). The caller canonicalises it through `parseEditGraphResponse`, the
 * SAME parser the LLM's output goes through, and hands the result to
 * `handleEditGraph`'s `preComposedOperations` — the estate's ONE ENTRY SEAM,
 * ONE APPLIER (ROADMAP 2.474 / A1). Normalisation, the field-safety screen,
 * Zod, the referee gate, the intervention encoder, apply, the commit and the
 * receipt are the same code on both paths, so this writer cannot acquire a
 * power the LLM path does not have — and #1016's guard still runs over the
 * before/after graphs afterwards (it returns `interventions_write_landed`
 * → allow, because an effect value genuinely did land).
 *
 * ⚠ THE ACKNOWLEDGEMENT IS NOT COMPOSED HERE (P5). `formatOptionEffectWriteAck`
 * takes the value the CALLER READ BACK OUT OF THE APPLIED GRAPH, not the value
 * this module resolved from the message. A claim that the model holds a value
 * must be grounded in the authoritative state, and the two can differ: the
 * referee can hold the op, canonicalisation can drop it, the encoder can defer
 * it. When they differ the caller must say nothing and let the existing
 * machinery speak.
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  mergeInterventionSources,
} from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
  type ConfigureOptionIntentTrigger,
} from './configure-option-intent.js';
import {
  messageCarriesOptionCue,
  optionCueMatches,
  phraseOccurrences,
  type PhraseOccurrence,
} from './option-intervention-guard.js';
import { readMissingValueAnswer } from './missing-value-answer.js';
import {
  deriveAskedEffectPair,
  deriveMissingEffectPairs,
  type MissingEffectPair,
} from './repair-value-binding.js';

/**
 * The triggers that mean "this sentence is explicitly about an OPTION'S
 * EFFECT on a factor".
 *
 * DERIVED from the shipped trigger union rather than re-spelled as strings, so
 * a new trigger cannot be silently admitted or silently forgotten: the type
 * below forces this set to name every member it excludes.
 */
const EFFECT_FRAMED_TRIGGERS: ReadonlySet<ConfigureOptionIntentTrigger> = new Set<
  ConfigureOptionIntentTrigger
>(['effect_vocab', 'intervention_vocab', 'configure_vocab']);

/**
 * Triggers deliberately NOT claimed, with the reason, pinned as data so the
 * suite REDs if the set above silently widens (trap 22f's honest-gap
 * protocol). See the header for why each is excluded.
 */
export const OPTION_EFFECT_WRITE_EXCLUDED_TRIGGERS: ReadonlyArray<{
  readonly trigger: ConfigureOptionIntentTrigger;
  readonly reason: string;
}> = Object.freeze([
  Object.freeze({
    trigger: 'option_value_set' as const,
    reason:
      'the W1 ambiguity class lands here: an explicit factor-BASELINE edit that names the option, '
      + 'names a linked factor and carries a value is indistinguishable at the graph from the '
      + 'witnessed wrong-entity write',
  }),
  Object.freeze({
    trigger: 'chip_prefix' as const,
    reason: 'the bare configure chip carries no value; the L16 intercept owns it',
  }),
]);

/**
 * Phrasings that carry option-effect intent and are KNOWINGLY NOT CLAIMED,
 * pinned as data (trap 22f). Each falls through to the pre-existing edit-lane
 * route unchanged; none is a dead end this module introduces.
 *
 * `{option}` and `{factor}` are substituted with REAL labels from the graph
 * under test, so the set exercises the live resolver rather than a
 * hand-written near-miss. The companion spec asserts each member declines AND
 * carries an opposite-direction twin that is claimed — so the suite REDs if
 * the predicate widens to swallow one, or narrows past a claimed form.
 */
export const OPTION_EFFECT_WRITE_KNOWN_DROPPED: readonly string[] = Object.freeze([
  // `baseline` suppressor — the sentence names two different entities.
  'For the {option} option, change the {factor} baseline to 0.3',
  // No unit conversion: this writer only ever writes a model-unit value.
  "Set the {option} option's effect on {factor} to £25,000",
  "Set the {option} option's effect on {factor} to 12%",
  // ⚠ ADDED AFTER A SURVIVING MUTANT (trap 22 — a corpus that omits a value
  // class cannot certify the code over it). Deleting the currency/percent
  // guard left the battery GREEN, because every currency and percent member
  // above was ALSO caught by the thousands-separator or the 0-1 scale check.
  // These two are the class where the guard is the ONLY thing standing: `£1`
  // is one pound and `1%` is 0.01, and both would otherwise bind as a
  // model-unit 1 — the maximum effect value, silently.
  "Set the {option} option's effect on {factor} to £1",
  "Set the {option} option's effect on {factor} to 1%",
  // Out of the 0-1 model scale — the LLM path can normalise against a cap.
  "Set the {option} option's effect on {factor} to 40000",
  // Compound: two assignments in one sentence, two writes, one turn.
  "Set the {option} option's effect on {factor} to 0.6 and to 0.3",
  // Qualitative: choosing a number would invent the user's judgement (P5).
  "Set the {option} option's effect on {factor} to high",
]);

/**
 * ⭐ RULE 3c's honest-gap protocol (trap 22f) — ordinary answers to the
 * product's own ask that this seam KNOWINGLY DOES NOT CLAIM, each with the
 * reason, pinned as data so the suite REDs if the claim widens or narrows.
 *
 * `{option}` / `{factor}` are substituted with REAL labels from the graph under
 * test, so the set exercises the live resolver rather than a near-miss.
 */
export const ANSWERED_ASK_KNOWN_DROPPED: readonly { readonly message: string; readonly why: string }[] =
  Object.freeze([
    Object.freeze({
      message: 'For the hybrid option, set it to 0.8.',
      why:
        '⚠ THE REASON CHANGED AND THE MEMBER DID NOT — the honest-gap protocol working as intended. '
        + 'It was refused because a COMMA was not a clause break; the 18 Aug RUN-B witness (deployed '
        + 'CEE 4a513781, with #1034 AND #1035 already live) proved that punctuation rule was deciding '
        + 'WHICH ENTITY got written, so the comma is now a break. This member still declines, at '
        + 'conjunct (a): the word "option" makes the SHIPPED classifier claim the sentence '
        + '(`option_value_set`, the W1 ambiguity class), and rule 3c is unreachable for anything the '
        + 'classifier claims. The old rule\'s own canonical example is refused by a guard that '
        + 'predates it — which is the evidence that the punctuation rule was never the load-bearing '
        + 'one. Measured, not argued.',
    }),
    Object.freeze({
      message: 'The numbers are all guesses at this point - use 0.8.',
      why:
        'no bare referent. "Use 0.8" alone is unmistakably an answer because nothing else is in '
        + 'the message; after a clause it might belong to that clause instead',
    }),
    Object.freeze({
      message: 'The team disagrees about this - set the {factor} baseline to 0.8.',
      why: 'the `baseline` suppressor — the sentence names two different entities (W1 class)',
    }),
    Object.freeze({
      message: 'That seems about right - set it to 80%.',
      why: 'not a model-unit value; this writer performs no conversion',
    }),
    Object.freeze({
      message: 'It would push it up a lot - set it to 0.8 for the {option} option.',
      why:
        'a NAMED TARGET inside the answering clause: the clause is no longer the closed bare-referent '
        + 'form, so the edit lane owns it exactly as it does today',
    }),
  ]);

/**
 * The word that means "the factor's own observed value", never an effect.
 *
 * ⭐ EXPORTED so the outstanding-ask clarify redirect applies the SAME closed
 * single-token suppressor rather than re-spelling it. Two spellings of
 * "this sentence is about the baseline" is the hand-maintained mirror this
 * estate keeps paying for (CLAUDE.md trap 12); the second copy is the one that
 * rots, and here the two readers would disagree about exactly the sentence
 * under dispute.
 */
export const BASELINE_FRAMING = /\bbaselines?\b/;

/**
 * ONE plain-number value assignment, on the model's own 0-1 scale.
 *
 * Anchored on `to` because that is the assignment preposition every accepted
 * phrasing in this estate uses — `VALUE_SET_PAYLOAD` in
 * `configure-option-intent.ts` is anchored on the same word, and
 * `buildConfigureOptionAdvisedFormat` emits it. The captures below are checked
 * rather than the match trusted: a currency symbol, a percent sign, an
 * attached unit or a thousands separator each mean the number is NOT in the
 * model's units, and this writer performs no conversion.
 */
const VALUE_ASSIGNMENT = /\bto\s+(£|\$|€)?\s*(\d+(?:\.\d+)?)(\s*%)?/g;

/** The user's effect value, or null when the message does not carry exactly one. */
export function readOptionEffectValue(normalisedMessage: string): number | null {
  const re = new RegExp(VALUE_ASSIGNMENT.source, 'g');
  let found: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalisedMessage)) !== null) {
    if (found !== null) return null; // a second assignment — compound, decline
    const [whole, currency, digits, percent] = match;
    if (currency !== undefined || percent !== undefined) return null;
    const after = normalisedMessage.slice(match.index + whole.length);
    // An attached unit (`0.6m`, `5k`), a further digit, or a thousands
    // separator all mean this number is not the model-unit value.
    if (/^[0-9a-z]/.test(after)) return null;
    if (/^[.,]\d/.test(after)) return null;
    const value = Number.parseFloat(digits!);
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    found = value;
  }
  return found;
}

/** A label match, kept with its identity so nothing is resolved by value. */
interface LabelMatch {
  readonly id: string;
  readonly label: string;
  readonly normalised: string;
  /** WHERE this label occurred, word-bounded. Nesting is decided on these. */
  readonly occurrences: readonly PhraseOccurrence[];
}

/**
 * Is EVERY occurrence of `m` inside an occurrence of some strictly longer
 * match? Then `m` is nowhere named in its own right.
 *
 * ⭐⭐ NESTING IS A FACT ABOUT POSITIONS, NOT ABOUT SPELLINGS — and the
 * difference is a wrong-entity write. The original rule dropped a match whose
 * LABEL was a phrase-substring of a longer match's label, without asking WHERE
 * either occurred. With options "Hire" and "Hire two engineers", the sentence
 *
 *   "Set the Hire option's effect on Payroll cost to 0.5 — not Hire two engineers."
 *
 * bound a write to "Hire two engineers" — the option the user had explicitly
 * EXCLUDED — because the "Hire" match was discarded on spelling alone. The
 * control proving it was a nesting defect and not a parsing one: the same
 * sentence against a graph without the longer option binds correctly to
 * "Hire". Demonstrated by execution on `2d998fa5`; pinned in
 * `__tests__/option-effect-write.test.ts` under `F1`.
 *
 * The rule is now: drop `m` only where every one of its occurrences lies
 * INSIDE an occurrence of a longer match. Where that does not hold, the
 * sentence genuinely names both, and two genuinely-named options are an
 * AMBIGUITY the product must ASK about rather than resolve by guessing
 * (CLAUDE.md trap 22f — where direction cannot be determined, the ambiguity
 * becomes the coaching moment).
 *
 * ⚠ COVERAGE IS TAKEN OVER THE WHOLE SET OF LONGER MATCHES, not against one
 * at a time. "Set the Hire two engineers option's effect and the Hire three
 * engineers option's effect on …" places each "Hire" occurrence inside a
 * DIFFERENT longer label: no single longer match covers both, yet "Hire" is
 * still nowhere named in its own right, and offering it as a third choice
 * would be the "a phrase and part of itself" theatre this rule exists to
 * remove. Pinned by an opposite-direction twin in the same block.
 *
 * ⚠ THE LENGTH ORDERING IS STRICT, AND LOAD-BEARING. Two options carrying the
 * SAME label are mutually contained; a non-strict comparison would drop BOTH
 * and turn a genuine ambiguity into "no option named". Pinned by its own twin.
 */
function isNestedThroughout(m: LabelMatch, all: readonly LabelMatch[]): boolean {
  if (m.occurrences.length === 0) return false;
  const longer = all.filter(
    (other) => other.id !== m.id && other.normalised.length > m.normalised.length,
  );
  if (longer.length === 0) return false;
  return m.occurrences.every((occurrence) =>
    longer.some((other) =>
      other.occurrences.some(
        (outer) => outer.start <= occurrence.start && occurrence.end <= outer.end,
      ),
    ),
  );
}

/**
 * Labels that appear in the message, word-bounded, with matches that are
 * nested EVERYWHERE THEY OCCUR dropped. See `isNestedThroughout` for why the
 * test is positional. Two matches that are not nested are a genuine ambiguity
 * and reach `ask`.
 */
function matchLabels(
  paddedMessage: string,
  candidates: readonly { readonly id: string; readonly label: unknown }[],
): LabelMatch[] {
  const matched: LabelMatch[] = [];
  for (const candidate of candidates) {
    if (typeof candidate.label !== 'string') continue;
    const normalised = candidate.label.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalised.length < 3) continue;
    const occurrences = phraseOccurrences(paddedMessage, normalised);
    if (occurrences.length === 0) continue;
    matched.push({ id: candidate.id, label: candidate.label, normalised, occurrences });
  }
  return matched.filter((m) => !isNestedThroughout(m, matched));
}

/** The factors this option is wired to. Same reader as the recovery copy. */
export function linkedFactorsOf(
  graph: GraphV3T,
  optionId: string,
): { readonly id: string; readonly label: unknown }[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: { id: string; label: unknown }[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from !== optionId) continue;
    if (seen.has(edge.to)) continue;
    const node = byId.get(edge.to);
    if (node === undefined || node.kind !== 'factor') continue;
    seen.add(edge.to);
    out.push({ id: node.id, label: (node as { label?: unknown }).label });
  }
  return out;
}

/** Why the writer declined. Every value leaves the pre-existing route intact. */
export type OptionEffectWriteDeclineReason =
  | 'not_effect_framed_intent'
  | 'baseline_framing'
  | 'graph_unparseable'
  | 'no_single_unit_scale_value'
  | 'option_not_named'
  /**
   * Rule 3b reached and could not resolve: the message named no option label,
   * and the outstanding ask does not name EXACTLY ONE of the factors the
   * message names. Distinct from `option_not_named` on purpose — it says the
   * fallback RAN and declined, which is the only way to tell "the product was
   * never asking about this" from "the option reference was unreadable".
   */
  | 'no_outstanding_ask_for_factor'
  /**
   * RULE 3c reached and there is no question to answer: the product's own
   * recovery copy is not currently asking for an effect value (the head blocker
   * is a mapping/encoding issue, or there are no blockers). Distinct from
   * `no_outstanding_ask_for_factor`, which means the ask exists and the message
   * does not land on it.
   */
  | 'no_answered_ask'
  /**
   * RULE 3c reached and the prose names an entity OUTSIDE the pair the product
   * asked about — a different option, or a different factor. The answer is not
   * an answer to THIS question, so the ask is not the authority on it and the
   * turn keeps today's route.
   */
  | 'answer_points_elsewhere'
  | 'factor_not_named'
  | 'value_already_set';

/**
 * ⚠ Rule 3b's stated residual, pinned as data so the suite REDs if someone
 * "fixes" it by widening rather than by rowing it (trap 22f's honest-gap
 * protocol, and trap 20 — a limit recorded loosely becomes a false claim).
 *
 * The companion spec executes this exact shape and asserts BOTH halves: the
 * write binds to the outstanding option, AND the acknowledgement names that
 * option by label — so the residual is bounded and VISIBLE, never silent.
 */
export const OPTION_EFFECT_WRITE_ASK_RESOLVED_LIMIT = Object.freeze({
  shape: "an option reference this reader cannot resolve, alongside a factor the product IS asking about for a DIFFERENT option — e.g. \"For the hybrid option, set {factor} to 0.8\"",
  behaviour: 'binds to the OUTSTANDING option for that factor, and names it in the acknowledgement',
  why_not_closed:
    'closing it needs a partial/synonym option-reference reader; four rounds of open-ended '
    + 'natural-language predicate tuning oscillated on a neighbouring seam (CLAUDE.md trap 22f), '
    + 'and the honest exit there is to ask rather than guess — which is what two or more '
    + 'outstanding options on the same factor already does',
});

/** One candidate pair the ask offers. */
export interface OptionEffectCandidate {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string;
}

export type OptionEffectWriteResolution =
  | { readonly matched: false; readonly reason: OptionEffectWriteDeclineReason }
  | {
      readonly matched: true;
      readonly kind: 'write';
      readonly optionId: string;
      readonly optionLabel: string;
      readonly factorId: string;
      readonly factorLabel: string;
      readonly value: number;
    }
  | {
      readonly matched: true;
      readonly kind: 'ask';
      /** Which half of the pair could not be pinned down. */
      readonly ambiguity: 'option' | 'factor';
      /**
       * ⭐ WHERE THE CANDIDATE OPTIONS CAME FROM — and it is a copy contract,
       * not telemetry. The pre-existing ask says *"Your message names 2
       * options"*, which is TRUE only when the message named them. Rule 3b's
       * candidates come from the product's own outstanding ask on a message
       * that named NO option, so reusing that sentence would be a fabricated
       * claim about the user's own words (P5) inside the copy written to stop
       * the product guessing. The composer branches on this field.
       */
      readonly optionSource: 'named_in_message' | 'outstanding_ask';
      readonly value: number;
      /**
       * Every candidate the message could have meant, by identity. A candidate
       * carries a factor ONLY when exactly one of that option's linked factors
       * was named — so a chip built from it is always a complete, routable
       * sentence.
       */
      readonly candidates: readonly OptionEffectCandidate[];
      /** Option labels the message named, when the OPTION is what is ambiguous. */
      readonly optionLabels: readonly string[];
    };

function decline(reason: OptionEffectWriteDeclineReason): OptionEffectWriteResolution {
  return { matched: false, reason };
}

/**
 * ⭐⭐ RULE 3b — resolve the OPTION from the product's own outstanding ask.
 *
 * Reached ONLY when the message names no option label at all. Everything it
 * can bind to comes from `deriveMissingEffectPairs` — the estate's one owner
 * of "which option × factor pairs is the product currently saying it has no
 * value for", read off the SAME canonical payload the blocker sentence the
 * user is answering was composed from (trap 12: one reader, no mirror). So
 * this cannot name a pair the product is not already asking about.
 *
 * ⚠ THE CANDIDATE SET IS THE ASK, NOT THE GRAPH. Matching factor labels
 * against `graph.nodes` instead would let a factor nobody asked about resolve
 * an option by proximity — the wrong-entity write in a new costume. The
 * restriction to asked-about factors is what makes this an ACCEPTANCE of the
 * product's own question rather than a second intent parser (P8).
 */
function resolveFromOutstandingAsk(
  paddedMessage: string,
  graph: GraphV3T,
  rawGraph: unknown,
  value: number,
): OptionEffectWriteResolution {
  // ⭐⭐ CONJUNCT (a), AND IT WAS PUT HERE BY THREE PRE-EXISTING GUARDS GOING
  // RED — the outside corpus refuting the first cut of this rule (trap 22c).
  //
  // Without it, rule 3b fired on any message whose option reference this
  // reader could not match, including a deliberate near-miss. It turned
  // `option-effect-write.test.ts`'s discriminating pair ("rename THE NAMED
  // option and the write withdraws") and both mutant-derived word-boundary
  // guards from RED to a WRITE — i.e. the fix reproduced, in a narrower form,
  // exactly the wrong-entity class it was written to remove. The lead question
  // was "could this fix be another instance of the defect it claims to
  // remove?", and the honest answer at the first cut was yes.
  //
  // THE DISCRIMINATOR IS THE SHIPPED READER, NOT A NEW ONE. `messageCarriesOptionCue`
  // is trigger (3) of `impliesOptionInterventionEdit` — the same subtraction
  // (`deriveOptionDistinctiveTokens`) the misroute guard uses — extracted so
  // there is ONE implementation. A sentence that names a PARTICULAR option we
  // could not match is a sentence whose option we must not choose; a sentence
  // that names none ("…the option's effect on <factor>…") leaves the ask as the
  // only authority on which option is meant. That also makes the writer and
  // the refusal guard agree about the same sentence, which is the trap-21
  // defect this seam produced in the first place.
  const optionLabels: string[] = [];
  const nonOptionLabels: string[] = [];
  for (const node of graph.nodes) {
    if (typeof node.label !== 'string' || node.label.trim().length === 0) continue;
    (node.kind === 'option' ? optionLabels : nonOptionLabels).push(node.label);
  }
  if (messageCarriesOptionCue(paddedMessage, optionLabels, nonOptionLabels)) {
    return decline('option_not_named');
  }

  const pairs = deriveMissingEffectPairs(buildCanonicalAnalysisReadyFromGraph(rawGraph));
  if (pairs.length === 0) return decline('option_not_named');

  // One entry per FACTOR the product is currently asking about. Deduplicated
  // by factor id: the same factor can be outstanding for several options, and
  // that is precisely the case rule 3b must ASK about rather than resolve.
  const askedFactors: { readonly id: string; readonly label: string }[] = [];
  const seenFactorIds = new Set<string>();
  for (const pair of pairs) {
    if (seenFactorIds.has(pair.factorId)) continue;
    seenFactorIds.add(pair.factorId);
    askedFactors.push({ id: pair.factorId, label: pair.factorLabel });
  }

  const factorMatches = matchLabels(paddedMessage, askedFactors);
  if (factorMatches.length !== 1) return decline('no_outstanding_ask_for_factor');
  const factor = factorMatches[0]!;

  const candidates: MissingEffectPair[] = pairs.filter((p) => p.factorId === factor.id);
  // `pairs` is already deduplicated by (option, factor), so two entries here
  // are two genuinely different OPTIONS waiting on this one factor.
  if (candidates.length > 1) {
    return {
      matched: true,
      kind: 'ask',
      ambiguity: 'option',
      optionSource: 'outstanding_ask',
      value,
      candidates: candidates.map((pair) => ({
        optionId: pair.optionId,
        optionLabel: pair.optionLabel,
        factorId: pair.factorId,
        factorLabel: pair.factorLabel,
      })),
      optionLabels: candidates.map((pair) => pair.optionLabel),
    };
  }

  const pair = candidates[0]!;
  return {
    matched: true,
    kind: 'write',
    optionId: pair.optionId,
    optionLabel: pair.optionLabel,
    factorId: pair.factorId,
    factorLabel: pair.factorLabel,
    value,
  };
}

/**
 * ⭐⭐ RULE 3c — THE USER ANSWERED THE QUESTION THE PRODUCT ASKED.
 *
 * WITNESSED (18 Aug 2026 composed model-compiler journey, deployed CEE
 * `585f8dce` / UI `dd089a50`, fresh guest, governed-corpus brief). Olumi asked,
 * on screen:
 *
 *   "Next, choose the missing effect value for "double down on enterprise
 *    sales (higher…" on "Sales Headcount - Hybrid Maintained" so the
 *    comparison can be prepared."
 *
 * The user answered it in ordinary English (turn 4, verbatim):
 *
 *   "Doubling down on enterprise sales would push sales headcount up a lot -
 *    set it to 0.8."
 *
 * `detectConfigureOptionIntent` does not match that sentence AT ALL — it frames
 * itself as nothing in particular, which is exactly what an answer does — so
 * rule 3b (#1034) could not reach it, the turn fell to the value-update path,
 * and the product refused the direct answer to its own question. That is P8, and
 * the founder's invariant states it without hedging: **if Olumi asks for X, a
 * natural answer must modify X and nothing else.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ WHY THIS IS NOT "MORE PATTERNS", WHICH IS THE FAILURE MODE ON THIS SEAM.
 *
 * Four rounds oscillated on a neighbouring natural-language predicate
 * (CLAUDE.md trap 22f) and the ruling out of it was to stop discriminating by
 * sentence shape. So the IDENTITY here is not read from the sentence at all:
 * it is `deriveAskedEffectPair` — literally the blocker the product's own
 * recovery copy composed the question from (`readiness-recovery.ts:194`, P7).
 * The sentence is consulted for exactly three things, all by SHIPPED readers,
 * none of them new:
 *
 *   · is it an ANSWER?      `readMissingValueAnswer` — one closed referent set,
 *                           one number grammar, one owner shared with the
 *                           clarify composer.
 *   · what VALUE?           `readOptionEffectValue` — the same model-unit
 *                           grammar path (3) uses, untouched.
 *   · does it point ELSEWHERE?  `optionCueMatches` (the misroute guard's own
 *                           distinctive-token subtraction) and `matchLabels`
 *                           (the same word-bounded matcher).
 *
 * No content word is matched anywhere in this rule. It can only ever decline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CONJUNCTS, each load-bearing:
 *
 *   (a) The shipped intent classifier DECLINED. Rule 3c is unreachable for any
 *       sentence the classifier claims, so the `option_value_set` and
 *       `chip_prefix` exclusions — and with them the whole W1 ambiguity class —
 *       are preserved BY CONSTRUCTION rather than by a second check that could
 *       drift. (Enforced at the call site.)
 *   (b) The message carries LEADING CONTEXT. A whole-message bare answer
 *       ("Set it to 0.8.") already has an owner in `resolveRepairValueBinding`,
 *       whose slot rule is "exactly one pair missing, else ask". Two owners for
 *       one shape is the trap-21 defect this estate keeps paying for, so this
 *       rule declines it and leaves it where it is.
 *   (c) The product IS asking for an effect value — `deriveAskedEffectPair`
 *       returns the head blocker's pair, or null when the recovery copy is
 *       rendering some other sentence entirely.
 *   (d) The prose points at NO entity outside that pair. A named option that is
 *       not the asked one, or any non-option entity named in full that is not
 *       the asked factor, withdraws the claim. TWO named options that are both
 *       outstanding on the asked factor become an ASK — the ambiguity is the
 *       product, never a guess.
 *
 * ⚠ THE STATED RESIDUAL, pinned rather than papered over. A PARTIAL reference to
 * an entity this graph does not make distinctive — "the burn rate is what worries
 * me - set it to 0.8", where "burn"/"rate" are claimed by several labels — is
 * invisible to both readers, so the answer binds to the asked pair. Closing it
 * needs a partial/synonym entity reader, which is the oscillating predicate the
 * ruling above forbids. It is BOUNDED and VISIBLE rather than silent:
 * `formatOptionEffectWriteAck` names the option and factor it wrote, so the user
 * reads which entity moved — and the asked pair is, by construction, the one the
 * product just put on screen. Pinned as `ANSWERED_ASK_RESOLVED_LIMIT`.
 */
export const ANSWERED_ASK_RESOLVED_LIMIT = Object.freeze({
  shape:
    'an entity referred to only by words this graph does not make distinctive — e.g. "the burn rate '
    + 'is what worries me - set it to 0.8" where "burn" and "rate" are claimed by several labels. '
    + '⚠ WIDENED by the RUN-B fix: a COMMA is now a clause break, so the leading context this '
    + 'residual applies to includes comma-led prose ("burn rate is the worry, set it to 0.2"). '
    + 'Conjunct (d) matches labels WORD-BOUNDED AND IN FULL, so a PARTIAL reference stays invisible '
    + 'to it either way — the widening enlarges the residual\'s reach, it does not create it.',
  behaviour: 'binds to the pair the product asked about, and names it in the acknowledgement',
  why_not_closed:
    'closing it needs a partial/synonym entity reader over natural language; four rounds of that '
    + 'oscillated on a neighbouring seam (CLAUDE.md trap 22f), and the exit named there is to resolve '
    + 'from the product\'s own outstanding question rather than from sentence shape — which is what '
    + 'this rule does',
});

function resolveFromAnsweredAsk(
  paddedMessage: string,
  normalisedMessage: string,
  graph: GraphV3T,
  rawGraph: unknown,
  value: number,
): OptionEffectWriteResolution {
  const readiness = buildCanonicalAnalysisReadyFromGraph(rawGraph);
  const asked = deriveAskedEffectPair(readiness);
  if (asked === null) return decline('no_answered_ask');

  const optionNodes = graph.nodes.filter((n) => n.kind === 'option');
  const nonOptionNodes = graph.nodes.filter((n) => n.kind !== 'option');
  const optionLabels = optionNodes.map((n) => (typeof n.label === 'string' ? n.label : ''));
  const nonOptionLabels = nonOptionNodes
    .map((n) => (typeof n.label === 'string' ? n.label : ''))
    .filter((label) => label.trim().length > 0);

  // ── (d) THE FACTOR AXIS. Any NON-OPTION entity named in full that is not the
  // asked factor means the sentence is about something else. Checked over every
  // non-option node — a goal or an outcome named in full is just as much a
  // different target as a sibling factor is.
  const namedEntities = matchLabels(
    paddedMessage,
    nonOptionNodes.map((n) => ({ id: n.id, label: n.label })),
  );
  if (namedEntities.some((m) => m.id !== asked.factorId)) {
    return decline('answer_points_elsewhere');
  }

  // ── (d) THE OPTION AXIS, through the misroute guard's own reader.
  const pointedOptionIds = optionCueMatches(normalisedMessage, optionLabels, nonOptionLabels)
    .map((index) => optionNodes[index]!.id);

  if (pointedOptionIds.length > 1) {
    // TWO OR MORE OPTIONS GENUINELY NAMED. Offer only those the product is
    // actually waiting on for the ASKED factor, so every chip is a complete,
    // routable sentence about the question on screen. Fewer than two such
    // candidates is not an offerable ambiguity — decline and change nothing.
    const outstanding = deriveMissingEffectPairs(readiness);
    const candidates = pointedOptionIds
      .map((optionId) =>
        outstanding.find((p) => p.optionId === optionId && p.factorId === asked.factorId),
      )
      .filter((pair): pair is MissingEffectPair => pair !== undefined);
    if (candidates.length < 2) return decline('answer_points_elsewhere');
    return {
      matched: true,
      kind: 'ask',
      ambiguity: 'option',
      // The message named them, but it did NOT name them in a form path (3)
      // could resolve; the candidate SET came from the product's own ask, and
      // the copy contract turns on where the candidates came from, not on
      // whether the user typed something option-shaped (P5).
      optionSource: 'outstanding_ask',
      value,
      candidates: candidates.map((pair) => ({
        optionId: pair.optionId,
        optionLabel: pair.optionLabel,
        factorId: pair.factorId,
        factorLabel: pair.factorLabel,
      })),
      optionLabels: candidates.map((pair) => pair.optionLabel),
    };
  }

  if (pointedOptionIds.length === 1 && pointedOptionIds[0] !== asked.optionId) {
    return decline('answer_points_elsewhere');
  }

  // ⚠ NO `value_already_set` CHECK HERE, deliberately: the asked pair is BY
  // CONSTRUCTION one the product is saying has no value, so the branch would be
  // unreachable — and an unreachable guard is a mutant that cannot be killed.
  return {
    matched: true,
    kind: 'write',
    optionId: asked.optionId,
    optionLabel: asked.optionLabel,
    factorId: asked.factorId,
    factorLabel: asked.factorLabel,
    value,
  };
}

/**
 * Resolve an explicit option-effect write request against the persisted graph.
 *
 * Pure: no I/O, no LLM, no telemetry. `graph` is the graph the caller is about
 * to dispatch the edit against; anything that does not strict-parse declines.
 */
export function resolveOptionEffectWrite(params: {
  readonly message: string;
  readonly graph: unknown;
}): OptionEffectWriteResolution {
  if (typeof params.message !== 'string') return decline('not_effect_framed_intent');
  const normalised = params.message.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalised.length === 0) return decline('not_effect_framed_intent');
  if (BASELINE_FRAMING.test(normalised)) return decline('baseline_framing');

  const parsed = GraphV3.safeParse(params.graph);
  if (!parsed.success) return decline('graph_unparseable');
  const graph = parsed.data;

  // Intent — the SHIPPED classifier, with the persisted graph's own labels.
  // Not a second reading of the message (trap 21).
  const detection = detectConfigureOptionIntent(
    params.message,
    projectOptionLabels(graph.nodes),
  );
  // ⭐⭐ RULE 3c's CONJUNCT (a), and it is structural rather than a check: the
  // fallback is reached ONLY where the shipped classifier claimed NOTHING. A
  // sentence it classified — including every `option_value_set` W1 shape and
  // the bare configure chip — takes the line below exactly as it does today.
  const answeredAsk = !detection.matched;
  if (answeredAsk) {
    // CONJUNCT (b): an ANSWER, read by the one owner, carrying leading context.
    // Whole-message bare answers belong to `resolveRepairValueBinding` and are
    // declined here so the two seams cannot both claim one shape (trap 21).
    const answer = readMissingValueAnswer(params.message);
    if (answer === null || answer.kind !== 'numeric' || answer.leadingContext === '') {
      return decline('not_effect_framed_intent');
    }
  } else if (!EFFECT_FRAMED_TRIGGERS.has(detection.trigger)) {
    return decline('not_effect_framed_intent');
  }

  const value = readOptionEffectValue(normalised);
  if (value === null) return decline('no_single_unit_scale_value');

  const padded = ` ${normalised} `;
  if (answeredAsk) {
    return resolveFromAnsweredAsk(padded, normalised, graph, params.graph, value);
  }
  const optionMatches = matchLabels(
    padded,
    graph.nodes.filter((n) => n.kind === 'option').map((n) => ({ id: n.id, label: n.label })),
  );
  if (optionMatches.length === 0) {
    // ⭐ RULE 3b — the product's own outstanding ask resolves the option. See
    // the header for the witness, the conjuncts and the stated residual.
    return resolveFromOutstandingAsk(padded, graph, params.graph, value);
  }

  if (optionMatches.length > 1) {
    // AMBIGUOUS OPTION. Offer a complete sentence per option, but only where
    // that option's own linked factors resolve to exactly one — a chip must
    // never complete more than the one choice it is asking for.
    const candidates: OptionEffectCandidate[] = [];
    for (const option of optionMatches) {
      const factors = matchLabels(padded, linkedFactorsOf(graph, option.id));
      if (factors.length !== 1) continue;
      const factor = factors[0]!;
      candidates.push({
        optionId: option.id,
        optionLabel: option.label,
        factorId: factor.id,
        factorLabel: factor.label,
      });
    }
    return {
      matched: true,
      kind: 'ask',
      ambiguity: 'option',
      optionSource: 'named_in_message',
      value,
      candidates,
      optionLabels: optionMatches.map((m) => m.label),
    };
  }

  const option = optionMatches[0]!;
  const factorMatches = matchLabels(padded, linkedFactorsOf(graph, option.id));
  if (factorMatches.length === 0) {
    // The message names no factor this option is wired to. Deliberately a
    // DECLINE, not an ask: the edit LLM can paraphrase-match a factor name
    // this exact reader cannot, and can add a missing structural edge, so
    // pre-empting it here would remove a capability rather than add one.
    return decline('factor_not_named');
  }

  if (factorMatches.length > 1) {
    return {
      matched: true,
      kind: 'ask',
      ambiguity: 'factor',
      optionSource: 'named_in_message',
      value,
      candidates: factorMatches.map((factor) => ({
        optionId: option.id,
        optionLabel: option.label,
        factorId: factor.id,
        factorLabel: factor.label,
      })),
      optionLabels: [option.label],
    };
  }

  const factor = factorMatches[0]!;

  // Already exactly this value? Writing it again lands no change, and a
  // no-change apply reads downstream as "the operation did not land". Decline
  // so the pre-existing machinery answers, rather than manufacturing a
  // false-failure receipt for a request that is already satisfied.
  const optionNode = graph.nodes.find((n) => n.id === option.id);
  const existing = optionNode
    ? mergeInterventionSources(optionNode as Record<string, unknown>)
    : undefined;
  if (existing !== undefined && existing[factor.id] === value) {
    return decline('value_already_set');
  }

  return {
    matched: true,
    kind: 'write',
    optionId: option.id,
    optionLabel: option.label,
    factorId: factor.id,
    factorLabel: factor.label,
    value,
  };
}

/**
 * The served edit prompt's EXAMPLE-2 operation, verbatim in its vocabulary.
 *
 * P7 — this shape is DERIVED FROM THE PRODUCER: `src/prompts/edit-graph-v6.ts`
 * instructs "patch the whole intervention object at
 * `/nodes/<opt>/data/interventions/<factor_id>` … This is a creation
 * (`old_value: null`), not a field-level update", and its EXAMPLE 2 emits
 * exactly this object. The caller runs it through `parseEditGraphResponse` —
 * the same parser the model's output goes through — so the canonical
 * `PatchOperation` this becomes cannot drift from the LLM path's.
 *
 * ⚠ ONLY `value` IS EMITTED, deliberately. `raw_value` / `unit` / `cap` are the
 * user-scale trio, and populating them means choosing a scale conversion this
 * module has no basis for. The binding predicate already refused every
 * non-model-unit input (currency, percent, attached unit, out of `[0,1]`), so
 * the number is the model-unit value and nothing else is known about it.
 */
export function buildOptionEffectRawOperation(resolved: {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string;
  readonly value: number;
}): Record<string, unknown> {
  return {
    op: 'update_node',
    path: `/nodes/${resolved.optionId}/data/interventions/${resolved.factorId}`,
    value: { value: resolved.value },
    old_value: null,
    impact: 'moderate',
    rationale: `Sets the effect value the user gave for ${resolved.optionLabel} on ${resolved.factorLabel}.`,
  };
}

/**
 * Read the effect value the COMMITTED graph actually holds for this pair.
 *
 * ⭐ P5 — THE ONLY AUTHORITY FOR THE ACKNOWLEDGEMENT. Read through
 * `mergeInterventionSources`, the same reader that composes the readiness
 * badge on the user's screen and that both #1016's guard and the 2.427 outcome
 * verdict consult, so the sentence, the badge and the verdict cannot disagree
 * about whether the value is there (trap 12). Returns `undefined` when the
 * write did not survive — and the caller must then say nothing.
 */
export function readCommittedOptionEffect(
  appliedGraph: unknown,
  optionId: string,
  factorId: string,
): number | undefined {
  if (appliedGraph === null || typeof appliedGraph !== 'object') return undefined;
  const nodes = (appliedGraph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return undefined;
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    if ((node as { id?: unknown }).id !== optionId) continue;
    const merged = mergeInterventionSources(node as Record<string, unknown>);
    return merged?.[factorId];
  }
  return undefined;
}

/**
 * The acknowledgement — a statement of what the committed graph now holds.
 *
 * ⚠ IT MAKES NO OFFER (P8). It does not say the analysis can now run: whether
 * it can is a separate derivation this module does not hold, and a
 * neighbouring composer shipped exactly that promise unconditionally and had
 * to have it withdrawn. `committedValue` is the value READ BACK from the
 * applied graph, never the value parsed from the message.
 */
export function formatOptionEffectWriteAck(params: {
  readonly optionLabel: string;
  readonly factorLabel: string;
  readonly committedValue: number;
}): string {
  return (
    `"${params.optionLabel}" now has an effect value of ${params.committedValue} `
    + `on "${params.factorLabel}".`
  );
}
