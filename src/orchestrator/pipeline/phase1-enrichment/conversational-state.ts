import type {
  CanonicalConstraint,
  ConversationalState,
  ConversationalTopic,
  ConversationContext,
  ConversationMessage,
  LastFailedAction,
} from "../../types.js";
import type { IntentClassification } from "../types.js";

const MAX_LOOKBACK_MESSAGES = 5;
const MAX_ACTIVE_ENTITIES = 3;

const FAILURE_REASON_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /draft a graph first|no graph/i, reason: "missing_graph" },
  { pattern: /change safely|apply that change safely|unsafe/i, reason: "unsafe_change" },
  { pattern: /structural/i, reason: "structural_validation_failed" },
  { pattern: /semantic/i, reason: "semantic_validation_failed" },
  { pattern: /plot/i, reason: "semantic_validation_unavailable" },
  { pattern: /problem processing|internal error/i, reason: "pipeline_error" },
  { pattern: /failed|rejected|wasn't able|unable to/i, reason: "failed" },
];

const BUDGET_RE = /(?:budget(?: is| of| at| under| below)?\s*)(£|\$|€)?\s?(\d+(?:[.,]\d+)?)(\s?[kKmM])?/gi;
const TIMELINE_RE = /(?:within|over|for|in|to|at least|minimum of|max(?:imum)? of)?\s*(\d+(?:[.,]\d+)?)\s*(day|days|week|weeks|month|months|year|years)/gi;
const THRESHOLD_RE = /(?:below|under|less than|at most|up to|max(?:imum)? of|above|over|more than|at least|min(?:imum)? of|target(?:ing)?|keep(?: it)? at|set(?: it)? to|make(?: it)?)(?:\s+stay)?\s+(\d+(?:[.,]\d+)?)\s*(%|percent|percentage points?|bps)?/gi;

function normaliseText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
}

function uniqueStable<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const output: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function classifyCurrentTopic(
  message: string,
  intentClassification: IntentClassification,
  context: ConversationContext,
): ConversationalTopic {
  const lower = message.toLowerCase();

  if (/\b(why|explain|what does|walk me through|break it down|recommended|recommendation)\b/.test(lower)) {
    return 'explaining';
  }
  if (/\b(run|analyse|analyze|simulation|results|scenario)\b/.test(lower)) {
    return 'analysing';
  }
  if (/\b(option|intervention|configure|configuration)\b/.test(lower)) {
    return 'configuring';
  }
  if (!context.graph || /\b(goal|objective|frame|framing|constraint|decision)\b/.test(lower)) {
    return 'framing';
  }
  if (intentClassification === 'act') {
    return 'editing';
  }
  return context.analysis_response ? 'explaining' : 'framing';
}

function getRecentMessages(messages: ConversationMessage[]): ConversationMessage[] {
  return messages.slice(-MAX_LOOKBACK_MESSAGES);
}

function buildEntityLabelCandidates(context: ConversationContext): string[] {
  return (context.graph?.nodes ?? [])
    .filter((node) => node.kind === 'factor' || node.kind === 'option')
    .map((node) => typeof node.label === 'string' ? node.label.trim() : '')
    .filter((label) => label.length > 0);
}

function extractActiveEntities(messages: ConversationMessage[], context: ConversationContext): string[] {
  const candidates = buildEntityLabelCandidates(context);
  if (candidates.length === 0) return [];

  const matched: string[] = [];
  for (const message of messages) {
    const sources: string[] = [message.content];
    if (message.role === 'assistant' && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.name === 'edit_graph' && typeof toolCall.input.edit_description === 'string') {
          sources.push(toolCall.input.edit_description);
        }
      }
    }

    const haystack = normaliseText(sources.join(' '));
    for (const label of candidates) {
      if (haystack.includes(normaliseText(label))) {
        matched.push(label);
      }
    }
  }

  return uniqueStable(matched).slice(-MAX_ACTIVE_ENTITIES);
}

function formatBudgetValue(symbol: string | undefined, numeric: string, suffix: string | undefined): string {
  const cleanNumber = numeric.replace(/,/g, '').toLowerCase();
  const cleanSuffix = (suffix ?? '').replace(/\s+/g, '').toLowerCase();
  const currency = symbol ?? '';
  return `${currency}${cleanNumber}${cleanSuffix}`;
}

function extractCanonicalConstraints(messages: ConversationMessage[]): CanonicalConstraint[] {
  const constraints: CanonicalConstraint[] = [];

  for (const message of messages) {
    if (message.role !== 'user') continue;
    const content = message.content;

    for (const match of content.matchAll(BUDGET_RE)) {
      constraints.push(`budget:${formatBudgetValue(match[1], match[2], match[3])}`);
    }

    for (const match of content.matchAll(TIMELINE_RE)) {
      const amount = match[1].replace(/,/g, '').toLowerCase();
      const unit = match[2].toLowerCase();
      constraints.push(`timeline:${amount}_${unit}`);
    }

    for (const match of content.matchAll(THRESHOLD_RE)) {
      const amount = match[1].replace(/,/g, '').toLowerCase();
      const unitRaw = (match[2] ?? '').toLowerCase();
      const unit = unitRaw.startsWith('percent') || unitRaw === '%' ? '%' : unitRaw.replace(/\s+/g, '_');
      constraints.push(`threshold:${amount}${unit}` as CanonicalConstraint);
    }
  }

  return uniqueStable(constraints);
}

function inferFailureReason(content: string): string | null {
  for (const candidate of FAILURE_REASON_PATTERNS) {
    if (candidate.pattern.test(content)) {
      return candidate.reason;
    }
  }
  return null;
}

function extractLastFailedAction(messages: ConversationMessage[]): LastFailedAction | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'assistant') continue;
    if (!message.tool_calls || message.tool_calls.length === 0) continue;
    const reason = inferFailureReason(message.content);
    if (!reason) continue;
    return {
      tool: message.tool_calls[0]?.name ?? 'unknown',
      reason,
    };
  }
  return null;
}

export function buildConversationalState(
  message: string,
  context: ConversationContext,
  intentClassification: IntentClassification,
): ConversationalState {
  const recentMessages = getRecentMessages(context.messages);

  return {
    active_entities: extractActiveEntities(recentMessages, context),
    stated_constraints: extractCanonicalConstraints(recentMessages),
    current_topic: classifyCurrentTopic(message, intentClassification, context),
    last_failed_action: extractLastFailedAction(recentMessages),
  };
}
