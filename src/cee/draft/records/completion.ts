/**
 * THE COMPLETION PASS — one focused turn that closes the gaps pass 1 left.
 *
 * ── WHY A SECOND PASS AT ALL, AND WHAT SETTLED IT ──────────────────────────
 * Not a hunch: a decisive probe (2026-08-12, `round6/PROBE-RESULT.md`) showed
 * the missing connectivity was PRESENT IN THE BRIEF and simply not stated. Shown
 * its own emission and the verdict on it, the model cleared EVERY blocking class
 * on both long briefs in one turn — B1's `MISSING_BRIDGE ×1 · NO_PATH_TO_GOAL ×6
 * · NO_EFFECT_PATH ×6` and B3's `INVALID_EDGE_TYPE ×3` all went to zero, with 0
 * unresolvable references across 63 new claims. The alternative branch — asking
 * the USER for the missing links — was pre-committed and NOT reached, because on
 * these briefs the information was never absent.
 *
 * ── THE FOUR PROPERTIES THIS MODULE EXISTS TO HOLD ─────────────────────────
 *
 * 1. **CLAIMS ONLY.** The completion grammar has no `stated_items` at all, so a
 *    fabricated user quote is STRUCTURALLY IMPOSSIBLE rather than merely
 *    forbidden. Reusing the draft grammar would have been easier and is exactly
 *    wrong: `stated_items` carries `minItems: 1`, so the second turn would be
 *    REQUIRED to re-emit the user's words — an invitation to paraphrase them,
 *    with the paraphrase then wearing a `stated` provenance badge. The schema is
 *    built from `buildDraftClaimItemSchema()`, never restated (trap 12).
 *
 * 2. **APPEND-ONLY.** Existing claims keep their indices, so every reference
 *    already on the wire stays valid; new claims land at `base + k` and the
 *    model is TOLD `base` so it can reference its own additions. `stated_items`
 *    is carried through untouched and the merge asserts it.
 *
 * 3. **THE VERDICT, NEVER AN ANSWER.** The model is shown what did not resolve
 *    and what shape is illegal — derived from the projector's own disclosures —
 *    and the legal vocabulary. It is never shown a suggested edge. A completion
 *    pass that proposed the answer would be the machine authoring the user's
 *    causal model, which is the failure this whole mechanism exists to prevent.
 *
 * 4. **BOTH CLASSES IN ONE ASK.** The probe's round 1 asked only about orphaned
 *    references; the three illegal shapes the projector already knew about
 *    survived the merge and re-appeared as `INVALID_EDGE_TYPE ×3`. A one-class
 *    ask leaves the other class standing, and we knew about it the whole time.
 *
 * ── ⚠⚠ HOW PASS 2 IS BOUNDED, AND WHY IT IS NOT THE RUNAWAY DETECTOR ───────
 * The streaming runaway detector cannot bound this call, and pretending it does
 * would be the worst kind of imaginary guarantee. Measured (#923 review): the
 * completion pass emits `claim_kind` at roughly character 12, so EVERY
 * detector gate — stall, hard ceiling, total chars — lifts on the first delta.
 * The detector gives pass 2 essentially no protection.
 *
 * So pass 2 does not rely on it. **The call is NON-STREAMING**, which removes
 * the streaming detector from the picture entirely rather than leaving a
 * lifted one in place looking like a bound, and it is held by two limits this
 * module owns and states:
 *
 *   RECORDS_COMPLETION_MAX_TOKENS  — an output ceiling (the probe's largest
 *                                    completion was 35 claims)
 *   RECORDS_COMPLETION_WALL_MS     — a hard wall-clock abort the caller applies
 *                                    with an AbortSignal (probe: 19.2 s for the
 *                                    35-claim completion, 4.0 s for the 3-claim
 *                                    one)
 *
 * On ANY failure — abort, provider error, unparseable output, a merge that would
 * disturb `stated_items` — the caller keeps PASS 1's projection unchanged. The
 * completion is strictly additive, so its failure mode is "no improvement",
 * never "worse than not trying". That property is asserted by a test whose cases
 * CAN trigger the transformation, not by two cases that could never have been
 * changed either way (trap 13d).
 */
import {
  buildDraftClaimItemSchema,
  type DraftInferenceClaim,
  type DraftRecordSet,
} from "./grammar.js";
import type { RecordProjection } from "./projector.js";
import { buildInterventionSignature } from "../../../validators/graph-validator.js";

