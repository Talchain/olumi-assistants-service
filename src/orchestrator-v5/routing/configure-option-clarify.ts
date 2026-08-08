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
import { computeStructuralReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../compose/analysis-ready-emit.js';
import {
  carriesConfigureOptionValuePayload,
  type ConfigureOptionIntentDetection,
} from './configure-option-intent.js';
import { containsPhrase } from './option-intervention-guard.js';

/** Why the intercept declined. Every value keeps the pre-existing route. */
export type ConfigureOptionClarifyDeclineReason =
  | 'not_configure_intent'
  | 'value_payload_present'
  | 'graph_unparseable'
  | 'no_readiness'
  | 'no_unconfigured_option'
  | 'option_not_identified'
  | 'no_candidate_factor';

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
  const graph = parsed.data;

  // DERIVED (trap 12): "which options are unconfigured" is not re-implemented
  // here — it is read off the SAME `computeStructuralReadiness` payload that
  // composes the gate reason the user is looking at. The remedy therefore
  // cannot disagree with the blocker copy about which option is blocked.
  const readiness = computeStructuralReadiness(graph);
  if (readiness === undefined) return decline('no_readiness');

  const unconfigured = readiness.options.filter((o) => o.status === 'needs_encoding');
  if (unconfigured.length === 0) return decline('no_unconfigured_option');

  const normalisedMessage = ` ${params.message.toLowerCase().replace(/\s+/g, ' ').trim()} `;

  // 1. The option the user named, when they named one.
  let target = unconfigured.find((o) => {
    const label = typeof o.label === 'string' ? o.label.toLowerCase().replace(/\s+/g, ' ').trim() : '';
    return label.length >= 3 && containsPhrase(normalisedMessage, label);
  });
  let optionSource: 'named_in_message' | 'sole_unconfigured' = 'named_in_message';

  // 2. Otherwise, the sole blocked option — which is what the chip's own
  //    message and the generic "Set values for options" chip resolve to.
  //    Deliberately NOT extended to "pick the first of several": with two
  //    blocked options and no name, guessing which one the user meant is the
  //    kind of confident wrong answer this lane exists to remove.
  if (target === undefined) {
    if (unconfigured.length !== 1) return decline('option_not_identified');
    target = unconfigured[0];
    optionSource = 'sole_unconfigured';
  }

  const factorLabels = collectCandidateFactorLabels(graph, target.option_id, target.interventions);
  if (factorLabels.length === 0) return decline('no_candidate_factor');

  return {
    matched: true,
    optionId: target.option_id,
    optionLabel: target.label,
    factorLabels,
    readiness,
    optionSource,
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
  return resolveConfigureOptionFacts(params);
}

/**
 * The factors this option is actually wired to and has not yet set a value
 * for. Read straight off the graph's edges — every name offered to the user is
 * a node the product itself created (the add-option transaction links the
 * option to its factor). Nothing here is generated.
 */
function collectCandidateFactorLabels(
  graph: { nodes: readonly { id: string; kind: string; label: string }[]; edges: readonly { from: string; to: string }[] },
  optionId: string,
  existingInterventions: Readonly<Record<string, number>> | undefined,
): readonly string[] {
  const already = new Set(Object.keys(existingInterventions ?? {}));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const edge of graph.edges) {
    if (edge.from !== optionId) continue;
    if (already.has(edge.to)) continue;
    const node = byId.get(edge.to);
    if (node === undefined || node.kind !== 'factor') continue;
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length === 0 || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
    if (labels.length === MAX_FACTOR_SUGGESTIONS) break;
  }

  return labels;
}
