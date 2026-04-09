/**
 * Prompt Dead-Weight Audit
 *
 * Logging-only inspection of the loaded PMS prompt to surface dead instructions
 * carried over from the pre-v4 (JSON-contract / XML-envelope) era. This module
 * NEVER mutates the prompt — it only emits findings via telemetry so the prompt
 * can be cleaned up at source in PMS.
 *
 * Sentinels are exact substring matches (no regex) on lines of the prompt.
 * Each sentinel corresponds to a specific dead artifact:
 *
 *   <OUTPUT_CONTRACT>...</OUTPUT_CONTRACT>  — pre-v4 envelope contract block
 *   Respond with valid JSON                  — pre-v4 JSON-only response suffix
 *   <diagnostics>                            — pre-v4 reasoning preamble tag
 *   <response> / <assistant_text>            — pre-v4 envelope output tags
 *   action_vocabulary / ACTION_VOCABULARY    — pre-v4 action routing section
 *
 * The four PMS edits in the v31 TODO at prompt-builder-v2.ts:11-17 are all
 * detectable by this set. See docs/llm-context-assembly-audit-2026-04-08.md
 * §1d for the rationale.
 */

import { createHash } from "node:crypto";

export const PROMPT_AUDIT_SENTINELS = [
  '<OUTPUT_CONTRACT>',
  '</OUTPUT_CONTRACT>',
  'Respond with valid JSON',
  '<diagnostics>',
  '<response>',
  '<assistant_text>',
  'action_vocabulary',
  'ACTION_VOCABULARY',
] as const;

export type PromptAuditSentinel = (typeof PROMPT_AUDIT_SENTINELS)[number];

export interface SentinelHit {
  sentinel: PromptAuditSentinel;
  approximateLine: number;
  context: string;
}

export interface PromptAuditResult {
  totalChars: number;
  deadSectionCount: number;
  estimatedDeadChars: number;
  sentinelsFound: SentinelHit[];
  sentinelsNotFound: PromptAuditSentinel[];
  promptHash: string;
}

const CONTEXT_RADIUS = 20;

/**
 * Inspect a raw prompt for dead-weight sentinels and return a structured result
 * suitable for telemetry. Pure function — does not log, does not throw, does
 * not mutate input.
 */
export function auditPromptForV4(rawPrompt: string): PromptAuditResult {
  const totalChars = rawPrompt.length;
  const promptHash = createHash('sha256').update(rawPrompt).digest('hex');

  const lines = rawPrompt.split('\n');
  const sentinelsFound: SentinelHit[] = [];
  const foundSet = new Set<PromptAuditSentinel>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const sentinel of PROMPT_AUDIT_SENTINELS) {
      if (line.includes(sentinel)) {
        const idx = line.indexOf(sentinel);
        const start = Math.max(0, idx - CONTEXT_RADIUS);
        const end = Math.min(line.length, idx + sentinel.length + CONTEXT_RADIUS);
        sentinelsFound.push({
          sentinel,
          approximateLine: i + 1,
          context: line.slice(start, end),
        });
        foundSet.add(sentinel);
      }
    }
  }

  const sentinelsNotFound = PROMPT_AUDIT_SENTINELS.filter((s) => !foundSet.has(s));

  // Estimated dead chars: span of <OUTPUT_CONTRACT>...</OUTPUT_CONTRACT> when
  // both endpoints are present (the most useful single estimate, since the
  // envelope block is the dominant cost). Other sentinels contribute their
  // containing line length each. This is an estimate, not a precise accounting.
  let estimatedDeadChars = 0;
  const openIdx = rawPrompt.indexOf('<OUTPUT_CONTRACT>');
  const closeIdx = rawPrompt.indexOf('</OUTPUT_CONTRACT>');
  if (openIdx >= 0 && closeIdx > openIdx) {
    estimatedDeadChars += closeIdx + '</OUTPUT_CONTRACT>'.length - openIdx;
  }
  // Sum line lengths for non-OUTPUT_CONTRACT sentinel hits, deduped by line.
  const countedLines = new Set<number>();
  for (const hit of sentinelsFound) {
    if (hit.sentinel === '<OUTPUT_CONTRACT>' || hit.sentinel === '</OUTPUT_CONTRACT>') continue;
    if (countedLines.has(hit.approximateLine)) continue;
    countedLines.add(hit.approximateLine);
    estimatedDeadChars += lines[hit.approximateLine - 1]?.length ?? 0;
  }

  return {
    totalChars,
    deadSectionCount: foundSet.size,
    estimatedDeadChars,
    sentinelsFound,
    sentinelsNotFound,
    promptHash,
  };
}

/**
 * Static runtime suffix appended to the cached static block. Tells the LLM
 * how the v4 native tool-use pipeline expects responses to be shaped, so the
 * dead JSON/XML envelope instructions in the cf-v28 prompt body have a clear
 * counter-instruction. This is a stop-gap until PMS is updated at source.
 *
 * The proposal-language directive (T5) is the upstream prevention for the
 * proposal-language guard. The runtime scanner in proposal-language-guard.ts
 * is the safety net; this directive teaches the model to avoid the leak in
 * the first place.
 *
 * Belongs in the static block (cacheable) — DO NOT put in the dynamic block.
 */
export const RUNTIME_TOOL_USE_SUFFIX =
  '\n\n[Runtime context: This system uses native tool calling. Respond in plain text. ' +
  'No XML envelopes, no JSON wrappers, no code blocks.]' +
  '\n\n[Proposal language: When proposing a change that requires confirmation, use proposal ' +
  "language: \"I'd suggest\", \"proposing\", \"here's what I'd change\". Never \"Adding now\" or " +
  "\"I've added\" on unconfirmed changes.]";
