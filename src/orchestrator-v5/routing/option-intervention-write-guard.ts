/**
 * ⭐⭐ ROADMAP 2.1266 (D1b) — A WRONG-ENTITY WRITE MUST NOT PERSIST BEHIND A
 * REPLY THAT SAYS NOTHING CHANGED.
 *
 * THE DEFECT, wire-witnessed on deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 5, turn_id
 * `4a43edef-603a-4777-8deb-cce556ed363f`):
 *
 *   REQUEST  "For the subcontracting inner-city deliveries to a green courier
 *            option, set the effect value on Subcontractor cost as share of
 *            affected-route revenue to 0.12 — a share, no unit."
 *   RESULT   `exit_path: "edit_graph"`; edit fact `edit_kind:
 *            "parameter_update"`, `status: "applied"`, `affected_entities:
 *            [{ kind: "factor", label: "Subcontractor cost as share of
 *            affected-route revenue" }]`; `graph_hash` 476126e58107f67f →
 *            9797c1f45bac4475; `analysis_state.run_state` → `complete_stale`,
 *            cause `graph_changed`.
 *   REPLY    byte-identical to the previous turn's refusal —
 *            "…still has no effect value on Subcontractor cost as share of
 *            affected-route revenue, so that link is not carrying anything
 *            yet. … To set it directly, open … on the canvas…"
 *   GUEST RELOAD (`captures/j6-reload-J4.json`) — factor `49a2b80b`
 *            `observed_state { value: 0.12, source: "user_override" }`, while
 *            option `21ea9b80` still carries `interventions: {}`.
 *
 * So the FACTOR BASELINE every option reads was silently rewritten, the option's
 * effect value the user actually asked for was not, the blocker never retired,
 * and the reply denied that anything had happened. `option-intervention-guard.ts`
 * exists precisely to stop this — its header says the caller must *"refuse the
 * factor mutation and clarify instead — graph unchanged"*.
 *
 * ⚠⚠ WHY THAT GUARD DID NOT FIRE, derived at the bytes. It is wired at ONE
 * place: `turn-executor.ts:8241` (`proposedHandlerId === 'set_factor_value'`),
 * whose comment claims *"Both the LLM and deterministic producers converge on
 * this execute block BEFORE any handler runs, so one guard here covers every
 * dispatch path."* **That claim is false for the edit lane.** A turn whose
 * `exit_path` is `edit_graph` never reaches that block: `handleEditGraph` owns
 * its own applier and its own commit, and no equivalent guard existed there.
 * The witnessed turn took exactly that route. (Trap 20's shape at the level of a
 * comment: "one guard covers every path" was a claim about a call graph nobody
 * re-derived.)
 *
 * ⭐ WHAT THIS MODULE ADDS, AND WHAT IT DELIBERATELY DOES NOT.
 * `evaluateConfigureOptionOutcome` (2.427) ALREADY detects this exact state —
 * its own header names it *"branch (b): something landed for a DIFFERENT
 * entity"* — and already replaces the reply wholesale. What it never did is
 * withhold the WRITE, so the honest text shipped on top of a persisted wrong
 * mutation. This module answers the one further question that licenses a
 * withhold, and reuses that verdict rather than re-reading the message (trap 21:
 * one concept, one owner — a second intent predicate here would be the
 * two-same-named-helpers defect):
 *
 *   *Did this turn write a FACTOR BASELINE while writing no effect value for
 *    ANY option?*
 *
 * Both conjuncts are load-bearing and both are narrow ON PURPOSE:
 *   - "no effect value for ANY option" — if an interventions write did land
 *     somewhere, the turn accomplished a real option edit and discarding it
 *     would be a new harm. Not our case, not withheld.
 *   - "a factor baseline moved" — this is the wrong-entity signature. A turn
 *     whose only effect was structural (an add, a rename, an edge) is NOT
 *     withheld, so a compound message keeps the part that landed.
 *
 * SAFE-BIASED IN THE DIRECTION THAT MATTERS. Every uncertainty returns `allow`,
 * which leaves today's behaviour byte-identical: an unparseable graph, an
 * outcome verdict that is not `not_honoured`, a turn with no write. The only
 * state that withholds is the measured one.
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import { evaluateConfigureOptionOutcome } from './configure-option-outcome.js';

export type OptionInterventionWriteAllowReason =
  /** No mutation applied this turn — nothing to withhold. */
  | 'no_write'
  /** Pre- or post-edit graph does not strict-parse; the harm is unestablished. */
  | 'graph_unparseable'
  /** The configure-option outcome guard reached no `not_honoured` verdict. */
  | 'outcome_not_unhonoured'
  /** An effect value DID land for some option — a real option edit. */
  | 'interventions_write_landed'
  /** Nothing moved a node's own value; the write was not the wrong-entity kind. */
  | 'no_baseline_write';

