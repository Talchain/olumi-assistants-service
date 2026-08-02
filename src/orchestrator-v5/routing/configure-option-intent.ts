/**
 * ROADMAP 2.11 / P0-2 (deterministic half) — configure-option intent
 * detector.
 *
 * Live-proven gap (diagnosis brief add-option-2.11.md §2, staging 57959b2,
 * 2026-07-16): "configure {option}" phrasings — INCLUDING the system's own
 * `options_not_configured` recovery-chip message — carried no
 * EDIT_GRAPH_POSITIVE_REGEX verb, fell through to the LLM router, and were
 * routed to `adjust_edge_strength`, which writes edge strength: a field
 * PLoT's preflight ignores. The user looped forever (chip → edge tweak →
 * analysis still blocked → same chip) while every sentence CEE said was
 * individually true.
 *
 * This detector is the deterministic gate that routes the intent to the
 * EDIT LANE instead, where the served edit prompt (PMS edit_graph v11,
 * verified 2026-07-16) emits the sanctioned `update_node`
 * `/nodes/<opt>/data/interventions/<factor_id>` vocabulary — the one chat
 * path that WRITES option interventions (field-safety allowlist →
 * D-S would_apply → patch applier → `mergeInterventionSources`).
 *
 * Triggers (any one):
 *   1. `chip_prefix` — the message starts with the shared chip prefix
 *      ("Help me configure …"). Chips replay their message as user text;
 *      the prefix comes from `configure-option-chip-text.ts`, the SAME module
 *      the chip composers build from, so chip copy and route cannot drift
 *      apart (trap-12: derive, don't mirror). Deliberately label-free: the
 *      chip only exists when options exist, and the intent is unambiguous
 *      even if the label round-trip degraded.
 *   2. `configure_vocab` — configure vocabulary ("configure", "configuring",
 *      "configuration") anchored to options (the word "option(s)" or a
 *      full option label).
 *   3. `intervention_vocab` — intervention vocabulary ("intervention(s)")
 *      anchored to options the same way. This is what catches
 *      "set {option}'s {factor} intervention to X"-class messages that the
 *      value-update gate would otherwise send to `set_factor_value` (where
 *      the option-intervention misroute guard can only refuse-to-clarify,
 *      not write).
 *
 * Safe-biased like its sibling guard (`option-intervention-guard.ts`): a
 * false positive costs an edit-lane turn (the edit LLM clarifies or
 * no-ops); a false negative is the live infinite loop. The caller (route-v2)
 * applies the shared negative gates — meta-question regex, analytical
 * question, state query — before dispatching.
 */

import { CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX } from '../configure-option-chip-text.js';
import { containsPhrase } from './option-intervention-guard.js';

export type ConfigureOptionIntentTrigger =
  | 'chip_prefix'
  | 'configure_vocab'
  | 'intervention_vocab'
  | 'effect_vocab'
  | 'option_value_set';

export type ConfigureOptionIntentDetection =
  | { readonly matched: true; readonly trigger: ConfigureOptionIntentTrigger }
  | {
      readonly matched: false;
      /**
       * ROADMAP 2.308 / S1 — would an option LABEL anchor have flipped this
       * verdict? True only when the message carries one of the anchored
       * triggers' payloads AND nothing already anchored it.
       *
       * DERIVED, never mirrored (trap 12): computed by re-running the SAME
       * classifier with the anchor granted, so it cannot drift from the
       * trigger set it describes. The route uses it to decide whether a
       * persisted-graph read could possibly change the routing decision —
       * i.e. it is the guard that keeps the read off turns it cannot help.
       */
      readonly labelAnchorWouldDecide: boolean;
    };

const NO_MATCH: ConfigureOptionIntentDetection = {
  matched: false,
  labelAnchorWouldDecide: false,
};

/** "configure"/"configuring"/"configuration" — whole-word, case-insensitive. */
const CONFIGURE_VOCAB = /\bconfigur(?:e|es|ed|ing|ation)\b/;

