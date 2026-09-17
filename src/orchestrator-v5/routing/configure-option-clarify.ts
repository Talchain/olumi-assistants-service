/**
 * ⭐ L16 / walk finding N16 — make the product's own `Configure <option>` chip
 * EXECUTABLE.
 *
 * THE DEFECT, traced at the bytes from the 3 Aug walk's wire bodies
 * (`journey-rewalk-2026-08-03b`, §2b row 1, raw
 * `b-wire-r5-01-configure-chip-{req,res}.txt`, deployed CEE `9a0541b`):
 *
 *   REQUEST  message "Configure Launch Customer Retention Programme"
 *   RESPONSE 200 — "I wasn't able to make that change safely. Can you describe
 *            what you'd like to add or change in simpler terms?",
 *            `rejection_code: "OPERATION_DID_NOT_LAND"`,
 *            `_diagnostic_trace.exit_path: "edit_graph"`, one `edit_graph` LLM
 *            call (489 output tokens, 11.9 s), and NO `analysis_ready`.
 *
 * The ROUTING was never broken — 2.11 and 2.308 fixed that, and the persisted
 * label anchor makes this message match `configure_vocab` and reach the edit
 * lane. What is broken is that a BARE configure has NOTHING WRITABLE in it: no
 * factor, no value. The edit LLM is asked to configure an option and must
 * guess an operation; the guess did not survive canonicalisation onto the
 * persisted graph (`edit-graph.ts` `batchFullyLanded`), the whole edit was
 * refused — correctly — and the user was handed a generic safety refusal
 * instead of the one thing that would unblock them.
 *
 * THE REMEDY, and why it is a first-class typed action rather than a better
 * prompt: the information the user is missing is entirely DERIVABLE from the
 * graph. Which option is blocked, which factor it is linked to, and the exact
 * sentence that writes it are all facts the server already holds. So this
 * module answers deterministically — no LLM, no invention, no round-trip —
 * and hands back the ONE phrasing proven to route to the honest writer:
 * `buildConfigureOptionAdvisedFormat`, which is probe P1 verbatim (sent to
 * deployed CEE `a5a3e22`, it flipped `analysis_ready` from `needs_encoding` to
 * `ready` and wrote `interventions: {fac_retention_investment: 1}`).
 *
 * NO NEW VOCABULARY. The advised format comes from
 * `configure-option-chip-text.ts` — the same module the chip composers and the
 * route detector build from — so the remedy this module suggests is, by
 * construction, a remedy the router accepts. That is the loop the 2.11
 * diagnosis called "a closed loop, minted by the product's own copy", closed
 * from the other end.
 *
 * ⚠ WHY THIS DELIBERATELY OFFERS NO VALUE, AND NO CHIPS. A chip must carry a
 * complete message, and a complete "set the effect to N" message would mean
 * THIS module choosing N. The value is the one thing here that is not a
 * derivable fact about the graph — it is the user's judgement about their own
 * decision. Emitting a chip with a plausible number would put a fabricated
 * intervention one click away behind a control that reads as the product's
 * recommendation. The format is given with its placeholder and glossed in
 * plain English instead. (Same posture as `buildSubstitutionClarify`: "no
 * chips: the ask is a free-text question a chip cannot answer".)
 *
 * SAFE-BIASED, and strictly additive: every path that cannot name a concrete
 * next step returns `matched: false` and leaves the pre-existing route
 * untouched. The intercept fires ONLY when it can name the option AND at least
 * one real linked factor — so it can never replace a working edit with a
 * question.
 */

import { GraphV3 } from '../../schemas/cee-v3.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import {
  carriesConfigureOptionValuePayload,
  type ConfigureOptionIntentDetection,
} from './configure-option-intent.js';
import { containsPhrase } from './option-intervention-guard.js';
import { deriveMissingEffectPairs } from './repair-value-binding.js';

