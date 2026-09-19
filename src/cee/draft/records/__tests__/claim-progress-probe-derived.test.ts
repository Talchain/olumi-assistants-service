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
const HISTORIC_V4_GRAMMAR_SHA256 =
  "e7505d3feaea15fc437acbb36066784d186c744e524cb07de5606fdf2a050bbf";

/**
 * ⭐ v5, 2026-08-14. The grammar moved for the SECOND time, and for a reason the
 * record must carry: `DRAFT_RECORD_CLAIM_KINDS` gained `risk` and `outcome`.
 *
 * Their absence was a live outage, not a tidiness matter — 5/5 draws on the
 * pinned brief returned `riskCount: 0` and an outcome layer that was 100 %
 * machine scaffolding (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/
 * analysis-outage-2026-08-14/`). This list IS the structured-output enum, so a
 * kind missing from it is a thought the model cannot express.
 *
 * ⚠ v4's VALUE STAYS AND IS ASSERTED DISTINCT, exactly as v3's is. Every draft
 * between 2026-08-12 and 2026-08-14 emitted `grammar_sha256:e7505d3f…`, and a
 * reader of those logs must be able to tell which grammar produced them.
 */
const HISTORIC_V5_GRAMMAR_SHA256 =
  "f5fbf0194c975db06cacd1d1a370129caf2bf65c1ccc2134de10f984d2ffe1f7";

/**
 * ⭐ v6 — 2026-08-14, the `is_baseline` widening. Two optional booleans, one on
 * `stated_items[]` and one on `claims[]` (grammar design note 5), closing a field
 * the served prompt has mandated since v195 and the records path could not emit.
 *
 * COST against the budget that actually binds: +66 serialised bytes (1198 →
 * 1264), NO new object schema and NO union, so the compiled-grammar-size
 * boundary — the UNPUBLISHED constraint that silently degrades a draft to
 * prompt-only JSON on a 400 — is untouched.
 *
 * ⚠ v5's VALUE STAYS AND IS ASSERTED DISTINCT, exactly as v3's and v4's are.
 */
const HISTORIC_V6_GRAMMAR_SHA256 =
  "e6c508e0285a95c6d5dd84bfacc91921871d9c3bb7b7d3e55f8514ba6d8010a7";

/**
 * ⭐ v7 — 2026-08-31, the `cause` stated kind (#1287). ONE new value on an enum
 * that already existed.
 *
 * COST against the budget that actually binds: +8 serialised bytes (1264 →
 * 1272, against 3400), NO new object schema, NO new union and NO new optional
 * parameter — the lowest-risk change class available at this boundary, because
 * the compiled grammar gains one alternative in a string enum it already
 * compiles.
 *
 * ⚠ THE STATIC BUDGET IS NOT EVIDENCE ABOUT THE COMPILED BOUNDARY, which is
 * unpublished and was established empirically. What can be asserted here is the
 * serialised size and the SHAPE of the change; a live compiled-grammar probe
 * with a 400-producing negative control needs provider credentials and is owed
 * separately. See the PR body.
 *
 * ⚠ v6's VALUE STAYS AND IS ASSERTED DISTINCT, exactly as v3/v4/v5's are: every
 * draft between 2026-08-14 and 2026-08-31 emitted `grammar_sha256:e6c508e0…`,
 * #1287's capture among them, and a reader of those logs must be able to tell
 * which grammar produced them.
 */
const HISTORIC_V7_GRAMMAR_SHA256 =
  "87bd3212076c64773e5f62c4b3e669cc5d47be2038b3a690636f67a6bb109864";

