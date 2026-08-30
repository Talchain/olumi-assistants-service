import { createHash } from "node:crypto";
import { buildDraftRecordsSchema } from "./grammar.js";

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
 * ⭐⭐ WHAT v6 CHANGED (2026-08-14), and why each line exists:
 *   · `outcome` and `risk` became EXPRESSIBLE claim kinds (`grammar.ts`), and an
 *     instruction that did not name them would leave the widening dark: the
 *     model cannot use a kind it is never told exists. Both halves move.
 *   · The shape half now ENUMERATES `claim_kind`, which it never did — it
 *     described the claims in prose and left the model to infer the vocabulary
 *     from the schema. With six kinds and two of them new that is not good
 *     enough.
 *   · "Name a result an `outcome` and a downside a `risk`. Do not file either as
 *     a `factor`." This is a RECLASSIFICATION instruction and applies NO
 *     pressure to invent — it tells the model where to put something it was
 *     already going to say. MEASURED cause: the banked capture
 *     `live-emission-round11-set12.json` carries a factor claim labelled
 *     "Engineering Attrition Risk", and 5/5 live draws on the pinned brief
 *     produced `riskCount: 0`.
 *   · Terminality and orientation, stated in records terms. These are NOT new
 *     rules and NOT this lane's invention: they are the served graph prompt's
 *     own BRIDGE TERMINALITY and NODE ORIENTATION sections
 *     (`defaults-v187` — "Outcomes and risks are terminal bridge nodes… Do not
 *     connect outcome→outcome, outcome→risk, risk→outcome, or risk→risk";
 *     "Outcomes are higher-is-better; risks are higher-is-worse"), which agree
 *     exactly with `ALLOWED_EDGES`. This is the RECONCILIATION half: system
 *     block 1 has asked for "≥1 outcome and ≥1 risk" throughout, and block 2 now
 *     stops contradicting it by silence.
 *   · "Point a factor at an `outcome` or a `risk` rather than at the goal
 *     directly", with the REASON given rather than an imperative: a bare
 *     `factor → goal` edge is bridged by `fixFactorGoalEdges`, and that bridge
 *     is the machine's guess at the result. Saying why is what makes it a
 *     contract rather than a rule the model discards under load.
 *
 * ⚠ WHAT v6 DELIBERATELY DID NOT TOUCH: system block 1 itself. Derived at the
 * bytes — `getSystemPrompt('draft_graph')` resolves from the prompt STORE with
 * the registered default as fallback, so `Prompts/canonical/draft_graph.txt` is
 * REFERENCE, not the served bytes, and editing it would change nothing a model
 * receives. The one contradiction that mattered ran the other way (block 1 asked
 * for risks and outcomes the grammar could not express), and it is closed from
 * this side.
 *
 * ⭐⭐ WHAT v10 CHANGED (2026-08-30) — ONE SECTION, AND IT IS THE ROOT CAUSE OF
 * THE 1-OF-23 COMPLETION RATE:
 *   · `## HOW MUCH EACH OPTION MOVES WHAT IT CHANGES` stopped telling the model
 *     to WITHHOLD the value. v9 said *"Where the brief does not support a
 *     number, leave `sets_to` out … a guessed one is read as the user's own and
 *     cannot be told apart from a figure they gave you."*
 *
 *     ⚠ THE SECOND CLAUSE WAS FALSE AT `f18d941b`. `projector.ts`
 *     `bindDirectStatedMagnitude` already stamps every option→factor magnitude
 *     `brief_extraction` (the value EQUALS a stated figure that verifies against
 *     the brief bytes) or `cee_hypothesis` (ours) — and only the first is ever
 *     presented as the user's. The instruction was a stale mirror of a
 *     distinction the projector gained later (CLAUDE.md trap 12), and it was
 *     costing the entire product: a messy strategic brief rarely states a
 *     per-option-per-factor figure, so the model complied and omitted `sets_to`
 *     everywhere, options reached readiness with no interventions, and every
 *     option×factor pair raised `MISSING_OPTION_VALUE` — in 20 of 23 measured
 *     fresh journeys. THE MODEL WAS NOT FAILING TO COMPLY; IT WAS COMPLYING.
 *
 *     The three legitimate states for a quantity are user fact / OUR estimate
 *     with its provenance / genuinely unknown. v9 collapsed the middle one into
 *     the third. v10 restores it, and the projector supplies the provenance so
 *     the model never has to speak about it (see the rule directly below, which
 *     is unchanged and is why this could be done at all).
 *
 *   · ⚠ THE HONESTY HALF SHIPS IN THE SAME CHANGE, NOT AFTER IT. `projector.ts`
 *     now stamps an UNCITED magnitude `cee_hypothesis` rather than writing no
 *     provenance at all — measured at `f18d941b` by executing the projector: an
 *     uncited `sets_to` produced `interventions` and `raw_interventions` and NO
 *     `intervention_details` whatsoever. Asking for more estimates while leaving
 *     them unattributable would trade a refusal the user can SEE for a
 *     fabrication they cannot. Pinned by
 *     `__tests__/option-effect-value-provenance.test.ts`.
 *
 *   · THE SHAPE HALF IS BYTE-IDENTICAL to v9. In particular *"Do not invent a
 *     number the user did not state"* on `stated_items` is UNTOUCHED: that
 *     governs the USER's half of the record set, it is the property this whole
 *     mechanism exists to defend, and it was never what blocked anybody.
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

