/**
 * ⭐⭐ AN OPTION'S OWN `observed_state` IS NOT A CARRIER FOR ITS EFFECT VALUE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT — witnessed in a real browser by an external auditor on 30 Aug
 * 2026, at deployed UI `525f8c32` / CEE `91d39119` / PLoT `669ba2b` / ISL
 * `28fe0c95`, owned scenario `0fe8c040-c47a-4010-b68e-9f42ccc275bf`.
 *
 * After a SUCCESSFUL analysis the user typed, in plain English:
 *
 *   "Revise Coverage Pilot to staff 30% of support hours, down from 70%. Keep
 *    Current Coverage at 40%, and do not change any other values or causal
 *    relationships."
 *
 * The product held a two-option proposal; the auditor clicked the product's OWN
 * confirmation. It replied *"Confirmed: change 'Coverage Pilot' to 30% and
 * change 'Current Coverage' to 40%."* (request `1a0ba66d`, 04:58:13Z, durable
 * version `fb4aafba`).
 *
 * A REAL WRITE HAPPENED — TO THE WRONG SEMANTIC CARRIER. Independent
 * authenticated readback: the only graph changes were each OPTION node's
 * provenance and its own `observed_state` (`70180763` "Coverage Pilot" value 30
 * / unit % / baseline 70; `4bba0554` "Current Coverage" value 40 / unit %). The
 * canonical staffing interventions stayed at `0.7` and `0.4`, and the
 * confirmation's own `analysis_ready` retained those exact old inputs.
 *
 * THEN THE PRODUCT MADE A FALSE ROBUSTNESS CLAIM. Rerun `e615c657`, 05:04:19Z:
 * *"Since you changed Coverage Pilot, the picture has stayed the same … the
 * conclusion held both before and after that change."* Win probabilities
 * unchanged (Pilot .6975 / Current .3025), `run_delta` present, both
 * differences `within_noise`. **That is not robustness — the input never moved.**
 *
 * The machinery works end to end: naming the option × factor in the internal
 * fraction scale (*"Set the effect of Coverage Pilot on Staffed Coverage to
 * 0.3 …"*, request `8c090366`) writes the real intervention and the next rerun
 * correctly names the leader reversal. Only the ROUTING is wrong.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ WHAT THIS MODULE IS — AND THE THING IT REFUSES TO BE.
 *
 * It adds **NO predicate over the user's message**. Not one character of the
 * sentence is read here. That refusal is the point: this estate burned four
 * consecutive rounds oscillating on exactly this class of natural-language
 * predicate (CLAUDE.md trap 22f), each round fixing one direction and reopening
 * the other under a fully green suite. Widening `EFFECT_FRAMED_TRIGGERS` or the
 * effect-framed grammar to swallow *"Revise Coverage Pilot to staff 30% …"*
 * would be round five.
 *
 * The signature this module binds to is **STRUCTURAL, at the graph**:
 *
 *   an OPTION node's own `observed_state.value` gained, changed or was lost,
 *   while THAT SAME OPTION's effect values did not move.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE.
 *
 * Derived from the PRODUCER's own instruction — the served edit prompt
 * (`src/prompts/edit-graph-v6.ts`), not from a corpus and not from the witnessed
 * sentence (trap 13c: a mutant kit measures whether a test can detect a change,
 * never whether the expectation is right):
 *
 *   - the option node template is
 *     `{ id: "opt_<slug>", kind: "option", label: "...", data: { interventions: {} } }`
 *     — it declares **no `observed_state`**;
 *   - OPTION CONFIGURATION's "Permitted operations: update_node on the option's
 *     intervention data ONLY";
 *   - `NodeV3.observed_state` is documented in `schemas/cee-v3.ts` as
 *     *"Quantitative data for factor nodes"*.
 *
 * An option is a CHOICE. Its quantities are the effects it has on the factors
 * it is wired to. A number written on the option itself is read by nothing on
 * the analysis path — which is exactly why the auditor's rerun came back
 * bit-identical, and exactly why the reply that acknowledged it was false.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐⭐ THE PER-OPTION CONJUNCT IS THE IDENTITY BINDING (trap 19).
 *
 * "That SAME option's effect values did not move" is checked **per option**,
 * never graph-wide. The graph-wide form — *"did ANY effect value land?"* — is a
 * VALUE PREDICATE A SIBLING CAN SATISFY: a turn that writes a real effect for
 * option B would excuse a wrong-carrier write on option A, and nothing would
 * tie the moved node to the option under suspicion. The spec's `S4` case pins
 * this and a mutant that loosens the conjunct to graph-wide turns it RED.
 *
 * ⚠ AND THE OPPOSITE-DIRECTION TWIN, because a predicate guarding two harms
 * cannot share one window (trap 22b). Withholding a turn that DID move the
 * option's effect value would destroy the user's real work — the direction this
 * estate calls unacceptable. `S3` is that twin: same wrong-carrier write, but
 * the effect moved too, so the turn is ALLOWED and the option's own value is
 * left as the harmless residue it is.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A SEPARATE MODULE FROM `option-intervention-write-guard.ts`.
 *
 * Trap 21: before reconciling two authorities that seem to disagree, write down
 * the question each one answers.
 *
 *   that module asks  — *did a FACTOR baseline move as a substitute for the
 *                        option effect value the user's MESSAGE asked for?*
 *                        (message-bound, via `evaluateConfigureOptionOutcome`)
 *   this module asks  — *did an OPTION's OWN quantity move while its effect
 *                        values stood still?*  (message-free, structural)
 *
 * They are different questions with different evidence and different failure
 * modes. Folding this into that module's `not_honoured` precondition would make
 * this seam unreachable for the witnessed turn — which declines the effect
 * resolver as `not_effect_framed_intent` and is allowed there as
 * `outcome_not_unhonoured`. Naming the concepts apart is the fix; aligning the
 * defaults is what trap 21 warns against.
 *
 * ⚠ NOTHING HERE WEAKENS THAT GUARD. It is untouched: both verdicts are
 * computed, and a withhold from either withholds the write.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ WHAT THIS DOES NOT CLOSE, stated rather than papered over.
 *
 * The user still cannot say *"staff 30% of support hours"* and have it applied.
 * This module stops the product CONFIRMING a write it did not make, and asks
 * for the missing binding using the product's OWN shipped configure affordance.
 * Accepting a human-unit quantity for an option effect needs a unit/cap frame
 * this seam does not have and must not guess — `option-effect-write.ts` refuses
 * exactly that conversion on purpose, and inventing one here would turn an
 * uncertainty into apparent fact. That is a separate, rowed piece of work.
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';

/**
 * The producer's declared semantics, pinned as data so the suite REDs if this
 * module is ever repointed at a different claim (trap 13c — derive the
 * expectation from the producer, never from your own reading of the field).
 */
