/**
 * run_exercise Tool Handler
 *
 * Gate-only virtual tool — NOT LLM-selectable, NOT in tool registry.
 * Invoked when the intent gate matches one of the 15 exercise patterns.
 *
 * Runs a cognitive challenge exercise (pre-mortem, devil's advocate,
 * or disconfirmation) using an internal LLM call against the current
 * analysis results.
 *
 * Prerequisite: context.analysis_response must be populated.
 * Throws TOOL_EXECUTION_FAILED if analysis is missing.
 * Throws TOOL_EXECUTION_FAILED if exercise type is unknown.
 *
 * Output: ReviewCardBlock with tone: 'challenger'.
 *
 * LLM call pattern: matches explain_results (adapter.chat, ORCHESTRATOR_TIMEOUT_MS).
 */

import { log } from "../../utils/telemetry.js";
import { ORCHESTRATOR_TIMEOUT_MS } from "../../config/timeouts.js";
import type { LLMAdapter, CallOpts } from "../../adapters/llm/types.js";
import type { ConversationBlock, ConversationContext, OrchestratorError, V2RunResponseEnvelope } from "../types.js";
import type { ExerciseType } from "../types/guidance-item.js";
import { createReviewCardBlock } from "../blocks/factory.js";

// ============================================================================
// Types
// ============================================================================

export interface RunExerciseResult {
  blocks: ConversationBlock[];
  assistantText: string | null;
  latencyMs: number;
}

// ============================================================================
// Exercise Protocol Templates
// ============================================================================

/** Build the pre-mortem system prompt from analysis data */
function buildPreMortemPrompt(summary: ExerciseSummary): string {
  return [
    'You are a decision coach running a pre-mortem exercise.',
    '',
    'Imagine it is 12 months from now and the chosen option has completely failed.',
    'Your task: identify the most plausible failure modes given the analysis below.',
    '',
    '## Analysis Context',
    ...formatSummaryLines(summary),
    '',
    '## Protocol',
    '1. State the primary failure mode (the most likely cause of failure)',
    '2. Identify 2-3 contributing factors',
    '3. Flag which fragile edges or uncertain factors most increase this risk',
    '4. Suggest one concrete action to reduce the most critical risk',
    '',
    '## Rules',
    '- Be specific and grounded in the analysis data above',
    '- Do NOT invent numbers or probabilities',
    '- Tone: constructive challenger — this is a cognitive safety check, not criticism',
    '- Keep response under 250 words',
  ].join('\n');
}

/** Build the devil\'s advocate system prompt */
function buildDevilAdvocatePrompt(summary: ExerciseSummary): string {
  return [
    'You are a decision coach running a devil\'s advocate exercise.',
    '',
    'Your task: make the strongest possible case AGAINST the currently recommended option.',
    '',
    '## Analysis Context',
    ...formatSummaryLines(summary),
    '',
    '## Protocol',
    '1. Identify the single best argument against the recommended option',
    '2. Point to the weakest assumptions underlying the recommendation',
    '3. Identify which alternative option is most underrated and why',
    '4. Suggest what new information would most change this recommendation',
    '',
    '## Rules',
    '- Argue in good faith — find genuine weaknesses, not strawmen',
    '- Ground arguments in the analysis data (sensitivities, constraints, robustness)',
    '- Do NOT invent numbers or probabilities',
    '- Tone: intellectual challenge — help the user stress-test their thinking',
    '- Keep response under 250 words',
  ].join('\n');
}

/** Build the disconfirmation system prompt */
function buildDisconfirmationPrompt(summary: ExerciseSummary): string {
  return [
    'You are a decision coach running a disconfirmation exercise.',
    '',
    'Your task: identify what evidence would change this recommendation.',
    '',
    '## Analysis Context',
    ...formatSummaryLines(summary),
    '',
    '## Protocol',
    '1. State the key assumption the recommendation most depends on',
    '2. Describe the specific evidence (observable signal) that would falsify this assumption',
    '3. Identify the timeframe within which this signal should appear',
    '4. Suggest a monitoring trigger: "If we observe X within Y timeframe, reconsider this decision"',
    '',
    '## Rules',
    '- Focus on falsifiable, observable signals — not vague concerns',
    '- Ground in the sensitivity and constraint data',
    '- Do NOT invent numbers or probabilities',
    '- Tone: scientific — help the user think like a tester of hypotheses',
    '- Keep response under 250 words',
  ].join('\n');
}

// ============================================================================
// Analysis Summary Extraction
// ============================================================================

