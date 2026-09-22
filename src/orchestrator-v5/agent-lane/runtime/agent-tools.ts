/**
 * Agent lane — the tool surface handed to the Managed Agent.
 *
 * ⭐ THE AGENT OWNS TOOL CHOICE. These are declarations plus dispatch; nothing
 * here decides WHEN to call them. Olumi keeps canonical truth, admissibility,
 * authorisation, CAS/idempotency, persistence and analysis — every handler below
 * delegates to an existing Olumi capability and adds no logic of its own.
 *
 * ⛔ EVERY HANDLER RUNS IN THE AUTHENTICATED CONTEXT OF THE ORIGINATING REQUEST.
 * The Agent never supplies a scenario id or a user id: both are bound from the
 * turn's own verified identity before any tool runs. That is why this is a
 * server-side loop and not an MCP surface OpenAI calls from outside.
 */

export interface AgentToolContext {
  /** Bound from the request, never from model output. */
  readonly scenario_id: string;
  readonly authenticated_user_id: string | null;
  readonly request_id: string;
}

export interface ToolDefinition {
  readonly type: 'function';
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

const obj = (props: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: 'object', additionalProperties: false, properties: props, required,
});

export const AGENT_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_canonical_state',
    description:
      'Read the authoritative persisted decision model for this conversation: its entities, ' +
      'what each one is, which values are stated and which are unknown, and what the analysis ' +
      'currently says. Call this before describing the model. Never assume its contents.',
    parameters: obj({ reason: { type: 'string', description: 'Why you need it now.' } }, ['reason']),
  },
  {
    type: 'function',
    name: 'propose_model_change',
    description:
      'Propose ONE change to the model. This does NOT change anything: it records an exact ' +
      'proposal and returns its id, which you must show the user before asking them to approve. ' +
      'Use the labels exactly as get_canonical_state returned them.',
    parameters: obj({
      from_label: { type: 'string' },
      to_label: { type: 'string' },
      direction: { type: 'string', enum: ['positive', 'negative'] },
      rationale: { type: 'string', description: 'Why this link matters, in the user’s terms.' },
    }, ['from_label', 'to_label', 'direction', 'rationale']),
  },
  {
    type: 'function',
    name: 'authorise_change',
    description:
      'Apply a previously returned proposal. Call this ONLY after the user has explicitly ' +
      'approved that specific proposal in their own words. The stored proposal is applied — ' +
      'nothing is regenerated. Report exactly what the result says, including a refusal.',
    parameters: obj({ proposal_id: { type: 'string' } }, ['proposal_id']),
  },
  {
    type: 'function',
    name: 'run_analysis',
    description:
      'Run the decision analysis over the persisted model. It may refuse and explain what is ' +
      'missing; report that honestly rather than guessing what the result would have been.',
    parameters: obj({ reason: { type: 'string' } }, ['reason']),
  },
];

export type ToolName = (typeof AGENT_TOOLS)[number]['name'];

/** Every tool result carries whether it changed anything, so nothing is implied. */
export interface ToolResult {
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly [k: string]: unknown;
}

export interface AgentCapabilities {
  getCanonicalState(ctx: AgentToolContext): Promise<ToolResult>;
  proposeModelChange(ctx: AgentToolContext, args: {
    from_label: string; to_label: string; direction: 'positive' | 'negative'; rationale: string;
  }): Promise<ToolResult>;
  authoriseChange(ctx: AgentToolContext, args: { proposal_id: string }): Promise<ToolResult>;
  runAnalysis(ctx: AgentToolContext, args: { reason: string }): Promise<ToolResult>;
}

export async function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: AgentToolContext,
  caps: AgentCapabilities,
): Promise<ToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return { ok: false, mutated: false, refusal: 'unparsable_arguments' };
  }
  switch (name) {
    case 'get_canonical_state':
      return caps.getCanonicalState(ctx);
    case 'propose_model_change':
      return caps.proposeModelChange(ctx, args as never);
    case 'authorise_change':
      return caps.authoriseChange(ctx, args as never);
    case 'run_analysis':
      return caps.runAnalysis(ctx, args as never);
    default:
      // An unknown tool is never silently ignored: the Agent is told plainly.
      return { ok: false, mutated: false, refusal: 'unknown_tool', tool: name };
  }
}
