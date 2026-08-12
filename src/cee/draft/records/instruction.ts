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
 * ── ⭐ VERSIONS, AND WHICH ONE THE EVIDENCE BELONGS TO ─────────────────────
 * v2 — sha256 `e630587523d29ace…`, 2,351 bytes. THE MEASURED ONE. Every result
 *      recorded up to 2026-08-11 (the 0/27-accepted enumeration, both arm-R1
 *      measured blocks) was taken against exactly these bytes.
 * v3 — sha256 `494e52b9fca94866…`, 3,673 bytes. PRE-REGISTERED 2026-08-12 and
 *      ⚠ UNMEASURED at the time of writing. It was written against the gate's
 *      grammar DERIVED at the validator's bytes (ALLOWED_EDGES, the structural
 *      category inference, MAX_OPTIONS) and against the emission anatomy of the
 *      banked corpus — not against a live result. Do not read the pin as
 *      evidence; read `v3/PRE-REGISTRATION-V3.md` in the evidence dir.
 *
 * Both hashes are pinned by a test, and the v2 literal is a RECORD that may
 * never be re-pointed: a silently edited instruction makes the whole evidence
 * base unattributable, and two instructions sharing one pin is the same defect
 * wearing a tidier face. Changing the instruction is legitimate; changing it
 * while re-pointing the pin in the same motion is not.
 *
 * ⭐ WHAT v3 CHANGED, and why each line exists (all derived, none observed):
 *   · An `option_refinement` IS an option (`projector.ts` CLAIM_KIND_TO_NODE_KIND
 *     maps it to `option`), so it needs its own chain. MEASURED on the banked
 *     corpus: 0 of 26 refinement claims carried an outgoing causal_link — 0.0% —
 *     so every one was born as an option that could never reach the goal. The
 *     instruction had never told the model this mapping existed.
 *   · The edge rule, stated POSITIVELY. `ALLOWED_EDGES` has no
 *     `factor→factor[controllable]` rule and a factor is `controllable` exactly
 *     when an option points at it, so nothing may point INTO a factor an option
 *     acts on. v3 says where such an influence SHOULD go instead.
 *   · An option budget, because the projector mints one option per stated option
 *     AND per refinement, and MAX_OPTIONS is 6.
 *   · `sets_to`, so the analysis can compute a real number instead of comparing
 *     bare labels — asked for only where the brief supports it.
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

- Every option needs a chain that reaches the \`goal\`: a \`causal_link\` FROM the
  option TO a factor it changes, then onward from that factor until the chain
  ends at the goal. An option whose chain stops short cannot be compared with
  any other option.
- An \`option_refinement\` IS an option. It needs its own chain to the goal, on
  the same terms. If you are not going to connect a refinement, state it as part
  of the option it refines instead of as a separate claim.
- Count your options: stated options plus \`option_refinement\` claims together
  should come to six or fewer. Prefer a few well-connected options over many
  bare ones.
- The factor an option acts on is where a chain STARTS. Draw links onward from
  it — to another factor, or to the goal. Do not draw a link INTO it: if
  something else bears on that factor, connect that influence to a factor
  further along the chain, or to the goal.
- Every other factor needs at least one \`causal_link\` onward, and the chain
  must end at the \`goal\`. A factor that leads nowhere is not part of the
  decision.
- If a stated figure or constraint bears on the goal, say so with a
  \`causal_link\` from it to the goal, or into the chain that reaches the goal.
- Set \`effect\` to \`positive\` or \`negative\` on every \`causal_link\`.

Do not emit a factor you cannot connect. But never drop something the user
stated: keep it in \`stated_items\`, and connect it if it bears on the goal.

## HOW MUCH EACH OPTION MOVES WHAT IT CHANGES

On a \`causal_link\` FROM an option TO a factor, set \`sets_to\` to the value that
factor would take if that option were chosen, in the same unit the factor is
measured in.

Set it only where the brief gives you the basis for it — a figure the user
stated, or a change they described. Where the brief does not support a number,
leave \`sets_to\` out. An absent number is a truthful answer; a guessed one is
read as the user's own and cannot be told apart from a figure they gave you.
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
