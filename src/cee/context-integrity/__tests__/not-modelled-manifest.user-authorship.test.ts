/**
 * ROADMAP 2.1024 — THE LEDGER MUST NEVER CLAIM A VALUE THE USER AUTHORED.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * Wire-witnessed 2026-08-25 on the quartet UI `ebe7ae20` · CEE `5f2e3fd` ·
 * PLoT `3a3bee5` · ISL `28fe0c9`. The brief-audit reply said:
 *
 *   "Figures I supplied myself, which you did not state: … Cash runway
 *    consumed … Those are my estimates, not yours, and they are worth
 *    checking."
 *
 * while canonical state for that factor was
 * `{ value: 0.35, source: "user_override", raw_value: 0.35 }` — the user had
 * set it themselves, minutes earlier, through the Model-tab Confirm chip.
 *
 * `deriveInferredFactors` decided authorship ONLY against the brief text, so a
 * value the user authored on the CANVAS was invisible to it and got claimed as
 * ours — on the one surface whose entire job is to say who authored what.
 *
 * ── WHY IT SURVIVED, MEASURED ──────────────────────────────────────────────
 * The `context-integrity` corpus contains NO user-authored provenance stamp
 * anywhere: `user_override|user_confirmed|user_calibration|panel_elicited`
 * matched 0 files, while the contrast control `observed_state` matched 7. The
 * fixtures are cold-read captures taken BEFORE any user edit — a STATE-CLASS
 * exclusion (fresh-draft only, never post-edit). A corpus with no member of a
 * class cannot certify the code over that class (CLAUDE.md trap 22).
 *
 * This file is that class.
 *
 * ── HOW EVERY ARM AVOIDS VACUITY ───────────────────────────────────────────
 * Each case is a PAIR on the SAME node with the SAME numeric payload, differing
 * ONLY in the stamp:
 *
 *   · a `cee_inference` baseline, asserted CLAIMED — this pins the precondition
 *     (CLAUDE.md trap 13b), proving the node is one the module would otherwise
 *     claim and that the numeric payload did not silently trip the brief-match
 *     or magnitude-coincidence suppressors;
 *   · the subject stamp, asserted against its expected verdict.
 *
 * Without the baseline half, a fixture that quietly stopped being claimed would
 * make every suppression assertion pass by testing nothing.
 *
 * Assertions bind by NODE ID, never by a value predicate another node could
 * satisfy (CLAUDE.md trap 19).
 *
 * ── ⚠⚠ WHAT THIS SUITE DOES NOT ESTABLISH — READ BEFORE TRUSTING IT ────────
 *
 * 1. KNOWN GAP: `user_override` IS NOT A SINGLE-MEANING RECEIPT. One literal
 *    serves both a genuine Confirm-chip write AND a model-authored
 *    `update_node` op — `stampUserEditProvenance` deliberately overwrites an
 *    LLM's `cee_inference` with `user_override`, on a premise
 *    `mutation-consent.ts` contradicts in writing ("`edit_graph` is genuinely
 *    UNCOVERED by withheld-consent enforcement"; gap ROADMAP 2.628a). For that
 *    class the suppressor can drop a MODEL-AUTHORED number from the
 *    disclosure. Accepted because it lands in the OMISSION direction, which the
 *    composed answer discloses unconditionally — never a false claim about the
 *    user. Full argument at `USER_WRITE_RECEIPT` in the module.
 *
 *    ⭐ RE-SURFACE TRIGGER (so this gap cannot acquire a lapsed licence):
 *      · ROADMAP 2.628a closes — the premise becomes true, gap dissolves;
 *      · `stampUserEditProvenance` gains a distinct stamp for model-authored
 *        ops (grep `USER_EDIT_SOURCE` in `canonicalise-value-ops.ts`);
 *      · the `user_override` writer manifest becomes a DERIVATION over all
 *        seven receipt literals rather than a string scan for one.
 *
 * 2. THE STAMPS HERE ARE SYNTHETIC INJECTIONS INTO COLD-READ CAPTURES, NOT
 *    REAL POST-EDIT CAPTURES. A fixture you wrote yourself is not evidence
 *    about the wire (CLAUDE.md trap 16-inverse). These arms prove the
 *    CLASSIFIER behaves correctly over the stamp vocabulary; they do NOT prove
 *    the deployed product emits these stamps in these places.
 *
 * 3. FOUR LITERALS HAVE NO CEE WRITER AND ARE UNVERIFIED HERE.
 *    `user_confirmed` / `user` / `user_edited` / `user_calibration` are
 *    believed to correspond to real user actions on the strength of a
 *    CROSS-REPO HAND-MAINTAINED COMMENT (`schemas/cee-v3.ts`, citing the UI's
 *    `isReviewedByUser.ts`) — a hand-maintained mirror (trap 12), with zero CEE
 *    write sites. Nobody on this lane or its review could verify it. Treated as
 *    receipts because the direction of error is omission, not a false claim —
 *    but the claim is UNVERIFIED and is stated as such rather than assumed.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { OBSERVED_STATE_SOURCE_LITERALS } from "@talchain/schemas";

import { deriveNotModelledManifest } from "../not-modelled-manifest.js";
import { classifyValueSource } from "../../graph-readiness/obligation-provenance.js";

const HERE = dirname(fileURLToPath(import.meta.url));

interface ColdRead {
  readonly brief_text: string;
  readonly graph: Record<string, unknown>;
}

const B1 = JSON.parse(
  readFileSync(join(HERE, "fixtures", "b1-growth.cold-read.json"), "utf8"),
) as ColdRead;

/**
 * The node every pair is built on: a factor the module claims as its own
 * invention on the UNMODIFIED capture. Chosen by derivation, not by hand, so
 * the file cannot silently bind to a node that stopped qualifying.
 */