/** Why the intercept declined. Every value keeps the pre-existing route. */
export type ConfigureOptionClarifyDeclineReason =
  | 'not_configure_intent'
  | 'value_payload_present'
  | 'graph_unparseable'
  | 'no_readiness'
  | 'no_unconfigured_option'
  | 'option_not_identified'
  | 'no_candidate_factor'
  /**
   * ⭐ THE OPTION WAS IDENTIFIED — the RECOVERY COPY's domain excludes it.
   *
   * Distinct from `option_not_identified`, which this branch used to borrow and
   * which said the opposite of what happened (CLAUDE.md trap 14: an honest
   * label overwritten by a convenient one is how a reader stops looking).
   * Nothing branches on these reasons outside tests — swept at this tip, zero
   * non-test reads of `.reason` from either predicate, contrast control: 7 in
   * the companion spec — so this is honesty in the record, not behaviour.
   */
  | 'option_already_partially_configured'
  /**
   * ⭐ THE MESSAGE NAMED MORE THAN ONE OPTION, and no one of them is a nested
   * reading of another. Distinct from `option_not_identified`, which says no
   * option was named at all: these are two different facts about the message
   * and they want two different remedies (ask which, vs ask for one). Picking
   * one of several is the confident-wrong-answer this module exists to remove.
   */
  | 'option_label_ambiguous';

export type ConfigureOptionClarifyResult =
  | { readonly matched: false; readonly reason: ConfigureOptionClarifyDeclineReason }
  | {
      readonly matched: true;
      readonly optionId: string;
      readonly optionLabel: string;
      /** Real, linked, not-yet-configured factor labels. Never invented. */
      readonly factorLabels: readonly string[];
      /**
       * Readiness for the UNCHANGED graph, carried so the caller can stamp
       * `analysis_ready` on this turn. Gate-reason integrity: the remedy turn
       * must not be the turn on which the specific blocker disappears.
       */
      readonly readiness: AnalysisReadyPayload;
      /** How the option was pinned down — for telemetry, not for copy. */
      readonly optionSource: 'named_in_message' | 'sole_unconfigured';
    };

/**
 * At most this many factor names are offered. Beyond three the copy stops
 * reading as a next step and starts reading as a list to audit.
 */
const MAX_FACTOR_SUGGESTIONS = 3;

function decline(reason: ConfigureOptionClarifyDeclineReason): ConfigureOptionClarifyResult {
  return { matched: false, reason };
}

/**
 * ⭐⭐ ROADMAP 2.427 — TRAP 21: TWO QUESTIONS, ONE PREDICATE.
 *
 * Until this change there was ONE exported predicate here
 * (`tryConfigureOptionClarify`) and route-v2 consumed it for ONE purpose:
 * *"should the deterministic remedy answer this turn INSTEAD of the edit
 * lane?"* Its decline on `value_payload_present` is exactly right for that
 * question — a configure message that names a factor and a value has something
 * to write, and pre-empting the edit lane would replace a WORKING edit with a
 * question.
 *
 * 2.427 needs an answer to a DIFFERENT question: *"the edit lane has already
 * run and did NOT record this option — can we name what the user should type
 * now?"* On that question the `value_payload_present` decline is not just
 * unhelpful, it is precisely inverted: the failure captures that motivated this
 * row ALL carry a value payload ("Under the Cloud-Native CRM option, set its
 * effect on Adoption Complexity to 0.7."), so the single predicate declined
 * every turn that most needed the copy, and the user got the generic dead end
 * instead.
 *
 * Trap 21's rule is to name the concepts apart rather than reconcile the
 * defaults, so the shared FACT RESOLUTION lives in `resolveConfigureOptionFacts`
 * below and the two questions get one named predicate each:
 *
 *   `shouldInterceptBeforeEditLane`   — BEFORE the edit lane. Declines on a
 *                                       value payload. Behaviour unchanged.
 *   `buildConfigureOptionRecoveryCopy` — AFTER the edit lane failed. Does not
 *                                       consult the value payload at all.
 *
 * Note what is NOT shared: the gate. Both call the same resolver, and neither
 * inherits the other's answer to a question it was not asked.
 */
