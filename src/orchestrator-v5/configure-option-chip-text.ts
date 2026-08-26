/**
 * ROADMAP 2.11 / P0-2+P1-3 — the SINGLE source of configure-option chip
 * copy.
 *
 * Every surface that offers "configure this option" (the
 * `options_not_configured` recovery composer, the GM held-apply receipt)
 * builds its chip from here, and the deterministic route-v2 gate
 * (`routing/configure-option-intent.ts`) matches the SAME prefix — so the
 * chip message and the route can never drift apart (trap-12: derive, don't
 * mirror). Before this module, the chip copy lived inline in
 * `handler-failure-responses.ts` while routing knew nothing about it: the
 * system's own chip message routed to `adjust_edge_strength` and closed the
 * live infinite loop documented in the 2.11 diagnosis brief (scenario A,
 * A6→A7).
 *
 * Dependency-free on purpose: imported by both routing and compose without
 * cycle risk.
 */


/**
 * The load-bearing prefix. `detectConfigureOptionIntent` treats any message
 * starting with this as configure-option intent (chips replay their message
 * as user text, and "help me configure …" is unambiguous configure intent
 * in this product's vocabulary).
 */
export const CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX = 'Help me configure ';

/** Build the chip MESSAGE for a (render-safe) option reference. */
export function buildConfigureOptionChipMessage(entityRef: string): string {
  return `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}${entityRef}.`;
}

export interface ConfigureOptionChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
}

/**
 * The labelled configure chip (`options_not_configured` with a usable
 * label; GM held-apply receipt for a needs-encoding option).
 */
export function buildConfigureOptionChip(entityRef: string): ConfigureOptionChip {
  return buildConfigureOptionChipWithDisplay(entityRef, entityRef);
}

/**
 * ⭐⭐ THE SAME CHIP WHEN THE CALLER HOLDS A SHORTENED DISPLAY FORM — one
 * implementation, two entry points, and NO optional flag.
 *
 * WHY IT EXISTS, measured at pristine `7abed98e` on the live-journey capture
 * `tests/unit/ci/fixtures/live-journey-draftfirst-turn1-2ceb65f.json`:
 * `coaching/readiness-recovery.ts` elides every label it resolves to 40
 * characters (`MAX_LABEL_CHARS`, for the on-screen sentence) and then handed
 * THAT string to `buildConfigureOptionChip` — so the chip's MESSAGE read
 *
 *   "Help me configure open a second bakery location in Leeds…."
 *
 * naming an entity that exists in no graph. `detectConfigureOptionIntent`'s
 * label anchor cannot match it and `resolveOptionEffectWrite` returns
 * `not_effect_framed_intent`: the product's own repair chip could not route
 * back into the lane that offered it — ROADMAP 2.11's closed loop, re-minted by
 * a display cut.
 *
 * ⚠ #1041 (N26) DOES NOT CLOSE THIS, and the distinction is the whole point.
 * That change made the CUT honest — `elideLabelAtWordBoundary` is bracket-aware,
 * so the on-screen sentence no longer breaks mid-parenthesis. An honest cut is
 * still a cut: `…in Leeds…` names no node either. The two fixes compose —
 * #1041 owns what the user READS, this owns what the product REPLAYS.
 *
 * The split is the fix and it belongs HERE rather than at the call site: a
 * caller that rebuilt `Configure ${label}` itself would be a second spelling of
 * this chip's copy, which is the drift this module exists to make impossible
 * (CLAUDE.md trap 12). The MESSAGE is always the full entity reference; only
 * the LABEL may be shortened, because only the label is display.
 */
export function buildConfigureOptionChipWithDisplay(
  entityRef: string,
  displayRef: string,
): ConfigureOptionChip {
  return {
    id: 'chip_prompt_configure_option',
    label: `Configure ${displayRef}`,
    message: buildConfigureOptionChipMessage(entityRef),
  };
}

