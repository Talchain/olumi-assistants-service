/**
 * SPIKE ARM C — the arm switch, the frozen system-block appendix, and the
 * pre-registration hashes.
 *
 * ⚠ THROWAWAY. Spike branch only. Never merged, never pushed to `staging`.
 *
 * ── THE SWITCH ─────────────────────────────────────────────────────────────
 * `SPIKE_ARM=C` in the LOCAL instance env only (§3: staging config UNTOUCHED).
 * Read through a function, never captured at module load, so a test can set the
 * variable and observe the change — a module-level `const` would freeze the
 * first value read and make the arm untestable in-process.
 *
 * DEFAULT IS OFF. With the variable absent, every call site takes the byte-
 * identical status-quo path, which is what makes arm A on this lineage a true
 * control.
 *
 * ── THE APPENDIX, AND WHY IT IS NOT `systemDirective` ──────────────────────
 * §2: the record instruction is "an in-code system-block appendix on the spike
 * branch (added in the adapter's system-blocks assembly, NOT via
 * `systemDirective` — that seam is owned by the lean-draft retry,
 * `parse.ts:387-411`, and two meanings under one channel is trap 21)."
 *
 * Trap 21 is the one this obeys: two concepts sharing a channel because their
 * names looked alike produced a defect that neither PR's tests could see. The
 * lean-draft retry's directive answers "what should this RETRY do differently?";
 * the arm-C appendix answers "what SHAPE should every draft on this arm emit?".
 * Different questions ⇒ different channels, named apart.
 *
 * The appendix is appended as a SECOND system block, after the one carrying the
 * `cache_control` breakpoint. That ordering is deliberate: the cached prefix
 * (the pinned v195 prompt) stays byte-identical, so arm C does not pay a cold
 * cache-write on every draft and the frozen prompt is genuinely untouched (§3).
 *
 * ── THE PINNED PROMPT IS NOT EDITED ────────────────────────────────────────
 * §3 freezes `draft_graph_default@v195` and the prompt store is READ-ONLY. This
 * appendix is in-code, on the spike branch, and never written to the store.
 *
 * ── ⚠ THE CONFOUND, DISCLOSED (§2, restated because it bounds the result) ───
 * Arm C necessarily changes BOTH the output shape AND the instruction. The two
 * cannot be separated within one arm and the protocol does not pretend
 * otherwise. Any arm-C effect is the JOINT effect of the pair.
 */

import { createHash } from "node:crypto";
import { buildSpikeCRecordsSchema } from "./records-schema.js";

/**
 * `SPIKE_ARM=C` — read per call, never cached at module scope.
 *
 * ⚠ `no-restricted-syntax` (direct `process.env`) is disabled HERE, once, on
 * purpose. The repo's rule points at `src/config/index.ts`, and that is right
 * for product code. It is wrong for this: adding a key to the shared config
 * module would put a throwaway spike variable into a file every lane and both
 * other arms import, and §3 freezes configuration for the duration of the
 * spike. A single localised read on a branch that is never merged is the
 * smaller violation, and the rule is disabled with its reason rather than the
 * file being restructured to hide the read.
 */
export function isSpikeArmC(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- spike-only gate; see above.
  return process.env.SPIKE_ARM === "C";
}

/**
 * ⭐ ARM C-EXTENDED (`SPIKE_ARM=C_EXT`) — §1.4's own named option, run as a
 * SEPARATE arm with its OWN pre-registration.
 *
 * `C-BUILD-2` (P4C) measured 44 causal links across 9 arm-C runs with ZERO
 * originating at an option, and traced it to the appendix: the frozen bytes
 * describe the two lists and never ask for the connections. §1.4 names the
 * response — "C-extended (records + an explicit structural constraint)" — and
 * ADDENDUM v1.3 §2 pre-commits it: narrow diagnosis → smallest change →
 * re-measure.
 *
 * ⚠ THE FROZEN ARM-C BYTES ARE NOT EDITED. `SPIKE_C_SYSTEM_APPENDIX` above is
 * byte-identical to `d3e9fdae` (its sha256 is pinned by a test), so every P4C
 * arm-C run stays reproducible and the pre-registration hash still verifies.
 * C-ext is a NEW constant, a NEW hash, and a NEW arm label — never an edit to
 * v1. §6.1's rule ("post-hoc promotion is forbidden; discovering the list was
 * wrong is a finding, not an edit") is the governing principle, applied to the
 * intervention rather than to the atom list.
 */
export function isSpikeArmCExt(): boolean {
  // eslint-disable-next-line no-restricted-syntax -- spike-only gate; see above.
  return process.env.SPIKE_ARM === "C_EXT";
}

/**
 * The three behavioural sites (records grammar in the structured-outputs slot,
 * system-block appendix, post-LLM projection seam) are SHARED by C and C-ext.
 * That sharing is deliberate and load-bearing: the ONLY difference between the
 * two arms is the appendix bytes, so any difference in result is attributable to
 * the instruction and to nothing else. A second copy of the projector would have
 * made C-ext a different arm in more ways than the one being tested.
 */
export function isSpikeArmCFamily(): boolean {
  return isSpikeArmC() || isSpikeArmCExt();
}

