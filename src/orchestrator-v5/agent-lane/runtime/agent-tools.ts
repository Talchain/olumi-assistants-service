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
import type { ReconcileGoalScopeArgs } from '../reconcile-goal-scope.js';
import type { ProposalEditsRequest } from '../proposal-object/amend.js';
import { sendableQuery } from './public-research.js';
import { PROVISIONAL_VIEW_RULE } from '../provisional-view.js';

/**
 * ⭐ THE CANVAS'S WORD FOR THE LOWEST BAND IS "Slight" (Canvas #70 5847910497). The `strength` enum keeps the wire value
 * `weak`, but the user reads "Slight" on every link pill. Served on CEE `92c2e34`: told "the link … is slight", the model
 * asked "does slight mean weak?"; the user's "Yes." named no band, so it was refused, and the user was then told to say
 * "weak" — a word the canvas never shows. `bandTheUserWrote` already grounds "slight" (#2008); this tells the model so.
 */
/**
 * ⭐ THE USER'S OWN WORDS, PROPOSED AS A READING THEY APPROVE (slice C3; ruling ChatGPT 5854968869 P3B). Measured on
 * Paul's served transcript (27 Sep): "price sensitivity is very high" was refused twice, and recording "very strong"
 * took four turns. The capability admits the phrase only when it is written in THIS turn's typed words
 * (`wordsTheUserWrote`), so the Agent cannot invent it; the approve button shows the reading.
 */
export const FROM_WORDS_DESCRIPTION =
  'When the user described the strength in their own words rather than a band word, give their exact phrase here and your '
  + 'reading in `strength`; the user approves your reading. Copy it exactly from their message this turn (for example '
  + '"very high"); never a phrase they did not write.';
const FROM_WORDS = { type: 'string', description: FROM_WORDS_DESCRIPTION } as const;

export const SLIGHT_IS_WEAK =
  ' The canvas calls the lowest band Slight: when the user calls a link slight, that IS `weak` \u2014 pass `weak`, and never ask '
  + 'whether slight means weak. When you ask the user for a band, use the canvas\u2019s words: slight, moderate, strong or very strong.';

/**
 * \u26d4 PJ-C3: A FACTOR'S SIZE IS THE LINK OUT OF IT (R&C root #70 5860219371, words verbatim; DL route 5860238223). Asked
 * "price sensitivity is very high", the Agent recorded the link INTO the node (Pro plan price \u2192 Price sensitivity) in 4
 * of 5 served journey-A runs; the one PASS recorded the link OUT of it (Price sensitivity \u2192 Monthly churn, 0.0075).
 * A node's "size" is how strongly it moves what it affects. The tool took a from/to and had no rule for a statement
 * about a node, so the model picked the edge that feeds it.
 */
export const NODE_SIZE_MEANS_LINK_FROM =
  'When the user says how big a factor or risk IS (\'price sensitivity is very high\'), they mean how strongly it moves '
  + 'what it affects: the link FROM it, to the outcome they name or imply. If it has several and they named none, ask which.';

/**
 * ⛔ PJ-C3 — THE USER'S BAND MUST REACH THE OUTCOME THEY NAME (DL #72 5864154474; Runtime re-land of the reverted #2183,
 * with no domain example). Served, the Agent sized the link INTO a node: into the node named for what they sized
 * (price → "Price-sensitive customer loss", `pj-20260928T052306Z`) or into a node between cause and outcome (price →
 * "Price-driven churn", `…053022Z`). Either way, the node's own link on to churn stayed Olumi's estimate, so their
 * "very high" never reached churn.
 */
export const THE_BAND_MUST_REACH_THE_OUTCOME =
  'Their band must reach the outcome they name, and a link INTO a node never does: that node\u2019s own link on stays '
  + 'Olumi\u2019s estimate. If a node is named for what they sized (a qualifier such as "risk" or "loss" still counts), record '
  + 'the link FROM it to that outcome. If none is, record the link from its cause straight to that outcome, proposing it with '
  + 'propose_model_change at their band if the model lacks it.';

/**
 * ⛔ THE CARVE-OUT (DL CHANGES_REQUIRED on #2153, words verbatim): "how big a factor IS" also matches a FIGURE for the
 * factor itself ("churn is 6%"). That is the factor's value (`propose_assumptions`), never a link strength.
 */
export const A_FIGURE_IS_THE_FACTORS_VALUE =
  'A figure for the factor itself (e.g. \'churn is 6%\') is its value, not a link.';

/**
 * ⛔ A LEVEL'S LINK IS NOT A STRENGTH TO ASK ABOUT (AI Conversation #70 5849437163 U2b, served c35801a): the user gave
 * "it lowers Monthly churn to 6%" for an option not yet linked to churn; the model left that level out and asked "how
 * strong is that effect" — the band question that belongs to a CAUSAL link between factors. A level on an unlinked
 * factor brings its own option → factor link in the same change (`link_for_level`, no strength), so it is sent as is.
 */
export const LEVEL_BRINGS_ITS_LINK =
  ' A level on a factor the option is not linked to yet brings that link with it, in the same change: the link only says the '
  + 'option acts on that factor, so never ask how strong it is — send the level the user gave.';

/**
 * ⛔ A RISK IS NOT A MEDIATOR (Canonical #70 5855234599): it links TO the goal or an outcome it threatens and FROM the
 * factors that drive it — never INTO a factor. The door refuses any other pair; this tells the model before it asks.
 */
export const RISK_LINKS_RULE =
  'A risk links TO the goal or an outcome it threatens (`affects`, at least one) and FROM factors that drive it (`caused_by`, '
  + 'optional) \u2014 never into a factor: a risk affects the goal or an outcome, not a factor directly.';

export interface AgentToolContext {
  /** Bound from the request, never from model output. */
  readonly scenario_id: string;
  readonly authenticated_user_id: string | null;
  readonly request_id: string;
  /** RT-1 selection, resolved from the REQUEST against canonical state, never tool args or model output. */
  readonly grounded_selection?: { readonly element_ids: readonly string[]; readonly unresolved: 'none' | 'not_in_model' | 'could_not_check' };
  /** The drawn tuple resolved by the host press, never model output. */
  readonly drawn_link?: { readonly press_id: string; readonly from: string; readonly to: string };
  readonly grounded_links?: readonly { readonly from: string; readonly to: string }[];
  /** RC3: bound only by a re-minted widen Add press, outside every model-authored tool argument. */
  readonly widen_relies_on?: { readonly option_id: string };
  /**
   * The user's own words in this conversation (its user messages, this turn's last), bound by the route — never
   * from model output. A figure is recorded as the user's only when it is written here (`stated-by-user.ts`);
   * absent, nothing is.
   */
  readonly user_text?: string;
  /**
   * THIS turn's message when the user typed it (never a chip's text), bound by the route. A link's strength band is
   * the user's only when named here (`bandTheUserWrote`): a band word elsewhere in the conversation is about something else.
   */
  readonly user_turn_text?: string;
  /**
   * The proposal THIS request's typed approve chip names (`typedApprovalOf`), bound by the route — never model output.
   * A link's stated effect is written only from that button, which shows the exact reading it records (PR Review's
   * fifth CR on #2275): a free-text "yes" to the model never records it.
   */
  readonly typed_approval_of?: string;
  /** That chip's words, bound only when a card for the proposal is on offer: a link-effect card's words carry its reading. */
  readonly typed_approval_words?: string;
  /**
   * ⭐ S-D: the values the user set in the change's panel, sent WITH that card's press and bound by the route to it —
   * never model output. Only a held product proposal (`gmh_`) takes them in slice 1.
   */
  readonly proposal_edits?: ProposalEditsRequest;
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

const UNMODELLED_MECHANISMS = {
  type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 80 },
  description: 'Unresolved effects this option does not yet model. Omit to preserve its existing gaps; [] explicitly requests clearing them. '
    + 'The user must approve the complete named gap statement, including the current gaps and questions it replaces.',
};


