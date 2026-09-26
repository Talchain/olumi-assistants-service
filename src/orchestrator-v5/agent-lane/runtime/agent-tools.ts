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
  /**
   * The user's own words in this conversation (its user messages, this turn's last), bound by the route — never
   * from model output. A figure is recorded as the user's only when it is written here (`stated-by-user.ts`);
   * absent, nothing is.
   */
  readonly user_text?: string;
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


/** The factors ONE option would change — shared by the single and the several-option forms of propose_new_option. */
const ACTS_ON = {
  type: 'array',
  description: 'The factors this option would change, and which way. At least one.',
  items: obj({
    factor_label: { type: 'string' },
    direction: {
      type: 'string', enum: ['positive', 'negative'],
      description: 'Whether this option pushes the factor up or down. State it; never guess it for the user.',
    },
    level: obj({
      value: { type: 'number', description: 'The figure the user stated FOR THIS FACTOR, in the factor\u2019s own units (e.g. 54 for \u00a354 on a price). A figure given for something else (a price, when this factor is a churn rate) is never this factor\u2019s level: leave level out. With no figure from the user, leave level out \u2014 never 0 or any placeholder to mean \u201cnot set\u201d \u2014 unless it is your OWN suggested figure for an option you suggested: then set estimate.' },
      unit: { type: 'string', description: 'The unit the user stated, if any.' },
      estimate: { type: 'boolean', description: 'true ONLY when this figure is your own suggestion, not the user\u2019s (an option you proposed, at the figure you proposed). It is recorded and shown as Olumi\u2019s estimate, never as the user\u2019s. Needs basis.' },
      basis: { type: 'string', description: 'With estimate: why this figure, in plain words the user can check.' },
    }, ['value']),
  }, ['factor_label', 'direction']),
};

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
      'proposal and returns its id, which you keep for authorise_change: show the user what it changes, never the id, before asking them to approve. ' +
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
  {
    type: 'function',
    name: 'build_model_from_brief',
    description:
      'Build the decision model from the user\u2019s brief when get_canonical_state reports the ' +
      'model is empty. Preserves the user\u2019s own facts, numbers and constraint wording, then ' +
      'adds the options, factors, risks and causal mechanisms that make the decision reasonable ' +
      'to analyse. Report honestly what it says was left out.',
    parameters: obj({
      brief: { type: 'string', description: 'The user\u2019s decision in their own words, verbatim.' },
    }, ['brief']),
  },
  {
    type: 'function',
    name: 'propose_assumptions',
    description:
      'Propose starting values for factors that have none, so the model can be reasoned about ' +
      'instead of sitting blank. This does NOT change anything: it records an exact proposal and ' +
      'returns its id, which you keep for authorise_change: show the user the values, never the id, before asking them to approve. Each value is ' +
      'the user\u2019s assumption to adopt or correct, NEVER a measurement \u2014 say so. Propose only ' +
      'factors the model actually has, using the labels get_canonical_state returned. ' +
      'A factor that already holds a value is left alone UNLESS you set `revise: true` on it, which ' +
      'you may do ONLY when the user has just asked for that factor to be changed and named the ' +
      'number themselves. Never set it to replace someone\u2019s figure with one of your own.',
    parameters: obj({
      assumptions: {
        type: 'array',
        description: 'The factors to give a starting value, with the reasoning for each.',
        items: obj({
          factor_label: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          basis: { type: 'string', description: 'Why this is a reasonable starting point, in the user\u2019s terms.' },
          revise: {
            type: 'boolean',
            description:
              'Set true ONLY when the user has just asked for this factor to be changed and gave the ' +
              'number. It permits replacing a value that is already there; the approval will show the ' +
              'user both the current value and the new one. Omit it in every other case.',
          },
        }, ['factor_label', 'value', 'unit', 'basis']),
      },
    }, ['assumptions']),
  },
  {
    type: 'function',
    name: 'propose_new_option',
    description:
      'Add an option the user has just asked for, when the model does NOT already have it. '
      + 'This does NOT change anything: it prepares ONE complete change and returns its id, which you keep for '
      + 'authorise_change: show the user the option and what it will be linked to, never the id, before asking them to approve. '
      + 'The option is linked from the decision automatically. Name the factors it would change, using the labels '
      + 'get_canonical_state returned. Give a level ONLY for a figure the user stated, in their own units; never invent one. '
      + 'A factor with no stated level is added with no level, and you say plainly what is still needed. '
      + 'When the user asks for SEVERAL options (up to 4), put them ALL in `options` in ONE call: they become ONE change the '
      + 'user approves once, and it lands whole or not at all. If an option changes something the model has NO factor for, '
      + 'add that factor in the SAME change with `new_factors` (never link the option to an unrelated factor instead), and name '
      + 'it in `acts_on`. Only for something the user asked the option to change; what it changes and which way come from the '
      + 'user\u2019s words, or where it is plain from the option itself \u2014 if unclear, ask. Once a call has prepared a change, never call it again in the '
      + 'same reply. A call that was REFUSED prepared nothing: you may call it once more in the same reply, corrected as the '
      + 'refusal says.',
    parameters: obj({
      label: { type: 'string', description: 'ONE option in the user\u2019s own words. For several, use `options` instead.' },
      acts_on: ACTS_ON,
      options: {
        type: 'array',
        description: 'Several options the user asked for (2 to 4), each with its own label and factors. One change, one approval.',
        items: obj({
          label: { type: 'string', description: 'The option in the user\u2019s own words.' },
          acts_on: ACTS_ON,
        }, ['label', 'acts_on']),
      },
      new_factors: {
        type: 'array',
        description: 'Factors the model does NOT have that these options change, added in this same change. Each is named in an option\u2019s acts_on.',
        items: obj({
          label: { type: 'string', description: 'The factor in the user\u2019s words (e.g. "AI add-on price").' },
          affects: {
            type: 'array',
            description: 'What this factor changes that the model already has (the goal, an outcome, a risk, or a factor no option sets), and which way. At least one.',
            items: obj({
              label: { type: 'string', description: 'A label exactly as get_canonical_state gives it.' },
              direction: { type: 'string', enum: ['positive', 'negative'], description: 'Whether raising this factor raises (positive) or lowers (negative) it. From the user; never guessed.' },
            }, ['label', 'direction']),
          },
        }, ['label', 'affects']),
      },
      rationale: { type: 'string', description: 'Why this option is worth comparing, in the user\u2019s terms.' },
    }, ['rationale']),
  },
  {
    type: 'function',
    name: 'propose_option_interventions',
    description:
      'Propose the level an option sets a factor to \u2014 what the option actually DOES. An option ' +
      'that names a factor without saying what it sets it to blocks the comparison for EVERY option, ' +
      'not just itself. Give the value in the factor\u2019s own units, as the user would say it ' +
      '(\u00a354, not 0.27). This changes nothing: it records an exact proposal and returns its id for ' +
      'authorise_change; show the user what it sets first, never the id. Propose only what the user\u2019s words support; if an option\u2019s level is ' +
      'not stated, offer one as an assumption and say so, exactly as with propose_assumptions.',
    parameters: obj({
      interventions: {
        type: 'array',
        items: obj({
          option_label: { type: 'string' },
          factor_label: { type: 'string' },
          value: { type: 'number', description: 'In the factor\u2019s own units \u2014 the number a user would say.' },
          basis: { type: 'string' },
          user_stated: {
            type: 'boolean',
            description:
              'Set true ONLY when the USER gave this level \u2014 their own number, for this option and factor. ' +
              'It records the level as theirs; without it the level is recorded as Olumi\u2019s estimate, so never ' +
              'set it on a figure you proposed. On an option in `status_quo_held` it is also what permits a level ' +
              'at all (the user said carrying on changes this factor), and never to restate the factor\u2019s ' +
              'starting value: carrying on as now already keeps that, so such a level is not recorded.',
          },
        }, ['option_label', 'factor_label', 'value', 'basis']),
      },
    }, ['interventions']),
  },
  {
    type: 'function',
    name: 'propose_starting_point',
    description:
      'Propose, as ONE exact proposal the user approves ONCE, both the starting values for factors that ' +
      'have none AND the level each option sets — everything a first comparison needs. Use this instead ' +
      'of propose_assumptions + propose_option_interventions whenever both are needed: two separate ' +
      'proposals cannot both be applied from one approval, because applying the first changes the model ' +
      'the second was made against. This changes nothing on its own. Every figure is the user’s ' +
      'assumption to adopt or correct, NEVER a measurement — say so. Values in the factor’s own units.',
    parameters: obj({
      assumptions: {
        type: 'array',
        description: 'Starting values for factors that have none. May be empty.',
        items: obj({
          factor_label: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          basis: { type: 'string' },
        }, ['factor_label', 'value', 'unit', 'basis']),
      },
      option_levels: {
        type: 'array',
        description: 'The level each option sets a factor to, in the factor’s own units. May be empty.',
        items: obj({
          option_label: { type: 'string' },
          factor_label: { type: 'string' },
          value: { type: 'number' },
          basis: { type: 'string' },
          user_stated: {
            type: 'boolean',
            description:
              'Set true ONLY when the USER gave this level \u2014 their own number, for this option and factor. ' +
              'It records the level as theirs; without it the level is recorded as Olumi\u2019s estimate, so never ' +
              'set it on a figure you proposed. On an option in `status_quo_held` it is also what permits a level ' +
              'at all (the user said carrying on changes this factor), and never to restate the factor\u2019s ' +
              'starting value: carrying on as now already keeps that, so such a level is not recorded.',
          },
        }, ['option_label', 'factor_label', 'value', 'basis']),
      },
    }, ['assumptions', 'option_levels']),
  },
];

