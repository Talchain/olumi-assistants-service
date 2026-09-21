/**
 * ⭐⭐ AN OPTION THAT SAYS `needs_user_mapping` MUST NAME WHAT IT NEEDS.
 *
 * THE DEFECT, MEASURED ON TWO REAL USER DEBUG BUNDLES (2026-09-21T11:47Z,
 * scenarios `48a1ce84` and `376707e6`). All four options in both bundles
 * carried, together:
 *
 *     status             = "needs_user_mapping"
 *     unresolved_targets = ABSENT
 *     user_questions     = 0
 *
 * The user asked the product what was missing and it had nothing to say. The
 * repo already declares that combination invalid — `v3-validator.ts`
 * (`MISSING_USER_QUESTIONS`, "Option X needs user mapping but has no
 * user_questions or unresolved_targets") — but only as a post-hoc WARNING on a
 * response that has already been built. Nothing held the PRODUCER to it.
 *
 * ── WHY THIS PRODUCER ───────────────────────────────────────────────────────
 * `projectOptionForCanonicalBuilder` mints the V3 option for the
 * persisted-graph readiness path. It decides `status` from the INTERVENTION
 * COUNT, and copies `unresolved_targets` / `user_questions` only if the raw
 * candidate already happened to carry them. Two different facts, and nothing
 * joins them — so a candidate with `interventions: {}` and neither explanation
 * field reaches `needs_user_mapping` with nothing to say. Its own factor filter
 * (`if (!factorIds.has(factorId)) continue`) DROPS interventions aimed at
 * unknown factors without recording them as unresolved targets, so this is not
 * a theoretical corner: it is how an option loses every intervention it had.
 *
 * ⚠ THE TWO EXTRACTOR PATHS THE DEFECT REPORT NAMED ARE NOT THE PRODUCER.
 * Derived at this tip, and recorded here so the next session does not re-run it:
 *   · `intervention-extractor.ts:1188` cannot reach both-empty. Its loop sends
 *     every entry to either `interventions[factorId]` or `missingFactors`
 *     (the only `continue` is the one that pushes a missing factor), so
 *     `interventions` empty ⟹ `missingFactors` non-empty ⟹
 *     `unresolved_targets` is set.
 *   · `intervention-extractor.ts:1531-1543` already backfills a question on
 *     exactly this predicate. That backfill is the in-repo precedent this
 *     change generalises — it is now the SAME function, called from both sites,
 *     rather than a second hand-maintained copy of the sentence.
 *
 * ── THE ORACLE IS THE REPO'S OWN RULE, NOT THIS SUITE'S RESTATEMENT ─────────
 * Every assertion is made by running `validateV3Response` and reading its
 * `MISSING_USER_QUESTIONS` warnings (trap 13c: a suite that encodes its own
 * model of the rule scores itself). THE POSITIVE CONTROL below proves that
 * warning can still fire, so the absence assertions are not vacuous (trap 13).
 *
 * ── BINDING ────────────────────────────────────────────────────────────────
 * Every assertion names its option BY ID (trap 19). Counts are never the
 * subject. The graph, the option records, the factor ids and the goal are read
 * from a REAL CAPTURE committed in this repo
 * (`cee/transforms/__tests__/fixtures/held-baseline-journey-2026-09-18.json`),
 * so no self-authored envelope can make a case pass vacuously. The capture is
 * an append-only historic record and is READ ONLY here (trap 14b) — the
 * measured condition is reproduced by clearing `interventions` on a COPY.
 *
 * ── THE CONTRAST CONTROL THAT STOPS THIS RE-OPENING A CLOSED DEFECT ────────
 * A HELD BASELINE must NOT acquire a question. "Which factor(s) does this
 * change, and what value should each be set to?" has no answerable form for a
 * status quo — supplying the mapping stops it being the status quo. That is the
 * ruling already recorded in `option-status.ts`, and a blanket backfill would
 * re-open it (CLAUDE.md trap 21: a harm closed by one change re-opened by its
 * neighbour). `bad0f75e` is the real captured baseline and pins it.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import type { GraphV3T, OptionV3T } from "../../../schemas/cee-v3.js";
import { validateV3Response } from "../../../cee/validation/v3-validator.js";
import { projectOptionForCanonicalBuilder } from "../analysis-ready-helper.js";

// ---------------------------------------------------------------------------
// The capture. READ ONLY — never edited to match new behaviour (trap 14b).
// ---------------------------------------------------------------------------

const CAPTURE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../cee/transforms/__tests__/fixtures/held-baseline-journey-2026-09-18.json",
        import.meta.url,
      ),
    ),
    "utf-8",
  ),
) as { draft_graph: GraphV3T };

const GRAPH = CAPTURE.draft_graph;

/** A real, captured, NON-baseline option. The subject of the defect. */
const SUBJECT_ID = "edbad1ba";
/** The real, captured HELD BASELINE. Must never be asked the unanswerable question. */
const BASELINE_ID = "bad0f75e";
/** A real, captured option that keeps its interventions. The untouched-arm control. */
const CONFIGURED_ID = "3fb49c45";

type RawOptionNode = Record<string, unknown> & { id: string; label: string };

const FACTOR_IDS: ReadonlySet<string> = new Set(
  GRAPH.nodes.filter((n) => n.kind === "factor").map((n) => n.id),
);

const GOAL_NODE_ID = GRAPH.nodes.find((n) => n.kind === "goal")?.id ?? "";

const OPTION_NODES = GRAPH.nodes.filter(
  (n) => n.kind === "option",
) as unknown as RawOptionNode[];

/**
 * Reproduce the measured bundle condition on the named REAL option records:
 * `interventions: {}`, with neither explanation field present. Everything else
 * about the record — id, label, provenance, `is_baseline` — is the capture's.
 */