function resolveConfigureOptionFacts(params: {
  readonly message: string;
  readonly detection: ConfigureOptionIntentDetection;
  readonly graph: unknown;
}): ConfigureOptionClarifyResult {
  if (!params.detection.matched) return decline('not_configure_intent');

  const parsed = GraphV3.safeParse(params.graph);
  if (!parsed.success) return decline('graph_unparseable');

  // DERIVED (trap 12): "which options are unconfigured" is not re-implemented
  // here — it is read off the SAME canonical readiness payload that
  // composes the gate reason the user is looking at. The remedy therefore
  // cannot disagree with the blocker copy about which option is blocked.
  const readiness = buildCanonicalAnalysisReadyFromGraph(params.graph);
  if (readiness === undefined) return decline('no_readiness');

  const candidates = outstandingSlotsByOption(readiness);
  if (candidates.length === 0) return decline('no_unconfigured_option');

  const normalisedMessage = ` ${params.message.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  // 1. The option the user named, when they named one.
  let target = candidates.find((o) => {
    const label = o.optionLabel.toLowerCase().replace(/\s+/g, ' ').trim();
    return label.length >= 3 && containsPhrase(normalisedMessage, label);
  });
  let optionSource: 'named_in_message' | 'sole_unconfigured' = 'named_in_message';

  // 2. Otherwise, the sole blocked option — which is what the chip's own
  //    message and the generic "Set values for options" chip resolve to.
  //    Deliberately NOT extended to "pick the first of several": with two
  //    blocked options and no name, guessing which one the user meant is the
  //    kind of confident wrong answer this lane exists to remove.
  if (target === undefined) {
    if (candidates.length !== 1) return decline('option_not_identified');
    target = candidates[0]!;
    optionSource = 'sole_unconfigured';
  }

  const factorLabels = target.factorLabels;
  if (factorLabels.length === 0) return decline('no_candidate_factor');

  return {
    matched: true,
    optionId: target.optionId,
    optionLabel: target.optionLabel,
    factorLabels,
    readiness,
    optionSource,
  };
}

/**
 * ⭐⭐ THE CANDIDATE SET IS THE OUTSTANDING SLOT, NOT THE OPTION'S STATUS — and
 * this replaced a genuine WRONG-ENTITY path, measured rather than reasoned.
 *
 * WHAT WAS HERE: `readiness.options.filter((o) => o.status === 'needs_encoding')`,
 * plus a private `collectCandidateFactorLabels` that re-walked the graph's edges
 * and subtracted the option's existing interventions — a SECOND derivation of
 * "which option × factor slots are still unset", beside the estate's declared
 * owner of that question (`deriveMissingEffectPairs`). Both are now gone; this
 * module reads the owner.
 *
 * WHY IT HAD TO GO, measured at pristine `7abed98e` by driving the six-step
 * repair loop on the live-journey capture
 * (`tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json`, see
 * `graph-management/__tests__/canonical-repair-loop-termination.test.ts`):
 * option-level status is COARSER than the slot. As soon as an option has ONE
 * numeric intervention its status is `ready`, even while another of its linked
 * factors still has no value. So a partially-configured option dropped out of
 * `unconfigured`, and the message that NAMED it stopped matching:
 *
 *   step 1 — asked about `1bf99178 × be01ab27`; the named option was not a
 *            candidate, three others were → `option_not_identified`, i.e. the
 *            dead end the witness recorded as "no affordance".
 *   step 4 — asked about `d8d2df15 × be01ab27`; the named option was not a
 *            candidate and exactly one other was, so the `sole_unconfigured`
 *            fallback fired ON A MESSAGE THAT NAMED AN OPTION and resolved to
 *            **`e75f367a`** — a different option entirely. The product would
 *            have answered about an entity the user had not named.
 *
 * That second one is the wrong-entity class (#1034/#1035) surviving in the
 * QUESTION rather than the writer, and it is why this could not be left for a
 * later lane: the identity-carrying chip this change ships would have routed
 * into it.
 *
 * ⚠⚠ THIS ALSO NARROWS `sole_unconfigured`, AND AN EARLIER VERSION OF THIS
 * COMMENT DENIED IT. It read *"THE DECLINE REASONS ARE UNCHANGED, and so is
 * every path that was already correct"* — **false as stated**, and a false
 * comment about a predicate's breadth is how the next lane inherits a wrong
 * model. An adversarial review caught it; the numbers below are this lane's own
 * re-measurement at BOTH tips, not the review's, on the fixture named above
 * using the product's shipped `SET_OPTION_VALUES_CHIP.message` (which names no
 * option, so it is exactly the message the tie-break serves).
 *
 * WIDENING THE CANDIDATE SET MAKES THE ONE-CANDIDATE TIE-BREAK AT `:174`
 * STRICTLY HARDER TO REACH. At mid-repair — `needs_encoding = 1` but TWO
 * options still holding an outstanding slot:
 *
 *   base a61fe7ff : matched(`e75f367a`, `sole_unconfigured`)   ← both predicates
 *   head          : decline(`option_not_identified`)            ← both predicates
 *
 * So on that turn the deterministic clarify prose is replaced by the edit
 * lane's generic refusal. That is a real cost and it is disclosed here rather
 * than argued away.
 *
 * ⚠ IT IS NOT AN AFFORDANCE LOSS — measured on the same turn, the identity
 * chip `chip_prompt_repair_effect_value` is still offered, so the user keeps a
 * concrete next step. And the prose that was lost was answering about the
 * WRONG ENTITY: at base the "sole" candidate was `e75f367a` while the product's
 * own blocker was asking about `d8d2df15 × be01ab27`. A tie-break that calls
 * itself "sole" while two options genuinely have outstanding slots is a guess,
 * not a resolution. Both halves are true; neither cancels the other.
 *
 * UNCHANGED, and re-measured: an option with no linked factors, one linked only
 * to non-factor nodes, and one whose factors are all set have NO outstanding
 * slot and still decline `no_unconfigured_option`; two candidates with none
 * named still declines `option_not_identified`.
 */
interface OutstandingOptionSlots {
  readonly optionId: string;
  readonly optionLabel: string;
  /** Capped for copy; the full set stays in the readiness payload. */
  readonly factorLabels: readonly string[];
}

function outstandingSlotsByOption(
  readiness: AnalysisReadyPayload,
): readonly OutstandingOptionSlots[] {
  const byOption = new Map<string, { optionLabel: string; factorLabels: string[] }>();
  for (const pair of deriveMissingEffectPairs(readiness)) {
    const entry = byOption.get(pair.optionId)
      ?? { optionLabel: pair.optionLabel, factorLabels: [] };
    if (
      entry.factorLabels.length < MAX_FACTOR_SUGGESTIONS
      && !entry.factorLabels.includes(pair.factorLabel)
    ) {
      entry.factorLabels.push(pair.factorLabel);
    }
    byOption.set(pair.optionId, entry);
  }
  return [...byOption].map(([optionId, entry]) => ({
    optionId,
    optionLabel: entry.optionLabel,
    factorLabels: entry.factorLabels,
  }));
}

/**
 * ⭐⭐⭐ QUESTION: *WHICH OPTION DID THE USER NAME?* — and nothing else.
 *
 * ── WHY THIS EXISTS, MEASURED ──────────────────────────────────────────────
 * `resolveConfigureOptionFacts` above answers a DIFFERENT question and always
 * did: *"which option can I offer a concrete next step for?"* Its candidate set
 * is `outstandingSlotsByOption`, so it declines `no_unconfigured_option` the
 * moment nothing is outstanding. **A drafted graph arrives already populated,
 * so every later edit is a REVISION, and a revision has no outstanding slot.**
 * Driven live against deployed CEE staging on 14 Sep 2026,
 * `evaluateConfigureOptionOutcome` returned `not_applicable` on **46 of 46**
 * real captured turns while the shipped intent detector matched 46/46.
 *
 * ⚠ THE PRECISE FRAMING, because the loose one sends the next lane at the wrong
 * code: the guard does not reach a WRONG verdict on an already-configured
 * option. **It reaches no verdict in any direction** — a successful revision is
 * exactly as invisible to it as a wrong-entity one. So this is not a guard that
 * needs tightening; it is a guard that is never asked.
 *
 * ── THIS IS A SPLIT, NOT A WIDENING (trap 21) ─────────────────────────────
 * The two bounds that sat in series here guard two different questions, and
 * widening one predicate to cover both would make the product STATE A
 * FALSEHOOD:
 *
 *   TARGET RESOLUTION — *which option did the user name?*
 *     → decides whether the WRITE is guarded.
 *     → an already-configured option is a perfectly good answer. **This
 *       function. No outstanding-slot bound, no sole-unconfigured fallback.**
 *
 *   COPY REPLACEMENT  — *what copy replaces the response?*
 *     → decides what the product SAYS.
 *     → an already-configured option has NO true sentence available, because
 *       the recovery copy asserts *"this option has no effect values yet"*.
 *       **`buildConfigureOptionRecoveryCopy` below. The domain bound STAYS.**
 *
 * ⚠ NO SOLE-UNCONFIGURED FALLBACK, ON PURPOSE. `configure-option-outcome.ts`
 * rejected that fallback outright (its P1 note: *a guess is not an identity*),
 * so carrying it here would only reintroduce a retargeting hazard for a caller
 * that discards it anyway. Every match this function returns was NAMED.
 *
 * Pure. `graph` is the persisted graph; anything that does not strict-parse
 * declines. Safe-biased in the same direction as its siblings: every
 * uncertainty declines, and a decline leaves the pre-existing route untouched.
 */
export type ConfigureOptionTargetDeclineReason =
  | 'not_configure_intent'
  | 'graph_unparseable'
  | 'no_readiness'
  | 'option_not_identified'
  | 'option_label_ambiguous';

export type ConfigureOptionTargetResult =
  | { readonly matched: false; readonly reason: ConfigureOptionTargetDeclineReason }
  | {
      readonly matched: true;
      readonly optionId: string;
      readonly optionLabel: string;
      /** Carried so callers need not recompute it — same payload, one read. */
      readonly readiness: AnalysisReadyPayload;
    };

/** The message/label normalisation `resolveConfigureOptionFacts` uses, verbatim. */
function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function resolveConfigureOptionTarget(params: {
  readonly message: string;
  readonly detection: ConfigureOptionIntentDetection;
  readonly graph: unknown;
}): ConfigureOptionTargetResult {
  if (!params.detection.matched) return { matched: false, reason: 'not_configure_intent' };

  const parsed = GraphV3.safeParse(params.graph);
  if (!parsed.success) return { matched: false, reason: 'graph_unparseable' };

  // DERIVED (trap 12): the SAME canonical readiness payload the badge and the
  // blocker copy are composed from — so this resolver cannot disagree with the
  // user's screen about which options exist or what they are called. The only
  // difference from its sibling is that it reads `options` WHOLE instead of the
  // outstanding-slot projection of them.
  const readiness = buildCanonicalAnalysisReadyFromGraph(params.graph);
  if (readiness === undefined) return { matched: false, reason: 'no_readiness' };

  const normalisedMessage = ` ${normaliseLabel(params.message)} `;

  const matches: Array<{ optionId: string; optionLabel: string; normalised: string }> = [];
  for (const option of readiness.options) {
    const label = option.label;
    if (typeof label !== 'string') continue;
    const normalised = normaliseLabel(label);
    if (normalised.length < 3) continue;
    if (!containsPhrase(normalisedMessage, normalised)) continue;
    if (matches.some((m) => m.optionId === option.option_id)) continue;
    matches.push({ optionId: option.option_id, optionLabel: label, normalised });
  }

  if (matches.length === 0) return { matched: false, reason: 'option_not_identified' };

  // ⭐ A NESTED READING IS ONE READING, NOT TWO CANDIDATES. "Cloud CRM" sitting
  // inside "Cloud CRM Premium" both match a message containing the longer
  // phrase; the user named the longer one and the shorter is an artefact of
  // substring matching. Keep only MAXIMAL labels — those contained in no other
  // match. Two options sharing one normalised label are maximal in each other
  // and therefore correctly fall through to `option_label_ambiguous`.
  const maximal = matches.filter(
    (m) => !matches.some((other) => other !== m && other.normalised.includes(m.normalised)),
  );
  if (maximal.length !== 1) return { matched: false, reason: 'option_label_ambiguous' };

  const target = maximal[0]!;
  return {
    matched: true,
    optionId: target.optionId,
    optionLabel: target.optionLabel,
    readiness,
  };
}

/**
 * QUESTION: *should the deterministic remedy answer this turn INSTEAD of
 * sending it to the edit LLM?*
 *
 * Pure. `graph` is the PERSISTED graph (the caller owns the read and its
 * failure policy); anything that does not strict-parse declines.
 *
 * Behaviour is byte-identical to the pre-2.427 `tryConfigureOptionClarify`,
 * including the `value_payload_present` decline that keeps walk remedy #5 — the
 * path that WORKED — on its existing route. Renamed, not changed: the old name
 * did not say WHICH question it answered, which is how the second question came
 * to be answered by the same predicate.
 */
export function shouldInterceptBeforeEditLane(params: {
  readonly message: string;
  readonly detection: ConfigureOptionIntentDetection;
  readonly graph: unknown;
}): ConfigureOptionClarifyResult {
  if (!params.detection.matched) return decline('not_configure_intent');

  // The load-bearing discriminator FOR THIS QUESTION: a configure message that
  // names a factor AND a value has something to write, and the edit lane is the
  // right place for it. Never consulted by the recovery sibling below — after
  // the edit lane has already failed, the value payload says nothing about
  // whether the user needs the copy.
  if (carriesConfigureOptionValuePayload(params.message)) {
    return decline('value_payload_present');
  }

  return resolveConfigureOptionFacts(params);
}

/**
 * ⭐ ROADMAP 2.427 — QUESTION: *the edit lane has already run and the option
 * was NOT recorded; can we name the option, its still-unset factors, and the
 * sentence that writes it?*
 *
 * This is a RECOVERY predicate, and it is reached only from the failure path
 * (`evaluateConfigureOptionOutcome` has already established that no
 * interventions write landed for the resolved option). It therefore does NOT
 * consult `carriesConfigureOptionValuePayload`: on this question a value
 * payload is not evidence that the edit lane is the right destination — the
 * edit lane already had its turn and produced nothing for this option.
 *
 * `graph` should be the POST-edit graph when one exists, falling back to the
 * pre-edit graph: the copy must describe what is STILL unset after whatever the
 * edit did land, not what was unset before it ran.
 *
 * Same safe bias as its sibling: every path that cannot name a concrete next
 * step declines, and a decline leaves the pre-existing copy in place.
 */
export function buildConfigureOptionRecoveryCopy(params: {
  readonly message: string;
  readonly detection: ConfigureOptionIntentDetection;
  readonly graph: unknown;
}): ConfigureOptionClarifyResult {
  // ⭐⭐ BOUND A — IDENTITY, and this is the ONE thing that moved. It used to
  // come from `resolveConfigureOptionFacts`, whose candidate set is the
  // OUTSTANDING-SLOT projection — so on a revision (nothing outstanding) this
  // predicate declined `no_unconfigured_option` before the domain bound below
  // was ever reached, and the caller flattened that to `option_not_identified`:
  // a name for a resolution failure that was never attempted.
  //
  // Worse than the misleading name, and the reason this could not simply be
  // left alone: with the outstanding-slot candidate set, a message NAMING a
  // configured option found no match among the candidates and fell through to
  // the `sole_unconfigured` tie-break, silently resolving to a DIFFERENT
  // option. The copy predicate could answer about an entity the user had not
  // named — the wrong-entity class this module exists to remove, occurring
  // inside the module.
  //
  // `resolveConfigureOptionFacts` itself is UNTOUCHED: `shouldInterceptBefore
  // EditLane` shares it and answers a question for which the outstanding-slot
  // candidate set is exactly right.
  const target = resolveConfigureOptionTarget(params);
  if (!target.matched) return decline(target.reason);
  const readiness = target.readiness;

  // ⭐⭐ THE DOMAIN BOUND, UNCHANGED — and now stated at the question that owns
  // it rather than smuggled in through the shared candidate set.
  //
  // It used to be implicit: the resolver only ever considered `needs_encoding`
  // options, so this predicate inherited the bound for free. Correcting the
  // resolver's candidate set (see `outstandingSlotsByOption` — a partially
  // configured option IS a legitimate intercept target) would have removed the
  // bound from HERE too, silently, and
  // `configure-option-outcome.test.ts`'s `DOMAIN BOUND` pin went RED and said
  // so. That pin is right and it stays.
  //
  // WHY THE TWO QUESTIONS DIFFER (trap 21 again, and it is the same split this
  // file already documents): the intercept asks *"can I name a slot the user
  // should fill?"* — true of a partially configured option. The recovery copy
  // asserts *"this option has no effect values yet, so the analysis cannot
  // compare it"* — FALSE of an option already carrying one value and being
  // given a second. Widening the predicate without a second copy variant would
  // trade a false success for a false NOTICE: the same harm, opposite sign.
  // The residual (a wrong-entity write against a partially configured option
  // raises no notice) is unchanged by this lane, and still rowed.
  const option = readiness.options.find((o) => o.option_id === target.optionId);
  if (option?.status !== 'needs_encoding') return decline('option_already_partially_configured');

  // ⭐ BOUND C — MATERIAL. The copy names REAL, still-unset, linked factors or
  // it is not offered: "never invented" is this module's whole posture. Read
  // from the outstanding-slot projection, which is the estate's owner of
  // "which option×factor slots are unset" (trap 12 — derive, do not re-spell).
  // `optionLabel` comes from the same entry as the factors, so the copy cannot
  // name one option and list another's factors.
  const slots = outstandingSlotsByOption(readiness).find((s) => s.optionId === target.optionId);
  if (slots === undefined || slots.factorLabels.length === 0) {
    return decline('no_candidate_factor');
  }

  return {
    matched: true,
    optionId: target.optionId,
    optionLabel: slots.optionLabel,
    factorLabels: slots.factorLabels,
    readiness,
    // Every match is NAMED now — the sole-unconfigured tie-break belongs to the
    // intercept question, and the only caller of this one discarded it anyway.
    optionSource: 'named_in_message',
  };
}