export const OPTION_OWN_VALUE_IS_NOT_AN_EFFECT_CARRIER =
  "An option node holds no quantity of its own: the served edit prompt's option template is "
  + '`{ id, kind: "option", label, data: { interventions: {} } }` and its permitted operation is '
  + "\"update_node on the option's intervention data ONLY\" (src/prompts/edit-graph-v6.ts). "
  + 'An option\'s numbers are its interventions — its effects on the factors it is wired to. '
  + '`NodeV3.observed_state` is declared as "Quantitative data for factor nodes".';

/** Why the write was allowed to proceed. Every value is today's behaviour. */
export type OptionOwnValueAllowReason =
  /** No mutation applied this turn — nothing to withhold. */
  | 'no_write'
  /** Pre- or post-edit graph does not strict-parse; the harm is unestablished. */
  | 'graph_unparseable'
  /** No option node's own value moved — not the wrong-carrier signature. */
  | 'no_option_own_value_write'
  /**
   * Every option whose own value moved ALSO moved its own effect values, so
   * nothing was substituted: the turn did the real work and discarding it
   * would destroy it.
   */
  | 'option_effect_write_landed';

export interface OptionOwnValueSubstitution {
  /** The option, by identity, from the BEFORE graph — the persisted authority. */
  readonly optionId: string;
  readonly optionLabel: string;
  /** The option's own value before this turn, when it carried one. */
  readonly from: number | undefined;
  /** The option's own value after this turn — the number that was NOT applied. */
  readonly to: number | undefined;
  /** The unit the write carried, when it carried one (the witnessed write said `%`). */
  readonly unit: string | undefined;
  /**
   * The factors this option is wired to, from the BEFORE graph's edges — the
   * links one of which the number was actually meant for. Same direction rule
   * as `optionLinkedNodeIds` / `collectCandidateFactorLabels`, so this copy and
   * the shipped recovery copy cannot disagree about which factors belong to the
   * option (trap 12).
   */
  readonly linkedFactorLabels: readonly string[];
}

