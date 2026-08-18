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
 * PERSISTED graph through `containsPhrase` — the same reader
 * `configure-option-intent.ts` and `configure-option-clarify.ts` use. Four
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
 *   3. EXACTLY ONE option node's label appears in the message, word-bounded.
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
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
  type ConfigureOptionIntentTrigger,
} from './configure-option-intent.js';
import { containsPhrase } from './option-intervention-guard.js';

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

/** The word that means "the factor's own observed value", never an effect. */
const BASELINE_FRAMING = /\bbaselines?\b/;

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
}

/**
 * Labels that appear in the message, word-bounded, with NESTED matches
 * dropped.
 *
 * ⭐ WHY NESTING IS DROPPED RATHER THAN COUNTED AS AMBIGUITY. With options
 * "Expand" and "Expand to Leeds", the sentence "…the Expand to Leeds
 * option…" matches BOTH — the shorter one only because it is a prefix of the
 * longer. That is a tokenisation artefact, not a second candidate, and
 * treating it as ambiguity would ask the user to disambiguate between a
 * phrase and part of itself. A match that is a phrase-substring of another
 * match is therefore removed. Two matches that are NOT nested are a genuine
 * ambiguity and reach `ask`.
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
    if (!containsPhrase(paddedMessage, normalised)) continue;
    matched.push({ id: candidate.id, label: candidate.label, normalised });
  }
  return matched.filter(
    (m) =>
      !matched.some(
        (other) =>
          other.id !== m.id
          && other.normalised.length > m.normalised.length
          && containsPhrase(` ${other.normalised} `, m.normalised),
      ),
  );
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
  | 'factor_not_named'
  | 'value_already_set';

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
  if (!detection.matched || !EFFECT_FRAMED_TRIGGERS.has(detection.trigger)) {
    return decline('not_effect_framed_intent');
  }

  const value = readOptionEffectValue(normalised);
  if (value === null) return decline('no_single_unit_scale_value');

  const padded = ` ${normalised} `;
  const optionMatches = matchLabels(
    padded,
    graph.nodes.filter((n) => n.kind === 'option').map((n) => ({ id: n.id, label: n.label })),
  );
  if (optionMatches.length === 0) return decline('option_not_named');

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