interface ExerciseSummary {
  winnerLabel: string | null;
  winnerProbability: number | null;
  runnerUpLabel: string | null;
  runnerUpProbability: number | null;
  fragileEdges: string[];
  topFactors: Array<{ label: string; influence: number }>;
  violatedConstraints: string[];
  isFragile: boolean;
}

function extractExerciseSummary(response: V2RunResponseEnvelope): ExerciseSummary {
  // Results: winner and runner-up
  let winnerLabel: string | null = null;
  let winnerProbability: number | null = null;
  let runnerUpLabel: string | null = null;
  let runnerUpProbability: number | null = null;

  if (response.results && Array.isArray(response.results) && response.results.length > 0) {
    const results = response.results as Array<Record<string, unknown>>;
    const sorted = [...results].sort((a, b) => {
      const wa = typeof a.win_probability === 'number' ? a.win_probability : 0;
      const wb = typeof b.win_probability === 'number' ? b.win_probability : 0;
      return wb - wa;
    });
    if (sorted[0]) {
      winnerLabel = typeof sorted[0].option_label === 'string' ? sorted[0].option_label : null;
      winnerProbability = typeof sorted[0].win_probability === 'number' ? sorted[0].win_probability : null;
    }
    if (sorted[1]) {
      runnerUpLabel = typeof sorted[1].option_label === 'string' ? sorted[1].option_label : null;
      runnerUpProbability = typeof sorted[1].win_probability === 'number' ? sorted[1].win_probability : null;
    }
  }

  // Fragile edges
  const fragileEdges: string[] = [];
  const robustness = response.robustness as Record<string, unknown> | undefined;
  if (robustness?.fragile_edges && Array.isArray(robustness.fragile_edges)) {
    for (const e of robustness.fragile_edges) {
      const edge = e as Record<string, unknown>;
      const label = edge.label ?? edge.edge_id ?? edge.id;
      if (typeof label === 'string') fragileEdges.push(label);
    }
  }

  // Top factors by influence
  const topFactors: Array<{ label: string; influence: number }> = [];
  if (response.factor_sensitivity && Array.isArray(response.factor_sensitivity)) {
    const factors = response.factor_sensitivity as Array<Record<string, unknown>>;
    const withInfluence = factors
      .map((f) => ({
        label: typeof f.label === 'string' ? f.label : String(f.node_id ?? f.factor_id ?? 'unknown'),
        influence: typeof f.elasticity === 'number' ? Math.abs(f.elasticity) :
                   typeof f.sensitivity === 'number' ? Math.abs(f.sensitivity) : 0,
      }))
      .sort((a, b) => b.influence - a.influence)
      .slice(0, 3);
    topFactors.push(...withInfluence);
  }

  // Violated constraints (prob < 0.5)
  const violatedConstraints: string[] = [];
  if (response.constraint_analysis?.per_constraint && Array.isArray(response.constraint_analysis.per_constraint)) {
    for (const c of response.constraint_analysis.per_constraint) {
      const constraint = c as Record<string, unknown>;
      if (typeof constraint.probability === 'number' && constraint.probability < 0.5) {
        const label = constraint.label ?? constraint.constraint_id ?? constraint.id;
        if (typeof label === 'string') violatedConstraints.push(label);
      }
    }
  }

  // Robustness level
  const isFragile = robustness?.level === 'fragile';

  return {
    winnerLabel,
    winnerProbability,
    runnerUpLabel,
    runnerUpProbability,
    fragileEdges,
    topFactors,
    violatedConstraints,
    isFragile,
  };
}

