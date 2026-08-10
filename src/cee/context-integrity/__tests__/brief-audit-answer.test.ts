/**
 * ROADMAP 2.975 — unit coverage for the brief-audit discriminator and composer.
 *
 * The corpus is drawn from OUTSIDE this author's head (CLAUDE.md trap 22):
 * every audit phrasing is a verbatim capture from the 2026-08-08
 * context-integrity trace or a paraphrase of one of the four questions the
 * trace pre-registered, and every negative is lifted from the existing
 * `state-query-guard.test.ts` session-edit corpus. Each positive has an
 * OPPOSITE-DIRECTION TWIN, because this predicate guards two harms that point
 * in opposite directions (trap 22b).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  composeBriefAuditAnswer,
  isBriefAuditQuestion,
  tryBriefAuditAnswer,
} from "../brief-audit-answer.js";
import {
  NOT_TRACKED_CLASSES,
  deriveNotModelledManifest,
} from "../not-modelled-manifest.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadCapture(name: string): { brief_text: string; graph: unknown } {
  return JSON.parse(
    readFileSync(join(HERE, "fixtures", `${name}.cold-read.json`), "utf8"),
  ) as { brief_text: string; graph: unknown };
}

const B1 = loadCapture("b1-growth");
const B2 = loadCapture("b2-restructuring");
const B3 = loadCapture("b3-product-bet");

describe("isBriefAuditQuestion", () => {
  describe("fires on the questions the trace measured being deflected", () => {
    const auditQuestions: readonly string[] = [
      // Verbatim captures.
      "Before I go further I want to audit what you did with my brief. Tell me " +
        "specifically: 1) what from my brief did you keep in the model, 2) what did " +
        "you add or infer yourself, 3) what did you leave out, and 4) what did you " +
        "change or reinterpret? Be specific about numbers.",
      "Which parts of my brief did you leave out of the model, and which numbers " +
        "did you change or reinterpret?",
      // The four pre-registered questions asked singly.
      "What did you keep from my brief?",
      "What did you leave out?",
      "What did you ignore in my brief?",
      "What did you omit?",
      "Which of my numbers did you use?",
      "Have you used what I told you, or did you make things up?",
      "What did you not model from what I wrote?",
      "Did you use the figures I gave you?",
      "Show me what you left out.",
      "What did you discard from my brief?",
    ];

    for (const message of auditQuestions) {
      it(`fires on ${JSON.stringify(message.slice(0, 58))}`, () => {
        expect(isBriefAuditQuestion(message)).toBe(true);
      });
    }
  });

  describe("does NOT fire on session-edit questions (the opposite harm)", () => {
    const sessionEditQuestions: readonly string[] = [
      "What changed?",
      "What's changed?",
      "What has changed?",
      "What just changed?",
      "what update did you make?",
      "What change did you make?",
      "What did you change?",
      "What did you update?",
      "What did you add?",
      "did you change anything?",
      "Did you update it?",
      "Did you apply that?",
      "Did you add it?",
      "I can't see it",
      "I can't see this constraint",
      "where is it?",
      "where did it go?",
      "show me what you added",
      "show me what you changed",
      "show me what you updated",
      "What did that update do?",
    ];

    for (const message of sessionEditQuestions) {
      it(`declines ${JSON.stringify(message)}`, () => {
        expect(isBriefAuditQuestion(message)).toBe(false);
      });
    }
  });

  describe("does NOT fire on requests that merely mention the brief", () => {
    // A brief REFERENT without an AUDIT FRAME is a request, not an audit. This
    // is the conjunct that stops "use my brief" becoming a fidelity report.
    const notAudits: readonly string[] = [
      "Add a factor from my brief about the German TAM.",
      "Use my brief to build the model.",
      "Here is my brief.",
      "My brief mentions BaFin licensing.",
      "Redraft the model from my brief.",
    ];

    for (const message of notAudits) {
      it(`declines ${JSON.stringify(message)}`, () => {
        expect(isBriefAuditQuestion(message)).toBe(false);
      });
    }
  });

  it("an audit frame alone is not enough", () => {
    // "did you" with no brief referent and no omission verb.
    expect(isBriefAuditQuestion("Did you run the analysis?")).toBe(false);
  });

  it("a brief referent alone is not enough", () => {
    expect(isBriefAuditQuestion("My brief is quite long.")).toBe(false);
  });

  /**
   * THE AMBIGUOUS PAIR, kept apart by the retention-verb conjunct. These two
   * differ by ONE verb and mean different things, and the difference is not
   * recoverable from punctuation or length (trap 22f) — so the ambiguous one
   * stays with the existing session-edit behaviour rather than being guessed at.
   */
  it('"which of my numbers did you USE" is an audit question', () => {
    expect(isBriefAuditQuestion("Which of my numbers did you use?")).toBe(true);
  });

  it('"did you CHANGE my numbers" is left to the session-edit guard', () => {
    // After a value edit this is a session-edit question, and answering it with
    // a brief-fidelity report would be the lie the gap is worth avoiding.
    expect(isBriefAuditQuestion("Did you change my numbers?")).toBe(false);
  });

  it('"did you update my figures" is likewise left alone', () => {
    expect(isBriefAuditQuestion("Did you update my figures?")).toBe(false);
  });
});

