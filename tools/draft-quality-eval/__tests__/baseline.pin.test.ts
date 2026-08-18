/**
 * THE BASELINE PIN — the number every future candidate instruction is compared
 * against, and the guard that stops it being attributed to the wrong artefact.
 *
 * ⚠ WHAT IS PINNED HERE, AND WHAT DELIBERATELY IS NOT.
 *
 * PINNED: the rubric's verdict over a FIXED, committed JSON file (the governed
 * baseline's 14 captured draws). That input never changes, so this figure moves
 * only when the RUBRIC moves. It is a regression pin on the instrument.
 *
 * NOT PINNED: anything that would RED this gate when someone edits
 * `DRAFT_RECORDS_INSTRUCTION`. That would be a merge gate on serving code
 * dressed up as a harness test, and it is not this tool's business to hold one.
 * The attribution question — "was this banked run produced by the instruction
 * the tree now holds?" — is asked where it actually matters: at the moment a
 * measurement is REPORTED, by the CLI, which refuses rather than mislabels. Its
 * logic is unit-tested below on synthetic inputs so it is proven without
 * coupling this file to the instruction's bytes.
 */
import { describe, it, expect } from "vitest";
import {
  loadBriefs,
  loadGovernedBaseline,
  assertInstructionAttribution,
  type GovernedBaseline,
} from "../corpus.js";
import { evaluateDraft, evaluateDraftPostRepair } from "../runner.js";

describe("the governed baseline corpus is what this harness says it is", () => {
  const baseline = loadGovernedBaseline();
  const briefs = loadBriefs();

  it("loads 14 captured draws and 16 briefs, by name", () => {
    // An aggregate cannot see a corpus that silently shrank to zero.
    expect(baseline.cases).toHaveLength(14);
    expect(baseline.cases.map((c) => c.briefId)).toEqual([
      "01-simple-binary",
      "02-multi-option-constrained",
      "03-vague-underspecified",
      "04-conflicting-constraints",
      "05-product-feature",
      "06-operations-warehouse",
      "07-cloud-migration",
      "08-channel-strategy",
      "09-nested-subdecision",
      "10-many-observables",
      "11-feedback-loop-trap",
      "12-similar-options",
      "13-forced-binary",
      "14-qualitative-strategy",
    ]);
    expect(briefs).toHaveLength(16);
    // The two staging briefs have no captured draw — stated, not implied.
    const withoutCapture = briefs
      .map((b) => b.id)
      .filter((id) => !baseline.cases.some((c) => c.briefId === id));
    expect(withoutCapture).toEqual(["hiring-staging", "pricing-staging"]);
  });

  it("carries the front-matter oracles the rubric consumes", () => {
    // If front-matter parsing breaks, D4.4 silently becomes UNEVALUABLE on every
    // brief and the harness quietly stops asking the status-quo question.
    const withOracle = briefs.filter((b) => b.expectStatusQuo !== undefined);
    expect(withOracle).toHaveLength(16);
    expect(briefs.find((b) => b.id === "01-simple-binary")?.expectStatusQuo).toBe(true);
    expect(briefs.find((b) => b.id === "05-product-feature")?.expectStatusQuo).toBe(false);
    // …and the brief BODY is present, front-matter stripped.
    expect(briefs.find((b) => b.id === "01-simple-binary")?.text).toContain("£150/month");
    expect(briefs.find((b) => b.id === "01-simple-binary")?.text).not.toContain("expect_status_quo");
  });
});