export type OptionOwnValueVerdict =
  | { readonly verdict: 'allow'; readonly reason: OptionOwnValueAllowReason }
  | { readonly verdict: 'withhold'; readonly substitutions: readonly OptionOwnValueSubstitution[] };

/** A node's own observed value, or undefined when it carries none. */
function readOwnValue(node: unknown): number | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const observed = (node as Record<string, unknown>).observed_state;
  if (observed === null || typeof observed !== 'object') return undefined;
  const value = (observed as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** The unit the option's own value carried, when it carried one. */
function readOwnUnit(node: unknown): string | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const observed = (node as Record<string, unknown>).observed_state;
  if (observed === null || typeof observed !== 'object') return undefined;
  const unit = (observed as Record<string, unknown>).unit;
  return typeof unit === 'string' && unit.trim().length > 0 ? unit.trim() : undefined;
}

/**
 * ONE option's effect values, read through `mergeInterventionSources` — the
 * estate's canonical three-source reader, the SAME one
 * `evaluateConfigureOptionOutcome`, `computeStructuralReadiness` and the
 * sibling write guard use. Derived, never re-spelled (trap 12): a second
 * spelling of the precedence rule is the copy that rots.
 */
function optionEffectValues(node: unknown): Record<string, number> {
  if (node === null || typeof node !== 'object') return {};
  return mergeInterventionSources(node as Record<string, unknown>) ?? {};
}

/** Did THIS option's own effect values move between the two graphs? */
function optionEffectValuesMoved(beforeNode: unknown, afterNode: unknown): boolean {
  const pre = optionEffectValues(beforeNode);
  const post = optionEffectValues(afterNode);
  const keys = new Set([...Object.keys(pre), ...Object.keys(post)]);
  for (const k of keys) {
    if (pre[k] !== post[k]) return true;
  }
  return false;
}

/**
 * The labels of the factors this option is wired to, read from the BEFORE
 * graph. Read from BEFORE on purpose, for the same reason
 * `optionLinkedNodeIds` does: the pre-edit graph is the persisted authority,
 * and resolving against `after` would let the very edit under suspicion invent
 * an edge that justifies the copy naming it.
 */
