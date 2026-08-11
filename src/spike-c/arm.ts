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

/** sha256 of the appendix bytes, for the §8 manifest. */
export function spikeCAppendixHash(): string {
  return createHash("sha256").update(SPIKE_C_SYSTEM_APPENDIX, "utf8").digest("hex");
}

/** sha256 of the serialized records schema, for the §8 manifest. */
export function spikeCSchemaHash(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildSpikeCRecordsSchema()), "utf8")
    .digest("hex");
}

/** One object for the run record — everything §8 asks the arm to stamp. */
export function spikeCPreRegistration(): {
  arm: "C";
  appendix_sha256: string;
  appendix_bytes: number;
  schema_sha256: string;
  schema_bytes: number;
} {
  return {
    arm: "C",
    appendix_sha256: spikeCAppendixHash(),
    appendix_bytes: Buffer.byteLength(SPIKE_C_SYSTEM_APPENDIX, "utf8"),
    schema_sha256: spikeCSchemaHash(),
    schema_bytes: JSON.stringify(buildSpikeCRecordsSchema()).length,
  };
}