export type OptionInterventionWriteVerdict =
  | { readonly verdict: 'allow'; readonly reason: OptionInterventionWriteAllowReason }
  | {
      readonly verdict: 'withhold';
      /** The option the USER NAMED, by identity, from the outcome verdict. */
      readonly optionId: string;
      readonly optionLabel: string;
      /** Node ids whose own value this turn moved — what is being discarded. */
      readonly baselineNodeIds: readonly string[];
    };

/** Every effect value the graph holds, keyed `<optionId>::<factorId>`. */
function projectInterventionValues(graph: GraphV3T): Map<string, number> {
  const out = new Map<string, number>();
  for (const node of graph.nodes) {
    const merged = mergeInterventionSources(node as unknown as Record<string, unknown>);
    if (merged === undefined) continue;
    for (const [factorId, value] of Object.entries(merged)) {
      out.set(`${node.id}::${factorId}`, value);
    }
  }
  return out;
}

/**
 * Did ANY option gain or change an effect value between the two graphs?
 *
 * Read through `mergeInterventionSources`, the SAME reader
 * `evaluateConfigureOptionOutcome` and the readiness badge use, so this cannot
 * disagree with either about whether an effect value exists.
 */
export function anyInterventionWriteLanded(before: GraphV3T, after: GraphV3T): boolean {
  const pre = projectInterventionValues(before);
  const post = projectInterventionValues(after);
  for (const [key, value] of post) {
    if (!pre.has(key)) return true;
    if (pre.get(key) !== value) return true;
  }
  // A REMOVED effect value is a write too — an edit that cleared one did
  // something real to an option, so it is not the wrong-entity signature.
  for (const key of pre.keys()) {
    if (!post.has(key)) return true;
  }
  return false;
}

/** A node's own observed value, or undefined when it carries none. */
function readObservedValue(node: unknown): number | undefined {
  if (node === null || typeof node !== 'object') return undefined;
  const observed = (node as Record<string, unknown>).observed_state;
  if (observed === null || typeof observed !== 'object') return undefined;
  const value = (observed as Record<string, unknown>).value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Which nodes' OWN values this turn moved — gained, changed, or lost.
 *
 * This is the wrong-entity signature: the shared baseline every option reads,
 * rewritten in place of the option's effect value. Identity-bound by node id so
 * the answer names what would be discarded rather than asserting "something
 * changed" (trap 19).
 */
export function baselineWritesLanded(before: GraphV3T, after: GraphV3T): string[] {
  const pre = new Map<string, number | undefined>();
  for (const node of before.nodes) pre.set(node.id, readObservedValue(node));
  const moved: string[] = [];
  for (const node of after.nodes) {
    if (!pre.has(node.id)) continue; // a NEW node is a structural add, not a rewrite
    const post = readObservedValue(node);
    if (pre.get(node.id) !== post) moved.push(node.id);
  }
  return moved;
}

/**
 * Decide whether this edit turn's graph write may persist.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the withhold.
 */
export function decideOptionInterventionWrite(params: {
  readonly message: string;
  /** The pre-edit graph this turn was dispatched against. */
  readonly before: unknown;
  /** The applied graph, or null when the edit produced none. */
  readonly after: unknown;
  /** The dispatcher's own "a mutation truly applied" predicate. */
  readonly appliedMutation: boolean;
}): OptionInterventionWriteVerdict {
  if (!params.appliedMutation) return { verdict: 'allow', reason: 'no_write' };

  const parsedBefore = GraphV3.safeParse(params.before);
  const parsedAfter = GraphV3.safeParse(params.after);
  if (!parsedBefore.success || !parsedAfter.success) {
    return { verdict: 'allow', reason: 'graph_unparseable' };
  }
  const before = parsedBefore.data;
  const after = parsedAfter.data;

  // Reuse the SHIPPED verdict — the same identity resolution, the same
  // `named_in_message` requirement, the same reader. No second intent predicate.
  const outcome = evaluateConfigureOptionOutcome({
    message: params.message,
    before: params.before,
    after: params.after,
  });
  if (outcome.status !== 'not_honoured') {
    return { verdict: 'allow', reason: 'outcome_not_unhonoured' };
  }

  if (anyInterventionWriteLanded(before, after)) {
    return { verdict: 'allow', reason: 'interventions_write_landed' };
  }

  const baselineNodeIds = baselineWritesLanded(before, after);
  if (baselineNodeIds.length === 0) {
    return { verdict: 'allow', reason: 'no_baseline_write' };
  }

  return {
    verdict: 'withhold',
    optionId: outcome.optionId,
    optionLabel: outcome.optionLabel,
    baselineNodeIds,
  };
}
