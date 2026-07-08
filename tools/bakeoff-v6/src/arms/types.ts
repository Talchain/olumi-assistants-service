import type { LlmClient } from "../llm/client.ts";
import type { PromptSet } from "../prompts/loader.ts";
import type {
  BriefFixture,
  CallRecord,
  DeferArtifact,
  MergeReport,
  ResolvedArmModels,
} from "../types.ts";

/** Shared arm interface: brief in, GraphV3 candidate out. */
export interface ArmRunInput {
  brief: BriefFixture;
  seed: number;
  prompts: PromptSet;
  client: LlmClient;
  models: ResolvedArmModels;
  /**
   * Arm B only: per-brief output-token budget derived from the USD compute
   * target of the comparison partner (equal-compute matching). Absent on
   * unmatched runs.
   */
  bTokenBudget?: number;
  /**
   * Arm C only: a frozen (pre-generated) M1 graph to critique instead of
   * drafting a fresh one. When set, arm C skips its M1 API call and feeds this
   * graph to M2 — so every M2 variant critiques the IDENTICAL M1 graph,
   * removing the M1-variation confounder from M2-prompt comparisons (and
   * providing the scored round's paired-review input). Absent = normal draft.
   */
  frozenM1?: unknown;
}

export interface ArmRunOutput {
  candidate: unknown | null;
  calls: CallRecord[];
  armC: { proposals_raw: unknown[]; merge: MergeReport } | null;
  armD: { advice_texts: string[]; content_block_types: string[] } | null;
  artifacts: DeferArtifact[];
  failure: { stage: string; message: string } | null;
}

export type ArmRunner = (input: ArmRunInput) => Promise<ArmRunOutput>;

export function emptyOutput(): ArmRunOutput {
  return { candidate: null, calls: [], armC: null, armD: null, artifacts: [], failure: null };
}

export function briefUserContent(brief: BriefFixture): string {
  return `Decision brief:\n${brief.brief}`;
}