/**
 * Output ceiling for the completion turn. The probe's largest real completion
 * was 35 claims; this is a comfortable multiple of that and well under any
 * budget the draft call itself uses.
 */
export const RECORDS_COMPLETION_MAX_TOKENS = 3000;

/**
 * Hard wall-clock bound the caller enforces with an AbortSignal. The probe
 * measured 19.2 s (35 claims) and 4.0 s (3 claims) for this turn against a
 * ~8–9k-character focused prompt.
 *
 * ⚠ This number is also a GATE-5 commitment, not just a safety limit. Gate 5
 * compares the TWO-PASS TOTAL against arm A's committed p50, so an unbounded
 * second call could pass every correctness gate and fail the latency one.
 */
export const RECORDS_COMPLETION_WALL_MS = 35_000;

/** One thing the completion turn is asked about. */
export interface CompletionAskItem {
  readonly kind:
    | "unresolved_reference"
    | "illegal_shape"
    | "unconnected_record"
    | "option_without_chain"
    | "no_chain_reaches_goal"
    | "options_indistinguishable";
  readonly detail: string;
}

export interface CompletionAsk {
  readonly items: readonly CompletionAskItem[];
  /** `claims.length` at the time of the ask — the index the model's first new claim will take. */
  readonly baseClaimIndex: number;
}

/**
 * THE ORACLE, derived from the projection's OWN disclosures plus the two
 * connectivity predicates, read at the validator's bytes.
 *
 * ⚠ DELIBERATELY NOT THE FULL VALIDATOR, AND NOT THE ENUMERATION ORACLE. Both
 * over-report against the live pipeline: measured on one identical 18-node /
 * 23-edge graph, the live `post_sweep_authoritative` phase reported 3 errors
 * where the enumeration oracle raised 4 blocking and 15 total, because the
 * oracle runs only one stage of the deterministic sweep. Asking the model to fix
 * a class the live pipeline would never have raised spends a turn manufacturing
 * claims for a problem that does not exist — and every one of those claims is a
 * causal assertion presented to the user.
 *
 * So the ask is built ONLY from things this projector itself observed:
 * references it refused, shapes it rejected, records it could not place, and
 * reachability computed on its own emitted edges.
 */