/** "intervention"/"interventions" — whole-word, case-insensitive. */
const INTERVENTION_VOCAB = /\binterventions?\b/;

/** "option"/"options" (apostrophe is a word boundary, so "option's" hits). */
const OPTION_WORD = /\boptions?\b/;

/**
 * POC-BOARD 5c (Step-0 trust-spine captures T12/T12c/T15, 2026-07-17) —
 * three additional live shapes that must claim the edit lane. The original
 * trigger set required configure/intervention VOCAB plus an option-word or
 * option-LABEL anchor; on the live wire route-v2 has NO labels to anchor
 * with (the request carries no graph_state), so:
 *
 *   T12  "Configure Cloud-Native CRM: set its CRM Feature Depth to 0.7 …"
 *        (configure vocab, option named by LABEL only) fell to the LLM
 *        router → adjust_edge_strength → guard refusal dead-end;
 *   T12c "Under the Cloud-Native CRM option, set its effect on CRM Feature
 *        Depth to 0.7." ("effect", not "intervention") → the wrong-thing
 *        link-strength write — the exact old "Adjusted the link…" loop;
 *   T15  "Set CRM Feature Depth to 0.7 … for the Cloud-Native CRM option."
 *        — the assistant's OWN suggested format (T14) — routed to the
 *        value-update path whose option-intervention guard can only
 *        refuse-to-clarify: the assistant suggested a phrasing it then
 *        rejected, a closed loop.
 */

/** "effect"/"effects" — the lay synonym for an option's interventions. */
const EFFECT_VOCAB = /\beffects?\b/;

/**
 * Assignment verbs that make effect-vocabulary a mutation request.
 *
 * REVIEW-573 C-2: "make" was removed after two adversarial phrasings
 * proved it claims conversational STATEMENTS for the edit lane — C1d
 * "Make sure the effects on both options are captured." (a meta-request)
 * and C1e "The options make no difference to the effect here." (an
 * observation) both matched via `make` + effect + option-word anchor,
 * and both classify `structural` in the edit lane, whose resolution mode
 * is auto_apply — leaving mutation-vs-no-op entirely to the edit LLM's
 * judgement. With `make` excluded, both stay on the pre-PR LLM-router
 * path. The genuine configure shapes keep an explicit assignment verb
 * ("set/change/update/adjust/revise/configure … effect …"), including the
 * qualitative no-digit form "Set the {option} option's effect on
 * {factor} to high" that VALUE_SET_PAYLOAD (digit-anchored) cannot see.
 */
const EFFECT_ASSIGN_VERB = /\b(?:set|change|update|adjust|revise|configure)\b/;

/**
 * A value-assignment payload: an assignment verb … "to" … a number
 * (optional currency symbol). Bounded to one sentence so a verb in one
 * sentence cannot borrow a number from the next. This is (a) the stand-in
 * ANCHOR for configure-vocabulary messages that name the option only by a
 * label the route cannot see (T12), and (b) the spine of the
 * `option_value_set` trigger (T15). Safe-biased by design: a false
 * positive costs one edit-lane turn (the edit LLM clarifies or no-ops); a
 * false negative is a refusal dead-end or a wrong-entity write.
 */
const VALUE_SET_PAYLOAD = /\b(?:set|change|update|adjust|revise)\b[^.?!]*\bto\b\s*(?:£|\$|€)?\s*\d/;

/**
 * Question-shape suppressor — mirrors the vague-edit guard's doctrine
 * (either signal alone suffices): configure INTENT is imperative, and
 * mutating the graph on a question ("what did you just configure on my
 * options?", "could configuring an option help?") is the worst failure
 * mode. HONEST LIMIT: a suppressed question falls through to the LLM
 * router with NO deterministic backstop — the turn-executor's
 * adjust_edge_strength misroute guard calls THIS detector, so the same
 * question-lead suppression fires there too. A question-shaped configure
 * message the LLM router misroutes to adjust_edge_strength is refused
 * only if the router's own gates catch it. A question-tolerant backstop
 * (vocabulary-only match at the refusal site) is a deliberate follow-up,
 * not built here. The chip-prefix trigger is checked BEFORE this
 * suppressor: chip messages are the product's own copy and never
 * question-shaped.
 */
