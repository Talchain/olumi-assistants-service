/**
 * Context Architecture v2 — S4 rolling summary: the summariser MODEL port.
 *
 * The model call is behind an injectable port so the maintainer's containment
 * logic (monotonic write, regen horizon, parse-reject) is unit-tested with a
 * fake — no network, deterministic. The production impl wraps chatWithAnthropic
 * on a HAIKU-class model (CEE_MODEL_SUMMARY, default claude-haiku-4-5).
 *
 * SUMMARISER_SYSTEM_PROMPT is CODE-DEFINED and registered in
 * PROMPT-ESTATE-REGISTER.md (unowned prompts are the estate's known failure
 * mode — 05 §S4 errata). It is NOT free-form: it mandates the four-slot output
 * contract the parser enforces, and Doctrine P (no raw floats — it summarises
 * the conversation, not the analysis; 04 §3.3).
 */

import { chatWithAnthropic } from '../../adapters/llm/anthropic.js';
import { config } from '../../config/index.js';

import {
  DEFAULT_SUMMARY_MODEL,
  SUMMARY_TARGET_MAX_CHARS,
  SUMMARY_TARGET_MIN_CHARS,
} from './summary-types.js';

/** The code-defined summariser prompt (Doctrine P; strict four-slot contract).
 *  British English, matching the estate. Registered in PROMPT-ESTATE-REGISTER. */
export const SUMMARISER_SYSTEM_PROMPT = [
  'You maintain a running summary of a decision-making conversation so the assistant never forgets what the user said earlier.',
  '',
  'Output EXACTLY these four labelled slots, each on its own line, and NOTHING else — no preamble, no closing remarks, no markdown headings:',
  '',
  'DECISION FRAME: <the decision being made — goal and options — in 1-2 sentences>',
  'CONSTRAINTS & PREFERENCES: <every constraint or preference the user has stated, including ones said only in prose; write "(none)" if there are none> [tN]',
  'RESOLVED: <threads that are settled, so they are not relitigated; "(none)" if none> [tN]',
  'OPEN: <unanswered questions or pending intents; "(none)" if none> [tN]',
  '',
  'Rules:',
  `- Keep the whole summary between ${SUMMARY_TARGET_MIN_CHARS} and ${SUMMARY_TARGET_MAX_CHARS} characters. Never exceed the length — drop the least important detail instead.`,
  '- After each CONSTRAINTS / RESOLVED / OPEN entry, cite the turn(s) it came from as [t3] or [t3, t7], using the [tN] labels shown in the input. FRAME does not need a citation.',
  '- Preserve constraints the user stated long ago even if they were not repeated recently — that is the whole point of this summary.',
  '- Write plain prose. Do NOT include probabilities, percentages, scores, or any numeric analysis values — those live elsewhere. Never invent facts the conversation does not contain.',
  '- If you are updating a prior summary, carry forward everything still true and only change what the new turns actually changed.',
].join('\n');

export interface SummariserModelResult {
  readonly text: string;
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number };
}

export interface SummariserModel {
  summarise(
    userMessage: string,
    opts?: { readonly requestId?: string },
  ): Promise<SummariserModelResult>;
}

/** Resolve the summariser model id: CEE_MODEL_SUMMARY override, else the
 *  haiku-class default. The 1.74 estate lane re-points this estate-wide. */
export function resolveSummaryModel(): string {
  const configured = config.cee.models.summary;
  // Treat an empty/whitespace env value as unset (an empty CEE_MODEL_SUMMARY
  // must never blank the model id and 400 the call).
  return configured && configured.trim().length > 0 ? configured : DEFAULT_SUMMARY_MODEL;
}

/** Off-turn-path budget: the summariser is fire-and-forget; a generous but
 *  bounded timeout keeps a hung upstream from leaking work. */
const SUMMARISER_TIMEOUT_MS = 20_000;
/** Enough for the four slots + citations; well under haiku's 8,192 cap. */
const SUMMARISER_MAX_TOKENS = 700;

export class AnthropicSummariserModel implements SummariserModel {
  async summarise(
    userMessage: string,
    opts?: { readonly requestId?: string },
  ): Promise<SummariserModelResult> {
    const result = await chatWithAnthropic({
      system: SUMMARISER_SYSTEM_PROMPT,
      userMessage,
      model: resolveSummaryModel(),
      maxTokens: SUMMARISER_MAX_TOKENS,
      temperature: 0,
      timeoutMs: SUMMARISER_TIMEOUT_MS,
      requestId: opts?.requestId,
    });
    return {
      text: result.content,
      usage: {
        input_tokens: result.usage?.input_tokens,
        output_tokens: result.usage?.output_tokens,
      },
    };
  }
}