const SUBJECT_NODE_ID = (() => {
  const base = deriveNotModelledManifest(B1.brief_text, B1.graph);
  const first = base.inferred_factors.items[0];
  if (first === undefined) {
    throw new Error("b1 capture claims no inferred factors — the fixture changed");
  }
  return first.node_id;
})();

/**
 * A value the user did not write in the brief. `0.35` is the wire-witnessed
 * value from the trace; asserted absent from the brief so the numeric payload
 * cannot itself be what suppresses the claim.
 */
const CANVAS_VALUE = 0.35;

function claimedIdsWithStamp(source: string | null): readonly string[] {
  const graph = JSON.parse(JSON.stringify(B1.graph)) as Record<string, unknown>;
  const nodes = graph.nodes as Array<Record<string, unknown>>;
  const node = nodes.find((n) => n.id === SUBJECT_NODE_ID);
  if (node === undefined) throw new Error(`subject node ${SUBJECT_NODE_ID} vanished`);
  const existing = (node.observed_state ?? {}) as Record<string, unknown>;
  node.observed_state = {
    ...existing,
    value: CANVAS_VALUE,
    raw_value: CANVAS_VALUE,
    ...(source === null ? {} : { source }),
  };
  if (source === null) delete (node.observed_state as Record<string, unknown>).source;
  return deriveNotModelledManifest(B1.brief_text, graph).inferred_factors.items.map(
    (i) => i.node_id,
  );
}

/** The precondition every arm depends on, asserted inside every arm. */
function expectBaselineIsClaimed(): void {
  expect(
    claimedIdsWithStamp("cee_inference"),
    "PRECONDITION: with a model stamp this node must be claimed as ours — " +
      "if it is not, every suppression assertion below is vacuous",
  ).toContain(SUBJECT_NODE_ID);
}

/**
 * The stamps written by a DETERMINISTIC USER-WRITE PATH, server-side.
 * Contract provenance: `src/schemas/cee-v3.ts:59-70` names these the
 * "USER-OWNED members", against the "PRODUCER members" below.
 */
const USER_WRITE_RECEIPTS = [
  "user_override",
  "user_confirmed",
  "user",
  "user_edited",
  "user_calibration",
  "user_assumption",
  "panel_elicited",
] as const;

