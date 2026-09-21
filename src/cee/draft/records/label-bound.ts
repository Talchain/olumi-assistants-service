/**
 * ⭐⭐ THE NODE LABEL'S LENGTH BOUND — DERIVED FROM THE PUBLISHED CONTRACT,
 * APPLIED AT MINT TIME, BEFORE THE DURABLE COMMIT.
 *
 * ── THE WITNESSED DEFECT (CEE #1178, staging 28 Aug 2026, build `674a4f2a`) ──
 * An ordinary open strategic brief drafted a 16-node graph that rendered on the
 * canvas, and the user's ENTIRE assistant reply was replaced by
 *   "The server produced a response that failed validation."
 * The failing field was `model_version_receipt.graph.nodes.0.label` — 212
 * characters against a `max(200)` bound. #1178 fixed the SYMPTOM (a
 * receipt-confined validation failure now drops the receipt and re-parses
 * instead of destroying the reply). This module closes the CAUSE.
 *
 * ── THE CAUSE: TWO SCHEMAS, ONE NAME (CLAUDE.md trap 21/12) ────────────────
 *   producer gate  `mutation-receipt.ts:68` `GraphVerbatim` superRefines against
 *                  `GraphV3` from CEE-LOCAL `schemas/cee-v3.ts`, whose
 *                  `NodeV3.label` is a bare `z.string()` (`cee-v3.ts:162`)
 *                  → UNBOUNDED, 212 chars ACCEPTED
 *   egress gate    the PUBLISHED `NodeV3Schema.label = z.string().min(1).max(200)`
 *                  (`@talchain/schemas` 0.50.0 `dist/graph.js:259`)
 *                  → 212 chars REJECTED
 * CEE mints a receipt its own validator accepts and its own boundary rejects,
 * milliseconds apart. `mutation-receipt.ts`'s own docblock states the rule that
 * breaks: *"The ADMISSIBILITY question must be the same one the version carrier
 * asked."* They closed that gap for `strength.std` and left it open for `label`.
 *
 * ── ⭐ THE BOUND IS DERIVED, NOT RESTATED (trap 12) ─────────────────────────
 * A hand-copied `200` here would be the estate's dominant defect: a mirror a
 * human must remember to sync, whose drift always reads as green. So the number
 * is read OUT OF THE PUBLISHED SCHEMA at module load, and the read FAILS LOUD if
 * the check is ever absent — a pin that stops declaring `max` on `label` is a
 * contract change this module must not silently survive.
 *
 * `z.string().max()` counts UTF-16 code units (`data.length`), so measuring and
 * slicing with `.length` here is the SAME measurement the validator makes. That
 * is not a coincidence to rely on quietly: it is why `boundNodeLabel`'s output
 * cannot be off by one against the gate it exists to satisfy.
 *
 * ── WHY TRUNCATE RATHER THAN REFUSE, AND WHY NOTHING IS LOST ───────────────
 * Refusing an over-long label would block a legitimate draft over a display
 * string. Truncating is safe here — and ONLY here — because the verbatim is
 * CONSERVED beside it: `NodeV3.source_quote` (`schemas/cee-v3.ts:276`) exists
 * precisely to carry the user's exact words to the wire, is populated for every
 * stated node (`projector.ts:2176`), is read at `transforms/schema-v3.ts:1182`,
 * and is deliberately UNBOUNDED. This is the module's own ratified ruling,
 * quality bar §8 A2 (`objective-label.ts` header):
 *
 *   "conservation is asserted across `label ∪ source_quote ∪ goal_threshold ∪
 *    goal_constraints[]`, never within the label alone. Because A1 keeps the
 *    verbatim, a shorter label loses nothing from the record."
 *
 * ⚠ THE SCOPE THAT FOLLOWS FROM THAT ARGUMENT, STATED SO IT CANNOT BE WIDENED
 * BY ACCIDENT. This bound belongs to the RECORDS DRAFT PATH, where a verbatim
 * sidecar exists by construction. It must NOT be lifted to a general
 * graph-normalisation pass: a UI/`edit_graph`-authored label has no
 * `source_quote`, so truncating one would DESTROY user text rather than shorten
 * a display string. That population keeps #1178's graceful degrade.
 *
 * ⚠ AND THE FIELD THIS MODULE MUST NEVER BE EXTENDED TO BOUND: `source_quote`
 * itself. Its unboundedness is load-bearing, not an oversight — `cee-v3.ts:262-269`
 * is explicit that bounding it "would delete [the user's words] from the
 * product, which is strictly worse than the defect it fixes". The whole
 * conservation argument above rests on it staying unbounded.
 */
