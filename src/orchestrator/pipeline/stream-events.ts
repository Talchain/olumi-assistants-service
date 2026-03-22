/**
 * Orchestrator Streaming Event Types
 *
 * Canonical SSE event schema for orchestrator streaming.
 * Single source of truth consumed by both CEE (emitter) and UI (parser).
 *
 * Feature-gated behind ENABLE_ORCHESTRATOR_STREAMING.
 */

import { z } from "zod";
import type { TypedConversationBlock } from "../types.js";
import type { OrchestratorResponseEnvelopeV2 } from "./types.js";

// ============================================================================
// TypeScript Types
// ============================================================================

export type OrchestratorStreamEvent =
  | { type: 'turn_start'; seq: number; turn_id: string; routing: 'deterministic' | 'llm'; stage: string }
  | { type: 'text_delta'; seq: number; delta: string }
  | { type: 'tool_start'; seq: number; tool_name: string; long_running: boolean }
  | { type: 'block'; seq: number; block: TypedConversationBlock }
  | { type: 'tool_result'; seq: number; tool_name: string; success: boolean; duration_ms?: number }
  | { type: 'turn_complete'; seq: number; envelope: OrchestratorResponseEnvelopeV2 }
  | { type: 'error'; seq: number; error: { code: string; message: string }; recoverable: boolean };

// ============================================================================
// Error Codes
// ============================================================================

export const STREAM_ERROR_CODES = {
  LLM_TIMEOUT: 'LLM_TIMEOUT',
  LLM_ERROR: 'LLM_ERROR',
  TOOL_ERROR: 'TOOL_ERROR',
  TURN_BUDGET_EXCEEDED: 'TURN_BUDGET_EXCEEDED',
  STREAM_WRITE_TIMEOUT: 'STREAM_WRITE_TIMEOUT',
  PIPELINE_ERROR: 'PIPELINE_ERROR',
} as const;

// ============================================================================
// Zod Schemas (for fixture validation and shared contract)
// ============================================================================

const TurnStartEventSchema = z.object({
  type: z.literal('turn_start'),
  seq: z.number().int().nonnegative(),
  turn_id: z.string().min(1),
  routing: z.enum(['deterministic', 'llm']),
  stage: z.string().min(1),
});

const TextDeltaEventSchema = z.object({
  type: z.literal('text_delta'),
  seq: z.number().int().nonnegative(),
  delta: z.string(), // empty string is valid (parser hardening)
});

const ToolStartEventSchema = z.object({
  type: z.literal('tool_start'),
  seq: z.number().int().nonnegative(),
  tool_name: z.string().min(1),
  long_running: z.boolean(),
});

const BlockEventSchema = z.object({
  type: z.literal('block'),
  seq: z.number().int().nonnegative(),
  block: z.object({
    block_type: z.string(),
    data: z.unknown(),
  }).passthrough(),
});

// Slim tool_result — success/duration only, no rich payload.
// Visual content comes from `block` events. Canonical state from `turn_complete`.
const ToolResultEventSchema = z.object({
  type: z.literal('tool_result'),
  seq: z.number().int().nonnegative(),
  tool_name: z.string().min(1),
  success: z.boolean(),
  duration_ms: z.number().nonnegative().optional(),
});

const TurnCompleteEventSchema = z.object({
  type: z.literal('turn_complete'),
  seq: z.number().int().nonnegative(),
  envelope: z.object({
    turn_id: z.string(),
    assistant_text: z.string().nullable(),
    blocks: z.array(z.unknown()),
    lineage: z.object({ context_hash: z.string() }).passthrough(),
  }).passthrough(),
});

const ErrorEventSchema = z.object({
  type: z.literal('error'),
  seq: z.number().int().nonnegative(),
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
  }),
  recoverable: z.boolean(),
});

export const OrchestratorStreamEventSchema = z.discriminatedUnion('type', [
  TurnStartEventSchema,
  TextDeltaEventSchema,
  ToolStartEventSchema,
  BlockEventSchema,
  ToolResultEventSchema,
  TurnCompleteEventSchema,
  ErrorEventSchema,
]);
