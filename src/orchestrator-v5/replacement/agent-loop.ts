/**
 * Replacement conversation layer — the agent loop.
 *
 * WHAT IT REPLACES
 * ----------------
 * The current path decides what the user meant with a routing classifier, then
 * sends the turn down one of several branches. Measured across two live
 * sessions, 9 of 26 turns took the `edit_graph` branch, which reads about a
 * fifth of the conversation, carries no summary, and has exactly two possible
 * outcomes: mutate, or ask for the missing mutation parameters. There is no
 * exit that engages with an idea. Three turns produced an answer with no model
 * call at all.
 *
 * This is the other shape: one loop, one context, a small set of typed tools,
 * and the model decides what to do by calling them.
 *
 * THE RULE THE LOOP ENFORCES, AND WHY IT IS HERE AND NOT IN A GUARD
 * -----------------------------------------------------------------
 * A tool is either a READ or a PROPOSAL. Reads execute immediately. Proposals
 * NEVER touch the graph — they return operations, which the caller records as
 * a proposal for the user to accept or refuse. So there is no path through
 * this loop that writes to the model without a human yes, and that property is
 * structural rather than something a downstream check has to notice.
 *
 * This is why the loop does not use a framework's automatic tool execution:
 * auto-execution is exactly wrong for a consent-gated save.
 *
 * TESTABILITY
 * -----------
 * The model call is injected ({@link AgentLoopDeps.chatWithTools}), so the
 * whole loop runs offline against a scripted fake — no network, no provider
 * credentials, no spend. Every behaviour below is pinned that way.
 */

import type { ToolDefinition, ToolResponseBlock } from '../../adapters/llm/types.js';

/** A tool the model may call. `kind` is the safety-relevant half. */
export interface AgentTool {
  readonly definition: ToolDefinition;
  /**
   * `read` runs immediately and returns information.
   * `propose` returns operations for the user to consent to. It MUST NOT
   * mutate anything; the loop asserts the shape but cannot police side
   * effects, so this is also a review obligation on each tool.
   * `remember` writes what the USER established into the durable record. It
   * touches no graph and needs no consent — recording that someone said
   * something is not a change to their model. It may never record an
   * assistant suggestion or an authorised change: the composer owns the
   * first and only a receipt can produce the second.
   * `accept` records that the user agreed to a proposal ALREADY OFFERED, by
   * its id. It never invents a change: the operations come from the store,
   * exactly as they were shown. This is the only kind whose effect can reach
   * the graph, and it can only reach it along a path the user has seen.
   */
  readonly kind: 'read' | 'propose' | 'accept' | 'remember';
  readonly execute: (input: Record<string, unknown>) => Promise<AgentToolOutcome> | AgentToolOutcome;
}

export type AgentToolOutcome =
  /** A read's answer, or a refusal. Serialised back to the model verbatim. */
  | { readonly type: 'result'; readonly content: string }
  /** A proposal's operations. The loop records it; the model is told it is
   *  pending the user's agreement, so it cannot narrate the change as done. */
  | {
      readonly type: 'proposed';
      readonly summary: string;
      readonly operations: readonly Record<string, unknown>[];
      readonly content?: string;
      /**
       * ⭐ Set ONLY by an amend tool: the id of the proposal this replaces.
       *
       * It stays on the `proposed` outcome rather than getting an outcome type
       * of its own precisely so the loop's existing invariant covers it — a
       * `propose` tool may stage operations and MAY NOT record consent. An
       * amendment must go back to the user, so it must not be an `accept`.
       */
      readonly amends?: string;
    }
  /** The user agreed to a proposal that was already put to them. Carries the
   *  id, never a change — a re-derived operation is a different decision. */
  | {
      readonly type: 'accepted';
      readonly proposal_id: string;
      readonly summary: string;
      readonly content?: string;
    }
  /** Things the user established this turn, for the durable record. */
  | {
      readonly type: 'remembered';
      readonly items: readonly RememberedItem[];
      readonly content?: string;
    }
  | { readonly type: 'refused'; readonly content: string };

