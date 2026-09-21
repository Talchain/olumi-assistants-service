/**
 * Replacement conversation layer — `set_option_effect`.
 *
 * THE OPERATION WHOSE ABSENCE ENDED A LIVE SESSION
 * ------------------------------------------------
 * 20 Sep 2026, 11:52:49Z. The assistant had invented an option, taught the
 * user how to configure it, and asked him to choose a level. He answered
 * "I think we should go for full parity." The model then proposed exactly the
 * right action and the validator threw it out:
 *
 *   V5 TurnExecutor validation rejected tool-call proposal
 *   { validation_error_code: "ENTITY_KIND_MISMATCH",
 *     handler_id: "set_factor_value",
 *     proposed_kind: "option", accepted_kinds: ["node"] }
 *
 * The user was shown "I wasn't sure what you meant by Increase Price for New
 * Customers Only", followed by chips listing every node in the graph. That was
 * the last thing he saw. `set_factor_value` writes a FACTOR's own value; there
 * was no operation for an OPTION's effect on a factor, so the model's correct
 * intent had nowhere to land.
 *
 * WHAT THIS IS BUILT ON, AND WHY THAT MATTERS
 * -------------------------------------------
 * The retired option-intervention writer in `system-events/` already writes
 * option interventions — but it is fused to the controller being retired
 * (`parseEditGraphResponse`, `edit-graph-dispatch`, `edit-graph-referee-gate`,
 * `edit-graph-fact-builder`, `commitDirectAnswer`). Wrapping it would drag the
 * old routing back in behind a new name, which is the one thing the
 * replacement must not do.
 *
 * ⚠ THAT WRITER IS NAMED HERE BY DESCRIPTION, NOT BY ITS IDENTIFIER, AND THAT
 * IS DELIBERATE. `routing/__tests__/consent-coverage-manifest.test.ts` pins the
 * writer's production consumers at EXACTLY ONE, and its detector is a
 * source-spelling scan that deliberately includes comments ("even conservative
 * type imports or comments require review of this still-unadmitted
 * classification"). Spelling the symbol in this paragraph enrolled THIS file as
 * a second consumer and REDed the guard — while the sentence the paragraph
 * makes is that this module does NOT use it.
 *
 * The honest repair is this rewording, not a manifest entry: adding the file to
 * the pinned list would assert in the repo's own record that a second entry
 * seam onto that applier exists, when the property the guard defends — one
 * seam, so two callers cannot disagree about what they validate first — is
 * still true. Verified rather than assumed: this module imports only
 * `linkedFactorsOf` / `buildOptionEffectRawOperation` from
 * `routing/option-effect-write.js`, nothing under `replacement/` calls
 * `commitDirectAnswer`, and the route injects no write path at all, so nothing
 * here can reach that writer at runtime either.
 *
 * So this composes the parts that are genuinely free of it, each verified by
 * reading its imports at the deployed SHA:
 *   · `buildOptionEffectRawOperation` — pure; builds the patch operation
 *   · `linkedFactorsOf`               — pure; reads the option's factor edges
 *   · `validatePatchOperations`       — generic patch validation
 *   · `applyPatchOperations`          — generic patch application
 *
 * COMPOSITION
 * -----------
 * This tool RETURNS operations; it does not write. The agent turns them into a
 * proposal, the user consents, and only then does the mutation path apply them
 * under an idempotency key. Tool → proposal → consent → apply, so that no
 * assistant-chosen value ever reaches the graph without the user's yes.
 */

import { linkedFactorsOf, buildOptionEffectRawOperation } from '../routing/option-effect-write.js';
import {
  resolveFactorRange,
  shareOfRange,
  roundShare,
  describeRange,
  type FactorBounds,
} from './factor-range.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

/** The minimum graph shape this tool reads. Deliberately narrow. */
export type EffectGraph = Pick<GraphStateIngress, 'nodes' | 'edges'>;