/** The generic fallback chip (no safe label available). */
export const CONFIGURE_OPTION_GENERIC_CHIP: ConfigureOptionChip = Object.freeze({
  id: 'chip_prompt_configure_option_generic',
  label: 'Configure an option',
  message: buildConfigureOptionChipMessage('one of my options'),
});

/**
 * ROADMAP 2.308 / S2(b) — the post-draft readiness chip ("Set values for
 * options"), moved here from `handlers/draft-graph-dispatch.ts`.
 *
 * Its previous message — `'Help me set up the options for this decision so
 * the analysis can run.'` — was blocked TWICE over (2.308 diagnosis §7 row 3,
 * re-measured at `a5a3e22a`):
 *
 *   1. NO_MATCH at `detectConfigureOptionIntent`. The gate's chip trigger is
 *      the `Help me configure ` prefix; this chip never adopted it.
 *   2. A hit on `EDIT_GRAPH_NEGATIVE_REGEX` via the phrasal verb "set up",
 *      which route-v2 applies to the configure gate as a shared negative —
 *      so even a matching detector would NOT have dispatched it.
 *
 * "The product's own 'Set values for options' readiness chip is not in its own
 * configure vocabulary" — the ROADMAP-2.11 defect surviving in the sibling
 * chip the 2.11 fix did not cover. Building the message from the shared prefix
 * fixes both blocks at once and, because it is DERIVED, cannot drift back
 * (trap 12). The chip's `id` and `label` are unchanged: this is a routing fix,
 * not a UI-surface change.
 */
export const SET_OPTION_VALUES_CHIP_LABEL = 'Set values for options';

/**
 * The load-bearing half. Every producer of a "Set values for options" chip
 * MUST build from this — `handlers/draft-graph-dispatch.ts` (post-draft) and
 * all four sites in `compose/chip-generator.ts` (the readiness floor at
 * `needs_encoding` — i.e. the 2.308 blocked state itself — and the three
 * analyse/decide-stage fallbacks). The first cut of 2.308 converted only the
 * post-draft producer, which left the chip a blocked tester actually sees
 * still carrying the doubly-blocked literal.
 */
export const SET_OPTION_VALUES_CHIP_MESSAGE = `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}the options for this decision so the analysis can run.`;

export const SET_OPTION_VALUES_CHIP: ConfigureOptionChip = Object.freeze({
  id: 'chip_prompt_set_option_values',
  label: SET_OPTION_VALUES_CHIP_LABEL,
  message: SET_OPTION_VALUES_CHIP_MESSAGE,
});

/**
 * ⭐ ROADMAP 2.308 / S2(a) — THE phrasing the assistant is allowed to advise
 * when it needs an option's effect value.
 *
 * The edit lane's "what value?" reply used to suggest
 * `'Set Customer Retention Investment to £40,000'` and
 * `'Set retention investment to 0.8'`. Both are NO_MATCH against the configure
 * gate (diagnosis §2c rows 2 / 2b): "the assistant suggests phrasings that
 * cannot return to the lane that suggested them: a closed loop, minted by the
 * product's own copy." Neither can simply be made to match — they name a
 * FACTOR and carry no option reference, so claiming them would reroute every
 * plain "set X to N" off `set_factor_value` into the edit LLM, the blast
 * radius the diagnosis explicitly refused.
 *
 * This shape is the one that works, and it is not a guess: it is probe P1
 * (diagnosis §5) verbatim — sent to deployed CEE `a5a3e22`, it flipped
 * `analysis_ready` from `needs_encoding` to `ready`, wrote
 * `interventions: {fac_retention_investment: 1}`, and the analysis then ran
 * (§6c). It anchors on the literal word "option" (via `option's`), so it needs
 * no label list and routes on `effect_vocab` on any turn, in any scenario.
 */
export function buildConfigureOptionAdvisedFormat(
  optionRef: string,
  factorRef: string,
  value: string,
): string {
  return `Set ${buildOptionEffectReference(optionRef, factorRef)} to ${value}`;
}