/**
 * PJ-C1 latency (#70 5859918872): the model's own typed word that this ONE call is everything the user asked for in
 * this message. Only then may the reply be composed from the call's result with no narrating call (proposal-reply.ts);
 * absent or false keeps today's second call, so a message asking for two things never loses the second.
 */
const WHOLE_REQUEST = {
  type: 'boolean',
  // Words: AI Conversation #70 5860022029.
  description: 'true ONLY when this one call does everything the user asked for in their latest message: no other change to make, no question to answer, nothing else to explain. If there is anything more, or you are unsure, false.',
} as const;

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
    level: {
      ...obj({
        value: { type: 'number', description: 'The figure the user stated FOR THIS FACTOR, in the factor\u2019s own units (e.g. 54 for \u00a354 on a price). A figure given for something else (a price, when this factor is a churn rate) is never this factor\u2019s level: leave level out. With no figure from the user, leave level out \u2014 never 0 or any placeholder to mean \u201cnot set\u201d \u2014 unless it is your OWN suggested figure for an option you suggested: then set estimate.' },
        unit: { type: 'string', description: 'The unit the user stated, if any.' },
        estimate: { type: 'boolean', description: 'true ONLY when this figure is your own suggestion, not the user\u2019s (an option you proposed, at the figure you proposed). It is recorded and shown as Olumi\u2019s estimate, never as the user\u2019s. Needs basis.' },
        basis: { type: 'string', description: 'With estimate: why this figure, in plain words the user can check.' },
      }, ['value']),
      // ⛔ Where the model writes a level (OpenAI Runtime #70 5859406197): the switch rule sat only on new_factors.kind.
      description: 'The level this option sets the factor to. Never give a level for a factor you add in new_factors with '
        + 'kind \'switch\': a switch has no level of its own \u2014 the option turns it on.',
    },
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
      'Use the labels exactly as get_canonical_state returned them. ' +
      'On a host-bound drawn_link press ONLY, propose your own band, direction and one-line reason for that exact pair, shown as Olumi\u2019s estimate. For every other turn, the link is recorded with `strength` as the user\u2019s own estimate, so give ONLY the band the user named for it in this message; ' +
      'if they described it in their own words ("very high"), give your reading in `strength` and their exact phrase in `from_words`, and show it; ' +
      'if they named none, ask how strong the effect is first \u2014 a band they did not say is refused.' + SLIGHT_IS_WEAK,
    parameters: obj({
      from_label: { type: 'string' },
      to_label: { type: 'string' },
      direction: { type: 'string', enum: ['positive', 'negative'] },
      strength: {
        type: 'string', enum: ['weak', 'moderate', 'strong', 'very strong'],
        description: 'The band the user said for this link in THIS message, in their own words \u2014 or your reading of their own words, given with `from_words`. Only for the host-bound drawn_link pair, your own Olumi estimate is allowed.',
      },
      reason: { type: 'string', maxLength: 140, description: 'For a host-bound drawn link: one short plain line explaining your estimate, with no figures.' },
      from_words: FROM_WORDS,
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
    name: 'withdraw_proposal',
    description:
      'Withdraw a change you proposed earlier in THIS turn that you now think is wrong, before you reply. It is never applied '
      + 'and no approve button is shown. Never ask the user not to approve a change you leave offered. '
      + 'An unresolved goal reading (goal-scope: ID) may also be withdrawn, but only when the user writes exactly '
      + '"Withdraw this unresolved goal reading: <goal_id>". Otherwise retain its question.',
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
      whole_request: WHOLE_REQUEST,
    }, ['brief']),
  },
  {
    type: 'function',
    name: 'propose_assumptions',
    description:
      'Propose starting values for factors that have none, so the model can be reasoned about ' +
      'instead of sitting blank. This does NOT change anything: it records an exact proposal and ' +
      'returns its id, which you keep for authorise_change: show the user the values, never the id, before asking them to approve. Each value is ' +
      'an assumption for the user to adopt or correct, NEVER a measurement \u2014 say so; a value the result marks ' +
      '`your_figure` is the user\u2019s own figure, never called an assumption. Propose only ' +
      'factors the model actually has, using the labels get_canonical_state returned. ' +
      'A factor that already holds a value is left alone UNLESS you set `revise: true` on it, which ' +
      'you may do ONLY when the user has just asked for that factor to be changed and named the ' +
      'number themselves. Never set it to replace someone\u2019s figure with one of your own. ' +
      // PTL decision #78 5921683490 (AIQ ruling #75 5921113788): the Agent once scripted "Set Warm introductions to 2 per
      // month" for the user to type — stored as the user's own override and shown "Set by you", laundering Olumi's figure.
      'When the user asks to revise an existing value without supplying a replacement figure, ask what figure they ' +
      'would use; never supply a number or an instruction for them to repeat as their own. ' +
      'When the user says Olumi\u2019s current estimate for a factor is right and should stay, set `keep: true` on it ' +
      'instead: nothing changes, and their approval records that they accepted Olumi\u2019s estimate.',
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
          keep: {
            type: 'boolean',
            description:
              'Set true ONLY when the user has just said Olumi\u2019s CURRENT figure for this factor is right and should ' +
              'stay. The stored figure is kept exactly (give it as value); it stays Olumi\u2019s estimate and the approval ' +
              'records that the user accepted it. Never on the user\u2019s own figure or one from their brief, never with a ' +
              'different number, and never in the same call as other values. Omit it in every other case.',
          },
        }, ['factor_label', 'value', 'unit', 'basis']),
      },
    }, ['assumptions']),
  },
  {
    type: 'function',
    name: 'propose_new_option',
    description:
      'Add an option the user has just asked for. If its exact label already identifies a stored option marked `proposed_by: olumi`, call this tool with that label and no edits to offer adoption of the SAME option into their comparison. Its Olumi origin and suggested levels remain labelled as Olumi\'s; do not call it an existing user option or a user-stated figure. '
      + 'This does NOT change anything: it prepares ONE complete change and returns its id, which you keep for '
      + 'authorise_change: show the user the option and what it will be linked to, never the id, before asking them to approve. '
      + 'The option is linked from the decision automatically. Name the factors it would change, using the labels '
      + 'get_canonical_state returned. Give a level for a figure the user stated, in their own units; for an option YOU suggested you may give '
      + 'your own suggested figure with estimate: true and a basis, recorded and shown as Olumi\u2019s estimate. Never a placeholder. '
      + 'A factor with no level is added with no level, and you say plainly what is still needed. '
      + 'When the user asks for SEVERAL options (up to 4), put them ALL in `options` in ONE call: they become ONE change the '
      + 'user approves once, and it lands whole or not at all. If an option changes something the model has NO factor for, '
      + 'add that factor in the SAME change with `new_factors` (never link the option to an unrelated factor instead), and name '
      + 'it in `acts_on`. Only for something the user asked the option to change; what it changes and which way come from the '
      + 'user\u2019s words, or where it is plain from the option itself (a paid add-on adds revenue); if it is unclear, ask. Once a call has prepared a change, never call it again in the '
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
              direction: { type: 'string', enum: ['positive', 'negative'], description: 'Whether raising this factor raises (positive) or lowers (negative) it: from the user\u2019s words, or where it is plain from the option itself (a paid add-on adds revenue); if it is unclear, ask. The preview names it so the user can correct it.' },
            }, ['label', 'direction']),
          },
          kind: {
            type: 'string', enum: ['switch', 'graded'],
            description: '"switch" when the option simply turns this ON \u2014 something not in place today that the option puts in place '
              + '(grandfathering existing customers, launching a feature). It is then added as off today, Olumi\u2019s reading for the user '
              + 'to correct, and on under every option that acts on it: give it no level. Leave kind out for an amount or a rate '
              + '(a price, a share of customers): its current value is `today` when the user stated it, otherwise asked for, '
              + 'and the option\u2019s level is asked for.',
          },
          // ⭐ PJ-A1 £49 (DL #70 5860365834): the status quo of a factor the Agent adds is its level today — the user's, or none.
          today: {
            ...obj({
              value: { type: 'number', description: 'The figure the user stated for this factor TODAY, in their own units (e.g. 49 for \u201cfrom \u00a349 to \u00a359\u201d on a price).' },
              unit: { type: 'string', description: 'The unit the user stated it in.' },
            }, ['value']),
            description: 'For a factor you add, give today\u2019s level ONLY if the user stated it in their own words (e.g. a price '
              + 'they said moves "from \u00a349" is \u00a349 today). Never your own estimate, never a placeholder or 0: with no figure '
              + 'from the user, leave today out and ask for it. Never for a switch.',
          },
        }, ['label', 'affects']),
      },
      rationale: { type: 'string', description: 'Why this option is worth comparing, in the user\u2019s terms.' },
      whole_request: WHOLE_REQUEST,
    }, ['rationale']),
  },
  {
    type: 'function',
    name: 'propose_link_effect',
    description:
      'Record how much an EXISTING link moves its target, as the user\u2019s own figures, when the user has just said it in numbers '
      + '(for example "every \u00a31 on the price loses us about 50 subscribers"). This does NOT change anything: it prepares ONE change and '
      + 'returns its id, which you keep for authorise_change: show the user what it records, never the id, before they approve. '
      + 'Both magnitudes must be the user\u2019s own figures in ONE statement from THIS message. Deterministic number words '
      + 'are accepted ("two", "one and a half", "half a point", "about a point"); explicit percent levels such as '
      + '"from 8% to 4%" state a -4-point change. Never choose a figure from a range or invent a missing figure. '
      + '`amount` is your proposed signed change in the TARGET (negative when it falls); `per_source_change` is your '
      + 'proposed signed change in the SOURCE, each in its own unit. The approval card shows this reading in symbols '
      + 'AND words, with the verbatim quote, and explicitly discloses a reversal of the stored link direction. '
      + '`quote` is the user\u2019s complete statement copied exactly. It must identify both ends, unless the REQUEST\u2019s '
      + 'canvas selection grounds this link or both ends; do not infer selection from your own output. A question or '
      + 'denial is not a statement. A bare % needs the returned clarification: never resolve it yourself into points '
      + 'or a money change. A literal currency period ("per month", "a month", "a week", "a year") can supply an '
      + 'eligible unitless end\u2019s unit. Show the exact card and ask the user to approve or correct; nothing is recorded '
      + 'without approval. For a strength said in words ("strong"), use propose_link_strength. When several links need '
      + 'sizes, ask for them in ONE message; when the user supplies several sizes, call propose_link_effect ONCE with all of them.',
    parameters: {
      ...obj({
      links: { type: 'array', minItems: 1, maxItems: 12, description: 'Several existing links to size in one approval; use instead of the single-link fields when the user gave several figures.', items: obj({
        from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
        to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
        amount: { type: 'number', description: 'The signed target change.' }, amount_unit: { type: 'string', description: 'The target unit.' },
        per_source_change: { type: 'number', description: 'The signed source change this is per.' }, per_source_change_unit: { type: 'string', description: 'The source unit.' },
        quote: { type: 'string', description: 'The exact user words for this link.' },
      }, ['from_label', 'to_label', 'amount', 'amount_unit', 'per_source_change', 'per_source_change_unit', 'quote']), },
      from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
      to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
      amount: { type: 'number', description: 'Your proposed signed reading of the user\u2019s target magnitude (negative when it falls), disclosed on the approval card.' },
      amount_unit: { type: 'string', description: 'The target\u2019s unit (for a percentage level, "percentage points").' },
      per_source_change: { type: 'number', description: 'Your proposed signed reading of the user\u2019s source magnitude (non-zero), disclosed on the approval card.' },
      per_source_change_unit: { type: 'string', description: 'The source\u2019s unit.' },
      quote: { type: 'string', description: 'The user\u2019s complete statement from THIS message, copied exactly with its punctuation.' },
      }, []),
      oneOf: [
        { required: ['links'] },
        { required: ['from_label', 'to_label', 'amount', 'amount_unit', 'per_source_change', 'per_source_change_unit', 'quote'] },
      ],
    },
  },
  {
    type: 'function',
    name: 'propose_link_strength',
    description:
      'Record how strong an EXISTING link is, as the user\u2019s own estimate, when the user has just said it (for example '
      + '"that effect is strong", or "it actually pushes the other way"). This does NOT change anything: it prepares ONE change '
      + 'and returns its id, which you keep for authorise_change: show the user what it records, never the id, before they approve. '
      + NODE_SIZE_MEANS_LINK_FROM + ' ' + A_FIGURE_IS_THE_FACTORS_VALUE + ' ' + THE_BAND_MUST_REACH_THE_OUTCOME + ' '
      + 'The user\u2019s word is one of Olumi\u2019s strength bands. If the link already sits in that band, its strength is kept and only '
      + 'their review is recorded: it stays Olumi\u2019s estimate unless it was already theirs; otherwise it is set to the middle of that band, and the result says the figure so you can tell them. '
      + 'Give `direction` ONLY when the user said the link pushes the other way. When they described the strength in their own words '
      + '("very high", "hardly at all"), give your reading in `strength` and their exact phrase in `from_words`: the user approves your reading. '
      + 'Never use this for a strength the user did not state: if they said nothing about how strong it is, ask which band it is first '
      + '\u2014 a band they did not say is refused.' + SLIGHT_IS_WEAK,
    parameters: obj({
      from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
      to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
      strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'very strong'], description: 'The strength the user stated, or your reading of their own words, given with `from_words`.' },
      from_words: FROM_WORDS,
      direction: { type: 'string', enum: ['positive', 'negative'], description: 'ONLY when the user said the link pushes the other way, with their words in `direction_from_words`. Leave it out otherwise: the link keeps its direction.' },
      direction_from_words: { type: 'string', description: 'With `direction`: the user\u2019s exact words in THIS message saying the link runs the other way. A reversal without them is refused.' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['from_label', 'to_label', 'strength', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_link_strengths',
    description:
      'Record the strengths of SEVERAL existing links as ONE change the user approves once \u2014 never one approval per link. '
      + 'Use it when the user gives strengths for more than one link in one message, or asks Olumi to size links for them '
      + '(they ask what you recommend, then agree to it). This does NOT change anything: it prepares ONE change and returns its id, '
      + 'which you keep for authorise_change: show the user what each link will hold, never the id, before they approve. '
      + 'A link is recorded as the user\u2019s own ONLY when its `from_words` are the user\u2019s exact words from THIS message naming that link '
      + '(one of its ends) AND its band; naming the band a link already sits in keeps it as it is. '
      + 'Every other link is recorded as OLUMI\u2019S ESTIMATE, applied with their approval \u2014 never as theirs \u2014 and you must say which are which. '
      + 'Directions are kept: a link the user says runs the other way is propose_link_strength, one link at a time. '
      + 'A strength the user set themselves is never replaced by an estimate. The set is written whole or not at all.' + SLIGHT_IS_WEAK,
    parameters: obj({
      links: {
        type: 'array', minItems: 1, maxItems: 12,
        description: 'Every link in the set, each once.',
        items: obj({
          from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
          to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
          strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'very strong'], description: 'The band the user named for this link, or Olumi\u2019s estimate when they did not.' },
          from_words: { type: 'string', description: 'ONLY when the user named this link\u2019s band: their exact words from THIS message that name this link (one of its ends) and the band. Leave it out for Olumi\u2019s estimate.' },
        }, ['from_label', 'to_label', 'strength']),
      },
      rationale: { type: 'string', description: 'What the user asked for, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['links', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_goal_target',
    description:
      'Set the goal’s success target to the figure the user has just stated (for example "we need at least £60k MRR", '
      + '"keep churn under 5%"). This does NOT change anything: it prepares ONE change and returns its id, which you keep for '
      + 'authorise_change: show the user what it sets, never the id, before they approve. Give the figure exactly as the user '
      + 'wrote it, in their units (60000, with the unit £, for £60k), and whether they said at least or at most. Never use this '
      + 'for a figure or a direction the user did not state: if they have not given both in their own words, ask first — '
      + 'a figure or direction they did not state is refused. If the user ALSO stated the goal’s level today (for example "we have secured '
      + '£0 so far and need at least £1m"), pass it as current_level: both go on ONE card and are written on ONE approval. '
      + 'Never promise to record today’s level later: without current_level nothing records it. '
      + 'When the target is DERIVED from a figure the user gave ("we\u2019re at £100,000 … aiming to double that"), give the '
      + 'result as value and pass derived_from {base, multiplier} (100000 and 2): the base must be a figure they wrote. '
      + 'When the user did not say at least or at most, give your reading in constraint_type: the card offers it as a '
      + 'decision with the other direction beside it, and the user chooses.',
    parameters: obj({
      constraint_type: { type: 'string', enum: ['at_least', 'at_most'], description: 'at_least when the user said the goal must reach at least the figure; at_most when they said it must stay at or under it.' },
      value: { type: 'number', description: 'The figure the user stated, in their own units.' },
      unit: { type: 'string', description: 'The unit of that figure, as the user gave it (for example £, % or customers).' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      derived_from: obj({
        base: { type: 'number', description: 'The figure the user wrote that the target is derived from, in their units (100000 for "£100,000").' },
        multiplier: { type: 'number', description: 'The multiple they asked for: 2 for "double that", 3 for "triple", 0.5 for "halve".' },
      }, ['base', 'multiplier']),
      current_level: obj({
        value: { type: 'number', description: 'The goal’s level TODAY, exactly as the user stated it in their units (0 for "we have secured £0 so far").' },
        unit: { type: 'string', description: 'The unit the user gave it in (for example £).' },
      }, ['value', 'unit']),
    }, ['constraint_type', 'value', 'unit', 'rationale']),
  },
  {
    type: 'function', name: 'propose_team_time',
    description: 'Propose the time today’s team would take to finish the event deliverable, after its deadline is held. Read the duration from THIS user message only and express it as low_months and high_months; convert weeks or years to months (weeks may be rounded to two decimals here; the server keeps the exact conversion). A single time (about 8 months means both 8) is kept only as the most likely time; the chance remains withheld until the user gives a range. Never use recruitment time, a historical duration or an earlier message. This prepares a card; authorise_change writes it only after approval.',
    parameters: obj({ low_months: { type: 'number', exclusiveMinimum: 0 }, high_months: { type: 'number', exclusiveMinimum: 0 } }, ['low_months', 'high_months']),
  },
  {
    type: 'function',
    name: 'propose_goal_deadline',
    description:
      'Record the DEADLINE the user has stated for their goal ("we have a deadline in 6 months", "by Q2", "by the end of March", '
      + '"7 April 2027"), as a date on the goal. Call it in the SAME turn the user states it, even beside another change they ask for. '
      + 'Give deadline_words EXACTLY as the user wrote the deadline phrase (for example "a deadline in 6 months"): Olumi works out the '
      + 'calendar date itself, from today, and the card asks the user to confirm it ("Is your deadline 7 April 2027 (6 months from '
      + 'today)?"). Never compute or state a date yourself, and never pass a duration that is not the deadline (for example how long '
      + 'recruitment takes). This does NOT change anything: it prepares ONE change and returns its id, which you keep for '
      + 'authorise_change once the user agrees; never show the id.',
    parameters: obj({
      deadline_words: { type: 'string', maxLength: 80, description: 'The user\u2019s own words for the deadline, verbatim (for example "a deadline in 6 months" or "end of Q2").' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
    }, ['deadline_words', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_option_status',
    description:
      'Take ONE option out of the comparison, or put it back, when the user asks (for example "drop carry on as now", '
      + '"we can\u2019t do option B, take it out", "put option B back"). The baseline (carry on as now) can be taken out too. '
      + 'This does NOT change anything: it prepares ONE change and returns its id, which you keep for authorise_change: '
      + 'show the user what it does, never the id, before they approve. The option stays in their model with its wording; '
      + 'only whether it is compared changes. Use `removed` when they want it out, `infeasible` when they say it cannot be '
      + 'done, `feasible` to put it back. Never use it to delete an option, and never for Olumi\u2019s own suggestion '
      + 'the user has not added.',
    parameters: obj({
      option_label: { type: 'string', description: 'The option exactly as get_canonical_state names it.' },
      status: { type: 'string', enum: ['removed', 'infeasible', 'feasible'], description: 'removed = out of the comparison; infeasible = cannot be done, out of the comparison; feasible = back in.' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
    }, ['option_label', 'status', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_new_risk',
    description:
      'Add a RISK the user has just asked for, when the model does NOT already have it: something that could go wrong and would '
      + 'hurt the goal or an outcome (for example \u201ccompetitors respond to our price rise\u201d). This does NOT change anything: it '
      + 'prepares ONE complete change and returns its id, which you keep for authorise_change: show the user the risk, what it '
      + 'threatens and what drives it, never the id, before asking them to approve. ' + RISK_LINKS_RULE + ' How strongly each '
      + 'link acts is not known yet: Olumi records a placeholder strength, not an estimate \u2014 say so. Use the labels exactly as the '
      + 'CURRENT MODEL STATE gives them.',
    parameters: obj({
      label: { type: 'string', description: 'The risk in the user\u2019s own words (e.g. "Competitive response").' },
      affects: {
        type: 'array',
        description: 'What the risk threatens: the goal or an outcome in the model, and which way. At least one. Never a factor.',
        items: obj({
          target_label: { type: 'string', description: 'The goal or an outcome, exactly as the CURRENT MODEL STATE labels it.' },
          direction: { type: 'string', enum: ['positive', 'negative'], description: 'negative when the risk lowers it (the usual case); from the user\u2019s words, never a guess.' },
        }, ['target_label', 'direction']),
      },
      caused_by: {
        type: 'array',
        description: 'Factors in the model that drive the risk, and which way (optional).',
        items: obj({
          factor_label: { type: 'string', description: 'A factor exactly as the CURRENT MODEL STATE labels it.' },
          direction: { type: 'string', enum: ['positive', 'negative'], description: 'positive when raising the factor makes the risk more likely.' },
        }, ['factor_label', 'direction']),
      },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['label', 'affects', 'rationale']),
  },
  // PJ-E-FIG (DL #72 5866036457): the add-risk door's twin for new factors carrying the user's figures. Text kept minimal:
  // every character here is sent on every turn (C1 latency).
  {
    type: 'function',
    name: 'propose_new_factor',
    description:
      'Add 1\u20133 NEW factors whose figures the user just stated (e.g. \u201cseniors cost \u00a3120k a year each\u201d), each figure '
      + 'recorded as theirs, as ONE change. Prepares only: show the factors and figures, never the id, then authorise_change once '
      + 'they agree. A factor the model has already: propose_assumptions.',
    parameters: obj({
      factors: {
        type: 'array', minItems: 1, maxItems: 3,
        items: obj({
          label: { type: 'string' },
          unit: { type: 'string', description: 'The user\u2019s unit, e.g. "GBP/year per engineer".' },
          today: obj({ value: { type: 'number', description: 'Whole units: 120000 for \u00a3120k.' }, unit: { type: 'string' } }, ['value']),
          affects: { type: 'string', description: 'ONE existing outcome, or a factor no option sets, that it drives, as the CURRENT MODEL STATE labels it.' },
          direction: { type: 'string', enum: ['positive', 'negative'] },
        }, ['label', 'unit', 'today', 'affects', 'direction']),
      },
      rationale: { type: 'string' },
      whole_request: WHOLE_REQUEST,
    }, ['factors', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_new_limit',
    description: 'Prepare ONE budget ceiling the user stated in THIS message, on an existing money quantity. '
      + 'Call in the same turn as “we only have £200,000”, “our budget is £200k” or “we cannot spend more than £200,000”. '
      + 'Use the quantity’s exact label and the user’s figure in its own units. No level or option cost is written. '
      + 'An existing limit routes to propose_limit_change. No matching quantity means no card: say the returned line, with no invented chip. '
      + 'Show the returned card exactly; a held-back reserve is offered as an alternative, never silently deducted. '
      + 'Nothing changes until authorise_change after approval.',
    parameters: obj({
      quantity_label: { type: 'string', description: 'Exact existing quantity label, for example Total cost.' },
      value: { type: 'number', description: 'The figure the user wrote, in the quantity’s own units.' },
      rationale: { type: 'string' },
    }, ['quantity_label', 'value', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_limit_change',
    description:
      'Change the figure of a LIMIT the model already holds (one listed under `limits` in the CURRENT MODEL STATE) when the user '
      + 'has just stated its new figure (for example \u201cthe budget is now \u00a330k\u201d). This does NOT change anything: it prepares ONE '
      + 'change and returns its id, which you keep for authorise_change: show the user the limit, its current figure and the new one, '
      + 'never the id, before they approve. Give the figure exactly as the user wrote it, in the limit\u2019s own unit (30000 for \u00a330k). '
      + 'The limit keeps its unit and meaning; only its figure changes, recorded as the user\u2019s. It never adds a limit, and never '
      + 'sets the goal\u2019s own target (that is propose_goal_target). A figure the user did not write is refused.',
    parameters: obj({
      limit_label: { type: 'string', description: 'The limit\u2019s `on` label exactly as the CURRENT MODEL STATE lists it under limits.' },
      operator: { type: 'string', enum: ['<=', '>='], description: 'The limit\u2019s operator exactly as the state lists it.' },
      new_value: { type: 'number', description: 'The new figure the user stated, in the limit\u2019s own unit.' },
      stated_operator: { type: 'string', enum: ['<', '<=', '>', '>='], description: 'Only when the user states the comparator in this message: '
        + '< for less than or under, <= for at most, > for more than, >= for at least. Omit it for a new figure alone: the limit keeps its own.' },
      unit: { type: 'string', description: 'The unit the user wrote the figure in, if any.' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['limit_label', 'operator', 'new_value', 'rationale']),
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
      'not stated, offer one as an assumption and say so, exactly as with propose_assumptions.' + LEVEL_BRINGS_ITS_LINK,
    parameters: obj({
      interventions: {
        type: 'array',
        items: obj({
          option_label: { type: 'string' },
          factor_label: { type: 'string' },
          value: { type: 'number', description: 'In the factor\u2019s own units \u2014 the number a user would say.' },
          unit: { type: 'string', description: 'The unit the user wrote this figure in, if any (\u00a3 per month for \u201c\u00a310 per month\u201d).' },
          basis: { type: 'string' },
          unmodelled_mechanisms: UNMODELLED_MECHANISMS,
          user_stated: {
            type: 'boolean',
            description:
              'Set true ONLY when the USER gave this level \u2014 their own number, for this option and factor. ' +
              'It records the level as theirs; without it the level is recorded as Olumi\u2019s estimate, so never ' +
              'set it on a figure you proposed. On an option in `status_quo_held` it is also what permits a level ' +
              'at all (the user said carrying on changes this factor), and never to restate the factor\u2019s ' +
              'starting value: carrying on as now already keeps that, so such a level is not recorded.',
          },
          likely_low: {
            type: 'number',
            description:
              'Only with user_stated, and only when the user gave a range for this level: its low end, in the same ' +
              'units as value. Never a range you made up. Send it with likely_high, range_meaning and range_user_stated.',
          },
          likely_high: { type: 'number', description: 'The high end of that same range. Send it with likely_low.' },
          range_meaning: {
            type: 'string',
            enum: ['likely_range', 'min_max', 'at_most', 'at_least', 'other'],
            description:
              'How the user meant that range. likely_range ONLY for a plain likely range (\u201clikely between 5 and 20 ' +
              'days\u201d), which Olumi reads as the middle half of what\u2019s likely. min_max for the lowest and highest ' +
              'possible; at_most / at_least for a bound; other for anything else (e.g. a 95% confidence interval). ' +
              'Only likely_range is recorded; for the rest, tell the user and ask for their likely range.',
          },
          range_user_stated: {
            type: 'boolean',
            description: 'Set true ONLY when the USER gave this range (both ends) for this option and factor.',
          },
        }, ['option_label', 'factor_label', 'value', 'basis']),
      },
      whole_request: WHOLE_REQUEST,
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
      'the second was made against. This changes nothing on its own. Every figure you propose is an ' +
      'assumption for the user to adopt or correct, NEVER a measurement — say so; one the result marks `your_figure` or ' +
      '`stated_by: \'user\'` is the user’s own figure, never called an assumption. Values in the factor’s own units.' + LEVEL_BRINGS_ITS_LINK,
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
          unmodelled_mechanisms: UNMODELLED_MECHANISMS,
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
  {
    type: 'function', name: 'reconcile_goal_scope',
    description: 'Retain the user’s goal scope or component share, and reconcile it with the existing rate and count. Use when they correct a whole/component reading or answer its share question (including “30% currently”). This retains one durable question; it never writes a derived number. Supply the exact user quote and existing operand ids. If a current_level is supplied, the ordinary baseline writer prepares ONE approval for the scope, baseline and withdrawal of any incompatible product identity. Never use propose_goal_current_level alone to force a total onto a component product.',
    parameters: obj({
      goal_label: { type: 'string' },
      scope: obj({ modelled: { type: 'string' }, alternative: { type: 'string' }, extent: { type: 'string', enum: ['total', 'component'] },
        stated_in_brief: { type: 'boolean', enum: [true] }, source: obj({ quote: { type: 'string' } }, ['quote']),
        component: obj({ label: { type: 'string' }, rate_id: { type: 'string' }, count_id: { type: 'string' }, share: { type: 'number' },
          basis: { type: 'string', enum: ['unknown', 'same', 'different'] }, count_basis: { type: 'string' }, basis_source: obj({ quote: { type: 'string' } }, ['quote']), source: obj({ quote: { type: 'string' } }, ['quote']) }, ['label', 'rate_id', 'count_id', 'basis', 'source']) }, ['modelled', 'alternative', 'extent', 'stated_in_brief', 'source']),
      current_level: obj({ value: { type: 'number' }, unit: { type: 'string', description: 'Their native currency and the goal’s stated period, e.g. GBP/month for MRR; never a normalized value.' }, quote: { type: 'string' } }, ['value', 'unit', 'quote']),
      component_share: { type: 'number', description: 'The user’s share as 0–1; bind a short answer only to the retained share question.' },
      component_basis: { type: 'string', enum: ['same', 'different'] }, count_basis: { type: 'string' }, source_quote: { type: 'string' },
    }, ['goal_label']),
  },
  {
    type: 'function',
    name: 'propose_goal_current_level',
    description:
      'Record the CURRENT level of the model’s goal when the user has just stated it (for example "our MRR is ' +
      '£12,000 today" when the goal is MRR). Without it the analysis cannot compare today with the goal’s ' +
      'target. This does NOT change anything: it records an exact proposal and returns its id, which you keep for ' +
      'authorise_change: show the user the figure, never the id, before asking them to approve. Only the user’s own ' +
      'figure for the goal’s OWN metric: never your estimate, and never a figure they gave for something else (a ' +
      'price, a subscriber count, a rate). Use the goal’s label exactly as get_canonical_state returned it.',
    parameters: obj({
      goal_label: { type: 'string' },
      value: { type: 'number', description: 'The figure the user stated, in their units (12000 for £12,000; never scaled).' },
      unit: { type: 'string', maxLength: 40, description: 'The unit the user stated, if any (e.g. GBP); at most 40 characters, e.g. "small-update equivalents per sprint".' },
      goal_is: {
        type: 'string', enum: ['at_least', 'above', 'at_most', 'below'],
        description: 'ONLY when the user has said how the goal’s target is put: reach at least it, get strictly above it, stay at most it, or stay strictly below it. Otherwise leave it out: today’s level is a fact about today and is recorded on its own, with or without a target, and you never ask for a target first. Never guess it.',
      },
      user_stated: {
        type: 'boolean',
        description: 'true ONLY when the USER gave this figure as the goal’s current level. Never set it for a figure you estimated.',
      },
      whole_request: WHOLE_REQUEST,
    // ⭐ R3 F5 I1.1 (#85 5933250962, CEE `fe8c9ab0`): #2450 made the door take a level with NO comparator and NO target, but this
    // schema still REQUIRED `goal_is` and said "ask them", so "Our quarterly revenue is £100,000." got no card, only a
    // question asking for a target. `goal_is` is optional, as the door already reads it.
    }, ['goal_label', 'value', 'unit', 'user_stated']),
  },
  {
    type: 'function',
    name: 'propose_identity',
    description:
      'Offer the user Olumi\u2019s reading of the goal as the product of two of their own figures (for example "Is MRR your '
      + 'price \u00d7 your subscribers?"), when a run_analysis result carries `identity_card`. It takes no arguments: the '
      + 'reading and its arithmetic come from the stored model. This does NOT change anything: it records the reading and '
      + 'returns its `card.words`. Ask the user those words exactly, never reworded, and tell them to confirm on the button. '
      + 'Never state the reading as a fact before they confirm, and never run the analysis again yourself.',
    parameters: obj({}, []),
  },
  {
    type: 'function',
    name: 'offer_public_research',
    description:
      'Offer to search the public web when the user wants outside evidence the model does not hold (a benchmark, a ' +
      'market figure, published research). This searches NOTHING: Olumi shows the user a control with exactly your ' +
      'query, and the search runs only if they press it, as a separate step with the sources shown. Write the query in ' +
      'plain public words; leave out the user\u2019s own figures, names and model details unless they asked you to search ' +
      'for them. Never say you have searched, and never describe results you do not have.',
    parameters: obj({
      query: { type: 'string', description: 'The exact public search question, one line, at most 200 characters.' },
    }, ['query']),
  },
  /**
   * ⭐ C5 — THE AGENT'S PROVISIONAL VIEW (Paul, DL #70 5855324470: "Yes, labelled provisional"). Read-only: it changes
   * nothing and proposes nothing. The ROUTE renders it after the leader gate, labelled (`../provisional-view.ts`).
   */
  {
    type: 'function',
    name: 'give_provisional_view',
    description:
      'Give a provisional view of what this model needs testing when the analysis cannot put an option forward yet (a leader may not be named). ' +
      PROVISIONAL_VIEW_RULE + ' ' +
      'This changes nothing. Olumi shows it beneath your reply as ONE paragraph labelled as your provisional view \u2014 ' +
      'never as the analysis result \u2014 with why the analysis cannot confirm it yet. Call it at most once per reply, and ' +
      'never write the view in your reply text: a reply sentence that ranks or favours an option is removed. It is refused ' +
      'when the analysis may name a leading option (then report what the analysis says) or when no analysis has completed.',
    parameters: obj({
      view: { type: 'string', description: 'At most 2 sentences: what to test or find out about a factor, assumption or figure. ' + PROVISIONAL_VIEW_RULE },
      reasoning: {
        type: 'string',
        description: 'At most 3 sentences: why, from the model\u2019s own facts and the user\u2019s own words. Never quote win percentages as a ranking or favour an option.',
      },
      confirm_step: {
        type: 'string',
        description: 'ONE sentence: the one thing that would let the analysis confirm or overturn this view \u2014 something the user can do, ' +
          'or a change one of your tools can propose. Never a step that cannot help, or an option to do or explore first.',
      },
    }, ['view', 'reasoning', 'confirm_step']),
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
export const MUTATION_TOOLS: readonly string[] = ['propose_new_option', 'propose_option_status', 'propose_new_risk', 'propose_new_factor', 'propose_link_strength', 'propose_link_effect', 'propose_link_strengths', 'propose_goal_target', 'propose_goal_deadline', 'propose_team_time', 'propose_limit_change', 'propose_model_change', 'propose_assumptions', 'propose_option_interventions', 'propose_starting_point', 'reconcile_goal_scope', 'propose_goal_current_level', 'propose_identity', 'authorise_change', 'withdraw_proposal', 'propose_new_limit'];

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

/**
 * One `acts_on` entry of `propose_new_option`, AS THE TOOL SCHEMA SENDS IT. The schema has always carried `level`
 * (`{value, unit, estimate, basis}`) and the capability reads it (the figure an option sets, or Olumi's own estimate
 * with its basis), but this type omitted it and dispatch passes the parsed arguments `as never` — so the compiler
 * could not see the field the writer depends on (ChatGPT → CODEX-CAPABILITIES #70 5858459113, point 2).
 */
export type NewOptionActsOn = {
  factor_label: string;
  direction: 'positive' | 'negative';
  level?: { value: number; unit?: string; estimate?: boolean; basis?: string } | null;
};

export interface AgentCapabilities {
  getCanonicalState(ctx: AgentToolContext): Promise<ToolResult>;
  proposeModelChange(ctx: AgentToolContext, args: {
    from_label: string; to_label: string; direction: 'positive' | 'negative'; rationale: string;
    /** The band the user typed THIS turn; without it (or with one they did not type) nothing is prepared. */
    strength?: 'weak' | 'moderate' | 'strong' | 'very strong';
    /** The user's own phrase THIS turn when `strength` is Olumi's reading of it (slice C3). */
    from_words?: string;
    reason?: string;
  }): Promise<ToolResult>;
  authoriseChange(ctx: AgentToolContext, args: { proposal_id: string }): Promise<ToolResult>;
  /** Optional: a change THIS turn proposed, withdrawn before the reply (`approval-chips.ts` WITHDRAW_PROPOSAL). */
  withdrawProposal?(ctx: AgentToolContext, args: { proposal_id: string }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). */
  proposeLinkStrength?(ctx: AgentToolContext, args: {
    from_label: string; to_label: string; strength: 'weak' | 'moderate' | 'strong' | 'very strong';
    direction?: 'positive' | 'negative'; rationale: string;
    /** The user's own phrase THIS turn when `strength` is Olumi's reading of it (slice C3). */
    from_words?: string;
    /** With a `direction` that reverses the link: the user's own words THIS turn saying it runs the other way. */
    direction_from_words?: string;
  }): Promise<ToolResult>;
  /** Optional: the user's stated effect on one link (their figures + words); a capability set without it refuses plainly. */
  proposeLinkEffect?(ctx: AgentToolContext, args: {
    links?: readonly { from_label: string; to_label: string; amount: number; amount_unit: string; per_source_change: number; per_source_change_unit: string; quote: string }[];
    from_label?: string; to_label?: string; amount?: number; amount_unit?: string;
    per_source_change?: number; per_source_change_unit?: string; quote?: string;
  }): Promise<ToolResult>;
  /** Optional: a set of link strengths as ONE approval and ONE commit; a capability set without it refuses the tool plainly. */
  proposeLinkStrengths?(ctx: AgentToolContext, args: {
    links: readonly { from_label: string; to_label: string; strength: 'weak' | 'moderate' | 'strong' | 'very strong'; from_words?: string }[];
    rationale: string;
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). */
  proposeGoalTarget?(ctx: AgentToolContext, args: {
    constraint_type: 'at_least' | 'at_most'; value: number; unit: string; rationale: string;
    /** The goal's level today, when the user stated it beside the target: ONE card, ONE approval (AIQ 5913897396). */
    current_level?: { value: number; unit: string };
  }): Promise<ToolResult>;
  /** S-E GOALS: the user's current-team duration, proposed for approval. */
  proposeTeamTime?(ctx: AgentToolContext, args: { low_months: number; high_months: number }): Promise<ToolResult>;
  /** S-E GOALS: the user's stated deadline as a date on the goal, proposed for approval. */
  proposeGoalDeadline?(ctx: AgentToolContext, args: { deadline_words: string; rationale: string }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). MG F1 T6. */
  proposeOptionStatus?(ctx: AgentToolContext, args: {
    option_label: string; status: 'removed' | 'infeasible' | 'feasible'; rationale: string;
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). SLICE C2. */
  proposeNewRisk?(ctx: AgentToolContext, args: {
    label: string; rationale: string;
    affects: readonly { target_label: string; direction: 'positive' | 'negative' }[];
    caused_by?: readonly { factor_label: string; direction: 'positive' | 'negative' }[];
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). PJ-E-FIG. */
  proposeNewFactor?(ctx: AgentToolContext, args: {
    rationale: string;
    factors: readonly {
      label: string; unit: string; today: { value: number; unit?: string };
      affects: string; direction: 'positive' | 'negative';
    }[];
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). SLICE C2. */
  proposeNewLimit?(ctx: AgentToolContext, args: { quantity_label: string; value: number; rationale: string }): Promise<ToolResult>;
  proposeLimitChange?(ctx: AgentToolContext, args: {
    limit_label: string; operator: '<=' | '>='; new_value: number; unit?: string; rationale: string;
    /** A2 follow-up: the comparator the user stated in this message, typed; absent for a new figure alone. */
    stated_operator?: '<' | '<=' | '>' | '>=';
  }): Promise<ToolResult>;
  runAnalysis(ctx: AgentToolContext, args: { reason: string }): Promise<ToolResult>;
  buildModelFromBrief(ctx: AgentToolContext, args: { brief: string }): Promise<ToolResult>;
  proposeAssumptions(ctx: AgentToolContext, args: {
    // `revise` is in the tool's schema (above) and read by the capability (`a?.revise === true`); the type now says so.
    assumptions: readonly { factor_id?: string; factor_label: string; value: number; unit: string; basis: string; revise?: boolean; keep?: boolean }[];
  }): Promise<ToolResult>;
  proposeNewOption(ctx: AgentToolContext, args: {
    label?: string; acts_on?: NewOptionActsOn[]; rationale: string;
    /** Several options as ONE change (F4): each `{label, acts_on}`, up to 4. */
    options?: { label: string; acts_on: NewOptionActsOn[] }[];
    /** Factors the model lacks, added in the SAME change (`planNewFactors`): each named in an option's acts_on. */
    new_factors?: readonly {
      label: string; affects: readonly { label: string; direction?: 'positive' | 'negative' }[];
      /** Today's level, ONLY as the user stated it (PJ-A1 £49); taken only when their own words write it. */
      today?: { value: number; unit?: string };
    }[];
  }): Promise<ToolResult>;
  proposeOptionInterventions(ctx: AgentToolContext, args: {
    interventions: readonly { option_label: string; factor_label: string; value: number; basis: string; unit?: string; user_stated?: boolean; unmodelled_mechanisms?: readonly string[] }[];
  }, internal?: ProposeLevelsInternal): Promise<ToolResult>;  proposeStartingPoint(ctx: AgentToolContext, args: {
    assumptions: readonly { factor_label: string; value: number; unit: string; basis: string }[];
    option_levels: readonly { option_label: string; factor_label: string; value: number; basis: string; user_stated?: boolean; unmodelled_mechanisms?: readonly string[] }[];
  }): Promise<ToolResult>;
  /** The goal's current level as the user stated it — held for approval (`../goal-current-level.ts`). */
  reconcileGoalScope?(ctx: AgentToolContext, args: ReconcileGoalScopeArgs): Promise<ToolResult>;
  proposeGoalCurrentLevel(ctx: AgentToolContext, args: {
    goal_label: string; value: number; unit: string; goal_is?: 'at_least' | 'above' | 'at_most' | 'below'; user_stated: boolean;
  }): Promise<ToolResult>;
  /** The user confirms Olumi's reading of their goal as a product (`../identity-card.ts`). Optional: absent ⇒ refused plainly. */
  proposeIdentity?(ctx: AgentToolContext): Promise<ToolResult>;
  /** C5: the Agent's own provisional view on a withheld turn (`../provisional-view.ts`). Optional: absent ⇒ refused plainly. */
  giveProvisionalView?(ctx: AgentToolContext, args: { view: string; reasoning: string; confirm_step: string }): Promise<ToolResult>;
  /**
   * Whether a search control quoting this query would reach the user on this turn (the final egress gate's own chip
   * rule, read by the route from its readback). Absent ⇒ every sendable query is accepted, as before.
   */
  researchControlShowable?(ctx: AgentToolContext, query: string): Promise<boolean>;
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    return { ok: false, mutated: false, refusal: 'unparsable_arguments' };
  }
  // ⛔ ARGUMENTS ARE AN OBJECT, OR NOTHING RUNS (X2 contract, Codex-Capabilities #70 5858831838): JSON `null` parsed
  // cleanly and crashed `authorise_change` (`args.proposal_id`) and `offer_public_research` (`args.query`); an array,
  // number or string reached every capability as its arguments. Refused here, for every tool, before any is reached.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, mutated: false, refusal: 'unparsable_arguments', detail: 'The call\u2019s arguments were not an object. Nothing was run; call it again with its arguments as an object.' };
  }
  const args = parsed as Record<string, unknown>;
  switch (name) {
    case 'get_canonical_state':
      return caps.getCanonicalState(ctx);
    case 'propose_model_change':
      return caps.proposeModelChange(ctx, args as never);
    case 'authorise_change':
      return caps.authoriseChange(ctx, args as never);
    case 'withdraw_proposal':
      return caps.withdrawProposal !== undefined
        ? caps.withdrawProposal(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A change cannot be withdrawn here. Nothing was withdrawn.' };
    case 'run_analysis':
      return caps.runAnalysis(ctx, args as never);
    case 'build_model_from_brief':
      return caps.buildModelFromBrief(ctx, args as never);
    case 'propose_assumptions':
      return caps.proposeAssumptions(ctx, args as never);
    case 'propose_new_option':
      return caps.proposeNewOption(ctx, args as never);
    case 'propose_link_strength':
      return caps.proposeLinkStrength !== undefined
        ? caps.proposeLinkStrength(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'Link strengths cannot be recorded here. Nothing was changed.' };
    case 'propose_link_effect':
      return caps.proposeLinkEffect !== undefined
        ? caps.proposeLinkEffect(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A link\u2019s size cannot be recorded here. Nothing was changed.' };
    case 'propose_link_strengths':
      return caps.proposeLinkStrengths !== undefined
        ? caps.proposeLinkStrengths(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'Link strengths cannot be recorded here. Nothing was changed.' };
    case 'propose_goal_target':
      return caps.proposeGoalTarget !== undefined
        ? caps.proposeGoalTarget(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A goal’s target cannot be set here. Nothing was changed.' };
    case 'propose_team_time':
      return caps.proposeTeamTime !== undefined ? caps.proposeTeamTime(ctx, args as never) : { ok: false, mutated: false, refusal: 'unsupported' };
    case 'propose_goal_deadline':
      return caps.proposeGoalDeadline !== undefined
        ? caps.proposeGoalDeadline(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A deadline cannot be recorded here. Nothing was changed.' };
    case 'propose_option_status':
      return caps.proposeOptionStatus !== undefined
        ? caps.proposeOptionStatus(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'An option cannot be taken out or put back here. Nothing was changed.' };
    case 'propose_new_risk':
      return caps.proposeNewRisk !== undefined
        ? caps.proposeNewRisk(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A risk cannot be added here. Nothing was changed.' };
    case 'propose_new_factor':
      return caps.proposeNewFactor !== undefined
        ? caps.proposeNewFactor(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A factor cannot be added here. Nothing was changed.' };
    case 'propose_new_limit':
      return caps.proposeNewLimit !== undefined
        ? caps.proposeNewLimit(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A limit cannot be added here. Nothing was changed.' };
    case 'propose_limit_change':
      return caps.proposeLimitChange !== undefined
        ? caps.proposeLimitChange(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A limit cannot be changed here. Nothing was changed.' };
    case 'propose_option_interventions':
      return caps.proposeOptionInterventions(ctx, args as never);
    case 'propose_starting_point':
      return caps.proposeStartingPoint(ctx, args as never);
    case 'reconcile_goal_scope':
      return caps.reconcileGoalScope ? caps.reconcileGoalScope(ctx, args as never) : { ok: false, mutated: false, refusal: 'scope_writer_unavailable' };
    case 'propose_goal_current_level':
      return caps.proposeGoalCurrentLevel(ctx, args as never);
    case 'propose_identity':
      return caps.proposeIdentity !== undefined
        ? caps.proposeIdentity(ctx)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A reading of the goal cannot be offered here. Nothing was changed.' };
    case 'give_provisional_view':
      return caps.giveProvisionalView !== undefined
        ? caps.giveProvisionalView(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A provisional view cannot be given here. Nothing was shown.' };
    case 'offer_public_research': {
      // Pure: nothing is searched here. The route turns the query into the one control that can send it.
      const query = sendableQuery(args.query);
      if (query === null) {
        return { ok: false, mutated: false, refusal: 'query_not_sendable',
          detail: 'That query cannot be offered: write it as one line of at most 200 characters. Nothing was searched.' };
      }
      // ⭐ ACCEPTED ⇒ ON THE WIRE. The answer below tells the model the user sees a control, so it is given only when the
      // control will survive the final egress gate. A query that gate would remove is refused here, with the way out.
      // A read that throws refuses the offer (fail closed): a control that may not arrive is never promised.
      let showable = true;
      if (caps.researchControlShowable !== undefined) {
        try { showable = (await caps.researchControlShowable(ctx, query)) === true; } catch { showable = false; }
      }
      if (!showable) {
        return { ok: false, mutated: false, refusal: 'query_cannot_be_shown',
          detail: 'That query cannot be shown as a control here: it reads as putting one option ahead of another, and this '
            + 'analysis names no leading option. The user sees NO control and nothing was searched. Either offer ONE '
            + 'neutral public question that names no option as better, or tell the user that no search is on offer. '
            + 'Never say a control is there.' };
      }
      return { ok: true, mutated: false, offered_query: query,
        detail: 'The user now sees a control that searches the web for exactly this query. Nothing has been searched yet: '
          + 'tell them what the search would look for and that it runs only if they press it.' };
    }
    default:
      // An unknown tool is never silently ignored: the Agent is told plainly.
      return { ok: false, mutated: false, refusal: 'unknown_tool', tool: name };
  }
}