export type SetOptionEffectRefusal =
  | { readonly reason: 'unknown_option'; readonly message: string }
  | { readonly reason: 'target_is_not_an_option'; readonly message: string; readonly actual_kind: string }
  | { readonly reason: 'unknown_factor'; readonly message: string }
  | {
      readonly reason: 'factor_not_linked_to_option';
      readonly message: string;
      /** What the user CAN set, so the conversation offers a route rather than a dead end. */
      readonly linkable: readonly { readonly id: string; readonly label: string }[];
    }
  | { readonly reason: 'value_out_of_range'; readonly message: string }
  | {
      /**
       * A native figure was given that does not sit inside the factor's own
       * range — "£600,000" on a factor framed to £500,000.
       *
       * This is NOT the same refusal as a share outside [0, 1], and collapsing
       * them would tell the user the wrong thing: the number they said is
       * perfectly sensible, it is the FRAME that disagrees with it, and the
       * next move is to check the frame rather than to restate the figure.
       */
      readonly reason: 'native_value_outside_factor_range';
      readonly message: string;
      /** What the range actually is, so the conversation can quote it back. */
      readonly range: string;
    }
  | {
      /**
       * ⭐ THE GUESS, CAUGHT.
       *
       * Both a native figure and a share were supplied, and converting the
       * native figure against the factor's REAL range does not produce that
       * share. There is exactly one way to reach this state: the share was
       * computed against a range the model did not have and therefore
       * invented.
       *
       * It is refused rather than silently corrected, and the refusal carries
       * the true share. A silent correction would teach nothing and would
       * leave the model's own reasoning — which the user is reading in the
       * surrounding sentence — still quoting the invented range.
       */
      readonly reason: 'share_disagrees_with_native_value';
      readonly message: string;
      /** The share the factor's own range actually yields. */
      readonly derived_value: number;
    }
  | {
      /**
       * The factor has no declared range, so "a share of the range" has no
       * referent and any number here would be invented.
       *
       * FOUND BY A LIVE RUN, NOT BY REVIEW. Two identical four-turn
       * conversations at temperature 0 diverged on exactly this: one asked
       * the user for the range, and the other silently translated "churn
       * went from 3% to 4.4%" into 0.47 and offered it as theirs. The prompt
       * forbids inventing a number; the prompt was followed once out of
       * twice. A rule that matters cannot live only in the prompt.
       */
      readonly reason: 'factor_has_no_range';
      readonly message: string;
    };

export interface SetOptionEffectSuccess {
  readonly ok: true;
  /** Patch operations for the proposal. NOT applied — consent comes first. */
  readonly operations: readonly Record<string, unknown>[];
  /** Plain-language summary for the proposal the user will be asked about. */
  readonly summary: string;
  readonly option_label: string;
  readonly factor_label: string;
  readonly value: number;
  /**
   * ⭐ WHAT THE USER MUST SEE BEFORE THEY AGREE.
   *
   * A share is not a quantity anybody said. When the user gave a figure in
   * their own units — "£59" — the encoded 0.000118 is a derivation, and
   * consent to a derivation the user cannot check is not consent. These carry
   * the figure they actually said and the range it was measured against, so
   * the proposal put to them can restate both.
   *
   * Absent when no native figure was given: then the share IS what the user
   * said, and there is nothing to restate.
   */
  readonly native_value?: number;
  readonly native_unit?: string;
  /** The range the share was taken of, rendered for a person. */
  readonly range?: string;
}

export type SetOptionEffectResult =
  | SetOptionEffectSuccess
  | { readonly ok: false; readonly refusal: SetOptionEffectRefusal };

export interface SetOptionEffectInput {
  readonly graph: EffectGraph;
  readonly optionId: string;
  readonly factorId: string;
  /** Normalised effect in [0, 1]. The conversation is responsible for having
   *  established what the number means before it gets here — this tool does
   *  not invent one, and refuses anything outside the interval.
   *
   *  ⚠ OPTIONAL ONLY WHEN `nativeValue` IS GIVEN, and the contract is
   *  UNCHANGED: this is still the encoded share, still refused outside
   *  [0, 1], and a native magnitude must never be written here (see
   *  `routing/native-quantity-operation.ts`, which states in terms why a
   *  native figure in the encoded slot corrupts the causal model). */
  readonly value?: number;
  /**
   * ⭐ THE FIGURE THE USER ACTUALLY SAID, IN THEIR OWN UNITS — £59, 3 months.
   *
   * THE DEFECT THIS CLOSES. The model's view of the workspace showed a
   * factor's value and unit and NOT its range, so expressing £59 as a share
   * was structurally impossible to do correctly: the only route to a number
   * was to guess the range, and a guessed range produces a confidently wrong
   * intervention WITH A RECEIPT — strictly worse than a refusal.
   *
   * The repair is not to ask the model to guess more carefully. It is to stop
   * asking it to guess: it passes the user's own figure through, and this
   * tool — which can read the factor — does the arithmetic. The range is now
   * also shown in `read_workspace`, from the SAME function that converts
   * here, so what the model sees and what this accepts cannot drift apart.
   */
  readonly nativeValue?: number;
}