/** A kind this layer will record on the user's behalf. Deliberately excludes
 *  `ai_suggestion` and `authorised_change`. */
export type RememberableKind =
  | 'user_fact'
  | 'user_preference'
  | 'open_question'
  | 'disagreement';

export interface RememberedItem {
  readonly kind: RememberableKind;
  readonly text: string;
  /** Id of an earlier item this corrects. Same kind only. */
  readonly supersedes?: string;
}

export interface ProposedChange {
  readonly tool: string;
  readonly summary: string;
  readonly operations: readonly Record<string, unknown>[];
  /** Set only by an amend tool — the proposal this one replaces. */
  readonly amends?: string;
}

export interface RememberedBatch {
  readonly tool: string;
  readonly items: readonly RememberedItem[];
}

export interface AcceptedProposal {
  readonly tool: string;
  readonly proposal_id: string;
  readonly summary: string;
}

export interface ChatWithToolsLike {
  (args: {
    readonly system: string;
    readonly messages: Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }>;
    readonly tools: ToolDefinition[];
  }): Promise<{
    readonly content: ToolResponseBlock[];
    readonly stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  }>;
}

export interface AgentLoopDeps {
  readonly chatWithTools: ChatWithToolsLike;
  /** Hard ceiling on model round-trips. A loop that cannot terminate is a
   *  spend incident and a hung turn; 6 is generous for one conversational
   *  turn and small enough to bound both. */
  readonly maxIterations?: number;
}

export interface AgentLoopInput {
  readonly system: string;
  readonly messages: Array<{ role: 'user' | 'assistant'; content: string | ToolResponseBlock[] }>;
  readonly tools: readonly AgentTool[];
}

export interface AgentLoopResult {
  /** What the user sees. Never contains a tool's raw output. */
  readonly text: string;
  /** Changes awaiting the user's yes. The caller opens these as proposals. */
  readonly proposed: readonly ProposedChange[];
  /** Proposals the user agreed to on this turn, by id. */
  readonly accepted: readonly AcceptedProposal[];
  /** What the user established this turn, for the durable record. */
  readonly remembered: readonly RememberedBatch[];
  /** Tools actually called, in order — for the receipt and for telemetry. */
  readonly toolsCalled: readonly string[];
  readonly iterations: number;
  /** True when the ceiling stopped the loop rather than the model finishing.
   *  The caller must not present a truncated turn as a complete answer. */
  readonly haltedAtCeiling: boolean;
}

export class AgentLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentLoopError';
  }
}

