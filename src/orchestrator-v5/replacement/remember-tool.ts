/**
 * Replacement conversation layer — writing down what the USER established.
 *
 * THE GAP THIS CLOSES, AND HOW IT WAS FOUND
 * ------------------------------------------
 * The first increment's promise is "retain new evidence". The memory module
 * supports `user_fact`, `user_preference`, `open_question` and
 * `disagreement`; the prompt renders them under headings that keep each
 * claim's standing distinct; the tests construct them by hand.
 *
 * And NOTHING recorded one at runtime. A sweep for `user_fact` outside tests
 * returned zero, while the contrast — `ai_suggestion` and
 * `authorised_change` — fired at three live sites. So the durable record
 * held only what the ASSISTANT had done, and the section headed "THE USER
 * STATED AS FACT" could never be populated. The conversation would still
 * work turn to turn on raw history, and would quietly lose everything the
 * user established the moment that history was trimmed or reloaded.
 *
 * WHY A TOOL RATHER THAN EXTRACTION IN CODE
 * ------------------------------------------
 * Deciding what someone established is a judgement over natural language,
 * and this estate has a standing rule about those: they do not belong in a
 * predicate. Four rounds were once spent oscillating on one. The model is
 * already reading the turn and is the right thing to make the call — so it
 * makes it explicitly, as a tool call that is visible in the receipt, rather
 * than through a regex nobody can audit.
 *
 * WHAT IT MAY NOT DO, ENFORCED HERE AND NOT IN THE PROMPT
 * -------------------------------------------------------
 * · It cannot record an `ai_suggestion`. The composer owns that, and it owns
 *   it precisely so that "you suggested X" can never quietly become "X".
 * · It cannot record an `authorised_change`. Only a receipt produces one —
 *   the memory module refuses it without both a proposal id and a receipt
 *   id, and this tool has neither to give.
 *
 * Both are refusals rather than prompt instructions because a rule that must
 * hold every time cannot live in a prompt: measured at temperature 0, two
 * identical runs of this layer obeyed a plainly-stated prompt rule once out
 * of twice.
 */

import { liveItems, type ConversationMemory } from './conversation-memory.js';
import type { AgentTool, AgentToolOutcome, RememberableKind, RememberedItem } from './agent-loop.js';

export interface RememberToolDeps {
  /** The record as it stands, so the same thing is not written twice. */
  readonly getMemory: () => ConversationMemory;
}

/**
 * Exact-after-normalisation, deliberately — the same rule the structure
 * tools use for duplicate nodes. A near-duplicate ("churn went to 4.4%" vs
 * "churn rose to 4.4% in 2024") is NOT caught, and trying to catch it would
 * be a similarity predicate over natural language, which is the shape this
 * estate has already spent four rounds failing to bound.
 */
function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
}

const ALLOWED: readonly RememberableKind[] = [
  'user_fact',
  'user_preference',
  'open_question',
  'disagreement',
];

/** What the model is told each kind means. This is the whole interface. */
const KIND_GUIDANCE = [
  'user_fact — something they stated as true about their business. Their words, their number.',
  'user_preference — something they want, require or rule out.',
  'open_question — something raised and not yet settled, by either of you.',
  'disagreement — where they pushed back on a suggestion or a result.',
].join(' · ');

export const REMEMBER_TOOL_NAME = 'remember';

export function createRememberTool(deps: RememberToolDeps): AgentTool {
  return {
    kind: 'remember',
    definition: {
      name: REMEMBER_TOOL_NAME,
      description:
        'Write down what the user has established, so it survives into later turns. ' +
        'Use it when they state a fact or a number about their business, say what they want or ' +
        'will not accept, raise something you cannot settle now, or disagree with you. ' +
        `Kinds: ${KIND_GUIDANCE}. ` +
        'Record their meaning in their own words — do not summarise a number away or soften a ' +
        'disagreement. You cannot record your own suggestions here, and you cannot record that ' +
        'something was saved: both are handled elsewhere and neither is yours to assert.',
      input_schema: {
        // ⚠ `additionalProperties: false` is REQUIRED on every object schema
        // here, including the nested one. Strict tool calling rejects the
        // whole request with a 400 otherwise — `tools.N.custom: For 'object'
        // type, 'additionalProperties' must be explicitly set to false`. The
        // sibling tools happen not to need it only because none of them has
        // a nested object; the next one that does will hit this.
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            description: 'One entry per distinct thing established. Usually one, occasionally two.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                kind: { type: 'string', enum: [...ALLOWED] },
                text: { type: 'string', description: "What they established, in their words." },
                supersedes: {
                  type: 'string',
                  description:
                    'Only when they have CORRECTED something recorded earlier: the id of that item. ' +
                    'A correction replaces a claim of the same kind; it never crosses kinds.',
                },
              },
              required: ['kind', 'text'],
            },
          },
        },
        required: ['items'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const rawItems = Array.isArray(raw.items) ? raw.items : [];
      if (rawItems.length === 0) {
        return {
          type: 'refused',
          content: 'Nothing to record. Call this only when the user has actually established something.',
        };
      }

      // What is already on the record, by kind. Recording the same thing
      // twice bloats every later prompt and reads to the user exactly like
      // not having listened — which is the defect this tool exists to fix,
      // arriving through the fix itself. Measured live: on a four-turn run
      // the model re-recorded an identical fact one turn after writing it.
      const already = new Set(
        liveItems(deps.getMemory()).map((i) => `${i.kind}\u0000${normalise(i.text)}`),
      );

      const items: RememberedItem[] = [];
      for (const entry of rawItems) {
        if (entry === null || typeof entry !== 'object') continue;
        const e = entry as Record<string, unknown>;
        const kind = typeof e.kind === 'string' ? e.kind : '';
        const text = typeof e.text === 'string' ? e.text.trim() : '';

        if (kind === 'ai_suggestion') {
          return {
            type: 'refused',
            content:
              'You cannot record your own suggestion here. A suggestion is written down for you when ' +
              'you offer a change, and it stays marked as yours rather than as theirs — that is what ' +
              'stops "you suggested it" turning into "it is so".',
          };
        }
        if (kind === 'authorised_change') {
          return {
            type: 'refused',
            content:
              'You cannot record that something was saved. Only an actual receipt from the save does ' +
              'that. If you believe a change was saved and cannot see it in the record, say you are ' +
              'not sure and check.',
          };
        }
        if (!(ALLOWED as readonly string[]).includes(kind)) {
          return {
            type: 'refused',
            content: `"${kind}" is not something I record. Use one of: ${ALLOWED.join(', ')}.`,
          };
        }
        if (text.length === 0) {
          return { type: 'refused', content: 'An empty entry records nothing. Say what they established.' };
        }

        const key = `${kind}\u0000${normalise(text)}`;
        if (already.has(key)) {
          return {
            type: 'refused',
            content:
              `That is already on the record, word for word: "${text}". Nothing to do. ` +
              `If they have CHANGED it rather than repeated it, record the new version with ` +
              `\`supersedes\` set to the id of the old one.`,
          };
        }
        already.add(key);

        const supersedes = typeof e.supersedes === 'string' && e.supersedes.trim().length > 0
          ? e.supersedes.trim()
          : undefined;
        items.push({ kind: kind as RememberableKind, text, ...(supersedes === undefined ? {} : { supersedes }) });
      }

      if (items.length === 0) {
        return { type: 'refused', content: 'None of those entries were usable. Each needs a kind and some text.' };
      }
      return { type: 'remembered', items };
    },
  };
}
