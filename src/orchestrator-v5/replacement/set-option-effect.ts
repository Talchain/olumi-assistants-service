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
 * `executeOptionInterventionEdit` already writes option interventions — but it
 * is fused to the controller being retired (`parseEditGraphResponse`,
 * `edit-graph-dispatch`, `edit-graph-referee-gate`, `edit-graph-fact-builder`,
 * `commitDirectAnswer`). Wrapping it would drag the old routing back in behind
 * a new name, which is the one thing the replacement must not do.
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
  | { readonly reason: 'value_out_of_range'; readonly message: string };

export interface SetOptionEffectSuccess {
  readonly ok: true;
  /** Patch operations for the proposal. NOT applied — consent comes first. */
  readonly operations: readonly Record<string, unknown>[];
  /** Plain-language summary for the proposal the user will be asked about. */
  readonly summary: string;
  readonly option_label: string;
  readonly factor_label: string;
  readonly value: number;
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
   *  not invent one, and refuses anything outside the interval. */
  readonly value: number;
}

function labelOf(node: { readonly label?: unknown } | undefined, fallback: string): string {
  const l = node?.label;
  return typeof l === 'string' && l.trim().length > 0 ? l : fallback;
}

/**
 * Resolve an option-effect write, or refuse with a reason a person can act on.
 *
 * Every refusal names what to do next. The failure this replaces did the
 * opposite: it said "I wasn't sure what you meant" and listed every node in
 * the graph, including the decision node, which was called "Question".
 */
export function setOptionEffect(input: SetOptionEffectInput): SetOptionEffectResult {
  const { graph, optionId, factorId, value } = input;

  if (!Number.isFinite(value) || value < 0 || value > 1) {
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

  const optionLabel = labelOf(option, optionId);
  const factorLabel = labelOf(factor, factorId);

  return {
    ok: true,
    operations: [
      buildOptionEffectRawOperation({ optionId, optionLabel, factorId, factorLabel, value }),
    ],
    summary: `Set what ${optionLabel} does to ${factorLabel} to ${value}`,
    option_label: optionLabel,
    factor_label: factorLabel,
    value,
  };
}