/**
 * ⭐ v8 — the `applies_to_stated` / `applies_to_claim` widening on
 * `stated_items[]`. TWO optional integers, the same shape as the widening v6
 * made, closing the field a stated `constraint` never had: WHAT THE LIMIT
 * APPLIES TO.
 *
 * ⚠ WHY IT WAS WORTH A GRAMMAR CHANGE AT ALL, since this boundary is the one
 * place in the draft path where a mistake degrades every draft silently. The
 * binder that replaced this field was a STRING-CONTAINMENT matcher, and it
 * dropped a user's stated limit whenever the drafting model improved on their
 * wording — "keeping monthly churn under 4%" against a node the model itself
 * labelled "Subscriber Churn Rate". Three replacement matchers were built and
 * adversarially tested and every one wrong-binds somewhere. The model already
 * knows the answer; it had nowhere to write it down.
 *
 * COST against the budget that actually binds: +77 serialised bytes (1272 →
 * 1349, against 3400) and +2 optional parameters (16 → 18, against 24). NO new
 * object schema (3, unchanged) and NO union (0, unchanged), so the compiled-
 * grammar-size boundary — the UNPUBLISHED constraint that silently degrades a
 * draft to prompt-only JSON on a 400 — gains no structural complexity. All four
 * figures MEASURED at this tip via `measureDraftRecordsSchemaBudget`, not
 * estimated.
 *
 * ⚠ THE STATIC BUDGET IS NOT EVIDENCE ABOUT THE COMPILED BOUNDARY, which is
 * unpublished and was established empirically. What is asserted here is the
 * serialised size and the SHAPE of the change; a live compiled-grammar probe
 * with a 400-producing negative control needs provider credentials and is owed
 * separately. See the PR body — this is stated as an OWED measurement, not as a
 * cleared one.
 *
 * ⚠ v7's VALUE STAYS AND IS ASSERTED DISTINCT, exactly as v3-v6's are: every
 * draft between 2026-08-31 and this change emitted `grammar_sha256:87bd3212…`,
 * INCLUDING the draws in which the dropped-limit defect was witnessed, and a
 * reader of those logs must be able to tell which grammar produced them.
 */
const HISTORIC_V8_GRAMMAR_SHA256 =
  "3da0c71e7ea918fb652965fd64cf185072ec4a7aad70698386b59262145b868a";

/**
 * ⭐ v9 — `unit` on `claims[]`. ONE optional string, closing the field a
 * MODEL-AUTHORED quantity never had: WHAT ITS OWN NUMBER IS MEASURED IN.
 *
 * ⚠ WHY IT WAS WORTH A GRAMMAR CHANGE, which this boundary sets a high bar for.
 * The unit-family safety gate reads `nodeDeclaredUnit(target)`, which reads
 * `data.unit`. Every unit write site in the projector read `item.unit` — from a
 * STATED item — so for anything the model authored `targetFamily` was
 * `undefined` BY CONTRACT, and the gate's conjunction
 *   `limitFamily !== "unknown" && targetFamily !== "unknown" && …`
 * could never hold. **The gate was one-sided not by oversight but because the
 * other side could not exist.** Measured the same night: across the six banked
 * 15 Sep record sets, 21 of 22 factor claims carry no value field at all, and
 * across 25 September bundles every one of the six stated limits fails to reach
 * a measurable target — including one bound to a factor, the RIGHT kind, which
 * is what refutes "filter the kinds" as the fix.
 *
 * ⭐ AND IT IS WHY FOUR MAGNITUDE-BASED SCALE DETECTORS WERE REFUTED in a row
 * (#1543): each was trying to reconstruct from `0.85` beside `80000` a fact the
 * producer was never able to state. The model already knows the unit; it had
 * nowhere to write it down — the same sentence v8 was registered under, one
 * field along.
 *
 * ⛔ DECLARING IS NOT THE THING ALREADY REFUTED. An earlier attempt BORROWED a
 * unit from a figure cited in `basis` whenever `claim.value` equalled it, and
 * review killed it with two reproductions — a £49 PRICE read onto a subscriber
 * COUNT, and a PROPOSED 59 read as a CURRENT 59. Inferring a unit is a
 * fabrication; the model stating one is a declaration. Nothing is borrowed and
 * no `extractionType` is earned.
 *
 * COST against the budget that actually binds, MEASURED at this tip via
 * `measureDraftRecordsSchemaBudget`, not estimated: +25 serialised bytes
 * (1349 → 1374, against 3400) and +1 optional parameter (18 → 19, against 24).
 * NO new object schema (3, unchanged) and NO union (0, unchanged).
 *
 * ⚠⚠ NOTE THE HEADROOM, because it constrains what comes next: 19 of 24
 * optional parameters are now used. `role` and `representation` — the other two
 * quantity-semantics fields a claim cannot express — would take it to 21. The
 * remaining budget is real and small, so the next field is a decision, not a
 * habit.
 *
 * ⚠ THE STATIC BUDGET IS NOT EVIDENCE ABOUT THE COMPILED BOUNDARY, which is
 * unpublished and was established empirically. Asserted here: the serialised
 * size and the SHAPE. A live compiled-grammar probe with a 400-producing
 * negative control needs provider credentials and is OWED, not cleared.
 *
 * ⚠ v8's VALUE STAYS AND IS ASSERTED DISTINCT: every draft between the v8
 * change and this one emitted `grammar_sha256:3da0c71e…`, including every draw
 * in which the mixed-scale defect was witnessed, and a reader of those logs
 * must be able to tell which grammar produced them.
 */