function formatSummaryLines(summary: ExerciseSummary): string[] {
  const lines: string[] = [];

  if (summary.winnerLabel !== null) {
    const pct = summary.winnerProbability !== null
      ? ` (win probability: ${(summary.winnerProbability * 100).toFixed(1)}%)`
      : '';
    lines.push(`Recommended option: ${summary.winnerLabel}${pct}`);
  }
  if (summary.runnerUpLabel !== null) {
    const pct = summary.runnerUpProbability !== null
      ? ` (${(summary.runnerUpProbability * 100).toFixed(1)}%)`
      : '';
    lines.push(`Runner-up option: ${summary.runnerUpLabel}${pct}`);
  }

  if (summary.isFragile) {
    lines.push('Robustness: FRAGILE — result is sensitive to assumption changes');
  }

  if (summary.fragileEdges.length > 0) {
    lines.push(`Fragile edges: ${summary.fragileEdges.join(', ')}`);
  }

  if (summary.topFactors.length > 0) {
    const factorList = summary.topFactors
      .map((f) => `${f.label} (influence: ${f.influence.toFixed(2)})`)
      .join('; ');
    lines.push(`Top sensitivity factors: ${factorList}`);
  }

  if (summary.violatedConstraints.length > 0) {
    lines.push(`Violated constraints: ${summary.violatedConstraints.join(', ')}`);
  }

  return lines;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Execute the run_exercise virtual tool.
 *
 * @param exercise - The type of cognitive exercise to run
 * @param context - Conversation context (must have analysis_response)
 * @param adapter - LLM adapter for generating exercise output
 * @param requestId - Request ID for tracing
 * @param turnId - Turn ID for block provenance
 * @returns ReviewCardBlock with tone: 'challenger'
 */
export async function handleRunExercise(
  exercise: ExerciseType,
  context: ConversationContext,
  adapter: LLMAdapter,
  requestId: string,
  turnId: string,
): Promise<RunExerciseResult> {
  // Prerequisite: analysis_response must be present
  if (!context.analysis_response) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: 'No analysis results available. Run analysis first before running an exercise.',
      tool: 'run_exercise',
      recoverable: true,
      suggested_retry: 'Run the analysis first, then try the exercise again.',
    };
    throw Object.assign(new Error(err.message), { orchestratorError: err });
  }

  const startTime = Date.now();
  const analysisResponse = context.analysis_response;

  // Extract exercise summary from analysis
  const summary = extractExerciseSummary(analysisResponse);

  // Build exercise-specific prompt
  let systemPrompt: string;
  let userMessage: string;
  switch (exercise) {
    case 'pre_mortem':
      systemPrompt = buildPreMortemPrompt(summary);
      userMessage = 'Run the pre-mortem exercise.';
      break;
    case 'devil_advocate':
      systemPrompt = buildDevilAdvocatePrompt(summary);
      userMessage = "Run the devil's advocate exercise.";
      break;
    case 'disconfirmation':
      systemPrompt = buildDisconfirmationPrompt(summary);
      userMessage = 'Run the disconfirmation exercise.';
      break;
    default: {
      const err: OrchestratorError = {
        code: 'TOOL_EXECUTION_FAILED',
        message: `Unknown exercise type: ${exercise as string}`,
        tool: 'run_exercise',
        recoverable: false,
      };
      throw Object.assign(new Error(err.message), { orchestratorError: err });
    }
  }

  const opts: CallOpts = {
    requestId,
    timeoutMs: ORCHESTRATOR_TIMEOUT_MS,
  };

  let chatResult;
  try {
    chatResult = await adapter.chat({ system: systemPrompt, userMessage }, opts);
  } catch (error) {
    const err: OrchestratorError = {
      code: 'TOOL_EXECUTION_FAILED',
      message: `Exercise LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      tool: 'run_exercise',
      recoverable: true,
      suggested_retry: 'Try the exercise again.',
    };
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { orchestratorError: err });
  }

  const latencyMs = Date.now() - startTime;

  log.info(
    { request_id: requestId, exercise, elapsed_ms: latencyMs },
    'run_exercise completed',
  );

  // Build ReviewCardBlock with challenger tone
  const card = {
    tone: 'challenger' as const,
    exercise_type: exercise,
    content: chatResult.content,
    suggested_actions: buildSuggestedActions(exercise, summary),
  };

  const block = createReviewCardBlock(card, turnId);

  return {
    blocks: [block],
    assistantText: null,
    latencyMs,
  };
}

// ============================================================================
// Suggested Actions Builder
// ============================================================================

function buildSuggestedActions(
  exercise: ExerciseType,
  summary: ExerciseSummary,
): Array<{ label: string; action_type: string }> {
  const actions: Array<{ label: string; action_type: string }> = [];

  switch (exercise) {
    case 'pre_mortem':
      actions.push({ label: 'Edit the model to address this risk', action_type: 'edit_graph' });
      if (summary.fragileEdges.length > 0) {
        actions.push({ label: 'Review fragile edges', action_type: 'explain_results' });
      }
      break;
    case 'devil_advocate':
      actions.push({ label: 'Reconsider the alternatives', action_type: 'explain_results' });
      actions.push({ label: 'Edit the model', action_type: 'edit_graph' });
      break;
    case 'disconfirmation':
      actions.push({ label: 'Set up monitoring triggers', action_type: 'discuss' });
      actions.push({ label: 'Edit the model', action_type: 'edit_graph' });
      break;
  }

  return actions;
}