/**
 * ⭐ THE NOUN PHRASE THAT NAMES ONE option × factor SLOT, and the estate's only
 * spelling of it.
 *
 * It was inlined in `buildConfigureOptionAdvisedFormat` above. Extracted —
 * byte-identically — because the identity-carrying repair chip below needs the
 * SAME phrase without a value, and a chip that spelled the phrase itself would
 * drift from the one the router's `effect_vocab` trigger is calibrated against
 * the first time either is edited (CLAUDE.md trap 12: the second spelling is
 * the one that rots). One phrase, two sentences.
 */
export function buildOptionEffectReference(optionRef: string, factorRef: string): string {
  const ref = typeof optionRef === 'string' ? optionRef.trim() : '';
  // ⭐ AN EMPTY OPTION REF IS THE "LEAVE IT TO THE OUTSTANDING ASK" FORM, and it
  // is HERE rather than in a second helper because a second spelling of this
  // noun phrase is precisely what the note above bans (trap 12).
  //
  // ⚠ IT EXISTS BECAUSE THE FULL-LABEL FORM CAN BE UNROUTABLE, and that was
  // MEASURED, not anticipated. Real drafted option labels are the user's own
  // brief fragments (84–101 characters on the captured 18 Aug graph), and every
  // user-facing rendering passes them through `safeLabel`, which TRUNCATES. Fed
  // back verbatim, the truncated sentence carries enough of the option's
  // distinctive vocabulary for `messageCarriesOptionCue` to say "the user named
  // a particular option" while no full label matches — so
  // `resolveOptionEffectWrite` correctly declines `option_not_named` and rule 3b
  // never runs. Measured at `65445df`: the truncated exemplar resolves
  // `{matched:false, reason:'option_not_named'}` and this form resolves
  // `{matched:true, kind:'write', optionId:'4abad64d'}` on the same graph.
  //
  // **Advising a sentence the product cannot execute is the P8 defect this
  // estate has already paid for twice.** Any copy that puts an exemplar in front
  // of a user must use the form that routes.
  return ref.length > 0
    ? `the ${ref} ${OPTION_EFFECT_ANCHOR} ${factorRef}`
    : `the ${OPTION_EFFECT_ANCHOR} ${factorRef}`;
}

/**
 * ⭐ THE LABEL-INDEPENDENT ANCHOR of the option-effect noun phrase, and the one
 * spelling of it. `buildOptionEffectReference` composes FROM it and
 * `messageNamesOptionEffectSlot` recognises BY it, so the sentence the product
 * advises and the sentence it can recognise cannot drift apart (trap 12 — the
 * second spelling is the one that rots). The dependency deliberately points
 * this way: the constant is the source, both directions derive.
 */
const OPTION_EFFECT_ANCHOR = "option's effect on";

/**
 * ⭐⭐ DOES THIS MESSAGE ALREADY NAME AN OPTION × FACTOR SLOT? — i.e. is the
 * IDENTIFICATION complete, whatever the message does or does not say about a
 * value?
 *
 * ## Why this is a SHAPE predicate and not a string comparison
 *
 * The obvious implementation is `message === buildRepairPairChipMessage(option,
 * factor)` for the pair the composer holds. **It would be dark in production,
 * and green in any fixture that supplies both sides.** Derived at the bytes:
 * the chip's message is built in `coaching/readiness-recovery.ts` from
 * `deriveAskedEffectPair(analysisReady)` — `asked.optionLabel` /
 * `asked.factorLabel` — while the composer's labels arrive from
 * `configure-option-outcome.ts` as `recovery.optionLabel` /
 * `recovery.factorLabels`, a SECOND resolution against a DIFFERENT graph whose
 * own header states that nothing structurally forces it onto the same shape.
 * Two derivations, no guarantee of equality — so an equality predicate is a
 * guard that agrees with the test fixture and nothing else (trap 13b).
 *
 * Matching the ANCHOR instead asks the question that actually matters, and asks
 * it about the message alone: *does this sentence name an option's effect on a
 * factor?* Labels never enter, so the two derivations cannot desynchronise it.
 *
 * ## What it deliberately does NOT decide
 *
 * Nothing about a value. `"…effect on Y to 0.6"` satisfies this too — and must,
 * because the predicate answers "is the slot named?", not "did the user give me
 * a number?" (trap 21: two questions, two names). The caller composes it with
 * the value predicates that already exist; conflating them here would rebuild
 * the same conjunction in a second place.
 */