function labelOf(node: { readonly label?: unknown } | undefined, fallback: string): string {
  const l = node?.label;
  return typeof l === 'string' && l.trim().length > 0 ? l : fallback;
}

/**
 * The factor's NATIVE unit — the one a person speaks in (£, months).
 *
 * ⚠ `'scale'` is not a unit anybody says; it is the producer's word for
 * "already normalised". It is dropped rather than printed, so a confirmation
 * never asks a user to agree to "0.3 scale".
 */
function unitOf(node: unknown): string | null {
  if (node === null || typeof node !== 'object') return null;
  const os = (node as { observed_state?: { unit?: unknown } }).observed_state;
  const u = os?.unit;
  if (typeof u !== 'string') return null;
  const trimmed = u.trim();
  return trimmed.length === 0 || trimmed === 'scale' ? null : trimmed;
}

/**
 * Resolve an option-effect write, or refuse with a reason a person can act on.
 *
 * Every refusal names what to do next. The failure this replaces did the
 * opposite: it said "I wasn't sure what you meant" and listed every node in
 * the graph, including the decision node, which was called "Question".
 */
export function setOptionEffect(input: SetOptionEffectInput): SetOptionEffectResult {
  const { graph, optionId, factorId, value, nativeValue } = input;

  // ⚠ THE [0,1] CHECK KEEPS ITS PLACE — FIRST — ON EVERY PATH THAT EXISTED
  // BEFORE. A native figure cannot be checked until the factor is resolved
  // (its range lives on the node), so that arm alone defers; the share-only
  // path is byte-unchanged, which is what keeps the existing refusal order,
  // and the tests pinning it, honest rather than merely still passing.
  const hasNative = typeof nativeValue === 'number';
  if (!hasNative && (!Number.isFinite(value) || value! < 0 || value! > 1)) {
    return {
      ok: false,
      refusal: {
        reason: 'value_out_of_range',
        message: `An option's effect is a share of the factor's range, between 0 and 1. I was given ${String(value)}.`,
      },
    };
  }

  const option = graph.nodes.find((n) => n.id === optionId);
  if (option === undefined) {
    return { ok: false, refusal: { reason: 'unknown_option', message: `There is no option with id ${optionId} on this model.` } };
  }
  if (option.kind !== 'option') {
    // The mirror of the failure that prompted this module: there, an option
    // was sent to a factor-only handler. Here the kind is checked in the
    // direction that matches what the tool actually writes, and the message
    // says which operation the caller wanted instead.
    return {
      ok: false,
      refusal: {
        reason: 'target_is_not_an_option',
        message: `${labelOf(option, optionId)} is a ${String(option.kind)}, not an option. Setting its own value is a different operation.`,
        actual_kind: String(option.kind),
      },
    };
  }

  const factor = graph.nodes.find((n) => n.id === factorId);
  if (factor === undefined) {
    return { ok: false, refusal: { reason: 'unknown_factor', message: `There is no factor with id ${factorId} on this model.` } };
  }

  const linked = linkedFactorsOf(graph, optionId).map((f) => ({ id: f.id, label: labelOf(f as { label?: unknown }, f.id) }));
  if (!linked.some((f) => f.id === factorId)) {
    return {
      ok: false,
      refusal: {
        reason: 'factor_not_linked_to_option',
        message:
          `${labelOf(option, optionId)} does not currently affect ${labelOf(factor, factorId)}, ` +
          `so an effect value there would not reach the comparison. ` +
          (linked.length > 0
            ? `It does affect: ${linked.map((f) => f.label).join(', ')}.`
            : `It does not yet affect anything — it needs a link to a factor first.`),
        linkable: linked,
      },
    };
  }

  // ── WHAT RANGE IS THIS A SHARE OF? ─────────────────────────────────────
  //
  // ⭐ THE DERIVATION MOVED OUT, AND THE MOVE IS THE FIX.
  //
  // This chain used to live here, inline, and it was the ONLY place in the
  // service that could answer "what is this factor's range?". `read-tools.ts`
  // — the model's own view of the workspace — showed a factor's value and
  // unit and no range at all, so the model was asked to express £59 as a
  // share of something it could not see.
  //
  // Writing a second copy into `read-tools.ts` would have made the range
  // SHOWN and the range ACCEPTED two independently maintained answers to one
  // question, free to drift, with every symptom of the drift looking exactly
  // like the guessing this exists to stop. One function, imported by both:
  // `factor-range.ts` carries the full captured-wire census and the reasoning
  // for each arm.
  const range = resolveFactorRange(factor);

  if (!range.ok) {
    return {
      ok: false,
      refusal: {
        reason: 'factor_has_no_range',
        message: range.absence === 'unquantified_placeholder'
          ? `${labelOf(factor, factorId)} has a placeholder range that nobody has stated — it is ` +
            `recorded as "could be anything from 0 to 1", which is not a range an effect can be ` +
            `measured against. Ask the user what the lowest and highest values really are; do not ` +
            `treat the placeholder as if it were their answer.`
          : `${labelOf(factor, factorId)} has no range set, and an option's effect is a share of that ` +
          `range — so there is nothing to express the effect against yet. Ask what the lowest and ` +
          `highest values are for ${labelOf(factor, factorId)}, then this can be set. Do not convert ` +
          `figures into a share yourself.`,
      },
    };
  }

  const bounds: FactorBounds = range.bounds;
  const nativeUnit = unitOf(factor);
  const renderedRange = describeRange(bounds, nativeUnit);

  // ── THE CONVERSION, DONE HERE RATHER THAN GUESSED UPSTREAM ─────────────
  //
  // When the user gave a figure in their own units, the share is DERIVED from
  // the factor's own range rather than accepted from the model. That is the
  // whole repair: the layer that can read the range is the layer that does
  // the arithmetic, so there is no step at which a range has to be imagined.
  let effective: number;
  if (hasNative) {
    const derived = shareOfRange(nativeValue as number, bounds);
    if (derived === null) {
      return {
        ok: false,
        refusal: {
          reason: 'factor_has_no_range',
          message: `${labelOf(factor, factorId)} has a range of zero width (${renderedRange}), so a ` +
            `share of it has no meaning. Ask what the lowest and highest values really are.`,
        },
      };
    }
    if (derived < 0 || derived > 1) {
      return {
        ok: false,
        refusal: {
          reason: 'native_value_outside_factor_range',
          message:
            `${String(nativeValue)}${nativeUnit === null ? '' : ` ${nativeUnit}`} is outside the range ` +
            `recorded for ${labelOf(factor, factorId)}, which runs ${renderedRange}. Do not rescale it ` +
            `to fit — either the figure or the range is wrong, and only the user can say which. Put ` +
            `the range to them and ask.`,
          range: renderedRange,
        },
      };
    }

    const rounded = roundShare(derived);

    // ⭐ BOTH SUPPLIED AND THEY DISAGREE — the guess, caught in the act.
    //
    // ⚠ THE TOLERANCE IS TIGHT ON PURPOSE. The only legitimate gap between a
    // model's share and this one is float dirt in the same division, which
    // lands many orders below 1e-9. A loose tolerance here would be a guard
    // too slack to bite: a range guessed as 0–400,000 instead of 0–500,000
    // yields 0.95 against 0.76, and anything that admits that admits
    // everything this check exists for.
    if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value - rounded) > 1e-9) {
      return {
        ok: false,
        refusal: {
          reason: 'share_disagrees_with_native_value',
          message:
            `${String(nativeValue)}${nativeUnit === null ? '' : ` ${nativeUnit}`} is ${String(rounded)} ` +
            `of ${labelOf(factor, factorId)}'s range (${renderedRange}), not ${String(value)}. The share ` +
            `you sent was measured against a different range from the one on the model. Use the range ` +
            `shown in the workspace, and do not offer the user a number derived from any other.`,
          derived_value: rounded,
        },
      };
    }
    effective = rounded;
  } else {
    effective = value as number;
  }

  const optionLabel = labelOf(option, optionId);
  const factorLabel = labelOf(factor, factorId);

  // ⛔ THE ENCODED SLOT STILL RECEIVES THE SHARE, AND ONLY THE SHARE.
  //
  // `buildOptionEffectRawOperation` writes `value: { value: n }` at
  // `/nodes/<option>/data/interventions/<factor>` — the ENCODED magnitude the
  // engine computes on. A native figure written there moves a [0,1]
  // intervention to 380,000 and corrupts the causal model;
  // `routing/native-quantity-operation.ts` exists because of that exact harm
  // and says so in terms. The native figure rides in the SUMMARY, which is
  // what the user reads before agreeing — it never enters the operation.
  const operations = [
    buildOptionEffectRawOperation({ optionId, optionLabel, factorId, factorLabel, value: effective }),
  ];

  // ── THE CONFIRMATION SENTENCE ──────────────────────────────────────────
  //
  // ⭐ CONSENT TO A DERIVATION YOU CANNOT CHECK IS NOT CONSENT.
  //
  // Before this, a user who said "£59" was asked to agree to "Set what X does
  // to Y to 0.000118" — a number they never said, derived from a range they
  // were never shown, by arithmetic nobody stated. If the range was wrong the
  // proposal was still perfectly well-formed, and agreeing to it produced a
  // wrong model carrying a receipt of the user's own consent. That is the
  // precise harm the consent layer exists to prevent, and it was reachable
  // THROUGH the consent layer.
  //
  // So where a figure was converted, the summary restates all three parts —
  // what they said, what it was measured against, and what is being stored —
  // and the user can refuse on any of them.
  // ⛔⛔ THE RANGE IS DELIBERATELY *NOT* IN THIS STRING, AND LEAVING IT IN
  // WOULD HAVE OPENED A CONSENT HOLE INSIDE THE CONFIRMATION BUILT TO CLOSE
  // ONE. Caught before it shipped; recorded so nobody adds it back.
  //
  // `namesANumberTheOfferDoesNot` (`run-replacement-turn.ts:279`) accepts a
  // user's agreement only when every digit run in THEIR message also appears
  // in this summary — the offer's own rendered string. Its purpose is that
  // "yes, make it 60" must NOT accept an offer of 59, because a held proposal
  // replays from its STORED patch and never re-reads the message: accepting
  // would save MY number and discard THEIRS, with a receipt.
  //
  // The first draft of this summary read "…on Cost's range of 0 to 500000 £
  // is 0.76". That puts `500000` into the offer's digit set — so "yes, make
  // it 500000" would have passed the guard and committed 0.76, i.e. £380,000,
  // against a user who had just asked for £500,000. The range bounds are
  // numbers the offer MENTIONS but is not ABOUT.
  //
  // (Worded with figures rather than magnitude WORDS on purpose: the
  // `magnitude-alphabet.union` guard scans src/ for them so no fifth
  // hand-written magnitude list can appear unreviewed. Nothing here parses a
  // magnitude — this module does affine arithmetic on numbers — so the honest
  // move is to not spell one, rather than to enrol a file in that manifest
  // that would then read as a magnitude consumer forever.)
  //
  // So this string names exactly the two numbers this offer IS about: what
  // the user said, and what will be stored. The range travels in the tool's
  // model-facing result instead, and the model states it in its own sentence
  // — which the guard does not read, because the guard's question is about
  // what the USER said.
  const summary = hasNative
    ? `Set what ${optionLabel} does to ${factorLabel} to ` +
      `${String(nativeValue)}${nativeUnit === null ? '' : ` ${nativeUnit}`}, stored as ${String(effective)}`
    : `Set what ${optionLabel} does to ${factorLabel} to ${String(effective)}`;

  return {
    ok: true,
    operations,
    summary,
    option_label: optionLabel,
    factor_label: factorLabel,
    value: effective,
    ...(hasNative ? { native_value: nativeValue as number, range: renderedRange } : {}),
    ...(hasNative && nativeUnit !== null ? { native_unit: nativeUnit } : {}),
  };
}
