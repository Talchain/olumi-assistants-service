/**
 * B1-b — A USER-STATED MAGNITUDE MUST NOT BE DISOWNED BECAUSE THE FACTOR IT
 * LANDED ON RECORDS NO SCALE.
 *
 * ── WHAT WAS MEASURED, AND WHERE ──────────────────────────────────────────
 * Twelve fresh-isolated-guest draws of ONE frozen brief against the deployed
 * quartet (UI `88cb7e37` · CEE `d1da670` · PLoT `7e5d8a7`), 2026-08-24. The brief
 * states two money figures of two different kinds: a one-off migration cost
 * (£20,000) and a recurring annual licence (£45,000). Across those draws the
 * user's £20,000 was attributed to them on some draws, carried but disowned on
 * others, and absent from the compiled model entirely on others — SAME BRIEF,
 * SAME BUILD.
 *
 * ── THE MECHANISM, DERIVED AT THE BYTES AND AT A CAPTURED WIRE PAYLOAD ─────
 * `buildInterventionsFromV4Data` decides provenance by asking
 * `classifyAmountAgainstBrief` about the NORMALISED level, which must be
 * de-normalised through the factor's `observed_state` to recover a magnitude.
 * Every factor CEE minted for this brief carried
 *   `observed_state = { value: 0.5, source: "cee_inference" }`
 * — no `cap`, no `raw_value` — so `resolveMagnitudeScale` returns `unknown`,
 * `magnitudeUnderScale` returns null, and the verdict is `undecidable` for EVERY
 * factor in the model. The `statedInBrief` route to `brief_extraction` is
 * therefore STRUCTURALLY DEAD for this class of brief, and the only surviving
 * route is the LLM-emitted `v4InterventionBindings` — an unpinned per-factor
 * model judgement. That is the coin flip.
 *
 * Meanwhile the user's actual magnitude is sitting in `carriedRaw`
 * (`raw_interventions[factorId] === 20000`, witnessed on the wire), unread by the
 * provenance decision, a few lines from where the verdict is taken.
 *
 * ── WHY THE FIX IS SOUND RATHER THAN CONVENIENT ───────────────────────────
 * `stated-amounts.ts` states the governing asymmetry itself: "a MATCH is decisive
 * whatever the denominator — if the number appears in the text, the user wrote
 * it". A RAW magnitude is precisely the case where the denominator is not merely
 * unknown but IRRELEVANT. The fix therefore only ever turns a DISOWNMENT into an
 * ATTRIBUTION, never the reverse, never changes a value, and refuses whenever the
 * denomination is ambiguous.
 *
 * ── WHAT THESE TESTS BIND TO (CLAUDE.md trap 19) ──────────────────────────
 * Every assertion is keyed by the FACTOR ID under test, never by "the
 * intervention whose value is 20000" — two interventions in these fixtures can
 * carry the same magnitude, and a value predicate would let the wrong one pass.
 * Each positive case is paired with its OPPOSITE-DIRECTION TWIN, so a fix that
 * over-fires is caught by the same file that proves it fires at all.
 */

import { describe, it, expect } from "vitest";
import type { NodeV3T } from "../../../schemas/cee-v3.js";
import { extractInterventionsForOption } from "../intervention-extractor.js";

/**
 * THE FROZEN BRIEF, verbatim — the exact text submitted on all twelve draws.
 * Historic evidence: do not reword it to suit a future test (trap 14b).
 */
const FROZEN_BRIEF =
  "We need to decide whether to move our whole sales team off Salesforce onto HubSpot this year. " +
  "A full switch costs £20,000 in migration and training. Staying on Salesforce costs us nothing " +
  "extra up front, and our annual Salesforce licensing is £45,000. We think rep adoption would be " +
  "better on HubSpot but we have no reliable data on that yet. Our main worry is losing pipeline " +
  "visibility during the cutover, which could hurt Q4 bookings.";

const LICENCE_FACTOR = "440d2e30";
const MIGRATION_FACTOR = "fd255d32";
const GOAL = "goal01";
const OPTION_NODE = "682a7e2d";

/**
 * The factor shape the DEPLOYED build actually mints — captured from
 * `olumi-canvas-autosave` on the draws above. The absent `cap` and absent
 * `raw_value` are the whole point: this is what makes `resolveMagnitudeScale`
 * answer `unknown`. A fixture that added either would test a graph the compiler
 * does not produce (trap 16-inverse: a fixture you wrote yourself is not
 * evidence about the wire).
 */
function scalelessFactor(id: string, label: string): NodeV3T {
  return {
    id,
    kind: "factor",
    label,
    provenance: "ai_inferred",
    observed_state: { value: 0.5, source: "cee_inference" },
  } as unknown as NodeV3T;
}

function graphNodes(): NodeV3T[] {
  return [
    { id: GOAL, kind: "goal", label: "Move off Salesforce or stay", provenance: "from_brief" } as unknown as NodeV3T,
    scalelessFactor(LICENCE_FACTOR, "Annual CRM Licensing Cost"),
    scalelessFactor(MIGRATION_FACTOR, "Migration and Training Cost"),
  ];
}

