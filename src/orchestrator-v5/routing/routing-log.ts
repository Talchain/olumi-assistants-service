/**
 * V5 Phase 1b — Routing log (JSONL file append, PoC fallback).
 *
 * Spec §11: records per-turn routing decisions for offline evaluation.
 *
 *  - DOES NOT write to v5_handler_facts or any Supabase table. The fact
 *    contract is for handler execution facts; routing logs are a different
 *    concern with different quality requirements (§ brief Resolution F).
 *  - Appends to `logs/v5-routing-logs.jsonl` relative to CWD.
 *  - Privacy: when redacted === true, raw_user_message is null and
 *    sonnet_text_hash is a SHA-256 of the Sonnet text.
 *  - label_tier defaults to "unreviewed".
 *  - turn_id links back to v5_conversation_turns.
 *
 * Non-throwing: file append failures are logged to the telemetry sink and
 * swallowed. Routing log emission must never fail a turn.
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import { log } from '../../utils/telemetry.js';

import type { IntentClass, CoachingMode, ResolutionStatus } from './types.js';

export const DEFAULT_ROUTING_LOG_PATH = resolve(process.cwd(), 'logs', 'v5-routing-logs.jsonl');

export type LabelTier = 'unreviewed' | 'triaged' | 'reviewed' | 'gold';

export interface RoutingLogInput {
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly stage: string;
  readonly intent_class: IntentClass | null;
  readonly handler_id: string | null;
  readonly coaching_mode: CoachingMode | null;
  readonly resolution_status: ResolutionStatus | null;
  readonly routing_error_cause: string | null;
  readonly validation_error_code: string | null;
  readonly compound_detected: boolean;
  readonly compound_pattern_matched: string | null;
  readonly raw_user_message: string;
  readonly sonnet_text: string;
  /** When true, raw_user_message is dropped and sonnet_text is hashed. */
  readonly redacted: boolean;
  readonly created_at: string;
  readonly label_tier?: LabelTier;
  /** Phase 1.5: graph signal counts from ContextPack.graph.counts. 0 on frame stage. */
  readonly graph_node_count: number;
  readonly graph_edge_count: number;
  /** Phase 1.5: deterministic graph hash (16 hex chars) or null when no graph. */
  readonly graph_hash: string | null;
}

export interface RoutingLog {
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly stage: string;
  readonly intent_class: IntentClass | null;
  readonly handler_id: string | null;
  readonly coaching_mode: CoachingMode | null;
  readonly resolution_status: ResolutionStatus | null;
  readonly routing_error_cause: string | null;
  readonly validation_error_code: string | null;
  readonly compound_detected: boolean;
  readonly compound_pattern_matched: string | null;
  readonly raw_user_message: string | null;
  readonly sonnet_text: string | null;
  readonly sonnet_text_hash: string | null;
  readonly redacted: boolean;
  readonly created_at: string;
  readonly label_tier: LabelTier;
  readonly graph_node_count: number;
  readonly graph_edge_count: number;
  readonly graph_hash: string | null;
}

/**
 * Build a routing log record. Applies redaction + defaults. Pure — no I/O.
 */
export function buildRoutingLog(input: RoutingLogInput): RoutingLog {
  const labelTier = input.label_tier ?? 'unreviewed';
  if (input.redacted) {
    return {
      turn_id: input.turn_id,
      scenario_id: input.scenario_id,
      stage: input.stage,
      intent_class: input.intent_class,
      handler_id: input.handler_id,
      coaching_mode: input.coaching_mode,
      resolution_status: input.resolution_status,
      routing_error_cause: input.routing_error_cause,
      validation_error_code: input.validation_error_code,
      compound_detected: input.compound_detected,
      compound_pattern_matched: input.compound_pattern_matched,
      raw_user_message: null,
      sonnet_text: null,
      sonnet_text_hash: sha256(input.sonnet_text),
      redacted: true,
      created_at: input.created_at,
      label_tier: labelTier,
      graph_node_count: input.graph_node_count,
      graph_edge_count: input.graph_edge_count,
      graph_hash: input.graph_hash,
    };
  }
  return {
    turn_id: input.turn_id,
    scenario_id: input.scenario_id,
    stage: input.stage,
    intent_class: input.intent_class,
    handler_id: input.handler_id,
    coaching_mode: input.coaching_mode,
    resolution_status: input.resolution_status,
    routing_error_cause: input.routing_error_cause,
    validation_error_code: input.validation_error_code,
    compound_detected: input.compound_detected,
    compound_pattern_matched: input.compound_pattern_matched,
    raw_user_message: input.raw_user_message,
    sonnet_text: input.sonnet_text,
    sonnet_text_hash: null,
    redacted: false,
    created_at: input.created_at,
    label_tier: labelTier,
    graph_node_count: input.graph_node_count,
    graph_edge_count: input.graph_edge_count,
    graph_hash: input.graph_hash,
  };
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Append a routing log to the JSONL file. Swallows I/O errors (logs a
 * warning via the telemetry sink). Never throws.
 */
export async function writeRoutingLog(
  record: RoutingLog,
  filePath: string = DEFAULT_ROUTING_LOG_PATH,
): Promise<void> {
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    log.warn(
      {
        request_id: record.turn_id,
        file_path: filePath,
        err: err instanceof Error ? err.message : String(err),
      },
      'V5 routing log append failed — swallowed',
    );
  }
}