describe("composeBriefAuditAnswer", () => {
  describe("refuses to claim when the manifest could not look", () => {
    it("returns null with no brief text", () => {
      expect(tryBriefAuditAnswer(null, B1.graph)).toBeNull();
    });

    it("returns null with no graph", () => {
      expect(tryBriefAuditAnswer(B1.brief_text, null)).toBeNull();
    });

    it("returns null on an empty brief rather than reporting zero losses", () => {
      // The failure mode this guards: "0 figures were dropped" on a scenario we
      // know nothing about is a new lie carrying the authority of a measurement.
      const answer = tryBriefAuditAnswer("   ", B1.graph);
      expect(answer).toBeNull();
    });
  });

  describe("quotes the user's own bytes back, verbatim", () => {
    /**
     * Bound by IDENTITY — the exact literal the user wrote, at a known offset,
     * derived from the producer rather than asserted here (trap 19: a value
     * predicate another quantity could satisfy would not prove the binding).
     */
    it("B1: names the ARR figure the model dropped", () => {
      const answer = tryBriefAuditAnswer(B1.brief_text, B1.graph);
      expect(answer).toContain("£11.2m");
    });

    it("B2: names the vendor quote the model dropped", () => {
      // The trace graded this atom SEVERE: the only real offer on the table.
      const answer = tryBriefAuditAnswer(B2.brief_text, B2.graph);
      expect(answer).toContain("£1.1m");
    });

    it("B3: names the hard deadline the model dropped", () => {
      const answer = tryBriefAuditAnswer(B3.brief_text, B3.graph);
      expect(answer).toContain("14 May 2027");
    });

    it("does not re-format the user's figure", () => {
      // "£11.2m" must not come back as "11200000" or "£11,200,000".
      const answer = tryBriefAuditAnswer(B1.brief_text, B1.graph) ?? "";
      expect(answer).not.toContain("11200000");
      expect(answer).not.toContain("£11,200,000");
    });
  });

  describe("the tallies are the manifest's, not this module's", () => {
    it("reports the derived counts rather than recomputing them", () => {
      const manifest = deriveNotModelledManifest(B1.brief_text, B1.graph);
      const q = manifest.quantities;
      expect(q).not.toBeNull();
      const answer = composeBriefAuditAnswer(manifest) ?? "";
      expect(answer).toContain(String(q!.total));
      expect(answer).toContain(String(q!.absent));
      expect(answer).toContain(String(q!.in_model));
    });
  });

  describe("never lets a finite list read as a complete account", () => {
    for (const [name, capture] of [
      ["B1", B1],
      ["B2", B2],
      ["B3", B3],
    ] as const) {
      it(`${name}: states that the account is incomplete`, () => {
        const answer = tryBriefAuditAnswer(capture.brief_text, capture.graph) ?? "";
        expect(answer).toMatch(/not (?:a )?complete account/i);
      });

      it(`${name}: names every class the derivation cannot see`, () => {
        // Derived from NOT_TRACKED_CLASSES by identity, so a class added to the
        // manifest cannot silently drop out of the caveat (trap 12).
        const answer = tryBriefAuditAnswer(capture.brief_text, capture.graph) ?? "";
        for (const cls of NOT_TRACKED_CLASSES) {
          expect(answer).toContain(cls.replace(/_/g, " "));
        }
      });
    }
  });

  describe("distinguishes our figures from the user's", () => {
    it("labels model-supplied figures as ours, not theirs", () => {
      const answer = tryBriefAuditAnswer(B1.brief_text, B1.graph) ?? "";
      expect(answer).toMatch(/supplied myself|my estimates/i);
    });
  });

  describe("does not emit the copy the egress filter forbids", () => {
    // The composed text lands on the same direct-answer path as the guard's
    // other dispatches, so it is subject to FORBIDDEN_USER_FACING_PHRASES.
    const denialPatterns: readonly RegExp[] = [
      /\bnothing\s+changed\b/i,
      /\bI\s+haven['’]t\s+applied\s+any\s+changes\b/i,
      /\bno\s+changes\s+(?:were|are|have\s+been)\s+(?:made|applied)\b/i,
      /\brecommendations?\b/i,
      /\bthe\s+winners?\b/i,
    ];

    for (const [name, capture] of [
      ["B1", B1],
      ["B2", B2],
      ["B3", B3],
    ] as const) {
      it(`${name}: carries no forbidden user-facing phrase`, () => {
        const answer = tryBriefAuditAnswer(capture.brief_text, capture.graph) ?? "";
        expect(answer.length).toBeGreaterThan(0);
        for (const pattern of denialPatterns) {
          expect(answer).not.toMatch(pattern);
        }
      });
    }
  });

  /**
   * The regression guard for the defect this lane shipped and then caught: at a
   * cap of 12, `14 May 2027` (B3's hard demo deadline, graded SEVERE by the
   * trace) was hidden behind "and 11 more" while `£15` was shown — a cap
   * silently choosing which of the user's losses they were allowed to see.
   */
  describe("every figure the user lost is named, not just the first few", () => {
    for (const [name, capture] of [
      ["B1", B1],
      ["B2", B2],
      ["B3", B3],
    ] as const) {
      it(`${name}: names EVERY absent figure`, () => {
        const manifest = deriveNotModelledManifest(capture.brief_text, capture.graph);
        const absent = manifest.quantities!.items.filter((i) => i.verdict === "absent");
        expect(absent.length).toBeGreaterThan(0);
        const answer = composeBriefAuditAnswer(manifest) ?? "";
        for (const item of absent) {
          expect(answer).toContain(item.literal);
        }
      });
    }
  });

  describe("beyond the cap, the overflow AND the ordering are disclosed", () => {
    /**
     * A LENGTH PROBE, not a fidelity claim: two real briefs concatenated to
     * exceed the cap. The bytes are still the corpus's, so the extraction is
     * exercised on real phrasing; only the LENGTH is contrived, which is the
     * one property under test here.
     */
    it("discloses the remainder and refuses to imply a ranking", () => {
      const manifest = deriveNotModelledManifest(
        `${B2.brief_text}\n\n${B3.brief_text}`,
        B3.graph,
      );
      const absent = manifest.quantities!.items.filter((i) => i.verdict === "absent");
      expect(absent.length).toBeGreaterThan(25);
      const answer = composeBriefAuditAnswer(manifest) ?? "";
      expect(answer).toMatch(/and \d+ more/);
      expect(answer).toMatch(/not a ranking/i);
    });
  });
});