/** Drive the production entry point exactly as the draft path drives it. */
function extract(args: {
  interventions: Record<string, number>;
  raw: Record<string, number>;
  brief?: string;
  nodes?: NodeV3T[];
}) {
  return extractInterventionsForOption(
    "move our whole sales team off Salesforce onto HubSpot this year",
    undefined,
    args.nodes ?? graphNodes(),
    [],
    GOAL,
    new Set<string>(),
    [],
    args.interventions,
    OPTION_NODE,
    args.brief ?? FROZEN_BRIEF,
    args.raw,
    undefined, // no LLM edge binding — THIS is the draw where the coin lands tails
  );
}

describe("B1-b — a stated magnitude on a scaleless factor", () => {
  it("attributes the user's own £20,000 to them, with their denomination", () => {
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.4, [LICENCE_FACTOR]: 0 },
      raw: { [MIGRATION_FACTOR]: 20000, [LICENCE_FACTOR]: 0 },
    });

    // Bound by IDENTITY: the migration factor specifically, never "whichever
    // intervention happens to hold 20000".
    const migration = option.interventions[MIGRATION_FACTOR];
    expect(migration, "the migration factor must carry an intervention").toBeDefined();

    // The value itself is untouched by this fix — assert that first, so a
    // regression that "fixes" provenance by altering the number fails here.
    expect(migration?.raw_value).toBe(20000);

    // THE DEFECT: at pristine these three are cee_hypothesis / low / undefined.
    expect(migration?.source).toBe("brief_extraction");
    expect(migration?.value_confidence).toBe("high");
    expect(migration?.unit).toBe("£");

    // The claim must be TRUE OF THE BRIEF and must quote it — an attribution
    // with no locatable referent is the fabrication direction.
    expect(migration?.reasoning).toContain("£20,000");
    expect(migration?.reasoning).not.toContain("not stated in the brief");
    expect(migration?.reasoning).not.toContain("scale is not recorded");
  });

  it("still disowns a model-invented magnitude the user never wrote (twin)", () => {
    // 22,500 is the midpoint the deployed build invents for its own pilot option.
    // It is a DEFAULT, not a measurement, and must never earn the user's name.
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.45, [LICENCE_FACTOR]: 0.5 },
      raw: { [MIGRATION_FACTOR]: 22500, [LICENCE_FACTOR]: 22500 },
    });

    const migration = option.interventions[MIGRATION_FACTOR];
    expect(migration?.raw_value).toBe(22500);
    expect(migration?.source).toBe("cee_hypothesis");
    expect(migration?.value_confidence).toBe("low");
    expect(migration?.reasoning).not.toContain("£22,500");
  });

  it("refuses when the same magnitude is also stated as a plain count (twin)", () => {
    // "20,000 licences" beside "£20,000" makes the KIND genuinely ambiguous.
    // Claiming a currency here would be a fabrication about which quantity the
    // user meant, so the honest answer is to keep disowning it.
    const ambiguous =
      "A full switch costs £20,000 in migration and training, and we manage 20,000 licences today.";
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.4 },
      raw: { [MIGRATION_FACTOR]: 20000 },
      brief: ambiguous,
    });

    expect(option.interventions[MIGRATION_FACTOR]?.source).toBe("cee_hypothesis");
  });

  it("refuses when two currencies state the same magnitude (twin)", () => {
    const ambiguous =
      "The UK switch costs £20,000 in migration and training; the US switch costs $20,000.";
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.4 },
      raw: { [MIGRATION_FACTOR]: 20000 },
      brief: ambiguous,
    });

    expect(option.interventions[MIGRATION_FACTOR]?.source).toBe("cee_hypothesis");
  });

  it("refuses with no brief to check against (fail-closed twin)", () => {
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.4 },
      raw: { [MIGRATION_FACTOR]: 20000 },
      brief: "",
    });

    expect(option.interventions[MIGRATION_FACTOR]?.source).toBe("cee_hypothesis");
  });

  it("does not launder a magnitude the model chose onto a DIFFERENT factor's zero (twin)", () => {
    // The licence factor is set to 0 on this option — a real model choice, and 0
    // is not a stated amount. It must stay disowned even while its sibling on the
    // same option earns attribution. This is the discriminating pair: one factor
    // flips, the other must not.
    const option = extract({
      interventions: { [MIGRATION_FACTOR]: 0.4, [LICENCE_FACTOR]: 0 },
      raw: { [MIGRATION_FACTOR]: 20000, [LICENCE_FACTOR]: 0 },
    });

    expect(option.interventions[MIGRATION_FACTOR]?.source).toBe("brief_extraction");
    expect(option.interventions[LICENCE_FACTOR]?.source).toBe("cee_hypothesis");
  });

  it("attributes the recurring £45,000 by the same route (the control that already worked)", () => {
    const option = extract({
      interventions: { [LICENCE_FACTOR]: 0.9 },
      raw: { [LICENCE_FACTOR]: 45000 },
    });

    const licence = option.interventions[LICENCE_FACTOR];
    expect(licence?.raw_value).toBe(45000);
    expect(licence?.source).toBe("brief_extraction");
    expect(licence?.unit).toBe("£");
    expect(licence?.reasoning).toContain("£45,000");
  });
});
