/**
 * P0d — THE CORRECTIVE CONTEXT THE BOUNDED AUTO-RETRY WAS THROWING AWAY.
 *
 * ## The defect
 *
 * `runUnifiedPipeline`'s retry re-drafted with BYTE-IDENTICAL input: no prompt
 * change, no error feedback. Two identical samples from a distribution that
 * mostly disconnects will mostly disconnect twice — 40–80 seconds spent
 * reproducing the failure the user was already holding. Meanwhile the gate's own
 * `revalidation.errors` had already named exactly what was wrong, was serialised
 * into `details`, and was discarded at the seam.
 *
 * This module turns that discarded finding into ONE system-authored paragraph
 * for attempt 2. It is the only thing that differs between the two attempts.
 *
 * ## What it deliberately does NOT do
 *
 * **It does not repair anything, and it must never be read as a repair.** The
 * post-enforcement validator still runs on attempt 2 and a second degenerate
 * draft still fails closed. Nothing here lets an unrepaired graph through, and
 * the directive's own closing sentence tells the model in terms that inventing a
 * link it cannot justify from the brief is worse than leaving the record out.
 * An invented edge is a machine-authored causal claim presented to the user as
 * part of their own reasoning.
 *
 * ## Why it carries CODES and COUNTS, and no ids, labels or messages
 *
 * Two independent reasons, and both are load-bearing:
 *
 * 1. **SAFETY — the directive lands in the system-authority region.**
 *    `systemDirective` is concatenated OUTSIDE the
 *    `[BEGIN/END]_UNTRUSTED_USER_CONTENT` markers (`adapters/llm/anthropic.ts:494-497`),
 *    deliberately, so the model reads its own retry instruction with system
 *    authority rather than as untrusted user text (#595 review P2). Node labels
 *    and validator `message` strings are drafted FROM the user's brief; routing
 *    them into that region is an injection carrier. **The producer already draws
 *    this exact line for the same reason** — `graph-enforcement.ts:707-714`
 *    keeps `validation_errors[].message` off the wire because "its `message`
 *    strings embed node labels drafted from user input", and ships
 *    `validation_error_codes` (fixed validator enums) instead. This module reads
 *    that already-adjudicated field. It is not a new safety judgement; it is the
 *    producer's.
 *
 * 2. **USEFULNESS — the ids would be noise.** Node ids are
 *    `sha8(claim_kind, label)` content hashes minted by the PROJECTOR
 *    (`cee/draft/records/projector.ts:2589`). The model never emitted them and
 *    has never seen them, and attempt 2 mints its own from its own labels. An id
 *    from attempt 1 is not a referent attempt 2 can act on.
 *
 * ## The gloss table and trap 12
 *
 * `CODE_GUIDANCE` is a hand-written mirror of part of `ValidationErrorCode`, and
 * it WILL fall behind that union. Two things keep that honest:
 *   - `satisfies Partial<Record<ValidationErrorCode, string>>` — a key that is
 *     not a real validator code, or one the validator renames, fails TYPECHECK.
 *     (It cannot catch a code that is ADDED; nothing derivable can.)
 *   - the formatter **degrades visibly, never silently**: a code with no gloss
 *     is still named and counted in the directive. The failure mode that matters
 *     is a code disappearing from the model's view because nobody wrote its
 *     sentence, and that cannot happen here. Pinned with a fabricated future
 *     code in `tests/unit/cee.unified-pipeline.informed-retry.test.ts`.
 */

import type { ValidationErrorCode } from "../../validators/graph-validator.types.js";
import { isEnforcementBlockedResult } from "./stages/repair/graph-enforcement.js";
import { isOptionsIdenticalBypassResult } from "./stages/repair/options-identical-bypass.js";
import type { UnifiedPipelineResult } from "./types.js";

/**
 * Plain-English gloss per blocking validator code, written in the DRAFT
 * prompt's vocabulary (options, factors, outcomes, goal).
 *
 * ⚠ The raw codes are NOT self-explanatory to the drafting model. The
 * `<VIOLATION_REFERENCE>` table that defines them lives in the **repair_graph**
 * prompt (`src/prompts/defaults.ts:723`, `REPAIR_GRAPH_PROMPT_VERSION`), which
 * attempt 2 never sees — it is a fresh `draft_graph` call. Shipping bare enums
 * would be shipping our internal vocabulary at a reader who has no glossary.
 *
 * Each gloss states WHAT WAS WRONG, never what to add. The "what to do" half is
 * one shared rule below, so no gloss can drift into prescribing a specific edge.
 */
const CODE_GUIDANCE = {
  NO_EFFECT_PATH:
    "an option had no controllable factor with a causal chain reaching the goal",
  NO_PATH_TO_GOAL: "a node had no causal chain reaching the goal",
  UNREACHABLE_FROM_DECISION: "a node could not be reached from the decision",
  MISSING_BRIDGE: "an outcome or risk had nothing linking it towards the goal",
  MISSING_GOAL: "the model had no goal node for anything to lead to",
  INSUFFICIENT_OPTIONS: "there were too few options to compare",
  INVALID_EDGE_TYPE:
    "a causal link joined two kinds of node that may not be linked directly",
  CYCLE_DETECTED: "the causal links formed a loop",
  GOAL_HAS_OUTGOING: "the goal had outgoing links, but nothing may follow the goal",
  DECISION_HAS_INCOMING: "the decision had incoming links, but nothing may precede it",
  OPTIONS_IDENTICAL:
    "two options carried the same intervention values, so there was nothing to compare",
} satisfies Partial<Record<ValidationErrorCode, string>>;

