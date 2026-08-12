/**
 * ⭐ THE STREAMING PROGRESS PROBE MUST BE DERIVED FROM THE GRAMMAR, NOT MIRRORED.
 *
 * The runaway detector needs a structural "a claim has been decoded" probe over
 * raw stream text. Written as its own string literal it would be a
 * hand-maintained mirror of this schema (trap 12): rename the field, the probe
 * silently stops matching, the detector silently stops seeing records progress,
 * and every slow records draft is aborted as a runaway with nothing red.
 *
 * ⚠ AND DERIVATION ALONE IS NOT ENOUGH (trap 12d). A guard derived from a list
 * proves the copies AGREE; it can never prove the list is RIGHT. So this file
 * carries both kinds:
 *   · a DERIVED assertion — the probe's field is present in the schema's own
 *     `claims.items.required`, read out of the built object;
 *   · a hand-written CORPUS — every claim kind matches, and the shapes that must
 *     NOT match (a stated_item, a bare `kind` field) are enumerated by hand,
 *     because a derived check cannot notice a probe that matches too much.
 *
 * The grammar hash pin is the third leg: this refactor replaced a literal key
 * with a computed one, and a computed key that serialises differently would
 * silently change the compiled grammar the provider receives.
 */
import { describe, expect, it } from "vitest";

import {
  buildDraftRecordsSchema,
  draftRecordsGrammarHash,
  DRAFT_RECORD_CLAIM_DISCRIMINATOR,
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORDS_CLAIM_PROGRESS_RE,
} from "../grammar.js";

/**
 * The grammar hash recorded in `PRE-REGISTRATION-V3.md` and emitted on every
 * draft as `grammar_sha256`. Pinned to the HISTORIC value (trap 12b: a control
 * pinned to "whatever the code currently produces" is a tautology).
 */
const HISTORIC_V3_GRAMMAR_SHA256 =
  "e2d6797fb4fcb44698f336de135f0209003900fd1af310594e27e2d05e73b669";

/**
 * ⭐ v4, pre-registered 2026-08-12. The grammar MOVED, deliberately and for the
 * first time: `from_ref`/`to_ref` (strings whose first character selected the
 * namespace) became four typed integer fields, because the namespace confusion
 * they permitted destroyed a whole acceptance block and a schema cannot
 * constrain a string's shape here (`pattern` is a forbidden keyword).
 *
 * ⚠ THE HISTORIC VALUE STAYS AND IS ASSERTED DISTINCT. Every draft up to and
 * including the 2026-08-12 blocks emitted `grammar_sha256:e2d6797f…`; a reader
 * of those logs must be able to tell which grammar produced them, and re-pointing
 * the literal would silently merge two grammars into one evidence base.
 */
const PINNED_GRAMMAR_SHA256 =
  "e7505d3feaea15fc437acbb36066784d186c744e524cb07de5606fdf2a050bbf";

describe("the claim-progress probe is derived from the grammar", () => {
  it("hashes to the PRE-REGISTERED v4 grammar the provider receives", () => {
    expect(draftRecordsGrammarHash()).toBe(PINNED_GRAMMAR_SHA256);
  });

  it("is DISTINCT from the historic v3 grammar, so v3's runs stay attributable", () => {
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V3_GRAMMAR_SHA256);
  });

  it("DERIVED — the probe's field is a REQUIRED key of the schema's own claim object", () => {
    const schema = buildDraftRecordsSchema() as {
      properties: { claims: { items: { required: string[]; properties: Record<string, unknown> } } };
    };
    const required = schema.properties.claims.items.required;
    expect(required).toContain(DRAFT_RECORD_CLAIM_DISCRIMINATOR);
    expect(Object.keys(schema.properties.claims.items.properties)).toContain(
      DRAFT_RECORD_CLAIM_DISCRIMINATOR,
    );
    // The probe is BUILT from that name — asserted rather than assumed, so a
    // probe hand-edited to a different field fails here.
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.source).toContain(DRAFT_RECORD_CLAIM_DISCRIMINATOR);
  });

  it("CORPUS — matches every claim kind, serialised as the wire serialises them", () => {
    for (const kind of DRAFT_RECORD_CLAIM_KINDS) {
      const wire = JSON.stringify({ claim_kind: kind, label: "x" });
      expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test(wire), `claim_kind=${kind}`).toBe(true);
    }
    // Pretty-printed too — whitespace before the colon must not defeat it.
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test('{ "claim_kind" : "factor" }')).toBe(true);
  });

  it("CONTRAST — does NOT match the shapes that are not a decoded claim", () => {
    // A stated_item is the whole first half of a record set. If the probe
    // matched one, the detector would lift on the very first item and the
    // runaway guard would be effectively off for every records draft.
    expect(
      DRAFT_RECORDS_CLAIM_PROGRESS_RE.test(
        JSON.stringify({ kind: "goal", source_quote: "get to £20m ARR", value: 20_000_000 }),
      ),
    ).toBe(false);
    // The bare envelope, before any claim has been decoded.
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test('{"stated_items":[{"kind":"option"')).toBe(false);
    // A claim kind appearing as a VALUE rather than as the key.
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test('{"label":"a causal_link between them"}')).toBe(false);
  });

  it("is NOT global — a global flag would carry lastIndex between calls", () => {
    // The same failure the edges probe's comment warns about: with `g`, a second
    // `.test()` on the same string resumes from `lastIndex` and returns false,
    // so the detector would see progress once and then stop seeing it.
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.global).toBe(false);
    const wire = JSON.stringify({ claim_kind: "factor", label: "x" });
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test(wire)).toBe(true);
    expect(DRAFT_RECORDS_CLAIM_PROGRESS_RE.test(wire)).toBe(true);
  });
});