/** The same machine-readable contract is present even after grammar degradation. */
export const DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION = `<DRAFT_RECORDS_MACHINE_SCHEMA>
${JSON.stringify(buildDraftRecordsSchema())}
</DRAFT_RECORDS_MACHINE_SCHEMA>`;

/** The shape half: two lists, verbatim quotes, and the honesty split. */
export const DRAFT_RECORDS_SHAPE_INSTRUCTION = `
## OUTPUT SHAPE FOR THIS REQUEST

Do not emit a graph. Emit two lists instead.
The JSON Schema below is the sole authority for machine-readable shape. It
replaces any earlier graph-output instructions or worked examples, including
those in a fallback prompt. Semantic guidance still applies where compatible.
Every claim requires a short, meaningful \`label\`, including causal links.

${DRAFT_RECORDS_MACHINE_SCHEMA_INSTRUCTION}

**stated_items** — one entry for each thing the user actually said that bears on
the decision. \`source_quote\` is REQUIRED and must be copied VERBATIM from the
brief: do not paraphrase, tidy, translate or summarise it. Use \`kind\`:
- \`goal\` — the result the user wants, not the move they are weighing to get
  there. Quote the span naming what is at stake: the quantity, position or state
  that will tell them the decision went well. A course of action is an
  \`option\`, however settled the user sounds about it and however early the brief
  puts it. Never file one span as both a \`goal\` and an \`option\`: if the words
  name something the user might DO, they are the option, and the goal is
  elsewhere.
  Check your pick against the alternatives. Every option, including carrying on
  as they are, has to be a candidate route TO the goal. If the goal you chose is
  one of those alternatives, or takes one of them as given, the others cannot be
  weighed against it and the whole model is built to justify a move the user has
  not finished making.
  Most briefs never state an objective outright — they open with a decision
  already taken, a symptom, or a question. Do not fall back to the sentence that
  frames the choice: that sentence is the decision, not its purpose. Quote
  instead the span naming what the options are trying to move — the measure that
  is going wrong, the position under threat, the quantity everyone is arguing
  about. Set \`role\` to \`baseline\` when that span gives where they are now
  rather than where they want to be.
  When the user HAS said what they are trying to achieve, that is the goal.
  Quote it, even if it is unquantified, modest or awkwardly worded, and even if
  you can see a sharper objective behind it. Theirs is the one that counts.
- \`option\` — a course of action the user named: something they could DO.
  Quote the span that NAMES the action, not the sentence it sits in. A shorter
  span is still verbatim, and that span is what the reader sees on the node.
  "the events budget, which everyone loves but I've never seen a deal come out
  of one" names one option — "the events budget" — and then comments on it:
  quote the option, and put the comment in a \`claim\` if it bears on the
  decision.
  The question the user is deciding is not an option. It is the decision, and
  the options are its branches. Neither is something they say they do not know,
  something that already happened, nor a description of how things work today:
  do not turn them into options. Competing explanations of a current problem
  are hypotheses, not prospective actions, even when each names something the
  team could change. Only generate new alternatives when the user is asking
  for possible actions or a choice between them, not just exploring causes.
  The records contract has no attributed hypothesis/disagreement item: do not
  disguise a reported belief as a factual \`figure\` or as your own \`claim\`.
  This limitation is not permission to assert that the belief was preserved.
  Every option is put on
  the graph to be scored and ranked against the others, so a span that is not a
  course of action is compared with the user's real alternatives as though it
  were one of them.
- \`constraint\` — a limit the user set. Set \`direction\` to \`floor\` when the
  value is a minimum the user must stay above, \`ceiling\` when it is a maximum
  they must stay below.
- \`figure\` — a quantity the user stated
Set \`value\` and \`unit\` when the user gave a number. Do not invent a number the
user did not state, and do not round or rescale one they did.
On a \`goal\` carrying a number, set \`role\` to \`target\` when the number is what
the user wants to REACH, and \`baseline\` when it is where they are NOW. That one
word decides whether the number is registered as the success threshold, so an
unstated \`role\` on a current reading is read as a target and inverts the goal.
On an \`option\` that is the status quo — doing nothing, continuing as-is,
deferring without action, or keeping the current course — set
\`is_baseline: true\`, whatever its wording. Set \`is_baseline: false\` on the
others. Users write this option themselves more often than not ("keep what we
have", "hold price and push volume instead"), and it must be flagged even when
the brief only lists named alternatives.

**claims** — one entry for each thing YOU are adding that the user did not say.
Use \`claim_kind\`:
- \`factor\` — something that varies and that an option can move or that bears on
  what happens
- \`outcome\` — a result the decision produces. Higher is better.
- \`risk\` — something that could go wrong, or a downside the decision carries.
  Higher is worse.
- \`causal_link\` — one thing affecting another
- \`option_refinement\` — a sharper version of an option
- \`prior\` — an AI-inferred quantity; \`value\` can carry a scalar point estimate.
  Omit \`value\` when unknown. This contract cannot carry a range, calibrated
  confidence, rationale or typed refusal. Do not encode those in a number or
  label, and do not present a scalar as a reasoned uncertainty estimate.

Name a result an \`outcome\` and a downside a \`risk\`. Do not file either as a
\`factor\`: a factor is something that VARIES on the way to a result, and calling
a result a factor loses the distinction the analysis needs to compare options.

Set \`basis\` to the array positions of the stated_items your claim
builds on. If a claim rests on nothing the user said, leave \`basis\` empty — that
is a legitimate and expected answer, and marking it honestly is more useful than
attaching a basis that does not hold.

Reference other records by ARRAY POSITION, and say WHICH ARRAY you mean by
choosing the field. A \`causal_link\` needs exactly one \`from_\` and one \`to_\`:
- \`from_stated\` / \`to_stated\` — a position in \`stated_items\`. \`0\` is the
  first thing the user said.
- \`from_claim\` / \`to_claim\` — a position in \`claims\`. \`0\` is your first
  claim.
Never set both \`from_stated\` and \`from_claim\` on one link, or both \`to_\`
fields: they point into different lists and the pair contradicts itself.

Emit only what the brief supports. An empty \`claims\` list is a valid response.
`.trim();