export function messageNamesOptionEffectSlot(message: string): boolean {
  if (typeof message !== 'string') return false;
  // Normalise the typographic apostrophe: user-facing copy round-trips through
  // surfaces that substitute it, and a slot named with a curly quote is the
  // same slot.
  const normalised = message.replace(/[‘’]/g, "'").toLowerCase();
  return normalised.includes(OPTION_EFFECT_ANCHOR);
}

/**
 * ⭐⭐ THE IDENTITY-CARRYING REPAIR AFFORDANCE — the chip the product offers
 * when its own readiness blocker says one option × factor slot has no value.
 *
 * WHAT IT SUPERSEDES. The `provide_value` recovery class used to mint
 * `chip_prompt_configure_option` from an OPTION LABEL ALONE — no factor, and
 * (see `buildConfigureOptionChipWithDisplay`) an ellipsis-truncated one at
 * that. Witnessed on deployed UI `aa916511` / CEE `7abed98` (19 Aug 2026, fresh
 * guest, brief `04-conflicting-constraints`): a chip was offered for a pair the
 * user had ALREADY set, clicking it made zero progress — *"was already set to
 * 0.8 in the previous turn"* — and the turn that followed carried no chips at
 * all. A chip that names only an option leaves the model to choose WHICH of
 * that option's factors it meant, and it chose one that was already resolved.
 *
 * WHY NAMING THE PAIR IS THE FIX AND NOT MERELY BETTER COPY: the pair comes
 * from `deriveAskedEffectPair` — the estate's one owner of "which slot is the
 * product currently asking about" — so the chip cannot name a slot the product
 * is not asking about, cannot name a slot that already has a value (a resolved
 * slot has no blocker), and cannot name a slot with no option→factor edge (the
 * producer derives `missing_value` blockers strictly from the option→factor
 * adjacency, `cee/transforms/analysis-ready.ts`). All three of those are
 * properties of the CANDIDATE SET, inherited rather than re-checked here.
 *
 * ⚠ WHAT IT DELIBERATELY DOES NOT DO: carry a value. The value is the one thing
 * in this slot that is not a derivable fact about the graph, and a chip bearing
 * a plausible number would put a fabricated intervention one click away behind
 * a control that reads as the product's recommendation (the posture
 * `configure-option-clarify.ts` states at length). So this chip completes the
 * IDENTIFICATION and leaves the number to the user; the value-bearing siblings
 * (`chip_prompt_repair_value_bind_*`, the outstanding-ask chip) fire only once
 * the user has supplied one.
 */
export function buildRepairPairChipMessage(optionRef: string, factorRef: string): string {
  return `${CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX}${buildOptionEffectReference(optionRef, factorRef)}.`;
}

/**
 * ⚠⚠ THIS MODULE OWNS NO DISPLAY BUDGET, AND THAT IS THE POINT.
 *
 * The first cut of this function declared `REPAIR_PAIR_CHIP_LABEL_MAX = 48` and
 * elided the factor itself. An adversarial review named it correctly: ONE
 * ELIDER AUTHORITY (right — #1041/N26) and TWO BUDGETS FOR ONE SEAM (wrong).
 * The same factor rendered one cut in the prose at 40 and a different cut on
 * the chip at 48 — both honest, of the same label, on the same turn,
 * disagreeing. 48 had no measured justification; I picked it.
 *
 * THE FIX IS NOT A FOURTH CONSTANT. `MAX_LABEL_CHARS = 40` is already declared
 * privately in `coaching/readiness-recovery.ts` AND
 * `coaching/post-draft-narrative.ts`, and mirrored as a literal in N26's
 * acceptance spec; a fifth name for the same number here would deepen the
 * accretion it is meant to remove. Instead the CALLER passes the display form,
 * cut from the SAME string the message carries with the SAME budget it uses for
 * its own prose — so the chip label and the sentence beneath it cannot
 * disagree. This module goes back to being dependency-free.
 *
 * ⚠ ROWED, NOT DONE: unifying the three private `MAX_LABEL_CHARS` declarations
 * behind one exported budget is real work in #1041's files and needs its pinned
 * spec literals moved first. Out of scope here, and named so the next reader
 * does not mistake "not converted" for "does not exist".
 *
 * `factorDisplayRef` is REQUIRED, not optional: an optional display argument is
 * a hand-maintained mirror of the caller's diligence, and this estate has
 * watched exactly that shape drift (trap 12 — the `valueAlreadySupplied?:
 * boolean` note in `compose/configure-option-clarify-response.ts`).
 */