const HISTORIC_V9_GRAMMAR_SHA256 =
  "c713248012a8e7a3f547ad83c687b5269004596eb37ec7b8fb1aab5e0f2a014d";

/**
 * ⭐ v10 — `value_scale` on `claims[]`. ONE optional enum, closing the field a
 * model-authored quantity never had: WHAT ITS OWN NUMBER MEANS.
 *
 * v9 gave the model somewhere to write what a number is MEASURED IN. It still
 * had nowhere to write what the number IS. Under `unit: "%"`, `4` and `0.04` are
 * both well-formed and mean the same thing, and v9 could not tell them apart.
 *
 * ⚠ WHY IT WAS WORTH A GRAMMAR CHANGE, which this boundary sets a high bar for.
 * Measured on a live v202 draw (17 Sep, pricing brief, banked at
 * `output/olumi-evidence-20260917-inert-quantities/prompt-v202/`): factor
 * `ab78e513` "Monthly Churn Rate", brief *"churn is currently 4% a month"* —
 *
 *     scale_frame = 100
 *       baseline      raw 0.04  -> level 0.0004
 *       intervention  raw 5.5   -> level 0.055
 *
 * Baseline and intervention are levels on ONE axis by construction. A real
 * x1.375 move is carried as x137.5 and the baseline is understated 100x.
 * `deriveFactorScaleFrame` must pick ONE frame per factor and pins it from
 * `Math.max(...)`, so a sub-1 member inherits the frame the >1 member earned.
 * Pinned in `percent-frame-straddles-one.test.ts` (CEE #1561).
 *
 * ⭐ AND IT IS WHY THE FRAME CANNOT BE FIXED WITH A BETTER MAGNITUDE TEST — the
 * repair lane had already written the reason down, about this exact harm
 * (`repair/unreachable-factors.ts:337`): *"THE TWO HARMS CANNOT SHARE ONE WINDOW
 * — a single `value > 1` test tries to serve both and serves the wrong one on
 * non-compliant input."* `unitPinnedScaleFrame`'s `magnitude > 1` IS that test.
 * A window cannot be widened into evidence. Same sentence v8 and v9 were
 * registered under, one field along: the model knows; it had nowhere to say so.
 *
 * ⛔ AND THE STAMP IS FROM THE DECLARATION, NEVER FROM THE MAGNITUDES, which was
 * my first instinct and is worse than absence. `display-value.ts:541` states the
 * condition from the consumer side: *"if any producer ever stamps
 * `declared_scale` WITHOUT deriving the prior from the same value, this read
 * must be re-verified before it is trusted."* A sniff is visibly a guess; a
 * declaration is trusted. Laundering one into the other is the worst available
 * move, and the contract says absence is safe: *"A consumer MUST NOT treat
 * absence as `unit_interval`."*
 *
 * ⚠ NOT A DARK FIELD, and that was checked rather than assumed. `projector.ts`
 * stamps `node.declared_scale` from `claim.value_scale`, and
 * `transforms/schema-v3.ts:660` already passes `anyNode.declared_scale` into
 * `synthesiseRangeDisplayValue` — a LIVE reader, on the `prior` display path,
 * which 2 of 9 drafted factors took across the two banked draws. The
 * `observed_state` path (7 of 9) has NO reader for it yet; that consumer is a
 * separate change and is NOT claimed here.
 *
 * COST against the budget that actually binds, MEASURED at this tip via
 * `measureDraftRecordsSchemaBudget`, not estimated: +77 serialised bytes
 * (1374 -> 1451, against 3400) and +1 optional parameter (19 -> 20, against 24).
 * NO new object schema (3, unchanged) and NO union (0, unchanged). The 77 bytes
 * are mostly the three enum tokens; `unit` cost 25 as a bare string.
 *
 * ⚠⚠ THE HEADROOM IS NOW 4 OPTIONAL PARAMETERS. `role` and `representation`
 * would take it to 22 of 24. The next field is a decision, not a habit, and the
 * one after it is close to the last.
 *
 * ⚠ THE STATIC BUDGET IS NOT EVIDENCE ABOUT THE COMPILED BOUNDARY, which is
 * unpublished and was established empirically. Asserted here: the serialised
 * size and the SHAPE. The live compiled-grammar probe with a 400-producing
 * negative control is still OWED, not cleared — unchanged from v9.
 *
 * ⚠ v9's VALUE STAYS AND IS ASSERTED DISTINCT: every draft between the v9 change
 * and this one emitted `grammar_sha256:c7132480…`, INCLUDING both live v202
 * draws that measured the churn defect above, and a reader of those logs must be
 * able to tell which grammar produced them.
 */