/** The connectivity half: the causal spine the structural validator checks. */
export const DRAFT_RECORDS_CONNECT_INSTRUCTION = `
## CONNECT WHAT YOU EMIT

A decision only holds together if its parts join up, so state the connections as
\`causal_link\` claims. They are claims like any other — yours, not the user's —
and \`basis\` still records whatever the user said that you built them on.

- Every option needs a chain that reaches the \`goal\`: a \`causal_link\` FROM the
  option TO a factor it changes, then onward from that factor to an \`outcome\`
  or a \`risk\`, and from there to the goal. An option whose chain stops short
  cannot be compared with any other option.
- **An \`outcome\` and a \`risk\` are where a chain ENDS.** A factor may point at
  one; the only link LEAVING one goes to the goal. Do not link an outcome or a
  risk to another outcome, risk or factor. If two results feel connected, say so
  by linking them to the goal separately, or make the upstream one a \`factor\`.
- Point a factor at an \`outcome\` or a \`risk\` rather than at the goal directly.
  A factor linked straight to the goal has to be bridged for you, and the bridge
  is then the machine's guess at what the result was, not yours.
- The goal is a \`stated_item\`, so a link that reaches it sets \`to_stated\`. The
  goal is never one of your \`claims\`, so \`to_claim\` cannot reach it: a link that
  tries lands on a factor instead, and every record behind it is dropped for not
  reaching the goal.
- **Chain the option the USER named.** When you add an \`option_refinement\` that
  spells out one of the user's own options, start the chain at the user's option
  (\`from_stated\`), not at your refinement — the two are one alternative and the
  refinement's \`basis\` already records which option it belongs to. Give a
  refinement its OWN chain only when it is a genuinely different alternative the
  user did not name.
- Count your alternatives: the user's stated options plus any \`option_refinement\`
  that introduces a NEW alternative should come to six or fewer. Prefer a few
  well-connected options over many bare ones.
- Nothing points INTO an option. An option is where a chain starts. If something
  bears on whether an option is viable, connect it to a factor on that option's
  chain, or to the goal.
- The factor an option acts on is where a chain STARTS. Draw links onward from
  it — to another factor, or to the goal. Do not draw a link INTO it: if
  something else bears on that factor, connect that influence to a factor
  further along the chain, or to the goal.
- Every other factor needs at least one \`causal_link\` onward, and the chain
  must end at the \`goal\`. A factor that leads nowhere is not part of the
  decision.
- If a stated figure or constraint bears on the goal, say so with a
  \`causal_link\` from it to the goal, or into the chain that reaches the goal.
- Set \`effect\` to \`positive\` or \`negative\` on every \`causal_link\`. On the link
  from an \`outcome\` to the goal that is normally \`positive\`; from a \`risk\` to
  the goal it is normally \`negative\`. Never store a good thing as a \`risk\`.

Do not emit a factor you cannot connect. Keep supported user-stated items in
\`stated_items\`, and connect them if they bear on the goal. Do not coerce an
unsupported semantic distinction into an unrelated record kind to satisfy
connectivity or option-count expectations.

## HOW MUCH EACH OPTION MOVES WHAT IT CHANGES

On a \`causal_link\` FROM an option TO a factor, set \`sets_to\` to the value that
factor would take if that option were chosen, in the same unit the factor is
measured in.

Set it on every option→factor link you emit. It is the only number the analysis
has for what an option actually does, so a link without one leaves that option
with nothing to compare — and the user is asked to supply a value for every
option and factor by hand before anything can be analysed at all.

Where the brief gives you the figure — a number the user stated, or a change they
described — use that, and set \`basis\` to the stated_items it came from. Where
the brief does not give you a figure, give your best estimate, reasoned from what
the brief does tell you: the scale of the numbers already in it, and the
direction and rough size of the change this option describes. Keep the factor's
own unit, and keep your estimates consistent across the options, so the
comparison between them means something.

Leave \`sets_to\` out only where you genuinely cannot form a defensible estimate
even from the brief's own scale. That is a truthful answer, and it also stops the
analysis running on that option — so do not reach for it merely because you are
unsure of the exact number. An estimate you can defend is worth more to the user
than a gap they must fill before they can see anything at all.
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