/**
 * The stamps written by CEE's own extraction/inference writers — i.e. the
 * MODEL's labels about itself.
 */
const PRODUCER_WRITTEN = [
  "brief_extraction",
  "explicit",
  "cee_inference",
  "inferred",
  "cee_repair",
] as const;

describe("the ledger never claims a value the user authored", () => {
  it("the brief does not contain the canvas value (else the arms below are vacuous)", () => {
    expect(B1.brief_text).not.toContain(String(CANVAS_VALUE));
  });

  it.each(USER_WRITE_RECEIPTS)(
    "a value stamped `%s` is NOT claimed as our invention",
    (source) => {
      expectBaselineIsClaimed();
      expect(claimedIdsWithStamp(source)).not.toContain(SUBJECT_NODE_ID);
    },
  );

  /**
   * ⭐⭐ THE ANTI-DOWNGRADE ARM — DO NOT DELETE AS REDUNDANT.
   *
   * This is what stops the fix becoming a downgrade wearing a fix's clothes.
   *
   * `brief_extraction` and `explicit` CLASSIFY AS `user_stated` on the
   * authorship axis, so a fix that suppressed on authorship alone would drop
   * them from the list. They are written by the MODEL, and the 2026-08-08 trace
   * measured them LYING exactly where it matters (`fac_nrr` carried
   * `extractionType:"explicit", provenance:"from_brief"` while holding zero
   * brief information). The set they would suppress is precisely "the label
   * says from-brief but the number is not in the brief" — i.e. the measured
   * lie. Suppressing there deletes TRUE entries from the disclosure.
   *
   * The list's value is that it is SPECIFIC. These arms are the guard on that.
   */
  it.each(PRODUCER_WRITTEN)(
    "ANTI-DOWNGRADE: a value stamped `%s` is STILL claimed — a producer-written label never suppresses",
    (source) => {
      expectBaselineIsClaimed();
      expect(claimedIdsWithStamp(source)).toContain(SUBJECT_NODE_ID);
    },
  );

  describe("absence is never promoted (the contract's own instruction)", () => {
    it("an unstamped value is still claimed — we do not read absence as authorship", () => {
      expectBaselineIsClaimed();
      expect(claimedIdsWithStamp(null)).toContain(SUBJECT_NODE_ID);
    });

    it("an unrecognised stamp is still claimed — never a guess", () => {
      expectBaselineIsClaimed();
      expect(claimedIdsWithStamp("something_new_from_a_future_producer")).toContain(
        SUBJECT_NODE_ID,
      );
    });
  });

  /**
   * ⚠ TRAP 21 — TWO AUTHORITIES, TWO QUESTIONS, ONE DELIBERATE DIVERGENCE.
   *
   * `obligation-provenance.classifyValueSource` answers "WHO AUTHORED this?".
   * This module answers "IS THIS STAMP A USER-WRITE RECEIPT?" — i.e. is the
   * label itself trustworthy evidence of user authorship. They are different
   * questions and they differ on exactly two literals.
   *
   * Pinned in BOTH directions, so neither silently absorbs the other.
   */
  describe("agreement with the authorship authority, divergence pinned", () => {
    it("every user-write receipt is also `user_stated` upstream", () => {
      for (const source of USER_WRITE_RECEIPTS) {
        expect(classifyValueSource(source), `${source} upstream`).toBe("user_stated");
      }
    });

    it("the divergence is exactly {brief_extraction, explicit}: `user_stated` upstream, NOT a receipt here", () => {
      const divergent = OBSERVED_STATE_SOURCE_LITERALS.filter(
        (lit) =>
          classifyValueSource(lit) === "user_stated" &&
          !(USER_WRITE_RECEIPTS as readonly string[]).includes(lit),
      );
      expect([...divergent].sort()).toEqual(["brief_extraction", "explicit"]);
    });

    it("the two sets partition the whole twelve-literal vocabulary", () => {
      const all = [...USER_WRITE_RECEIPTS, ...PRODUCER_WRITTEN].sort();
      expect(all).toEqual([...OBSERVED_STATE_SOURCE_LITERALS].sort());
    });
  });
});