export function buildRepairPairChip(
  optionRef: string,
  factorRef: string,
  factorDisplayRef: string,
): ConfigureOptionChip {
  return {
    id: 'chip_prompt_repair_effect_value',
    label: `Set effect on ${factorDisplayRef}`,
    message: buildRepairPairChipMessage(optionRef, factorRef),
  };
}

/**
 * The advised format for embedding in prompt copy. Derived from the builder
 * above so a prompt and a live suggestion can never diverge.
 *
 * ⚠ THE VALUE SLOT CARRIES A CONCRETE NUMBER, NOT `'<0-1>'` (NEW-5, 2026-08-16).
 * `<option>` and `<factor>` are placeholders the MODEL substitutes before the
 * sentence is ever shown — the value slot was not: the prompt told the model to
 * advise "exactly this phrasing", so `<0-1>` was reproduced verbatim into user
 * copy and a strategic user was asked to expand a template by hand. A real
 * number is what the model should be advising, and the routing witness accepts
 * a decimal exactly as it accepted the placeholder (it requires only a digit
 * after `to`). The 0-1 scale is stated in the prompt block that embeds this.
 */
export const CONFIGURE_OPTION_ADVISED_FORMAT_TEMPLATE = buildConfigureOptionAdvisedFormat(
  '<option>',
  '<factor>',
  '0.6',
);

