import { createHash } from "node:crypto";

/**
 * THE DRAFT RECORDS INSTRUCTION — the model-facing half of the contract.
 *
 * ── ONE CONTRACT, THREE ARTEFACTS, ONE OWNER ───────────────────────────────
 * The INSTRUCTION (this file), the GRAMMAR (`grammar.ts`) and the PROJECTOR
 * (`projector.ts`) are ONE contract: derive any two from the third and prove it
 * with a conformance test. That is why the instruction ships in CODE and not in
 * the prompt store. The store can version an instruction, but it cannot pin one
 * to the grammar and projector it must move in lockstep with — promoting this
 * would split one contract across two authorities whose precedence is already
 * implicit (a store model pin silently outranks the env var), behind a drift
 * alarm that has never run. The precondition for ever promoting it is a store
 * that can pin (prompt, grammar hash, projector version) as ONE unit.
 *
 * ── HOW IT REACHES THE MODEL ───────────────────────────────────────────────
 * As a SECOND system block, appended AFTER the block carrying the
 * `cache_control` breakpoint, so the long cached draft prompt stays
 * byte-identical and no draft pays a cold cache-write.
 *
 * ⚠ NOT via `args.systemDirective`. That channel is owned by the lean-draft
 * retry and answers a different question — "what should this RETRY do
 * differently?" versus "what SHAPE does every draft emit?". Two questions under
 * one name is trap 21, and this estate has paid for it.
 *
 * ── ⭐ THESE BYTES ARE THE MEASURED ONES ───────────────────────────────────
 * sha256 `e630587523d29ace5739d5c26754d787fb00479d542a3cb1fc7ca13ceb1eca26`,
 * 2,351 bytes. That hash is pinned by a test carrying a HISTORIC literal, and
 * the literal may never be "updated" to match a change: every measurement that
 * justified this mechanism was taken against exactly these bytes, and a silently
 * edited instruction makes all of it unattributable. Changing the instruction is
 * legitimate — changing it while leaving the pin pointing at the new value is
 * not. Move the pin deliberately, in the same commit, with the new measurement.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SAY ──────────────────────────────────────
 * NOTHING ABOUT PROVENANCE. The projector owns provenance mechanically, and a
 * model that could speak about provenance could commit false authorship — the
 * exact property this design exists to protect. An instruction that discussed a
 * provenance channel would invite the model to use one.
 *
 * It also asks for no `category` (category is INFERRED FROM STRUCTURE by the
 * validator, `graph-validator.ts:83-134`; declaring it invites `CATEGORY_MISMATCH`)
 * and no `strength` (a number the model was not asked for is invented precision,
 * and the repair machinery defaults it anyway).
 *
 * And it applies no pressure to invent: "do not emit a factor you cannot
 * connect" REMOVES a claim, it does not add one, and the sentence after it
 * forbids dropping anything the user stated. "CRITICAL: you MUST" phrasing
 * over-triggers on current models, so the contract is stated plainly and the one
 * prohibition that carries a reason is the only one raised.
 *
 * ── PROVENANCE OF THE SECOND SECTION ───────────────────────────────────────
 * `## CONNECT WHAT YOU EMIT` was written against the CONSUMER's predicate, not
 * against the symptom in hand (trap 13d). The symptom was "no causal link starts
 * at an option". That is NOT what the gate checks. Derived at the bytes:
 *   NO_EFFECT_PATH            `graph-validator.ts:822` — each option needs a
 *                             DIRECT `controllable`-factor target that reaches
 *                             the goal. Option-origin links alone satisfy none of it.
 *   NO_PATH_TO_GOAL           `:620` — EVERY node except the decision must reach
 *                             the goal.
 *   UNREACHABLE_FROM_DECISION `:576` — every node except decision/goal must be
 *                             reachable from the decision.
 * So the section asks for the WHOLE SPINE the gate checks, not for the symptom.
 * Measured effect on the first attempt, same window, controls firing: causal
 * links originating at an option moved 0/44 → 28/75, and goal-terminating links
 * 0 → 20, with no pressure on the model to invent anything.
 */

/** The shape half: two lists, verbatim quotes, and the honesty split. */
export const DRAFT_RECORDS_SHAPE_INSTRUCTION = `
## OUTPUT SHAPE FOR THIS REQUEST

Do not emit a graph. Emit two lists instead.

**stated_items** — one entry for each thing the user actually said that bears on
the decision. \`source_quote\` is REQUIRED and must be copied VERBATIM from the
brief: do not paraphrase, tidy, translate or summarise it. Use \`kind\`:
- \`goal\` — an objective the user stated
- \`option\` — a course of action the user named
- \`constraint\` — a limit the user set. Set \`direction\` to \`floor\` when the
  value is a minimum the user must stay above, \`ceiling\` when it is a maximum
  they must stay below.
- \`figure\` — a quantity the user stated
Set \`value\` and \`unit\` when the user gave a number. Do not invent a number the
user did not state, and do not round or rescale one they did.

**claims** — one entry for each thing YOU are adding that the user did not say:
factors worth modelling, causal links between them, refinements of an option, or
a prior. Set \`basis\` to the array positions of the stated_items your claim
builds on. If a claim rests on nothing the user said, leave \`basis\` empty — that
is a legitimate and expected answer, and marking it honestly is more useful than
attaching a basis that does not hold.

Reference other records by position: \`s0\` is the first stated_item, \`s1\` the
second; \`c0\` is the first claim. A \`causal_link\` needs \`from_ref\` and
\`to_ref\`.

Emit only what the brief supports. An empty \`claims\` list is a valid response.
`.trim();

/** The connectivity half: the causal spine the structural validator checks. */
export const DRAFT_RECORDS_CONNECT_INSTRUCTION = `
## CONNECT WHAT YOU EMIT

A decision only holds together if its parts join up, so state the connections as
\`causal_link\` claims. They are claims like any other — yours, not the user's —
and \`basis\` still records whatever the user said that you built them on.

- Every \`option\` needs at least one \`causal_link\` FROM it TO a factor claim it
  changes. An option that changes nothing cannot be told apart from any other
  option.
- Every factor needs at least one \`causal_link\` onward, and the chain must end
  at the \`goal\`. A factor that leads nowhere is not part of the decision.
- If a stated figure or constraint bears on the goal, say so with a
  \`causal_link\` from it to the goal.
- Set \`effect\` to \`positive\` or \`negative\` on every \`causal_link\`.

Do not emit a factor you cannot connect. But never drop something the user
stated: keep it in \`stated_items\`, and connect it if it bears on the goal.
`;

/**
 * The instruction served on every draft. A pure concatenation of the two
 * sections above, so the delta between them stays legible and each half can be
 * pinned independently.
 */
export const DRAFT_RECORDS_INSTRUCTION =
  `${DRAFT_RECORDS_SHAPE_INSTRUCTION}\n${DRAFT_RECORDS_CONNECT_INSTRUCTION}`.trimEnd();

/** sha256 of the served instruction bytes. */
export function draftRecordsInstructionHash(): string {
  return createHash("sha256").update(DRAFT_RECORDS_INSTRUCTION, "utf8").digest("hex");
}