export function enumerateCompletionAsk(
  records: DraftRecordSet,
  projection: RecordProjection,
): CompletionAsk {
  const items: CompletionAskItem[] = [];
  const seen = new Set<string>();
  const push = (item: CompletionAskItem) => {
    const key = `${item.kind}|${item.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const d of projection.dropped) {
    switch (d.reason) {
      case "unparseable_ref":
      case "ref_out_of_range":
      case "ref_target_not_a_node":
      case "missing_ref":
      case "ambiguous_ref":
        push({
          kind: "unresolved_reference",
          detail: `"${d.label}" — ${d.from_ref ?? "(no from)"} → ${d.to_ref ?? "(no to)"} did not resolve (${d.reason})`,
        });
        break;
      case "ref_kind_illegal":
        push({
          kind: "illegal_shape",
          detail: `"${d.label}" — a link from a ${d.from_kind} to a ${d.to_kind} is not a shape this model can hold`,
        });
        break;
      // ⚠⚠ `unconnected_to_goal` IS DELIBERATELY NOT ASKED ABOUT, and the first
      // version of this function did ask. MEASURED on B1: it produced an ask of
      // 40 items of which 24 were stated figures — "£3.1m cash", "NRR is 112%",
      // "TAM is supposedly €400m" — that the model had correctly declined to
      // connect because they do not bear on the goal.
      //
      // Three things are wrong with asking:
      //   · The projector WITHHOLDS these records from the graph precisely so
      //     they cannot manufacture `NO_PATH_TO_GOAL`. The validator never sees
      //     them, so they are not a failure — they are the disclosure that
      //     PREVENTS one.
      //   · Asking is PRESSURE TO INVENT a causal link for a figure that has
      //     none, and zero false authorship is the property this whole mechanism
      //     exists to defend. The grammar refuses to floor `claims` for exactly
      //     this reason; an ask that lists every unconnected figure would
      //     reintroduce the pressure the grammar declined to apply.
      //   · Fidelity does not depend on it. Stated content survives in
      //     `stated_items` whether or not it becomes a node, and that is what the
      //     fidelity postcondition measures.
      //
      // `option_budget_exceeded` and `refinement_merged_into_stated_option` are
      // likewise projector DECISIONS, not gaps: asking about either would ask the
      // model to undo a deliberate, disclosed choice.
      case "unconnected_to_goal":
      default:
        break;
    }
  }

  // The two connectivity predicates, derived at `graph-validator.ts`:
  //   NO_EFFECT_PATH  (:822) — each option needs ≥1 DIRECT factor target that
  //                            reaches the goal.
  //   MISSING_BRIDGE  (:384) — satisfied by ANY chain terminating at the goal.
  const { nodes, edges } = projection.graph;
  const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e.from);
    else incoming.set(e.to, [e.from]);
  }
  const goalIds = nodes.filter((n) => n.kind === "goal").map((n) => n.id);
  const reachesGoal = new Set<string>();
  const stack = [...goalIds];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachesGoal.has(current)) continue;
    reachesGoal.add(current);
    for (const from of incoming.get(current) ?? []) stack.push(from);
  }

  for (const node of nodes) {
    if (node.kind !== "option") continue;
    const hasEffectPath = edges.some(
      (e) => e.from === node.id && kindById.get(e.to) === "factor" && reachesGoal.has(e.to),
    );
    if (!hasEffectPath) {
      push({
        kind: "option_without_chain",
        detail: `the option "${node.label}" has no chain of causal_links that reaches the goal`,
      });
    }
  }
  if (goalIds.length > 0 && !edges.some((e) => reachesGoal.has(e.from) && e.from !== e.to && reachesGoal.has(e.to))) {
    push({ kind: "no_chain_reaches_goal", detail: "nothing you emitted terminates at the goal" });
  }

  // OPTIONS_IDENTICAL (`graph-validator.ts:841`) — two options the analysis
  // cannot tell apart. The signature is computed with the validator's OWN
  // EXPORTED `buildInterventionSignature`, never a retyped copy: that function's
  // docblock records that measurement harnesses previously restated its
  // semantics and drifted out of agreement with the thing they measured.
  //
  // MEASURED on B3: "finally do the platform rewrite" and the refinement
  // "Rewrite First, Then Copilot (Sequenced)" carry byte-identical signatures
  // (`475a18b9:1.0000|dbc7be0a:0.0000`). They are genuinely different
  // alternatives — one sequences the work, one does not — and the model simply
  // never said how they differ. That is a gap the brief can close, so it is
  // askable; the ask is phrased to permit "it does not", because a difference
  // invented to satisfy a validator is a number the user will read as their own.
  {
    const bySignature = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.kind !== "option") continue;
      const interventions = (node.data as { interventions?: Record<string, number> } | undefined)?.interventions;
      if (!interventions) continue;
      const signature = buildInterventionSignature(interventions);
      const list = bySignature.get(signature);
      if (list) list.push(node.label);
      else bySignature.set(signature, [node.label]);
    }
    for (const labels of bySignature.values()) {
      if (labels.length < 2) continue;
      push({
        kind: "options_indistinguishable",
        detail: `${labels.map((l) => `"${l}"`).join(" and ")} change the same factors to the same levels, so nothing can tell them apart`,
      });
    }
  }

  return { items, baseClaimIndex: records.claims.length };
}

/**
 * The completion turn's grammar — CLAIMS ONLY.
 *
 * `stated_items` is absent, so the second turn cannot restate the user's words
 * even if it wanted to. Built from the draft grammar's own claim-item builder,
 * so a change to the claim shape moves both passes together.
 */
export function buildRecordsCompletionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      claims: { type: "array", items: buildDraftClaimItemSchema() },
    },
    required: ["claims"],
    additionalProperties: false,
  };
}

/** Render the record set for the model, with the exact indices its references must use. */
function renderRecordsForAsk(records: DraftRecordSet): string {
  const stated = records.stated_items
    .map((s, i) => `  stated_items[${i}] ${s.kind}: ${JSON.stringify(s.source_quote)}${typeof s.value === "number" ? ` (value ${s.value}${s.unit ? ` ${s.unit}` : ""})` : ""}`)
    .join("\n");
  const claims = records.claims
    .map((c, i) => {
      const from = c.from_stated !== undefined ? `stated_items[${c.from_stated}]` : c.from_claim !== undefined ? `claims[${c.from_claim}]` : "";
      const to = c.to_stated !== undefined ? `stated_items[${c.to_stated}]` : c.to_claim !== undefined ? `claims[${c.to_claim}]` : "";
      const link = from || to ? `  ${from} → ${to}` : "";
      return `  claims[${i}] ${c.claim_kind}: ${JSON.stringify(c.label)}${link}`;
    })
    .join("\n");
  return `stated_items:\n${stated}\n\nclaims:\n${claims}`;
}

/**
 * The completion prompt.
 *
 * States the verdict and the legal vocabulary; never a suggested edge. The
 * "do not invent" clause is load-bearing and is phrased as a PERMISSION to
 * return nothing, because a completion turn that feels obliged to produce
 * claims will produce them.
 */
export function buildRecordsCompletionPrompt(args: {
  brief: string;
  records: DraftRecordSet;
  ask: CompletionAsk;
}): string {
  const { brief, records, ask } = args;
  const problems = ask.items.map((i) => `- ${i.detail}`).join("\n");
  return [
    "## COMPLETE THE RECORD SET YOU JUST EMITTED",
    "",
    "You emitted the record set below for this brief. Some of it does not join up.",
    "Add the causal_link claims that close the gaps — and ONLY those.",
    "",
    "### The brief",
    brief,
    "",
    "### What you emitted",
    renderRecordsForAsk(records),
    "",
    "### What does not join up",
    problems,
    "",
    "Any link listed above as an illegal shape has already been DISCARDED — it is not on the model",
    "and you cannot edit it. If the connection it was reaching for is real, state it again as a NEW",
    "link with a legal shape.",
    "",
    "### What to emit now",
    `Emit ONLY new claims. Your first new claim will be claims[${ask.baseClaimIndex}], the next`,
    `claims[${ask.baseClaimIndex + 1}], and so on — reference them with \`from_claim\`/\`to_claim\``,
    "using those numbers. Everything above keeps the index it already has.",
    "",
    "The shapes a chain can take:",
    "- an option → a factor it changes (`from_stated` or `from_claim` → `to_claim`)",
    "- a factor → another factor further along the chain",
    "- a factor → the goal",
    "- nothing points INTO an option, and nothing points INTO a factor that an option acts on;",
    "  connect such an influence further down the chain, or to the goal",
    "- nothing leaves the goal",
    "",
    "Set `effect` to `positive` or `negative` on every link. On a link FROM an option TO a factor,",
    "set `sets_to` to the level that factor takes under that option, in the factor's own unit —",
    "but only where the brief gives you the basis for it.",
    "",
    "Where two options are listed above as indistinguishable: if the brief says they act differently",
    "on some factor, say so with a link and a `sets_to` that reflects it. If the brief does NOT say",
    "they differ, leave them alone — a difference made up to separate two options is a number the",
    "user will read as their own.",
    "",
    "Do not restate anything the user said; you cannot, and you do not need to.",
    "Do not add a factor or a link the brief does not support. If a gap above cannot be closed from",
    "the brief, leave it open — an honest gap is a better answer than an invented link, and an empty",
    "`claims` list is a valid response.",
  ].join("\n");
}

export type CompletionMergeResult =
  | { ok: true; records: DraftRecordSet; added: number }
  | { ok: false; reason: "stated_items_disturbed" | "no_new_claims" };

/**
 * APPEND-ONLY MERGE. Existing claims keep their indices; `stated_items` is
 * carried through by reference-equality of content and asserted unchanged.
 *
 * The `stated_items_disturbed` branch cannot be reached through the completion
 * grammar (which has no `stated_items`), and exists anyway: the property that
 * the user's own words are untouched is the one this mechanism must never
 * discover it lost, and a guarantee that rests on "the schema wouldn't let it"
 * is a guarantee with no witness.
 */
export function mergeCompletionClaims(
  base: DraftRecordSet,
  completion: { stated_items?: unknown; claims?: DraftInferenceClaim[] },
): CompletionMergeResult {
  if (completion.stated_items !== undefined) return { ok: false, reason: "stated_items_disturbed" };
  const added = completion.claims ?? [];
  if (added.length === 0) return { ok: false, reason: "no_new_claims" };
  return {
    ok: true,
    records: { stated_items: base.stated_items, claims: [...base.claims, ...added] },
    added: added.length,
  };
}