/**
 * ⭐⭐ THE ONE SENTENCE THAT TELLS A USER WHERE TO SET AN OPTION'S EFFECT BY
 * HAND — and the estate's only spelling of that locus.
 *
 * ## What it supersedes, and why the old spelling was FALSE
 *
 * `compose/configure-option-clarify-response.ts` used to end its terminating
 * branch with its own inline sentence:
 *
 *   "…open "<option>" on the canvas and enter the value on its LINK to <factor>."
 *
 * Derived at the UI tip `3f59325a` (`DecisionGuideAI`, staging): an
 * option→factor edge is `isIntervention` (`inspector-v2/panels/EdgePanel.tsx:180`)
 * and its branch (`:305-311`, testid `intervention-edge-notice`) renders TWO
 * `<p>` tags and NO CONTROLS AT ALL. Contrast control, same file: the causal
 * branch at `:313-472` carries the strength/existence/std sliders — so the
 * absence is real, not a blind read. A witness followed that sentence to a
 * dead end on 2026-08-19.
 *
 * ## ⛔ AND THE CANVAS SPELLING THAT REPLACED IT WENT FALSE TOO — ROADMAP 2.1269
 *
 * The second spelling was:
 *
 *   "To set it directly, open "<option>" on the canvas and add <factor> to what
 *    it changes."
 *
 * It was right about WHICH FIELD the write targets (`data/interventions/<factorId>`
 * on the OPTION node, `op: 'update_node'`, pinned by
 * `graph-management/__tests__/option-effect-write-apply-chain.test.ts`) and wrong
 * about whether a user can reach it. The canvas option panel renders the
 * intervention row inside a DISABLED fieldset and writes nothing.
 *
 * DERIVED AT THE SERVED BUNDLE (`ReactFlowGraph-ozVez5O5.js`): `disabled:!0` is a
 * literal there; EXACTLY TWO fieldset sites exist in the whole bundle and BOTH
 * are disabled; ZERO `removeAttribute("disabled")`; ZERO `createPortal` in
 * `inspector-v2`, against a live contrast elsewhere in the same bundle. A forced
 * native write on 2026-08-25 produced ZERO wire calls, and the panel's own notice
 * says the change "cannot yet be saved to the shared model".
 *
 * ⚠⚠ RUNG, STATED EXACTLY: **DERIVED AT THE SERVED BUNDLE — NOT DOM-WITNESSED.**
 * No lane has observed a real `:disabled` computed state in a browser. Do not
 * read this header as claiming that rung.
 *
 * The old sentence was WITNESSED reaching a real user's read surface verbatim on
 * deployed CEE `c24bfe3` (signed-in wire drive, 14/14 Route-A probes, 2 users,
 * 2 scenarios, `llm_calls: []`).
 *
 * ## Why the destination is now CHAT, and why it takes no arguments
 *
 * Chat is the only destination witnessed to land this write
 * (`interventions: {…, source: "user_specified"}`, verified after reload). Every
 * hand-editing surface in the UI is currently inert for an option's effect value
 * — the canvas panel (above), the Model tab (`editConnectedIds` is built from
 * FACTOR nodes only, `ModelTabV2Panel.tsx:216-220`, so `editorAvailable` is false
 * for every option and `ValueCell` renders a `<span>`), and the Model tab's
 * options section (`OptionsSection.tsx:321-330` does render a real `InlineEdit`,
 * but `ModelTabBody.tsx:120` sets `LEGACY_DETAILED_EDITOR_MOUNTED = false`, so it
 * is DEAD). Naming any of them would repeat this sentence's own history.
 *
 * ⭐⭐ IT TAKES NO ARGUMENTS, AND THAT IS THE POINT. It must not ask the user to
 * reproduce the option label: the UI's `safeLabel` truncates option labels at 60
 * characters (the 2026-08-18 capture recorded real labels of 84-101), and
 * `resolveOptionEffectWrite` returns `option_not_named` on a truncated label — so
 * a user who copies the label AS THE PRODUCT RENDERS IT cannot name it back. Chat
 * works for the BARE-NUMBER form and fails for the label-bearing form. A builder
 * that CANNOT receive a label cannot invite one; that is a structural guarantee
 * rather than a promise the next reword could quietly drop. The caller still
 * names the option once, honestly, in the sentence above this one.
 *
 * ⚠ THE DECIMAL EXEMPLAR IS LOAD-BEARING, NOT STYLE. `matchBareRepairValue`
 * deliberately REFUSES a bare integer as "an ordinal in disguise" (a naked `1`
 * measured binding as an effect value of 1.0 while the user meant "the first
 * one"), so copy inviting "1" would invite the one token that will not bind.
 * `0.6` is the estate's existing exemplar and is wire-proven to route; #1113
 * created exactly this collision in its own copy and had to correct it.
 *
 * The literal is spelled here rather than imported: this module is
 * dependency-free ON PURPOSE (compose imports IT), so importing
 * `CONFIGURE_OPTION_EXAMPLE_VALUE` would be a cycle — and minting a local
 * constant would be the fifth name for one number, the accretion the
 * `buildRepairPairChip` header above already refuses. Agreement between the two
 * is asserted in
 * `compose/__tests__/configure-option-answered-locus-can-save.test.ts`, so drift
 * REDs instead of going quiet.
 *
 * ## The shape to notice
 *
 * Twice now this sentence named a locus that was correct when written and went
 * false when the surface beneath it changed — a cross-service hand-maintained
 * mirror (CLAUDE.md trap 12), exactly as the header of its own previous version
 * warned. Pointing at chat removes the mirror: the destination is a surface this
 * service owns.
 */
export function buildConfigureOptionDirectSetSentence(): string {
  return "Send me just the number here — 0.6, say — and I'll set it on that link.";
}
