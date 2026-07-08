/**
 * Arm C — dual-model: M1 drafts, M2 critiques and emits DISCRETE enrichment
 * proposals; deterministic benchmark code (merge.ts) — never a model — merges
 * them into the final GraphV3 candidate. Raw proposals are stored before any
 * merge; every invalid proposal is a RECORDED failure.
 */
import { ANTHROPIC_DRAFT_GRAPH_SCHEMA } from "../../../../src/cee/draft/anthropic-graph-schema.ts";
import { extractJson } from "../llm/client.ts";
import { buildCallRecord } from "../compute/cost.ts";
import { mergeProposals } from "../merge/merge.ts";
import { validateDraftAtBoundary } from "../validate/draft-boundary.ts";
import { STRUCTURED_OUTPUTS_AUX_STRING_REMINDER } from "../llm/structured-aux.ts";
import { briefUserContent, emptyOutput, type ArmRunner } from "./types.ts";
import { ARM_A_MAX_TOKENS } from "./arm-a.ts";

export const ARM_C_M2_MAX_TOKENS = 16_384;

export const runArmC: ArmRunner = async (input) => {
  const out = emptyOutput();

  // --- M1: either a frozen graph (paired-review / confounder-free M2 compare)
  //     or a fresh draft (same call shape as the served drafter) ---
  let m1Raw: unknown;
  if (input.frozenM1 !== undefined) {
    // Frozen M1: no API call. Every M2 variant critiques the identical graph.
    m1Raw = input.frozenM1;
  } else {
    const m1Result = await input.client.call({
      purpose: "arm-c-draft-m1",
      model: input.models.C.m1,
      system: input.prompts.armCM1.body,
      // Grammar arm: append the adapter's stringified-aux reminder (mirrors live).
      // No-think mirror = explicit thinking disabled; no temperature (400 on Sonnet 5).
      userContent: briefUserContent(input.brief) + STRUCTURED_OUTPUTS_AUX_STRING_REMINDER,
      maxTokens: ARM_A_MAX_TOKENS,
      thinking: { type: "disabled" },
      outputConfig: {
        format: { type: "json_schema", schema: ANTHROPIC_DRAFT_GRAPH_SCHEMA as Record<string, unknown> },
      },
    });
    out.calls.push(buildCallRecord("arm-c-draft-m1", input.models.C.m1, m1Result));
    try {
      m1Raw = extractJson(m1Result.text);
    } catch (err) {
      out.failure = { stage: "arm-c-m1-parse", message: (err as Error).message };
      return out;
    }
  }

  // M1 must be a well-formed draft at the LLM boundary before merging is
  // meaningful. Dry-run gate = the live adapter acceptance gate (de-stringify +
  // normalise + LLMDraftResponse.safeParse), NOT the V3 egress gate (which the
  // live pipeline reaches only after the deterministic V1->V3 transform).
  const m1Boundary = validateDraftAtBoundary(m1Raw);
  if (!m1Boundary.valid) {
    out.candidate = m1Boundary.normalised; // recorded as-is; counted invalid by the validation pass
    out.armC = {
      proposals_raw: [],
      merge: {
        proposals_total: 0,
        applied: 0,
        artifacts: 0,
        failures: [],
        post_merge_valid: false,
        post_merge_errors: ["merge skipped: M1 draft failed LLM-boundary validation"],
      },
    };
    out.failure = { stage: "arm-c-m1-validation", message: `M1 draft failed LLM-boundary validation — merge skipped (${m1Boundary.errors[0] ?? "unknown"})` };
    return out;
  }
  const m1Candidate = m1Boundary.normalised;

  // --- M2 critique: discrete evidence-linked proposals ---
  // v0.4.x M2 on Sonnet 5 at bounded effort (adaptive thinking + effort medium).
  const m2Result = await input.client.call({
    purpose: "arm-c-critique-m2",
    model: input.models.C.m2,
    system: input.prompts.armCM2.body,
    userContent: `${briefUserContent(input.brief)}\n\nDraft graph (M1 output, JSON):\n${JSON.stringify(m1Candidate, null, 2)}`,
    maxTokens: ARM_C_M2_MAX_TOKENS,
    thinking: { type: "adaptive" },
    outputConfig: { effort: "medium" },
  });
  out.calls.push(buildCallRecord("arm-c-critique-m2", input.models.C.m2, m2Result));

  // Live wire shape is an OBJECT ROOT { "proposals": [...] } (m2-review.ts:191-202).
  // A bare array is recorded as a wire-shape deviation, not silently accepted.
  let proposals: unknown[] = [];
  let m2ParseFailure: string | null = null;
  try {
    const parsed = extractJson(m2Result.text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
        Array.isArray((parsed as { proposals?: unknown }).proposals)) {
      proposals = (parsed as { proposals: unknown[] }).proposals;
    } else if (Array.isArray(parsed)) {
      proposals = parsed;
      m2ParseFailure = "M2 output is a bare array, not the required {proposals:[...]} object root";
    } else {
      m2ParseFailure = "M2 output is not a {proposals:[...]} JSON object";
    }
  } catch (err) {
    m2ParseFailure = (err as Error).message;
  }

  // Merge is deterministic scored-round logic; guard it (the M1 graph is the
  // LLM-boundary shape for the dry run, so a scored-round-shaped merge may
  // report post_merge_valid:false — that is non-evidence, never a crash).
  try {
    const outcome = mergeProposals(m1Candidate, proposals);
    out.candidate = outcome.merged;
    out.artifacts = outcome.artifacts;
    out.armC = { proposals_raw: proposals, merge: outcome.report };
  } catch (err) {
    out.candidate = m1Candidate;
    out.armC = {
      proposals_raw: proposals,
      merge: {
        proposals_total: proposals.length,
        applied: 0,
        artifacts: 0,
        failures: [],
        post_merge_valid: false,
        post_merge_errors: [`merge threw (non-evidence, dry run): ${(err as Error).message}`],
      },
    };
  }
  if (m2ParseFailure) {
    // Final candidate degrades to the bare M1 draft — recorded, never silent.
    out.failure = { stage: "arm-c-m2-parse", message: m2ParseFailure };
  }
  return out;
};