export function linkedFactorLabels(graph: GraphV3T, optionId: string): string[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  for (const edge of graph.edges) {
    if (edge.from !== optionId) continue;
    const target = byId.get(edge.to);
    if (target === undefined || target.kind !== 'factor') continue;
    const label = typeof target.label === 'string' ? target.label.trim() : '';
    if (label.length > 0 && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Decide whether this edit turn's graph write may persist.
 *
 * Pure: no I/O, no LLM, no message. The caller owns emission and the withhold,
 * so the decision is testable without a dispatcher.
 */
export function detectOptionOwnValueSubstitution(params: {
  /** The pre-edit graph this turn was dispatched against. */
  readonly before: unknown;
  /** The applied graph, or null when the edit produced none. */
  readonly after: unknown;
  /** The dispatcher's own "a mutation truly applied" predicate. */
  readonly appliedMutation: boolean;
}): OptionOwnValueVerdict {
  if (!params.appliedMutation) return { verdict: 'allow', reason: 'no_write' };

  const parsedBefore = GraphV3.safeParse(params.before);
  const parsedAfter = GraphV3.safeParse(params.after);
  if (!parsedBefore.success || !parsedAfter.success) {
    return { verdict: 'allow', reason: 'graph_unparseable' };
  }
  const before = parsedBefore.data;
  const after = parsedAfter.data;

  const afterById = new Map(after.nodes.map((n) => [n.id, n]));
  const substitutions: OptionOwnValueSubstitution[] = [];
  let anyOwnValueMoved = false;

  for (const beforeNode of before.nodes) {
    // Identity from the BEFORE graph: a node that did not exist before is a
    // structural add, not a rewrite of an option's meaning.
    if (beforeNode.kind !== 'option') continue;
    const afterNode = afterById.get(beforeNode.id);
    if (afterNode === undefined) continue;

    const from = readOwnValue(beforeNode);
    const to = readOwnValue(afterNode);
    if (from === to) continue;
    anyOwnValueMoved = true;

    // ⭐⭐ THE IDENTITY BINDING. Per option, never graph-wide — see the header.
    if (optionEffectValuesMoved(beforeNode, afterNode)) continue;

    substitutions.push({
      optionId: beforeNode.id,
      optionLabel: typeof beforeNode.label === 'string' ? beforeNode.label : beforeNode.id,
      from,
      to,
      unit: readOwnUnit(afterNode) ?? readOwnUnit(beforeNode),
      linkedFactorLabels: linkedFactorLabels(before, beforeNode.id),
    });
  }

  if (substitutions.length > 0) return { verdict: 'withhold', substitutions };
  return {
    verdict: 'allow',
    reason: anyOwnValueMoved ? 'option_effect_write_landed' : 'no_option_own_value_write',
  };
}

/**
 * The user's own number, in the user's own units. Never the internal scale.
 *
 * ⚠ NO `unit === '%'` EQUALITY HERE, DELIBERATELY. `unit-scale-class.test.ts`
 * pins the inline bare-equality sites as a KNOWN-UNMIGRATED set that REDs if it
 * grows, and its header states the rule this seam must not weaken: *"`unit ===
 * '%'` IS NEVER SUFFICIENT … the producer's convention is MAGNITUDE-DEPENDENT
 * … never re-add a bare equality on the unit."* This function does no
 * conversion and no classification — it only decides SPACING, from whether the
 * unit reads as a symbol or as a word, so it is correct for `%` and for a
 * currency symbol without knowing which it has.
 */
function humanQuantity(value: number | undefined, unit: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (unit === undefined) return `${value}`;
  const symbolic = /^[^\p{L}\p{N}]/u.test(unit);
  return symbolic ? `${value}${unit}` : `${value} ${unit}`;
}

function quoteList(labels: readonly string[]): string {
  const quoted = labels.map((l) => `"${l}"`);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

/**
 * The sentence a withheld turn MUST carry, and the ask that replaces the false
 * confirmation.
 *
 * ⭐⭐ WHY IT IS NOT OPTIONAL. Withholding is the honest choice when the graph
 * and the reply would otherwise disagree — but a SILENT withhold is its own
 * trust defect. The witnessed turn's harm was precisely a reply that CONFIRMED
 * a change the graph never made; replacing one silence with another would leave
 * the user believing the same false thing for a different reason.
 *
 * ⭐ IT ASKS, AND WHAT IT ASKS FOR IS THE MISSING BINDING — which link the
 * number belonged to. That is the documented trap-22f exit: where the target
 * cannot be determined, make the ambiguity the product rather than commit a
 * substitute. The caller pairs it with the product's OWN shipped
 * `Help me configure <option>` chip, so the question routes into the flow the
 * product already owns instead of asking for something it cannot accept (P8).
 *
 * ⚠ IT NEVER SPELLS THE INTERNAL SCALE. *"Set the effect of X on Y to 0.3"* is
 * a diagnostic probe, not product copy: a strategic user must never be asked to
 * understand Olumi's internal normalised scale. The quantity echoed back is the
 * USER'S OWN — their number, their unit.
 *
 * ⚠ It must also survive the finaliser's success-claim backstop, so it is
 * phrased as a negation and never as a commit acknowledgement.
 */
export function formatOptionOwnValueWithheldNotice(
  substitutions: readonly OptionOwnValueSubstitution[],
): string {
  const opening = 'Nothing from that message was saved, so the model is unchanged.';
  if (substitutions.length === 0) return opening;
  const parts: string[] = [
    `${opening} An option carries no value of its own — its numbers live on the links it changes, `
    + 'and I could not tell which link each number belonged to.',
  ];
  for (const sub of substitutions) {
    const quantity = humanQuantity(sub.to, sub.unit) ?? humanQuantity(sub.from, sub.unit);
    const option = `"${sub.optionLabel}"`;
    const number = quantity === undefined ? 'that number' : quantity;
    if (sub.linkedFactorLabels.length === 0) {
      parts.push(
        `${option} is not wired to anything yet, so there is nothing for ${number} to sit on.`,
      );
      continue;
    }
    const links = quoteList(sub.linkedFactorLabels);
    parts.push(
      sub.linkedFactorLabels.length === 1
        ? `${option} changes ${links} — did you mean ${number} there?`
        : `${option} changes ${links} — which of those did you mean to move to ${number}?`,
    );
  }
  return parts.join(' ');
}