export type ToolName = (typeof AGENT_TOOLS)[number]['name'];

/**
 * Preview mode: a READ-ONLY tool surface.
 *
 * ⛔ THE BOUNDARY IS STRUCTURAL, NEVER PROMPTED. A model told not to change
 * things is a model that usually does not change things. These tools are not
 * declared to it, `dispatchTool` refuses the names even if it invents them, and
 * the capabilities themselves refuse in preview. Three layers, none of which is
 * a sentence in an instruction block.
 *
 * Construction is NOT a mutation tool in this sense and stays available: it
 * creates the model for an empty preview scenario through the product's own
 * registration route, and without it a preview has nothing to talk about. It is
 * additionally refused over a scenario that already has entities.
 */
export const MUTATION_TOOLS: readonly string[] = ['propose_new_option', 'propose_model_change', 'propose_assumptions', 'propose_option_interventions', 'propose_starting_point', 'authorise_change'];

export type AgentLaneMode = 'full' | 'preview';

export function toolsFor(mode: AgentLaneMode): readonly ToolDefinition[] {
  if (mode !== 'preview') return AGENT_TOOLS;
  return AGENT_TOOLS.filter((t) => !MUTATION_TOOLS.includes(t.name));
}

/** Every tool result carries whether it changed anything, so nothing is implied. */
export interface ToolResult {
  readonly ok: boolean;
  readonly mutated: boolean;
  readonly [k: string]: unknown;
}