function textOf(blocks: readonly ToolResponseBlock[]): string {
  return blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function toolUsesOf(
  blocks: readonly ToolResponseBlock[],
): readonly { id: string; name: string; input: Record<string, unknown> }[] {
  return blocks.filter(
    (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
      b.type === 'tool_use',
  );
}

/**
 * What a proposal reports back to the model.
 *
 * Deliberately explicit that nothing has happened yet. A model told only
 * "ok" after a write-shaped tool call will narrate the change as done — which
 * is how a live session announced "Updated Monthly Churn Rate" on a turn that
 * then denied having changed anything. The wording here is part of the fix,
 * not decoration.
 */
function proposalToolResult(summary: string, extra?: string): string {
  const base =
    `PROPOSED, NOT APPLIED. Nothing has changed in the model. ` +
    `The user must agree before this is saved. Proposal: ${summary}`;
  return extra === undefined || extra.trim().length === 0 ? base : `${base}\n${extra}`;
}

/**
 * Run one conversational turn.
 *
 * Unknown tool names and thrown tool errors are returned to the model as
 * `is_error` tool results rather than aborting the turn: the model can
 * recover, and a user is never shown a stack trace. A tool that throws
 * repeatedly is bounded by the iteration ceiling like anything else.
 */
export async function runAgentLoop(
  input: AgentLoopInput,
  deps: AgentLoopDeps,
): Promise<AgentLoopResult> {
  const maxIterations = deps.maxIterations ?? 6;
  if (maxIterations < 1) throw new AgentLoopError('maxIterations must be at least 1');

  const byName = new Map(input.tools.map((t) => [t.definition.name, t]));
  if (byName.size !== input.tools.length) {
    throw new AgentLoopError('two tools share a name — the model could not address them distinctly');
  }

  const definitions = input.tools.map((t) => t.definition);
  const messages = [...input.messages];
  const proposed: ProposedChange[] = [];
  const accepted: AcceptedProposal[] = [];
  const remembered: RememberedBatch[] = [];
  const toolsCalled: string[] = [];

  let iterations = 0;
  let lastText = '';

  while (iterations < maxIterations) {
    iterations += 1;
    const response = await deps.chatWithTools({ system: input.system, messages, tools: definitions });

    const text = textOf(response.content);
    if (text.length > 0) lastText = text;

    const uses = toolUsesOf(response.content);
    if (response.stop_reason !== 'tool_use' || uses.length === 0) {
      return { text: lastText, proposed, accepted, remembered, toolsCalled, iterations, haltedAtCeiling: false };
    }

    // Echo the assistant's own blocks back before the results — the tool-use
    // protocol requires the call and its result to sit in adjacent messages.
    messages.push({ role: 'assistant', content: response.content });

    const results: ToolResponseBlock[] = [];
    for (const use of uses) {
      toolsCalled.push(use.name);
      const tool = byName.get(use.name);
      if (tool === undefined) {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `No tool named "${use.name}" exists. Available: ${[...byName.keys()].join(', ')}.`,
          is_error: true,
        });
        continue;
      }

      let outcome: AgentToolOutcome;
      try {
        outcome = await tool.execute(use.input);
      } catch (err) {
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: `The ${use.name} tool failed: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
        continue;
      }

      if (outcome.type === 'remembered') {
        if (tool.kind !== 'remember') {
          throw new AgentLoopError(
            `tool "${use.name}" is declared "${tool.kind}" but wrote to the record — only a "remember" tool may do that`,
          );
        }
        remembered.push({ tool: use.name, items: outcome.items });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content:
            outcome.content ??
            `Recorded, as ${outcome.items.length === 1 ? 'one item' : `${outcome.items.length} items`}. ` +
              `This is now part of what the conversation has established and will be there next turn.`,
        });
        continue;
      }

      if (outcome.type === 'accepted') {
        // Only an `accept` tool may record consent. A propose or read tool
        // doing so would turn an offer into an agreement without the user,
        // which is the whole failure this layer exists to prevent.
        if (tool.kind !== 'accept') {
          throw new AgentLoopError(
            `tool "${use.name}" is declared "${tool.kind}" but recorded the user's consent — only an "accept" tool may do that`,
          );
        }
        accepted.push({ tool: use.name, proposal_id: outcome.proposal_id, summary: outcome.summary });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content:
            outcome.content ??
            `The user's agreement to "${outcome.summary}" is recorded against that exact proposal.`,
        });
        continue;
      }

      if (outcome.type === 'proposed') {
        // A read tool returning a proposal is a programming error, and a
        // silent one: it would put operations in front of a user under a name
        // that implies nothing was staged.
        if (tool.kind !== 'propose') {
          throw new AgentLoopError(
            `tool "${use.name}" is declared "${tool.kind}" but returned a proposal — only a "propose" tool may stage operations`,
          );
        }
        proposed.push({
          tool: use.name,
          summary: outcome.summary,
          operations: outcome.operations,
          ...(outcome.amends !== undefined ? { amends: outcome.amends } : {}),
        });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          content: proposalToolResult(outcome.summary, outcome.content),
        });
        continue;
      }

      results.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: outcome.content,
        ...(outcome.type === 'refused' ? { is_error: true } : {}),
      });
    }

    messages.push({ role: 'user', content: results });
  }

  // The ceiling stopped us. `lastText` may be mid-thought, so the caller is
  // told explicitly rather than left to present a truncated turn as finished.
  return { text: lastText, proposed, accepted, remembered, toolsCalled, iterations, haltedAtCeiling: true };
}