/**
 * FROZEN BYTES. Hashed into the evidence manifest before any measured run
 * (§8: "Pre-registration artefacts hashed BEFORE run 1: … arm C's schema +
 * appendix bytes"). Editing this string after run 1 invalidates every measured
 * run on the arm — the hash is what makes that detectable rather than silent.
 *
 * Written to describe the SHAPE and the honesty rule, and deliberately NOT to
 * coach the model toward more claims: §2's minimal-exclusions list and F2 (zero
 * false authorship) both cut against pressure to produce inferences. Trap 22's
 * lesson applies to the instruction as much as to a predicate — "CRITICAL: you
 * MUST" phrasing over-triggers on current models, so the appendix states the
 * contract plainly and states the one prohibition that carries a reason.
 */
export const SPIKE_C_SYSTEM_APPENDIX = `
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

/**
 * ⭐ THE C-EXT EXTENSION — a PURE APPEND to the frozen arm-C bytes.
 *
 * A test asserts `SPIKE_C_EXT_SYSTEM_APPENDIX.startsWith(SPIKE_C_SYSTEM_APPENDIX)`,
 * so the intervention delta is exactly the section below and is legible as such.
 *
 * ── WRITTEN AGAINST THE CONSUMER'S PREDICATE, NOT AGAINST THE SYMPTOM ──────
 * Trap 13d: the failure in hand was "no link starts at an option", but the
 * consumer's gate is not that. Derived at the bytes:
 *
 *   NO_EFFECT_PATH           `graph-validator.ts:822-839` — each option needs a
 *                            DIRECT forward target that is a `controllable`
 *                            factor AND can reach the goal. An option-origin
 *                            link that leads nowhere satisfies none of it.
 *   NO_PATH_TO_GOAL          `:620-633` — EVERY node except the decision must
 *                            reach the goal.
 *   UNREACHABLE_FROM_DECISION`:576-618` — every node except decision/goal must be
 *                            reachable from the decision (exogenous
 *                            observable/external factors are exempt only if they
 *                            reach the goal).
 *   category                 `:83-134` — `controllable` is INFERRED FROM
 *                            STRUCTURE (an incoming option edge), never declared.
 *                            So the instruction asks for the LINK, never for the
 *                            category — asking for the category would invite
 *                            `CATEGORY_MISMATCH` (`:787`) instead.
 *
 * So instructing option-origin links ALONE would have been the symptom's fix.
 * The section asks for the whole spine the gate actually checks: option → factor
 * → … → goal, and every emitted node on it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT SAY ──────────────────────────────────────
 * Nothing about provenance (the projector owns that mechanically, and a model
 * that could speak about provenance could commit false authorship — the property
 * C-K4 exists to protect). Nothing that pressures the model to invent facts:
 * "do not emit a factor you cannot connect" removes a claim, it does not add
 * one, and the next sentence forbids dropping anything the USER stated. No
 * `strength` request — a number the model was not asked for is invented
 * precision, and the repair machinery defaults it (`patchEdgeNumeric`
 * `edge-format.ts:79` treats NONE as V1_FLAT for new edges), so nothing
 * structural depends on it.
 */
export const SPIKE_C_EXT_APPENDIX_SECTION = `
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

/** FROZEN BYTES for arm C-ext. Hashed into the manifest before its run 1. */
export const SPIKE_C_EXT_SYSTEM_APPENDIX = `${SPIKE_C_SYSTEM_APPENDIX}\n${SPIKE_C_EXT_APPENDIX_SECTION}`.trimEnd();

/** The appendix the ACTIVE arm serves. Never a module-level const — see the switch note. */
export function activeSpikeCAppendix(): string {
  return isSpikeArmCExt() ? SPIKE_C_EXT_SYSTEM_APPENDIX : SPIKE_C_SYSTEM_APPENDIX;
}

/** sha256 of the appendix bytes, for the §8 manifest. */
export function spikeCAppendixHash(): string {
  return createHash("sha256").update(activeSpikeCAppendix(), "utf8").digest("hex");
}

/** sha256 of the serialized records schema, for the §8 manifest. */
export function spikeCSchemaHash(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildSpikeCRecordsSchema()), "utf8")
    .digest("hex");
}

/**
 * One object for the run record — everything §8 asks the arm to stamp.
 *
 * ⚠ THE ARM LABEL IS DERIVED FROM THE GATE, NOT HARDCODED. It read a literal
 * `"C"` at `d3e9fdae`; with two arms sharing these three sites, a hardcoded
 * label would have stamped every C-ext run as arm C and made the two arms
 * indistinguishable in the very record that is supposed to tell them apart.
 * The appendix hash is likewise taken from the ACTIVE appendix, so the run
 * record proves which bytes were served rather than asserting it.
 */
export function spikeCPreRegistration(): {
  arm: "C" | "C_EXT";
  appendix_sha256: string;
  appendix_bytes: number;
  schema_sha256: string;
  schema_bytes: number;
} {
  return {
    arm: isSpikeArmCExt() ? "C_EXT" : "C",
    appendix_sha256: spikeCAppendixHash(),
    appendix_bytes: Buffer.byteLength(activeSpikeCAppendix(), "utf8"),
    schema_sha256: spikeCSchemaHash(),
    schema_bytes: JSON.stringify(buildSpikeCRecordsSchema()).length,
  };
}