const HISTORIC_V10_GRAMMAR_SHA256 =
  "d4f4201dd7422ce5c3f41fe1c1046dc9a101eb9b60c0b304451f330a2bb27dbe";

/**
 * ⭐⭐ v11 — THE `likelihood` DESTINATION (instruction v20.2). ONE optional
 * `{ type: "number" }` on the claim item, and nothing else.
 *
 * ⚠ THE SUPERSEDED VALUE IS KEPT ABOVE, AND ASSERTED DISTINCT BELOW, for the
 * reason every value above it is kept: every draft emitted between the
 * `value_scale` widening and this one carries `grammar_sha256:d4f4201d…`,
 * including every draw behind the measured risk 0/3 and outcome 0/2 this change
 * exists to move, and a reader of those logs must be able to tell which grammar
 * produced them. `d4f4201d…` is also the value `staging` serves until this
 * lands.
 *
 * ⛔ THE PIN MOVED BECAUSE THE ARTEFACT MOVED BY DESIGN, and that was DERIVED
 * rather than read off a diff — re-pinning to "whatever it is now" would launder
 * an accident into a registration. THE DISCRIMINATING CONTROL, run at this tip:
 * delete ONLY the `likelihood` property from the built schema and re-hash. It
 * reproduces `d4f4201dd7422ce5c3f41fe1c1046dc9a101eb9b60c0b304451f330a2bb27dbe`
 * EXACTLY — the constant above. So the grammar moved for exactly one reason and
 * carries exactly one new field; a second, unnoticed change would have left that
 * control disagreeing with the value staging serves.
 *
 * ⚠ COST, MEASURED on both arms via `measureDraftRecordsSchemaBudget()`, not
 * estimated: +31 serialised bytes (1451 -> 1482, against 3400) and +1 optional
 * parameter (20 -> 21, against Anthropic's 24). NO new object schema (3,
 * unchanged) and NO union (0, unchanged). The headroom is now THREE optional
 * parameters — the next field is a decision, not a habit.
 */
const PINNED_GRAMMAR_SHA256 =
  // ⚠ RE-PINNED with v20.2 (`likelihood`). This hash is over
  // `JSON.stringify(buildDraftRecordsSchema())` — the BUILT OBJECT the adapter
  // attaches, not the file — so it moves when a FIELD is added and cannot move
  // for a comment. That is what makes it the strongest of the three pins, and
  // it is why adding a grammar field moves it while the instruction pins move
  // independently: 1451 -> 1482 bytes.
  "bfbbe10037f2d52e603c6b3f0389adc61f62febce3f48748fb035a5ede2835a5";

describe("the claim-progress probe is derived from the grammar", () => {
  it("hashes to the PRE-REGISTERED v11 grammar the provider receives", () => {
    expect(draftRecordsGrammarHash()).toBe(PINNED_GRAMMAR_SHA256);
  });

  it("is DISTINCT from the v7 grammar, so the dropped-limit draws stay attributable to it", () => {
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V7_GRAMMAR_SHA256);
    // v8 kept distinct for the same reason as v3-v7: every draft between the
    // applies_to widening and the `unit` widening emitted `3da0c71e…`, and a
    // reader of those logs must be able to tell which grammar produced them.
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V8_GRAMMAR_SHA256);
    // v9 kept distinct for the same reason: both live v202 draws that measured
    // the x137.5 churn carry emitted `c7132480…`, and that evidence must stay
    // attributable to the grammar that produced it.
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V9_GRAMMAR_SHA256);
    // v10 kept distinct for the same reason, and it is the value `staging`
    // serves: every draft taken before the `likelihood` destination emitted
    // `d4f4201d…`, including every draw behind the measured risk 0/3 and
    // outcome 0/2 this change exists to move.
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V10_GRAMMAR_SHA256);
  });

  it("is DISTINCT from the historic v6 grammar, so #1287's capture stays attributable", () => {
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V6_GRAMMAR_SHA256);
  });

  it("is DISTINCT from the historic v4 and v5 grammars, so their runs stay attributable", () => {
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V4_GRAMMAR_SHA256);
    expect(draftRecordsGrammarHash()).not.toBe(HISTORIC_V5_GRAMMAR_SHA256);
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