const QUESTION_LEAD_PATTERN =
  /^(?:what|how|why|when|where|who|which|can|could|would|should|does|do|is|are|will)\b/;

/**
 * The trigger classifier — the SINGLE place the trigger set lives.
 *
 * Split out of `detectConfigureOptionIntent` (ROADMAP 2.308 / S1) so the
 * "would a label anchor decide this?" question can be answered by re-running
 * THIS function with `anchored` granted, rather than by a second predicate
 * that would have to be kept in step by hand (trap 12: the dominant defect is
 * the hand-maintained mirror). Every trigger below is byte-identical to the
 * pre-2.308 inline sequence, in the same order.
 */
function classifyConfigureOptionTrigger(
  normalised: string,
  anchored: boolean,
): ConfigureOptionIntentTrigger | null {
  const hasConfigureVocab = CONFIGURE_VOCAB.test(normalised);
  const hasInterventionVocab = INTERVENTION_VOCAB.test(normalised);
  const hasValueSetPayload = VALUE_SET_PAYLOAD.test(normalised);

  // Triggers 2–3 — configure / intervention vocabulary, anchored.
  if ((hasConfigureVocab || hasInterventionVocab) && anchored) {
    return hasConfigureVocab ? 'configure_vocab' : 'intervention_vocab';
  }

  // Trigger 2b (T12) — configure vocabulary with a value-set payload but no
  // visible anchor: "Configure {option label}: set {factor} to 0.7". On the
  // live wire route-v2 has no labels to anchor with (graph_state absent),
  // so the assignment payload stands in as the anchor. A configure-verb
  // imperative that assigns values is an edit whatever it names — the edit
  // lane is the correct destination for factor configures too.
  if (hasConfigureVocab && hasValueSetPayload) {
    return 'configure_vocab';
  }

  if (!anchored) return null;

  // Trigger 4 (T12c) — effect vocabulary, anchored, with an imperative edit
  // verb: "Under the {option} option, set its effect on {factor} to 0.7."
  // "Effect" is the lay synonym for an intervention; without this trigger
  // the message routes to adjust_edge_strength and WRITES the wrong field.
  if (EFFECT_VOCAB.test(normalised) && EFFECT_ASSIGN_VERB.test(normalised)) {
    return 'effect_vocab';
  }

  // Trigger 5 (T15) — an anchored value assignment: "Set {factor} to 0.7 …
  // for the {option} option." This is the assistant's own suggested
  // configure format; the value-update path it previously fell to can only
  // refuse-to-clarify (its guard cannot write interventions), so the edit
  // lane must claim it at route time.
  if (hasValueSetPayload) {
    return 'option_value_set';
  }

  return null;
}

/**
 * Detect configure-option intent. `optionLabels` are the CURRENT graph's
 * option labels; an empty list disables the label anchor but keeps the
 * chip-prefix and option-word anchors.
 *
 * ⚠ ROADMAP 2.308 — the label anchor was STRUCTURALLY UNREACHABLE in
 * production until S1. route-v2 projected `optionLabels` from
 * `extensions.graphState`, which the UI never sends, and the persisted graph
 * that would supply them was loaded 340 lines later inside a block whose
 * condition is computed FROM this detection. Callers that can reach a
 * persisted graph should use `resolveConfigureOptionIntent` below rather than
 * calling this directly with whatever the request happened to carry.
 */