describe("BASELINE — the figure a candidate instruction must beat", () => {
  const baseline = loadGovernedBaseline();
  const briefs = new Map(loadBriefs().map((b) => [b.id, b]));
  const scores = baseline.cases.map((c) =>
    evaluateDraft({
      briefId: c.briefId,
      graph: c.graph,
      briefText: briefs.get(c.briefId)?.text,
      expectStatusQuo: briefs.get(c.briefId)?.expectStatusQuo,
    }),
  );
  const passed = scores.reduce((a, s) => a + s.checksPassed, 0);
  const applicable = scores.reduce((a, s) => a + s.checksApplicable, 0);

  it("PROJECTED stage: 155 of 243 applicable checks over the 14-brief corpus", () => {
    // MEASURED 2026-08-18 against the committed capture
    // (records_instruction_sha256 37f271b2…, prompt draft_graph_default@v195,
    // claude-sonnet-4-6). The input is a fixed file: this moves only if the
    // RUBRIC changes, and then the change must be argued, not re-pinned.
    expect(applicable).toBe(243);
    expect(passed).toBe(155);
  });

  it("the failures are concentrated where the measurement says they are", () => {
    // Bound by IDENTITY, not by a rate another distribution could satisfy.
    const failCount = (id: string) =>
      scores.filter((s) => s.checks.find((c) => c.id === id)?.passed === false).length;

    // Every goal label that exists is a verbatim brief fragment; three briefs
    // produce no goal node at all, so the check is unevaluable there.
    expect(failCount("D1.2-goal-label-not-verbatim-quote")).toBe(11);
    // The decision node label is the hardcoded literal on every single draw.
    expect(failCount("D1.4-decision-label-authored")).toBe(14);
    // Every draw creates blocking repair work.
    expect(failCount("D7.1-draft-creates-no-blocking-repair")).toBe(14);
    // …and none of it is over structure the system invented (P6 clean).
    expect(failCount("D7.2-no-mandatory-ask-over-system-inferred-structure")).toBe(0);
    // Risk coverage is HEALTHY at this instruction — the 5/5 `riskCount: 0`
    // figure this harness was commissioned on belongs to an earlier version.
    expect(failCount("D3.1-at-least-one-authored-risk")).toBe(0);
  });

  it("three briefs project a model with NO goal node at all", () => {
    const goalless = scores.filter((s) => s.measures.goalNodeCount === 0).map((s) => s.briefId);
    expect(goalless).toEqual(["05-product-feature", "07-cloud-migration", "10-many-observables"]);
  });

  it("no outcome in the corpus is machine scaffolding", () => {
    // The 14 Aug outage was a 100%-scaffolded outcome layer. This is the
    // regression witness for it, over a corpus rather than one pinned brief.
    const scaffolded = scores.reduce((a, s) => a + s.measures.scaffoldedOutcomeCount, 0);
    const outcomes = scores.reduce((a, s) => a + s.measures.outcomeCount, 0);
    expect(outcomes).toBeGreaterThan(0); // or the zero below is vacuous
    expect(scaffolded).toBe(0);
  });
});

describe("BASELINE — the POST-REPAIR stage, which is closer to what the user gets", () => {
  const baseline = loadGovernedBaseline();
  const briefs = new Map(loadBriefs().map((b) => [b.id, b]));

  it("scores 164 of 246 applicable checks — and the delta from PROJECTED is the finding", async () => {
    const scores = [];
    for (const c of baseline.cases) {
      scores.push(
        await evaluateDraftPostRepair({
          briefId: c.briefId,
          graph: c.graph,
          briefText: briefs.get(c.briefId)?.text,
          expectStatusQuo: briefs.get(c.briefId)?.expectStatusQuo,
        }),
      );
    }
    const passed = scores.reduce((a, s) => a + s.checksPassed, 0);
    const applicable = scores.reduce((a, s) => a + s.checksApplicable, 0);
    expect(applicable).toBe(246);
    expect(passed).toBe(164);

    // ⭐ THE PAIR THAT MATTERS. Pre-repair, three briefs have NO goal. Post-
    // repair, all three have one — labelled with the machine placeholder. The
    // gap is not closed, it is COVERED, and only reading both stages shows it.
    // A harness that reported either stage alone would say something true and
    // leave the reader with the wrong picture.
    const goalless = scores.filter((s) => s.measures.goalNodeCount === 0);
    expect(goalless).toHaveLength(0);
    const placeholder = scores
      .filter((s) => s.checks.find((c) => c.id === "D1.5-goal-label-is-not-the-machine-placeholder")?.passed === false)
      .map((s) => s.briefId);
    expect(placeholder).toEqual(["05-product-feature", "07-cloud-migration", "10-many-observables"]);
  });

  it("repair does not clear the blocking burden: every draft still blocks", async () => {
    const scores = [];
    for (const c of baseline.cases) {
      scores.push(await evaluateDraftPostRepair({ briefId: c.briefId, graph: c.graph }));
    }
    const stillBlocking = scores.filter((s) => s.measures.blockingErrorCount > 0);
    expect(stillBlocking).toHaveLength(14);
  });
});

describe("the attribution guard refuses to mislabel evidence", () => {
  const fake = (sha: string) => ({ recordsInstructionSha256: sha } as GovernedBaseline);

  it("passes silently when the banked run matches the tree's instruction", () => {
    expect(() => assertInstructionAttribution(fake("abc123"), "abc123")).not.toThrow();
  });

  it("THROWS when it does not — a figure about the wrong artefact is worse than no figure", () => {
    expect(() => assertInstructionAttribution(fake("abc123"), "def456")).toThrow(
      /ATTRIBUTION FAILED/,
    );
  });

  it("names both hashes in the error, so the reader can tell which is which", () => {
    try {
      assertInstructionAttribution(fake("aaaa"), "bbbb");
      throw new Error("guard did not throw");
    } catch (e) {
      expect(String(e)).toContain("aaaa");
      expect(String(e)).toContain("bbbb");
    }
  });
});