import { NodeV3Schema } from "@talchain/schemas";

/**
 * Read one `ZodString` check value off a schema, or throw.
 *
 * FAIL-LOUD BY DESIGN. Returning a default would reinstate the mirror this
 * derivation exists to abolish: a pin that stops declaring the check would
 * silently restore the unbounded behaviour that deleted a user's reply, and
 * every test here would keep passing.
 *
 * ⭐ EXPORTED SO THE DERIVATION ITSELF CAN BE FALSIFIED (trap 12d). A guard
 * derived from a list proves the copies AGREE; it can never prove the list is
 * RIGHT. Asserting only that `NODE_LABEL_MAX_CHARS === 200` would be satisfied
 * just as happily by a hardcoded `200` — the exact mirror this module exists to
 * remove. Pointing this reader at a SYNTHETIC schema with a different bound is
 * what discriminates a real derivation from a constant that agrees with the
 * contract today.
 */
export function readStringBound(
  schema: unknown,
  kind: "min" | "max",
  what = "a string schema",
): number {
  const def = (schema as { _def?: { checks?: readonly unknown[] } })._def;
  const checks = def?.checks ?? [];
  for (const check of checks) {
    const c = check as { kind?: string; value?: unknown };
    if (c.kind === kind && typeof c.value === "number") return c.value;
  }
  throw new Error(
    `label-bound: ${what} declares no '${kind}' check. The bound this module ` +
      "enforces is DERIVED from the contract and cannot be guessed; a pin that " +
      "drops the check is a contract change that must be read, not defaulted.",
  );
}

const LABEL = NodeV3Schema.shape.label;

/** The published contract's own bound on `NodeV3.label`. Derived, never restated. */
export const NODE_LABEL_MAX_CHARS = readStringBound(LABEL, "max", "the published NodeV3Schema.label");

/** The published contract's own floor on `NodeV3.label`. */
export const NODE_LABEL_MIN_CHARS = readStringBound(LABEL, "min", "the published NodeV3Schema.label");

/**
 * U+2026, one UTF-16 code unit — so the arithmetic below is exact against the
 * validator's own `.length` measurement. Three ASCII dots would cost three.
 */
const ELLIPSIS = "…";

/** Characters left dangling by a cut that should not end the visible label. */
const TRAILING_NOISE = /[\s,;:.–—-]+$/u;

/** A lone high surrogate at the cut point — never ship half a code point. */
const DANGLING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

/**
 * Return `label` bounded to the published contract's limit.
 *
 * ⭐ IDENTITY WHEN IT FITS, AND THAT IS THE OVER-CORRECTION CONTROL. A label
 * within the bound is returned BY REFERENCE — not a copy, not a normalised
 * form. That is what makes "this change cannot touch an ordinary label" a
 * property of the code rather than a claim about it, and it is asserted
 * referentially in the suite: without it you cannot tell a fix from a
 * regression that quietly mangles every label in the product.
 */
export function boundNodeLabel(label: string): string {
  if (label.length <= NODE_LABEL_MAX_CHARS) return label;

  const room = NODE_LABEL_MAX_CHARS - ELLIPSIS.length;
  let head = label.slice(0, room);
  if (DANGLING_HIGH_SURROGATE.test(head)) head = head.slice(0, -1);

  // Prefer a word boundary, but never pay more than a quarter of the label for
  // one — a long unbroken token (a URL, a hash) would otherwise cut to nothing.
  const lastSpace = head.lastIndexOf(" ");
  if (lastSpace >= Math.floor(room * 0.75)) head = head.slice(0, lastSpace);

  head = head.replace(TRAILING_NOISE, "");

  // The contract's floor is as real as its ceiling: an empty label is a
  // rejection too. Nothing observed can reach this, which is exactly why it is
  // here rather than assumed away.
  if (head.length < NODE_LABEL_MIN_CHARS) head = label.slice(0, NODE_LABEL_MIN_CHARS);

  return head + ELLIPSIS;
}