function withInterventionsCleared(ids: readonly string[]): RawOptionNode[] {
  return OPTION_NODES.map((node) =>
    ids.includes(node.id) ? { ...node, interventions: {} } : { ...node },
  );
}

function project(candidates: readonly RawOptionNode[]): OptionV3T[] {
  return candidates
    .map((candidate) => projectOptionForCanonicalBuilder(candidate, FACTOR_IDS))
    .filter((option): option is OptionV3T => option !== null);
}

/** Run the REPO'S validator and return the ids it reports as unexplained. */
function idsMissingUserQuestions(options: readonly OptionV3T[]): string[] {
  const result = validateV3Response({
    schema_version: "3.0",
    nodes: GRAPH.nodes,
    edges: GRAPH.edges,
    options,
    goal_node_id: GOAL_NODE_ID,
  });
  // `warnings` is the complete list — errors/warningsOnly/info are views of it.
  return result.warnings
    .filter((w) => w.code === "MISSING_USER_QUESTIONS")
    .map((w) => w.affected_option_id ?? "")
    .filter((id) => id !== "");
}

function byId(options: readonly OptionV3T[], id: string): OptionV3T {
  const found = options.find((o) => o.id === id);
  if (!found) throw new Error(`harness: option ${id} was not projected`);
  return found;
}

// ---------------------------------------------------------------------------

describe("an option that needs user mapping names what it needs", () => {
  it("HARNESS: the capture supplies the three named options, a goal and factors", () => {
    expect(GOAL_NODE_ID).not.toBe("");
    expect(FACTOR_IDS.size).toBeGreaterThan(0);
    for (const id of [SUBJECT_ID, BASELINE_ID, CONFIGURED_ID]) {
      expect(OPTION_NODES.map((n) => n.id)).toContain(id);
    }
  });

  it("POSITIVE CONTROL: the validator still reports an unexplained needs_user_mapping option", () => {
    // Hand-built, deliberately both-empty — proves the oracle can SEE the
    // condition, so every absence assertion below is non-vacuous (trap 13).
    const planted: OptionV3T = {
      id: SUBJECT_ID,
      label: "planted",
      status: "needs_user_mapping",
      interventions: {},
    };
    const others = project(OPTION_NODES).filter((o) => o.id !== SUBJECT_ID);
    expect(idsMissingUserQuestions([planted, ...others])).toContain(SUBJECT_ID);
  });

  it("PRECONDITION: the subject really does reach needs_user_mapping with no interventions", () => {
    // Pins the precondition in-test, so a GREEN result can never come from the
    // fixture quietly ceasing to reproduce the condition (trap 13b).
    const subject = byId(project(withInterventionsCleared([SUBJECT_ID])), SUBJECT_ID);
    expect(subject.status).toBe("needs_user_mapping");
    expect(Object.keys(subject.interventions)).toHaveLength(0);
    expect(subject.is_baseline).not.toBe(true);
  });

  it("RED: a needs_user_mapping option carries unresolved_targets or user_questions", () => {
    const projected = project(withInterventionsCleared([SUBJECT_ID]));
    expect(idsMissingUserQuestions(projected)).not.toContain(SUBJECT_ID);
  });

  it("RED: the question names the option, so four such options are told apart", () => {
    // The measured bundles carried FOUR unexplained options at once. A generic
    // sentence cannot tell the user which of them needs what.
    const projected = project(withInterventionsCleared([SUBJECT_ID, CONFIGURED_ID]));
    const subjectLabel = byId(projected, SUBJECT_ID).label;
    const otherLabel = byId(projected, CONFIGURED_ID).label;
    expect(subjectLabel).not.toBe(otherLabel);

    const subjectQuestions = byId(projected, SUBJECT_ID).user_questions ?? [];
    const otherQuestions = byId(projected, CONFIGURED_ID).user_questions ?? [];
    expect(subjectQuestions.some((q) => q.includes(subjectLabel))).toBe(true);
    expect(otherQuestions.some((q) => q.includes(otherLabel))).toBe(true);
    expect(subjectQuestions).not.toEqual(otherQuestions);
  });

  it("CONTRAST CONTROL: a HELD BASELINE is never asked the unanswerable question", () => {
    const baseline = byId(project(withInterventionsCleared([BASELINE_ID])), BASELINE_ID);
    expect(baseline.is_baseline).toBe(true);
    expect(baseline.user_questions ?? []).toHaveLength(0);
  });

  it("CONTRAST CONTROL: an option that keeps its interventions gains nothing", () => {
    const configured = byId(project(withInterventionsCleared([SUBJECT_ID])), CONFIGURED_ID);
    expect(configured.status).toBe("ready");
    expect(configured.user_questions ?? []).toHaveLength(0);
  });

  it("CONTRAST CONTROL: a candidate's own explanation is preserved, not replaced", () => {
    const own = "Which market does this option apply to?";
    const candidates = withInterventionsCleared([SUBJECT_ID]).map((node) =>
      node.id === SUBJECT_ID ? { ...node, user_questions: [own] } : node,
    );
    const subject = byId(project(candidates), SUBJECT_ID);
    expect(subject.user_questions).toEqual([own]);
  });

  it("CONTRAST CONTROL: an option with unresolved_targets is already explained", () => {
    const candidates = withInterventionsCleared([SUBJECT_ID]).map((node) =>
      node.id === SUBJECT_ID ? { ...node, unresolved_targets: ["brand equity"] } : node,
    );
    const subject = byId(project(candidates), SUBJECT_ID);
    expect(subject.unresolved_targets).toEqual(["brand equity"]);
    expect(subject.user_questions ?? []).toHaveLength(0);
    expect(idsMissingUserQuestions(project(candidates))).not.toContain(SUBJECT_ID);
  });
});