export function detectConfigureOptionIntent(
  message: string,
  optionLabels: readonly string[],
): ConfigureOptionIntentDetection {
  if (typeof message !== 'string') return NO_MATCH;
  const normalised = message.toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalised.length === 0) return NO_MATCH;

  // Trigger 1 — the product's own configure chip shape.
  if (normalised.startsWith(CONFIGURE_OPTION_CHIP_MESSAGE_PREFIX.toLowerCase())) {
    return { matched: true, trigger: 'chip_prefix' };
  }

  // Question shapes never claim the edit lane (see QUESTION_LEAD_PATTERN).
  if (normalised.endsWith('?') || QUESTION_LEAD_PATTERN.test(normalised)) {
    return NO_MATCH;
  }

  // Option anchor: the word "option(s)", or a full option label.
  let anchored = OPTION_WORD.test(normalised);
  if (!anchored) {
    const padded = ` ${normalised} `;
    for (const raw of optionLabels) {
      if (typeof raw !== 'string') continue;
      const label = raw.toLowerCase().replace(/\s+/g, ' ').trim();
      if (label.length >= 3 && containsPhrase(padded, label)) {
        anchored = true;
        break;
      }
    }
  }

  const trigger = classifyConfigureOptionTrigger(normalised, anchored);
  if (trigger !== null) return { matched: true, trigger };

  return {
    matched: false,
    // Derived from the same classifier, with the anchor granted. Nothing to
    // keep in sync: adding a trigger below the `!anchored` guard automatically
    // widens this, and adding one above it automatically does not.
    labelAnchorWouldDecide:
      !anchored && classifyConfigureOptionTrigger(normalised, true) !== null,
  };
}

/**
 * Project option labels out of a graph's node list.
 *
 * ONE derivation for BOTH label sources — the request's `graph_state` and the
 * persisted `scenarios.graph`. Duck-typed on purpose: it is called with an
 * already-validated ingress graph in one place and with a raw persisted blob
 * in the other, and a labels-only read must not acquire the power to reject a
 * graph the strict parse would have accepted.
 */
export function projectOptionLabels(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return [];
  const labels: string[] = [];
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    if (record.kind !== 'option') continue;
    const label = record.label;
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    labels.push(label);
  }
  return labels;
}

/** Where the option labels that decided the verdict came from. */
export type ConfigureOptionLabelSource = 'request' | 'persisted';

export interface ConfigureOptionIntentResolution {
  readonly detection: ConfigureOptionIntentDetection;
  readonly optionLabelSource: ConfigureOptionLabelSource;
}

/**
 * ⭐ ROADMAP 2.308 / S1 — resolve configure-option intent with a label anchor
 * that actually exists on the live wire.
 *
 * The request's own labels are tried first and cost nothing. The persisted
 * read is taken ONLY when the detector itself reports that a label anchor
 * would decide the verdict — so conversational turns, chip turns, turns
 * already anchored by the literal word "option", and turns carrying no
 * configure/effect/value payload at all pay nothing.
 *
 * `loadPersistedOptionLabels` is a supplier, not a graph: the caller owns
 * memoisation (route-v2 shares ONE persisted read between this and the
 * edit-lane graph reload, so the edit lane pays no extra round-trip) and owns
 * failure policy. A supplier that throws or yields nothing degrades to the
 * request-labels verdict — a labels read must never be able to fail a turn
 * that would otherwise have succeeded.
 */
export async function resolveConfigureOptionIntent(params: {
  readonly message: string;
  readonly requestOptionLabels: readonly string[];
  readonly loadPersistedOptionLabels: () => Promise<readonly string[]>;
}): Promise<ConfigureOptionIntentResolution> {
  const fromRequest = detectConfigureOptionIntent(params.message, params.requestOptionLabels);
  if (fromRequest.matched || !fromRequest.labelAnchorWouldDecide) {
    return { detection: fromRequest, optionLabelSource: 'request' };
  }

  let persistedLabels: readonly string[] = [];
  try {
    persistedLabels = await params.loadPersistedOptionLabels();
  } catch {
    return { detection: fromRequest, optionLabelSource: 'request' };
  }
  if (persistedLabels.length === 0) {
    return { detection: fromRequest, optionLabelSource: 'request' };
  }

  return {
    detection: detectConfigureOptionIntent(params.message, persistedLabels),
    optionLabelSource: 'persisted',
  };
}