/**
 * The rule attempt 2 has to satisfy, stated POSITIVELY and once.
 *
 * ⛔ The final sentence is not decoration. Without it the directive reads as
 * "connect everything", and the cheapest way to satisfy that is to invent a
 * link — which is exactly the outcome this lane is forbidden to produce, and
 * strictly worse than a visible failure. The projector already reasons this way
 * about the same choice (`projector.ts:2833-2840`: FORCE IT IN / DROP IT /
 * DISCLOSE IT, and only the third is honest).
 */
const STRUCTURAL_RULE = [
  "For this attempt, make sure the causal structure holds together:",
  "- every option must change at least one factor, and that factor must have a chain of causal links reaching the goal;",
  "- every factor and constraint you place on the graph must reach the goal the same way.",
  "Do NOT invent a link to satisfy this. If a consideration genuinely does not bear on the goal, leave it out of the causal structure rather than adding a connection the brief does not support — an unsupported link is worse than an omitted one.",
].join("\n");

/** Stable, deterministic tally of the codes, in first-seen order. */
function tally(codes: readonly string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return [...counts.entries()];
}

/** `NO_EFFECT_PATH (×2) — an option had no controllable factor …` */
function formatCode(code: string, count: number): string {
  const gloss = (CODE_GUIDANCE as Record<string, string | undefined>)[code];
  const multiplicity = `${code} (×${count})`;
  // ⚠ DEGRADE VISIBLY. An unglossed code still reaches the model by name and
  // count — the silent drop is the failure mode that matters (trap 12).
  return gloss ? `- ${multiplicity} — ${gloss}` : `- ${multiplicity}`;
}

/**
 * The blocking codes attempt 1 emitted, read from the producer's own codes-only
 * mirror. Returns an empty array when the field is absent or malformed —
 * a directive is never worth a throw on the recovery path.
 */
function readValidationErrorCodes(body: unknown): string[] {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return [];
  const details = (body as Record<string, unknown>).details;
  if (details === null || typeof details !== "object" || Array.isArray(details)) return [];
  const codes = (details as Record<string, unknown>).validation_error_codes;
  if (!Array.isArray(codes)) return [];
  return codes.filter((c): c is string => typeof c === "string" && c.length > 0);
}

/**
 * ⭐ Build the corrective context for attempt 2 from attempt 1's own typed
 * failure — or `undefined` when there is nothing honest to say.
 *
 * `undefined` for every success, every thrown error, and every failure outside
 * the two self-declared-stochastic retry classes. The class test is DELEGATED to
 * the same two producer-side predicates the retry decision itself uses
 * (`isEnforcementBlockedResult` / `isOptionsIdenticalBypassResult`), so the
 * directive cannot be built for a result the seam would not have retried — one
 * authority for "is this a retryable draft failure", not two (trap 21).
 *
 * Pure. Reads `result`, writes nothing.
 */
export function buildPriorAttemptDirective(
  result: UnifiedPipelineResult | undefined,
): string | undefined {
  if (!result) return undefined;

  const header =
    "## Correction — your previous attempt at this brief was rejected\n\n" +
    "You have already drafted a model for this brief. It was rejected by structural validation and never reached the user. What follows is what the validator found. Draft the brief again, addressing it.";

  if (isEnforcementBlockedResult(result)) {
    const codes = tally(readValidationErrorCodes(result.body));
    // An enforcement block with no readable codes still gets the structural
    // rule: the class itself IS the finding (the gate fired), and the rule is
    // what attempt 2 needs regardless of which codes carried it.
    const findings = codes.length > 0
      ? `\n\nThe blocking findings were:\n${codes.map(([c, n]) => formatCode(c, n)).join("\n")}`
      : "";
    return `${header}${findings}\n\n${STRUCTURAL_RULE}`;
  }

  if (isOptionsIdenticalBypassResult(result)) {
    // ⚠ NOT the enforcement copy. These options were connected fine — they came
    // out with the same numbers. Borrowing the topology rule above would
    // describe a defect this draft did not have, and would point the model's
    // effort at the wrong thing (the same reasoning as the per-class exhausted
    // copy table in draft-auto-retry.ts).
    return [
      header,
      "",
      `The blocking finding was:\n${formatCode("OPTIONS_IDENTICAL", 1)}`,
      "",
      "For this attempt, give the options at least one intervention value that genuinely differs between them — whichever dimension the brief says the decision turns on. Do NOT manufacture a difference the brief does not support: if the brief truly does not distinguish the options on any value, say so in your reasoning rather than inventing a number to separate them.",
    ].join("\n");
  }

  return undefined;
}