/**
 * Server-internal input to the level proposer — never read from tool arguments
 * (`dispatchTool` passes two). `startingValues`: factor id → the native figure
 * the SAME starting point proposes for it, so a held status-quo level that only
 * restates that figure is recognised before anyone is asked to approve it.
 */
export interface ProposeLevelsInternal {
  readonly startingValues?: ReadonlyMap<string, number>;
}

export interface AgentCapabilities {
  getCanonicalState(ctx: AgentToolContext): Promise<ToolResult>;
  proposeModelChange(ctx: AgentToolContext, args: {
    from_label: string; to_label: string; direction: 'positive' | 'negative'; rationale: string;
  }): Promise<ToolResult>;
  authoriseChange(ctx: AgentToolContext, args: { proposal_id: string }): Promise<ToolResult>;
  runAnalysis(ctx: AgentToolContext, args: { reason: string }): Promise<ToolResult>;
  buildModelFromBrief(ctx: AgentToolContext, args: { brief: string }): Promise<ToolResult>;
  proposeAssumptions(ctx: AgentToolContext, args: {
    // `revise` is in the tool's schema (above) and read by the capability (`a?.revise === true`); the type now says so.
    assumptions: readonly { factor_label: string; value: number; unit: string; basis: string; revise?: boolean }[];
  }): Promise<ToolResult>;
  proposeNewOption(ctx: AgentToolContext, args: {
    label?: string; acts_on?: { factor_label: string; direction: 'positive' | 'negative' }[]; rationale: string;
    /** Several options as ONE change (F4): each `{label, acts_on}`, up to 4. */
    options?: { label: string; acts_on: { factor_label: string; direction: 'positive' | 'negative' }[] }[];
    /** Factors the model lacks, added in the SAME change (`planNewFactors`): each named in an option's acts_on. */
    new_factors?: readonly { label: string; affects: readonly { label: string; direction?: 'positive' | 'negative' }[] }[];
  }): Promise<ToolResult>;
  proposeOptionInterventions(ctx: AgentToolContext, args: {
    interventions: readonly { option_label: string; factor_label: string; value: number; basis: string; user_stated?: boolean }[];
  }, internal?: ProposeLevelsInternal): Promise<ToolResult>;  proposeStartingPoint(ctx: AgentToolContext, args: {
    assumptions: readonly { factor_label: string; value: number; unit: string; basis: string }[];
    option_levels: readonly { option_label: string; factor_label: string; value: number; basis: string; user_stated?: boolean }[];
  }): Promise<ToolResult>;
}

export async function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: AgentToolContext,
  caps: AgentCapabilities,
  mode: AgentLaneMode = 'full',
): Promise<ToolResult> {
  // Second layer. A model can name a tool it was never given; this refuses it
  // before any capability is reached, and says so rather than failing quietly.
  if (mode === 'preview' && MUTATION_TOOLS.includes(name)) {
    return {
      ok: false, mutated: false, refusal: 'read_only_preview',
      detail: 'This preview cannot change the model. Nothing has been altered.',
    };
  }
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
    case 'build_model_from_brief':
      return caps.buildModelFromBrief(ctx, args as never);
    case 'propose_assumptions':
      return caps.proposeAssumptions(ctx, args as never);
    case 'propose_new_option':
      return caps.proposeNewOption(ctx, args as never);
    case 'propose_option_interventions':
      return caps.proposeOptionInterventions(ctx, args as never);
    case 'propose_starting_point':
      return caps.proposeStartingPoint(ctx, args as never);
    default:
      // An unknown tool is never silently ignored: the Agent is told plainly.
      return { ok: false, mutated: false, refusal: 'unknown_tool', tool: name };
  }
}
