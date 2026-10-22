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
import type { EffectsTiming } from '../../goal-target/period-end-assumption.js';
import type { ReconcileGoalScopeArgs } from '../reconcile-goal-scope.js';
import type { ProposalEditsRequest } from '../proposal-object/amend.js';
import { QUOTE_SPEAKER, type StatementArgs } from '../user-statements.js';
import { sendableQuery } from './public-research.js';
import { PROVISIONAL_VIEW_RULE } from '../provisional-view.js';
import { LOSS_THRESHOLD_CONSEQUENCES } from '../stated-limit.js';
import { AnalysisReadDeadlineError } from '../../session/analysis-read-deadline.js';
import { log } from '../../../utils/telemetry.js';

// AIE 6141593167: exact option-level authorship contract at both entry points.
const OPTION_LEVEL_USER_STATED = {"type": "boolean", "description": "Set true ONLY for a level the user supplied for this option and factor, with its actual source; the host must verify that source before recording it as theirs. A verified retained human statement counts. Set false ONLY when explicitly proposing a new Olumi estimate now, with its own basis. Never infer false from missing, truncated or unmatched source, or from the absence of a user-authorship claim. Do not use false to relabel an old quoted, copied or recorded figure. Keep the original statement, subject and qualifications separate from any new interpretation. This flag is a claim to check, not proof of authorship; accepting an Olumi estimate does not turn it into a user-supplied fact. On an option in `status_quo_held`, a level is permitted only with true and verified user words saying that carrying on changes this factor and giving that level. Never restate the factor's starting value: carrying on as now already keeps that, so such a level is not recorded."} as const;
const ASSUMPTION_USER_STATED = {"type": "boolean", "description": "Set true ONLY for a figure the user supplied for this factor, with its actual source; the host must verify that source before recording it as theirs. A verified retained human statement counts. Set false ONLY when explicitly proposing a new Olumi estimate now, with its own basis; for keep: true, false identifies the existing recorded Olumi estimate being retained. Never infer false from missing, truncated or unmatched source, or from the absence of a user-authorship claim. Do not use false to relabel an old quoted, copied or recorded figure. Keep the original statement, subject and qualifications separate from any new interpretation. This flag is a claim to check, not proof of authorship; accepting an Olumi estimate does not turn it into a user-supplied fact."} as const;

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
  /** Host turn identity; never a model argument. */
  readonly turn_id?: string;
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
  /** Host-verified messages, without splitting multiline messages into separate statements. */
  readonly verified_user_messages?: readonly string[];
  /** Restored history whose source is unknown; reference only, never human or Olumi authority. */
  readonly unverified_user_text?: string;
  /** Host source coverage, not a model claim: false on fresh, restored or capped history. */
  readonly user_text_complete?: boolean;
  /**
   * THIS turn's message when the user typed it (never a chip's text), bound by the route. A link's strength band is
   * the user's only when named here (`bandTheUserWrote`): a band word elsewhere in the conversation is about something else.
   */
  readonly user_turn_text?: string;
  /**
   * Olumi's previous reply in this conversation, bound by the route from the session's own items (never the model's words now):
   * what a user's answer to Olumi's question about ONE risk's chance is bound by (AIE 6179240850, `occurrenceBoundTo`).
   */
  readonly preceding_assistant_text?: string;
  /**
   * The proposal THIS request's typed approve chip names (`typedApprovalOf`), bound by the route — never model output.
   * A link's stated effect is written only from that button, which shows the exact reading it records (PR Review's
   * fifth CR on #2275): a free-text "yes" to the model never records it.
   */
  readonly typed_approval_of?: string;
  /** That chip's words, bound only when a card for the proposal is on offer: a link-effect card's words carry its reading. */
  readonly typed_approval_words?: string;
  /**
   * ⭐ ONE APPROVAL ACTION (DL-3 18 Oct, ruling A): the user's OWN typed words, when the route bound the ONE waiting card to
   * them (not a press, not the card's exact words). Olumi's reading of them is the consent; a write it authorises records
   * them as a typed approval, read by Olumi, and the receipt quotes them with an Undo.
   */
  readonly typed_assent?: string;
  /**
   * ⭐ AN EXPLICIT SELECTION AMONG SEVERAL WAITING CARDS (PL amendment, DL-3 18 Oct 16:28): the cards the user was SHOWN at
   * the start of this typed turn (id → that card's button words). The id the Agent names when it approves binds only if it is
   * one of them; Olumi's reading of the words chose it, and the write records them as a typed approval.
   */
  readonly typed_assent_cards?: Readonly<Record<string, string>>;
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

/**
 * ⭐ STEP 8 PRODUCER (AIE df3304b7 `accepted_input_shapes`): a supported uncertainty for a size the user already gave on one link.
 * The host verifies every figure and phrase against this turn's words and answers an unsupported or incomplete statement with
 * the exact question or limitation to give the user.
 */
const LINK_UNCERTAINTY = obj({
  stated_as: { type: 'string', enum: ['standard_deviation', 'normal_quantiles'], description: 'standard_deviation: an explicit standard deviation of this same effect. normal_quantiles: values with the probability below, inside or above them (for example "90% between 10 and 30", or "5% below 10 and 5% above 30").' },
  sd: { type: 'number', description: 'standard_deviation only: the standard deviation exactly as written, in the size\u2019s own unit and per the same change in the cause.' },
  lower: { type: 'number', description: 'normal_quantiles only: the lower value as written, signed as the link\u2019s size is.' },
  upper: { type: 'number', description: 'normal_quantiles only: the upper value as written, signed as the link\u2019s size is.' },
  probability_inside: { type: 'number', description: 'normal_quantiles only: the percent stated as lying between lower and upper (90 for "90%").' },
  probability_below: { type: 'number', description: 'normal_quantiles only, when stated: the percent below lower (5 for "5% below 10").' },
  probability_above: { type: 'number', description: 'normal_quantiles only, when stated: the percent above upper (5 for "5% above 30").' },
  unit: { type: 'string', description: 'The unit the values are written in, as written.' },
  from_words: { type: 'string', description: 'The user\u2019s words in THIS message that give the values, copied exactly.' },
  tails_words: { type: 'string', description: 'When given: the user\u2019s exact words saying how much lies below and above (for example "5% below 10 and 5% above 30").' },
  shape_words: { type: 'string', description: 'When given: the user\u2019s exact words saying it is symmetric, bell-shaped or Normal.' },
  basis_words: { type: 'string', description: 'When given: the user\u2019s exact words saying what the assessment is based on.' },
  source: { type: 'string', description: 'Only when the assessment is another party\u2019s: who, exactly as the user names them (for example "the supplier").' },
}, ['stated_as', 'unit', 'from_words']);

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

/** Exact wording approved by AIE comment 6134928624. */
export const AIE_APPROVED_EFFECTS_TIMING_DESCRIPTION = "Your reading of the current held target, its period and the options being analysed, using the current canonical model and all relevant readable user statements, including later turns. Choose in_place_by_period only when those statements support the relevant effects being fully in place by that period; later_or_partial when a relevant effect arrives later or only partly; not_stated only when the complete readable relevant source states no effects timing (the goal's period alone is not effects timing). Use null when required context is missing, truncated, unreadable, has unknown authorship, conflicts, or cannot be classified reliably; never turn unknown into not_stated. In reason, identify the actual target/period and the source or missing context for your reading. This is Olumi's interpretation, not a measurement, human approval or a change to the user's evidence.";

export const AGENT_TOOLS: readonly ToolDefinition[] = [
  {
    type: 'function',
    name: 'get_canonical_state',
    description:
      'Read the authoritative persisted model for this conversation: its entities, ' +
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
      'Withdraw an eligible, unapproved change you proposed in this turn that you now judge wrong, before you reply. '
      + 'You may also withdraw an earlier-turn card only when it is Olumi’s own estimate, still offered on this scenario, unapproved and unapplied, and bound to the model it was made for. '
      + 'Do not use this to withdraw the user’s own figures, edits or words, or a protected card-only removal, rename, statement or quote confirmation; an unresolved goal reading has only the exact exception below. '
      + 'Existing ownership, approval, freshness and model-binding checks still apply. '
      + 'On success the card is set aside without applying it, its buttons are removed and the existing confirmation is shown once. '
      + 'On refusal the card remains unchanged: explain what you doubt and the actual refusal reason when supplied, without claiming withdrawal or inventing a cause. '
      + 'Never ask the user not to approve a change you leave offered. '
      + 'An unresolved goal reading (goal-scope: ID) may also be withdrawn, but only when the user writes exactly "Withdraw this unresolved goal reading: <goal_id>". Otherwise retain its question.',
    parameters: obj({ proposal_id: { type: 'string' } }, ['proposal_id']),
  },
  {
    type: 'function',
    name: 'run_analysis',
    description:
      'Run the analysis over the persisted model. It may refuse and explain what is ' +
      'missing; report that honestly rather than guessing what the result would have been.',
    parameters: obj({
      reason: { type: 'string' },
      effects_timing: { anyOf: [
        { type: 'string', enum: ['in_place_by_period', 'later_or_partial', 'not_stated'] },
        { type: 'null' },
      ], description: AIE_APPROVED_EFFECTS_TIMING_DESCRIPTION },
    }, ['reason', 'effects_timing']),
  },
  {
    type: 'function',
    name: 'build_model_from_brief',
    description:
      'Build the model from the user\u2019s brief when get_canonical_state reports the ' +
      'model is empty. Preserves the user\u2019s own facts, numbers and constraint wording, then ' +
      'adds the options, factors, risks and causal mechanisms that make the question reasonable ' +
      'to analyse. Report honestly what it says was left out. With a saved model, call only for the user’s explicit CURRENT request to generate a replacement model; pass that complete verified request verbatim in explicit_rebuild_request. Correction, quotation, hypothetical, negation or an earlier request is not current rebuild permission. Prepare ONE candidate through the existing construction/admission/widening pipeline, using the retained brief, verified corrections, answered context, current aim, sources and dissent; do not revive rejected mechanisms or obsolete aims. Show the complete proposed replacement, retained work, omissions and changed assumptions. Nothing replaces the saved model before this card’s own approval and complete candidate save/readback. Never rebuild automatically to apply a correction.',
    parameters: obj({
      brief: { type: 'string', description: 'For initial construction, the user’s brief verbatim. For an explicitly requested replacement, Olumi’s proposed framing; it is context, never human source.' },
      explicit_rebuild_request: { type: 'string', description: 'Only for a saved model: the complete verified current typed request verbatim.' },
      whole_request: WHOLE_REQUEST,
    }, ['brief']),
  },
  {
    type: 'function',
    name: 'propose_assumptions',
    // AIE #94 6140145484; approved artifact SHA-256 4de5e7f71fd603d03e39483d1064dfbc94425a0e4208e280441f124b5a924f86
    description: "Propose starting values for factors that have none, so the model can be reasoned about instead of sitting blank. This does not change anything: it records an exact proposal and returns its id for authorise_change. Show the complete approval card with every proposed value, its unit, source, basis and qualifications, and any omitted or unsupported parts; never show the id as consent. Supply the required user_stated boolean for every item: true identifies a user-supplied figure whose source must verify; false explicitly proposes a new Olumi estimate with its own basis, or identifies an existing recorded Olumi estimate when keep is true. Missing or unverifiable source is unknown, not evidence of a new AI estimate. Preserve verified human origin, known unknown source and the original words separately from a new interpretation; approval adopts an estimate without changing its original authorship. An Olumi estimate is an assumption to adopt or correct, never a measurement; a value the result marks your_figure is the user's own figure and must not be called an Olumi assumption. Propose only factors the model actually has, using the labels returned by get_canonical_state. A factor that already holds a value is left alone unless revise is true, which is allowed only when the user has just requested that factor's change and supplied the replacement figure. Never replace someone's figure with one of your own under revise. When the user requests a revision without a replacement figure, ask what figure they would use; never supply a number or an instruction for them to repeat as their own. When the user says the current recorded Olumi estimate should stay, use keep: true instead: the value does not change, and approval records acceptance of Olumi's estimate. Keep and revise retain their existing separate approval and permission checks.",
    parameters: obj({
      assumptions: {
        type: 'array',
        description: 'The factors to give a starting value, with the reasoning for each.',
        items: obj({
          user_stated: ASSUMPTION_USER_STATED,
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
          // S2 (DL 14 Oct, pricing r2): a figure the user already wrote, confirmed from their own statement, never asked again.
          // (c)/(d) DL-3 17 Oct (founder levels): a figure whose factor is Olumi's reading; work not started as Olumi's provisional zero.
          statements: { type: 'array', minItems: 1, maxItems: 1, description: 'The user\u2019s complete statement about this factor, copied exactly from their brief or a message. (a) A figure they already WROTE that the model holds as unverified (for example "from £49 to £59 per month" for today\u2019s price): form "point" with that figure as value, user_stated true and the same figure as value; approval records it as theirs and never changes it. (b) Words that DESCRIBE the factor without a figure (for example "I\u2019m not that experienced with marketing"): form "describes", with user_stated false, your own estimate as value and your reading as basis; the card quotes their words and the figure stays your estimate. (c) A figure they gave for this factor\u2019s level today in words that do not name the factor (for example "about 60% of my working time goes on it"): where the conversation makes this factor the one they most likely meant, form "point" with that figure as value and user_stated true; the figure stays theirs, and which factor it is about stays Olumi\u2019s unverified reading after approval, shown on the card for them to accept or correct. Ask once instead when two factors fit, or when its time, scope or denominator is unclear. (d) Words saying that work on this activity has not started (for example "nobody has begun the website redesign"): form "describes", user_stated false, value 0 and, as basis, your assumption that no time goes into it now; zero is your provisional assumption, never their figure or a measurement. Words saying only that a result is unfinished or not yet reached, a plan or need, an unknown, or that the work has started do not ground zero. Omit it otherwise.',
            items: obj({ quote: { type: 'string' }, speaker: QUOTE_SPEAKER, form: { type: 'string', enum: ['point', 'describes'] }, value: { type: 'number' } }, ['quote', 'form']) },
          // AIE packet 6e52e896 `event_risk.occurrence_range_description`, byte for byte (hiring path (a)).
          occurrence_range: { ...obj({
            low_percent: { type: 'number' },
            high_percent: { type: 'number' },
          }, ['low_percent', 'high_percent']), description: 'For an existing RISK ROOT with no held likelihood or level, propose Olumi’s estimated chance, in percent, that its clearly identified event happens at least once within the current bound goal period, as low and high figures. Give it with user_stated false and a grounded basis stating the event interpretation and window, alone in the call; value and unit are not used for a risk. This is Olumi’s starting assumption to review, never the user’s figure or a measurement. Do not guess an ambiguous event or period. Omit it for every factor.' },
        }, ['factor_label', 'value', 'unit', 'basis', 'user_stated']),
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
      + '\u2014 a band they did not say is refused.' + SLIGHT_IS_WEAK
      + ' To record how much a size the user ALREADY gave on this link could vary, give `uncertainty` instead of `strength`: the size stays exactly as it is.',
    parameters: obj({
      from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
      to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
      strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'very strong'], description: 'The strength the user stated, or your reading of their own words, given with `from_words`. Leave it out with `uncertainty`.' },
      uncertainty: LINK_UNCERTAINTY,
      from_words: FROM_WORDS,
      direction: { type: 'string', enum: ['positive', 'negative'], description: 'ONLY when the user said the link pushes the other way, with their words in `direction_from_words`. Leave it out otherwise: the link keeps its direction.' },
      direction_from_words: { type: 'string', description: 'With `direction`: the user\u2019s exact words in THIS message saying the link runs the other way. A reversal without them is refused.' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['from_label', 'to_label', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_link_strengths',
    description:
      'Record the strengths of SEVERAL existing links as ONE change the user approves once \u2014 never one approval per link. '
      + 'Use it when the user gives strengths for more than one link in one message, or asks Olumi to size links for them '
      + '(they ask what you recommend, then agree to it). This does NOT change anything: it prepares ONE change and returns its id, '
      + 'which you keep for authorise_change: show the user what each link will hold, never the id, before they approve. '
      + 'A link band is recorded as the user\u2019s own only when from_words quotes their complete, still-operative statement about that directed link, character for character from a verified user message in this conversation, including the words identifying its speaker or source, qualification and any negation. Use their latest applicable statement. A report of someone else\u2019s view, a question or dispute, or a band word about evidence rather than this link\u2019s effect does not establish their own link estimate. Bind the quote to this actual link through its stated ends or the current unambiguous directed selection; naming one endpoint alone is insufficient. Retain the full source and any competing statements separately. If positive human authorship cannot be verified, preserve the held origin or unknown; omission of from_words does not make copied or unknown material Olumi\u2019s estimate. Only an explicitly new, grounded Olumi proposal may be labelled Olumi\u2019s estimate, with its own basis and complete approval card. Naming an existing band retains its source and values. '
      + 'Directions are kept: a link the user says runs the other way is propose_link_strength, one link at a time. '
      + 'A strength the user set themselves is never replaced by an estimate. The set is written whole or not at all.' + SLIGHT_IS_WEAK,
    parameters: obj({
      links: {
        type: 'array', minItems: 1, maxItems: 12,
        description: 'Every link in the set, each once.',
        items: obj({
          from_label: { type: 'string', description: 'Where the link starts, exactly as get_canonical_state labels it.' },
          to_label: { type: 'string', description: 'Where the link ends, exactly as get_canonical_state labels it.' },
          // #3002: the AIE's exact text (packet 2b19ae59, #94 6163353417), replacing "or Olumi's estimate when they did not".
          strength: { type: 'string', enum: ['weak', 'moderate', 'strong', 'very strong'], description: 'The band for this specific directed relationship. Declare its origin separately: a positively verified human statement, an attributed third-party claim, or a genuinely new grounded Olumi estimate. Missing human words do not make the band Olumi\'s. An unknown or unsupported origin stays unknown and is not offered as a change.' },
          from_words: { type: 'string', description: 'For a positively verified user-authored band only: copy the complete latest applicable statement about this directed link verbatim from a verified user message, retaining speaker/source, qualification and negation. A report, question, dispute, or evidence-strength word is not the user\u2019s own link estimate. Otherwise omit human-credit words and preserve the original source separately; omission alone grants neither AI authorship nor a new estimate.' },
          // #3002 known-origin transport: the AIE's exact text (packet 491cee5a, #94 6162480601). The host verifies each declared
          // origin and never writes an unverified one; unknown is the existing outcome.
          origin: { type: 'string', enum: ['user', 'third_party', 'olumi'], description: 'Declare the source of this specific estimate, independently of approval. \u2018user\u2019 means a positively verified retained human statement supplies this estimate for this subject, quantity, units, reference and period; provide its complete bound quotation. A user-role message, approval, copied statement or incomplete/reseeded history is not proof. \u2018third_party\u2019 means the estimate comes from an identified person, report or other source; retain that source, its complete claim and verification state. \u2018olumi\u2019 means a genuinely new estimate Olumi is making now, with its own grounded basis for this same quantity and context. A false user flag, nonempty basis, paraphrase or copied figure does not make an estimate Olumi\u2019s. Preserve known stored human, AI or third-party origin; if origin cannot be verified, keep it unknown rather than inventing one.' },
          // #3002: the two companion fields the origin text names, the AIE's exact texts (packet 2b19ae59, #94 6163353417).
          source: { type: 'string', description: 'Only with origin third_party: identify the person, publication or other source to which this specific directed-link band is attributed, using the retained source words. Preserve its complete applicable claim, qualifications, reference, period and verification state in the existing readable source and context. A name or citation alone does not verify the band or make it the user\'s judgement.' },
          basis: { type: 'string', description: 'Only with origin olumi: explain the grounded reasons for the genuinely new estimate Olumi is making now for this directed link, at its actual reference, period and conditions. A nonempty sentence, copied band, existing stored estimate or statement that the user did not supply it is not a basis for new AI authorship. If revising a prior estimate, identify the new estimate and its grounds while retaining the prior value and source separately. Preserve the full evidence and qualifications in the existing readable context.' },
        }, ['from_label', 'to_label', 'strength', 'origin']),
      },
      rationale: { type: 'string', description: 'What the user asked for, in their words.' },
      whole_request: WHOLE_REQUEST,
    }, ['links', 'rationale']),
  },
  {
    type: 'function',
    name: 'propose_goal_target',
    description: 'Use reframe alone only when the current request explicitly replaces the governing aim with a qualitative aim, without numeric-mode arguments. Bind the current goal and quote the complete relevant human request verbatim, retaining its qualifications; the proposed label is Olumi’s reading. Show the complete change: the former aim and its original source and values become excluded history, and every old target or bound removed from the active aim is disclosed before approval. This mode does not correct numerical values, preserve an old target as the new aim’s target, add causal links or implement other requested edits. Do not use it for a mere addition of context or assume qualitative reasoning requires removing a numerical goal. If the request needs an unsupported mixed change, identify that boundary without claiming the whole request is prepared or saved. Preserve current independent limits, options, settings and dissent except the exact changes shown. No new number, unit, date, uncertainty law or choice is inferred, and no change is saved before its own approval and applied readback. Otherwise, the following rules apply to numerical targets. ' +
      'Set the goal’s success target to the figure the user has just stated (for example "we need at least £60k MRR", '
      + '"keep churn under 5%"). For a quantity already in the model, this prepares one target change and returns its id for '
      + 'authorise_change after the user approves the shown values. A restated quantity is offered as a targeted correction '
      + 'to the saved goal, retaining all options and settings. Show the complete card, including any uncertain binding or '
      + 'measurement change; only its own approval saves it. Never replace the model for this target correction or show its id. Give the figure exactly as the user '
      + 'wrote it, in their units (60000, with the unit £, for £60k), and whether they said at least or at most. Never use this '
      + 'for a figure or a direction the user did not state: if they have not given both in their own words, ask first — '
      + 'a figure or direction they did not state is refused. If the user ALSO stated the goal’s level today (for example "we have secured '
      + '£0 so far and need at least £1m"), pass it as current_level: both go on ONE card and are written on ONE approval. '
      + 'Never promise to record today’s level later: without current_level nothing records it. '
      + 'When the target is DERIVED from a figure the user gave ("we\u2019re at £100,000 … aiming to double that"), give the '
      + 'result as value and pass derived_from {base, multiplier} (100000 and 2): the base must be a figure they wrote. '
      + 'When the user did not say at least or at most, give your reading in constraint_type: the card offers it as a '
      + 'decision with the other direction beside it, and the user chooses. '
      + 'Give measures whenever the user names what the target is a figure of. '
      + 'Without governing_outcome, change only the current saved goal’s target. Use governing_outcome only when the saved goal measures a DIFFERENT outcome; if it already measures the named outcome (for example Funding secured), use the ordinary target card, including its measurement reading if needed. When the user changes the governing outcome, identify it and quote the complete verified source in goal_change_quote. Propose ONE card showing that outcome, its bound target, any stated deadline and explicitly requested mechanism removals from THIS turn, including their consequences. Earlier mention, concern, or wording to keep a part is not removal permission. If an optional part cannot be prepared, show the valid goal card and every named omission with its native refusal reason; coach or clarify the omitted part, never claim it will be saved. Keep options/settings except the changes shown. Retain earlier aims in history and any explicitly later ambition with its original values, source and uncertainty; do not turn a rejected aim into an operative or automatically later goal. Show what changes, remains and cannot be represented. Governing-outcome binding is Olumi’s reading until this card’s approval; approval does not rewrite source authorship. No invented figure, comparator, current level or deadline, silent partial change or whole-model rebuild. A new outcome label remains Olumi’s proposal unless supplied by the user. '
      + 'Do not use successive calls to represent additional goals or a full AND objective. '
      + 'Retain every requested goal, condition and source; show exactly which target this card changes and which parts remain unsaved or unsupported.',
    parameters: { ...obj({
      reframe: obj({ goal_id: { type: 'string' }, quote: { type: 'string', description: 'The complete current human request to change this aim, verbatim.' }, label: { type: 'string', description: 'Proposed qualitative aim label; Olumi reading, never a numeric target.' } }, ['goal_id', 'quote', 'label']),
      constraint_type: { type: 'string', enum: ['at_least', 'at_most'], description: 'at_least when the user said the goal must reach at least the figure; at_most when they said it must stay at or under it.' },
      value: { type: 'number', description: 'The figure the user stated, in their own units.' },
      unit: { type: 'string', description: 'The unit of that figure, as the user gave it (for example £, % or customers).' },
      measures: { type: 'string', description: 'What the figure is a figure OF, in the user\u2019s own words from this message (for example "conversion rate", "new customers").' },
      rationale: { type: 'string', description: 'What the user said, in their words.' },
      governing_outcome: { type: 'string', description: 'Only when changing WHICH outcome governs: the existing outcome label/id, or a proposed new outcome label. This is Olumi’s interpretation for review.' },
      goal_change_quote: { type: 'string', description: 'The COMPLETE verified human message supporting this goal change, verbatim, including conditions and uncertainty. A reported or disowned figure is not their target.' },
      later_ambition_quote: { type: 'string', description: 'For either a target change or a governing-outcome change: the complete verified source that makes the prior saved target a later ambition. Its original figure, source and conditions are retained as non-operative history on the same card. Without it the prior aim stays history, never automatically a later goal.' },
      deadline_words: { type: 'string', description: 'The exact deadline words for the new governing outcome, when stated. Include them in this same card, preserving their source/reference.' },
      remove_mechanisms: { type: 'array', maxItems: 6, items: obj({
        kind: { type: 'string', enum: ['factor', 'risk', 'link'] },
        id: { type: 'string' }, label: { type: 'string' }, to_id: { type: 'string' }, to_label: { type: 'string' },
        quote: { type: 'string', description: 'The complete verified user request to remove this mechanism, naming it (or both link ends). Include all consequences on this card.' },
      }, ['kind', 'quote']) },
      derived_from: obj({
        base: { type: 'number', description: 'The figure the user wrote that the target is derived from, in their units (100000 for "£100,000").' },
        multiplier: { type: 'number', description: 'The multiple they asked for: 2 for "double that", 3 for "triple", 0.5 for "halve".' },
      }, ['base', 'multiplier']),
      current_level: obj({
        value: { type: 'number', description: 'The goal’s level TODAY, exactly as the user stated it in their units (0 for "we have secured £0 so far").' },
        unit: { type: 'string', description: 'The unit the user gave it in (for example £).' },
      }, ['value', 'unit']),
    }, []), anyOf: [{ required: ['reframe'] }, { required: ['constraint_type', 'value', 'unit', 'rationale'] }] },
  },
  {
    // ⭐ SYSTEM 1: THE ONE STATEMENT DOOR (M1). Tool text: AIE 6181498097, exact.
    type: 'function',
    name: 'propose_statement',
    description: 'Use correction alone only for an explicit current request to correct or withdraw recorded source material. Bind each exact saved subject and field; quote the complete relevant current request verbatim, list the held spans to retire and the explicitly held spans to retain, and state any supported legacy evidence or dependency change. Never infer the unmentioned remainder. This mode records source and its separate Olumi reading. Represent the intended correction as one complete operation. Preserve every item the user explicitly keeps. For each replacement, supply the value, unit and exact source span for that quantity, retaining its full source context, speaker, sign, period, bounds and conditions. A cropped number from another item is not its replacement. An unresolved interpretation stays visibly Olumi’s reading after approval. Show every supported affected value that this card would change or make unavailable; preserve unrelated figures, causal relationships and other people’s recorded views. If the supplied operation is incomplete or conflicts with an explicit keep, state that limitation rather than silently withdrawing the kept value. Do not claim a change was saved until complete readback confirms it. A protected adoption or attestation that this mode cannot preserve safely requires an honest refusal, not copied approval or another route that drops it. ' + 'Propose recording a verified human statement through the existing bound card. Give the current canonical subject and '
      + 'field, and the complete statement with its actual speaker/source, qualifications, negation, conditions, reference and window; reuse '
      + 'a retained applicable statement rather than asking for it again. This door currently supports a risk\u2019s occurrence estimate and '
      + 'its current-condition reading; an option\u2019s forecast of how many people it reaches over the stated window, and the user\u2019s '
      + 'one-in-four-below and one-in-four-above conversion estimates as their actual answer in this message to that option\u2019s complete '
      + 'question (answering quotes it exactly; subject the option, field relation); and the user\u2019s answer to the actual question about '
      + 'whether the count target and conversion-rate denominator concern the same population and window (subject the goal, field relation); '
      // AIE 6182987896: the exact M5 clause.
      + 'and the user\u2019s statement of the new share of time an option would set, bound to that option and share through the actual '
      + 'applicable question (answering quotes that question exactly; subject the share, with the option, field level). Preserve its unit, '
      + 'population, reference, timing, bounds and conditions. Reuse retained applicable words; where this row cannot represent their meaning, '
      + 'retain them and explain only that missing binding or carrier rather than force a point. Any allocation-to-pace or timing assumption '
      + 'remains Olumi\u2019s separate grounded proposal on the complete card. '
      + 'It also supports when ONE option\u2019s effect would be fully in place (subject the option, field lead), with reading_words set to the '
      + 'user\u2019s own words for that option that state the month(s). '
      + 'Olumi proposes the interpretation; a complete quote or matching label alone does not verify it. Do not '
      + 'supply an Olumi estimate here or substitute a different event, quantity or time window. If the meaning or current carrier is '
      + 'unsupported, retain the original statement and explain that exact gap. This tool prepares one card and changes nothing. Only the '
      + 'bound approval records its complete shown postimage; a successful committed change then follows the existing automatic analysis '
      + 'and contextual SAME-Run coaching flow, with no duplicate Run.',
    parameters: { ...obj({
      correction: obj({ quote: { type: 'string', description: 'The complete verified CURRENT correction message, verbatim.' },
        speaker: QUOTE_SPEAKER,
        edits: { type: 'array', minItems: 1, maxItems: 6, items: obj({
          subject: obj({ kind: { type: 'string', enum: ['goal', 'factor', 'option', 'risk', 'link'] }, id: { type: 'string' }, to_id: { type: 'string' }, option_id: { type: 'string' }, field: { type: 'string', enum: ['level', 'target', 'holds_now', 'occurrence', 'lead', 'effect', 'measure', 'relation'] } }, ['kind', 'id', 'field']),
          retirement: obj({ quote: { type: 'string', description: 'Exact held source span to retire.' }, scope: { type: 'string', enum: ['whole', 'part'] }, disposition: { type: 'string', enum: ['historical', 'retracted'] } }, ['quote', 'scope', 'disposition']),
          retained: { type: 'array', items: { type: 'string' }, description: 'Explicit held source spans to retain, with their complete earlier source; required, non-empty for a partial retraction.' },
          reading_words: { type: 'string', description: 'Olumi interpretation of the correction, shown separately from the human quote.' },
          legacy: obj({ field: { type: 'string', enum: ['already_true_quote', 'dependency'] }, expected: { type: 'string' }, replacement: { type: ['string', 'null'] } }, ['field', 'expected', 'replacement']),
          replacement: obj({ value: { type: 'number' }, unit: { type: 'string', description: 'The unit exactly as the user wrote it after the figure, with its period (for example "hours per month").' },
            span: { type: 'string', description: 'Verbatim source words for this replacement occurrence and quantity. Keep the full source alongside this span so its subject, speaker, negation, conditions, bounds and unit remain identifiable; a bare number cropped from another quantity does not qualify.' } }, ['value', 'unit', 'span']),
        }, ['subject', 'retirement', 'retained', 'reading_words']) },
      }, ['quote', 'edits']),
      subject: obj({
        kind: { type: 'string', enum: ['goal', 'factor', 'option', 'risk', 'link'] },
        label: { type: 'string', description: 'The part\u2019s exact label, as get_canonical_state returned it.' },
        to_label: { type: 'string', description: 'Only for a link: the exact label of the part it points to.' },
        option_label: { type: 'string', description: 'Only when the statement is about what an option sets: that option\u2019s exact label.' },
        // S5 (DL 15 Oct, unseen brief R4): a label copied from a brief can differ from the stored one in quotes, dashes or punctuation,
        // and the part was "not recognised". The id names it exactly; no label matching is loosened.
        id: { type: 'string', description: 'The part\u2019s id, as get_canonical_state returned it. Give it whenever you have it: it names the part exactly.' },
        to_id: { type: 'string', description: 'Only for a link: the id of the part it points to.' },
        option_id: { type: 'string', description: 'Only when the statement is about what an option sets: that option\u2019s id.' },
        field: { type: 'string', enum: ['level', 'target', 'holds_now', 'occurrence', 'lead', 'effect', 'measure', 'relation'] },
      }, ['kind', 'label', 'field']),
      statements: { type: 'array', minItems: 1, maxItems: 2, items: obj({
        quote: { type: 'string', description: 'The user\u2019s complete statement, copied exactly from one of their messages.' },
        speaker: QUOTE_SPEAKER,
        answering: { type: 'string', description: 'Only when the statement answers a question you asked: that question, copied exactly from your reply.' },
        reading_words: { type: 'string', description: 'Only for a statement without a figure (what a goal is measured in, or when effects are in place), or for when one option\u2019s effect is fully in place: the user\u2019s own words that say it, copied from the quote.' },
        // AIE amended semantic guidance; these optional readings do not establish a verified human fact.
        form: { type: 'string', enum: ['range'], description: 'Use range only for a range of this link’s effect on its target quantity, with the stated reference and conditions; a duration, budget, current level, goal or another quantity is not that effect.' },
        low: { type: 'number', description: 'Only with form:range: the lower endpoint of that effect range as stated, preserving its sign and scale.' },
        high: { type: 'number', description: 'Only with form:range: the upper endpoint of that effect range as stated, preserving its sign and scale.' },
        unit: { type: 'string', description: 'Only with form:range: the unit belonging to that effect quantity wherever it occurs in the statement; do not borrow another quantity’s unit or invent a missing one.' },
        negated: { type: 'boolean', description: 'Only with form:range: retain whether the statement denies this effect range; a denied range is not a positive supplied effect range, zero effect or the opposite range.' },
      }, ['quote']) },
    }, []), anyOf: [{ required: ['correction'] }, { required: ['subject', 'statements'] }] },
  },
  {
    type: 'function', name: 'propose_team_time',
    description: 'Propose the time today’s team would take to finish the event deliverable, after its deadline is held. Use a time the user stated in ANY of their messages in this conversation, this one or an earlier one. Never use a recruitment or hiring time, a deadline, a delay ("a month late") or a historical duration. Give quote: the user’s exact words stating that time, copied from one message, including any words about how sure they are (for example "a month late (so, 7 months), but I have low confidence"). Give low_months and high_months as that time in months: a single time such as "7 months" means both 7; convert weeks or years to months (weeks may be rounded to two decimals; the server keeps the exact conversion). Olumi checks the quote is the user’s and that the figure is in it. For a single time it adds its own range for the uncertainty, which the card labels as Olumi’s estimate from the user’s figure, never as the user’s. When the user asks what the model still needs and has already stated this time, call this. When the user gave the time as a bound ("at least 7 months", "no more than 9") or across several messages, give statements instead of quote, low_months and high_months: one per statement, each its complete sentence copied from any of their messages, with your reading of it. Only two hard ends make a range. A lone bound or a likely end is kept as stated on its own card, never turned into a single forecast and never given a range or probability of Olumi\u2019s; then ask only for the hard end still missing, never for what they already said. This prepares a card; authorise_change writes it only after approval.',
    parameters: obj({
      quote: { type: 'string', description: 'The user’s own words that state the time, copied exactly from one of their messages, including any words about how sure they are.' },
      low_months: { type: 'number', exclusiveMinimum: 0 }, high_months: { type: 'number', exclusiveMinimum: 0 },
      statements: { type: 'array', minItems: 1, maxItems: 6, description: 'The user’s statements of this time, one per statement, in place of quote, low_months and high_months.',
        items: obj({
          quote: { type: 'string', description: 'The user’s complete statement, copied exactly from one of their messages (for example "At least 7 months", or "8 months" when they answered your question about the likely upper end).' },
          speaker: QUOTE_SPEAKER,
          form: { type: 'string', enum: ['point', 'range', 'lower_bound', 'upper_bound'], description: 'Your reading: a single time, a range, the soonest it could be (lower_bound, for example "at least"), or the latest (upper_bound, for example "no more than", or an answer to a question about the upper end).' },
          value: { type: 'number', exclusiveMinimum: 0, description: 'For point, lower_bound or upper_bound: the months the quote states.' },
          low: { type: 'number', exclusiveMinimum: 0, description: 'For range: its soonest end in months.' },
          high: { type: 'number', exclusiveMinimum: 0, description: 'For range: its latest end in months.' },
          qualifier: { type: 'string', description: 'Only when the end is not a hard limit: the hedging word, from the quote or from the question it answered (for example "likely" for "the likely upper end"). Leave it out for a hard bound such as "at least".' },
          negated: { type: 'boolean', description: 'True when the statement says the time is NOT this figure.' },
          conditions: { type: 'string', description: 'Any condition the statement depends on, verbatim (for example "if we hire two developers"). Statements under different conditions are never combined.' },
          answering: { type: 'string', description: 'Only when the statement answers a question you asked: what that question was about, in your words (for example "the likely upper end"). It is shown as context on the card, never as the user\u2019s words.' },
        }, ['quote', 'form']) },
    }, []),
  },
  {
    // ⭐ E5 (Paul's manual test, 12 Oct): the start of each person an option adds, quoted; Olumi reads the months (`hiring-times.ts`).
    type: 'function', name: 'propose_hiring_times',
    description: 'Prepare one approval card for hiring starts, after the deadline is held. Use this turn and verified retained sources. Give each option_id and one entry per start in order, keeping its exact source words, bounds, uncertainty and relative timing. A human figure keeps its verified origin; your interpretation remains Olumi\'s. Assistant, chip, document or unknown-origin text is not new typed human authority. Do not substitute team completion, the goal deadline or effects being fully in place for a person\'s start. Show the complete replacement timings and sources; only approval bound to this card writes them.',
    parameters: obj({
      options: { type: 'array', minItems: 1, maxItems: 6, items: obj({
        option_id: { type: 'string' },
        starts: { type: 'array', minItems: 1, maxItems: 2, items: obj({ quote: { type: 'string' }, months: { type: 'number', minimum: 0, maximum: 60, description: 'Optional proposed interpretation of this start in months. Keep the quote\'s bounds, uncertainty and relative order; do not turn a bound into an exact human figure. An inferred number remains Olumi\'s interpretation.' } }, ['quote']) },
      }, ['option_id', 'starts']) },
    }, ['options']),
  },
  {
    type: 'function',
    name: 'propose_goal_deadline',
    description: 'Prepare one deadline card for approval. Keep the exact source deadline phrase and its conditions, using this turn or verified retained source. Interpret it from the actual known reference and any explicitly stated start; these have different roles. You may supply the proposed ISO deadline date, showing how it follows from that source. For a relative deadline (for example "6 months from last Friday"), pass the user\'s exact words and leave reference_date and deadline_date unset: Olumi resolves them from the recorded reference. Never invent or silently replace a reference, unit or level, or use recruitment/team completion time as the goal deadline. Put the full relevant source and uncertainty in rationale. Distinguish human wording from your interpretation; approval selects the displayed change without rewriting its original source. Nothing is saved before approval bound to this card. If the deadline belongs to a different deliverable, identify it with deliverable and retain the complete request. This tool does not replace or construct a goal: explain any unsupported change precisely, use supported targeted edits where they fit, and continue useful qualitative reasoning without claiming a save or asking for supplied facts again.',
    parameters: obj({
      reference_date: { type: 'string', description: 'Optional actual known or verified ISO reference date for this interpretation. Otherwise omit it and use the recorded reference. Do not substitute a duration\'s start or an invented date; retain an explicitly stated start in deadline_words and rationale.' },
      deadline_date: { type: 'string', description: 'Optional proposed ISO calendar deadline date derived from the actual source and known reference, shown with that basis for approval. An interpretation is not a newly stated human date.' },
      deadline_words: { type: 'string', maxLength: 80, description: 'Exact source deadline phrase being interpreted, including its timing qualifiers, within this field\'s limit. Retain the full surrounding source, conditions and authorship in rationale. A new Olumi proposal must be identified as such, not quoted as the user\'s words.' },
      rationale: { type: 'string', description: 'Full relevant source wording and conditions, its verified or unknown origin, the known reference and any stated start, and your reasoning for the proposed date. Distinguish source statements from your interpretation; do not drop negation, uncertainty or limits.' },
      deliverable: { type: 'string', maxLength: 100, description: 'Optional trigger for a deliverable in this message that differs from the model’s current goal. Copy a short exact phrase from the user’s words; it does not replace the complete purpose, scope, conditions or source retained in this correction. This trigger does not authorise replacing the saved goal.' },
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
    // ⭐ S5 (DL 15 Oct; Paul's ≤¼ PoC ruling): ONE generic change tool for the edits no other tool makes. Each op prepares the ONE
    // card that quotes the user's words; only its press changes the model, through the existing writer. Existing tools stay.
    type: 'function',
    name: 'propose_change',
    description:
      'Propose one to six targeted changes the user asks for in THIS message that no other tool makes. Prepare them together on the saved model. This does NOT change anything: it prepares ONE '
      + 'card that quotes their words and says exactly what the change does; only their press makes it. '
      + 'op remove: remove ONE factor or risk, or ONE link between two parts ("remove staff training", "drop that risk"); a factor\u2019s '
      + 'or risk\u2019s links, and any option\u2019s setting of a factor, go with it. '
      + 'op set_zero: the user says a link should be zero ("set this link to zero") and means it has no DIRECT influence: the card shows '
      + 'that reading and proposes removing that direct link (kind link). If they mean only its average effect is zero, or it "barely '
      + 'matters" or "could go either way", this is NOT set_zero: keep the link, and ask only which they mean where that is unclear. '
      + 'Never remove an option (use propose_option_status) or the goal. '
      + 'op rename: the user gives a new name for ONE option, factor or risk ("call it Hire three developers"): new_label is that name, '
      + 'copied exactly from their words. '
      + 'op option_timing: when ONE option\u2019s effect would be fully in place, as the user said it ("live about two months after we '
      + 'commit; full effect in about 4 months"): kind option, quote their complete statement, reading_words their own words that state '
      + 'the month(s). It goes through the same card as propose_statement\u2019s lead. '
      + 'For quantities and statements, use their existing targeted tools. Preserve every requested goal, condition and source. '
      + 'Where a part cannot be changed with the supported operations, explain that specific limitation and continue useful qualitative reasoning; never claim it was saved. '
      + 'Never a part the user did not ask to change, and never a name or figure of your own.',
    parameters: obj({
      ops: { type: 'array', minItems: 1, maxItems: 6, items: obj({
        op: { type: 'string', enum: ['remove', 'set_zero', 'rename', 'option_timing'] },
        kind: { type: 'string', enum: ['goal', 'option', 'factor', 'risk', 'link'] },
        label: { type: 'string', description: 'The part\u2019s exact label, as get_canonical_state returned it (for a link: where it starts).' },
        to_label: { type: 'string', description: 'Only for a link: the exact label of the part it points to.' },
        id: { type: 'string', description: 'The part\u2019s id, as get_canonical_state returned it. Give it whenever you have it: it names the part exactly.' },
        to_id: { type: 'string', description: 'Only for a link: the id of the part it points to.' },
        quote: { type: 'string', description: 'The user\u2019s complete statement asking for the change, copied exactly from THIS message.' },
        new_label: { type: 'string', description: 'Only for op rename: the new name, copied exactly from the user\u2019s words in quote.' },
        reading_words: { type: 'string', description: 'Only for op option_timing: the user\u2019s own words that state the month(s), copied from quote.' },
        answering: { type: 'string', description: 'Only for op option_timing, when the statement answers a question you asked: that question, copied exactly from your reply.' },
      }, ['op', 'kind', 'label', 'quote']) },
    }, ['ops']),
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
      + 'CURRENT MODEL STATE gives them. For a precondition or timing dependency ONLY, set relies_on_option to the option\'s '
      + 'exact label when the user\'s words or brief say that option depends on the event happening or not (e.g. a price rise '
      + 'launched with the next feature release). Then leave affects and caused_by empty: it is kept without links and left '
      + 'out of the Run, with that option\'s omission disclosed for the user to approve.',
    parameters: obj({
      label: { type: 'string', description: 'The risk in the user\u2019s own words (e.g. "Competitive response").' },
      relies_on_option: { type: 'string', description: 'Optional precondition lease: the exact label of the non-baseline option that depends on this event happening or not, as stated by the user or brief. Never an id. Leave affects and caused_by empty.' },
      affects: {
        type: 'array',
        description: 'What the risk threatens: the goal or an outcome in the model, and which way. At least one for an ordinary risk; [] for relies_on_option. Never a factor.',
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
      'Propose 1–3 NEW factors with finite current figures in known units, using this turn and verified retained quantity/source records. Preserve the original central figure, any bounds and qualifications, and their separate origins; do not invent a midpoint or turn a range into a probability law. A verified human figure remains human when reused later; your estimates remain Olumi\'s, and unknown origin stays unknown. Never invent a unit or use a coordinate cap or goal target as evidence for the figure. Show every value and source on one complete card; authorise_change only after approval bound to it. For an existing factor use propose_assumptions.',
    parameters: obj({
      factors: {
        type: 'array', minItems: 1, maxItems: 3,
        items: obj({
          label: { type: 'string' },
          unit: { type: 'string', description: 'The actual known quantity\'s unit, from the model or verified source, for example GBP/year per engineer. Preserve its physical meaning; never invent a unit or silently change it.' },
          today: obj({ value: { type: 'number', description: 'Whole units: 120000 for \u00a3120k.' }, unit: { type: 'string' },
            range_low: { type: 'number', description: 'Only when the user also gave a range for this figure, both ends in one sentence of theirs ("between 20% and 30%"): its low end, in the same unit as value. value stays the one figure they chose; never a midpoint.' },
            range_high: { type: 'number', description: 'The high end of that same range. Send it with range_low.' } }, ['value']),
          affects: { type: 'string', description: 'ONE existing outcome, the goal, or a factor no option sets, that it drives, as the CURRENT MODEL STATE labels it.' },
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
    description: 'Prepare ONE budget ceiling on an existing money quantity, or ONE percentage-level loss threshold, stated in THIS message. '
      + 'Call in the same turn as “we only have £200,000”, “our budget is £200k” or “we cannot spend more than £200,000”. '
      + 'Also call for “if it goes above 6%, we start to lose money”: above/over/more than/past/tops/exceeds with '
      + `${LOSS_THRESHOLD_CONSEQUENCES.join('/')} names the bad region, so propose at most 6%, inclusively. `
      + 'Use the percentage quantity named anywhere in THIS message, else the model’s only percentage-level quantity; if ambiguous, ask which. '
      + 'Questions, third-party or past losses, percentage changes, and positive consequences never state this ceiling. '
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
          user_stated: OPTION_LEVEL_USER_STATED,
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
              // AIE 6183364243, exact.
              'Keep the range\'s actual meaning, source and qualifications. A plain likely range does not by itself specify ' +
              'quartiles or a probability law. likely_range uses the existing scenario carrier only for a separately grounded ' +
              'Olumi approximation fully disclosed on the card and adopted by its press; the user\'s original range remains ' +
              'theirs, and the approximation remains Olumi\'s. min_max means stated lowest/highest possible; at_most and ' +
              'at_least are bounds; other preserves other meanings or unresolved interpretation. If the current writer cannot ' +
              'represent the supplied meaning, retain that source and explain the exact limitation; do not require the user to ' +
              'replace retained bounds with a likely range merely to make a calculation run.',
          },
          range_user_stated: {
            type: 'boolean',
            description: 'Set true ONLY when the USER gave this range (both ends) for this option and factor.',
          },
        }, ['option_label', 'factor_label', 'value', 'basis', 'user_stated']),
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
      '`stated_by: \'user\'` is the user’s own figure, never called an assumption. Values in the factor’s own units. ' +
      'Give each value in the unit the saved option or factor already holds, as get_canonical_state shows it; never relabel what is counted.' + LEVEL_BRINGS_ITS_LINK,
    parameters: obj({
      assumptions: {
        type: 'array',
        description: 'Starting values for factors that have none. May be empty.',
        items: obj({
          user_stated: ASSUMPTION_USER_STATED,
          factor_label: { type: 'string' },
          value: { type: 'number' },
          unit: { type: 'string' },
          basis: { type: 'string' },
        }, ['factor_label', 'value', 'unit', 'basis', 'user_stated']),
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
          user_stated: OPTION_LEVEL_USER_STATED,
        }, ['option_label', 'factor_label', 'value', 'basis', 'user_stated']),
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
      + 'price \u00d7 your subscribers?"), when a run_analysis result carries `identity_card` or the user answers an asked part. Call it with no arguments '
      + 'when all the parts already have the user\u2019s figures; the reading and its arithmetic come from the stored model. '
      + 'Optionally pass parts: [{part_label, value, unit}] for ALL missing parts: '
      + 'only exact figures the user just typed for parts the model asked for. This does NOT change anything: it records the reading and '
      + 'returns its `card.words`. Ask the user those words exactly, never reworded, and tell them to confirm on the button. '
      + 'Never state the reading as a fact before they confirm, and never run the analysis again yourself.',
    parameters: obj({
      parts: { type: 'array', items: obj({
        part_label: { type: 'string', description: 'The exact label of a missing part the model asked the user for.' },
        value: { type: 'number', description: 'Only the exact figure the user just typed for this part; never guess, round or invent it.' },
        unit: { type: 'string', description: 'The unit of that asked part, matching the figure the user just typed.' },
      }, ['part_label', 'value', 'unit']) },
    }, []),
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
      'This changes nothing. Include your provisional interpretation in the reply, labelled as your view of the current model rather than a computed result or a human fact. Preserve the supplied uncertainty, source and unresolved conditions. ' +
      'Call it at most once per reply. It is refused ' +
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
export const MUTATION_TOOLS: readonly string[] = ['propose_statement', 'propose_new_option', 'propose_option_status', 'propose_change', 'propose_new_risk', 'propose_new_factor', 'propose_link_strength', 'propose_link_effect', 'propose_link_strengths', 'propose_goal_target', 'propose_goal_deadline', 'propose_team_time', 'propose_hiring_times', 'propose_limit_change', 'propose_model_change', 'propose_assumptions', 'propose_option_interventions', 'propose_starting_point', 'reconcile_goal_scope', 'propose_goal_current_level', 'propose_identity', 'authorise_change', 'withdraw_proposal', 'propose_new_limit'];

/**
 * `core` (PATH-B, Paul 19 Oct: run the AI core apart from Olumi's meaning layer, on the same build, per request): the full
 * tool surface; the AI's own words are the reply, and Olumi adds or rewrites no prose after it. Protocol (identity, approval,
 * digest, CAS, readback, replay) and the science engine are unchanged. Selected per request by `x-olumi-ai-mode: core`
 * ({@link laneModeFor}), never in production, and never over a read-only preview.
 */
export type AgentLaneMode = 'full' | 'preview' | 'core';

/** The request's `x-olumi-ai-mode` value that selects {@link AgentLaneMode} `core`. */
export const AI_CORE_MODE = 'core';
/**
 * THIN CORE FLIP (A1): the UI's staging default lane (`aiComparisonMode.ts`: staging sends `openai` unless `?ai=` says
 * otherwise). On staging it is the core lane too, so the default typed turn runs on the OpenAI-native core.
 */
export const AI_OPENAI_MODE = 'openai';

/**
 * The lane mode for ONE request. A read-only preview stays read-only whatever the request says; `core` is honoured only on a
 * staging, local or test runtime, so a header can never select it in production (or on a runtime whose class is unknown).
 * THE NAMED BRIDGE (Codex #3522 r3): on the default header, a scenario saved before the core lane (`legacyScenario`: a graph
 * with no living model) keeps its full legacy lane, because core changes such a graph through only part of the legacy tools
 * (no risk, deadline, limit or option-status proposals). An explicit `core` request is unchanged.
 */
export function laneModeFor(base: AgentLaneMode, aiModeHeader: unknown, runtimeEnv: string, legacyScenario = false): AgentLaneMode {
  if (base === 'preview') return 'preview';
  const coreRuntime = runtimeEnv === 'staging' || runtimeEnv === 'local' || runtimeEnv === 'test';
  return coreRuntime && (aiModeHeader === AI_CORE_MODE || (aiModeHeader === AI_OPENAI_MODE && !legacyScenario)) ? 'core' : base;
}

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
  getCanonicalState(ctx: AgentToolContext, options?: { section: 'run_explanation' }): Promise<ToolResult>;
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
    from_label: string; to_label: string; strength?: 'weak' | 'moderate' | 'strong' | 'very strong';
    /** STEP 8 producer: a supported uncertainty for the size the user already gave on this link (`LINK_UNCERTAINTY`). */
    uncertainty?: {
      stated_as: 'standard_deviation' | 'normal_quantiles'; sd?: number; lower?: number; upper?: number;
      probability_inside?: number; probability_below?: number; probability_above?: number; unit: string; from_words: string;
      tails_words?: string; shape_words?: string; basis_words?: string; source?: string;
    };
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
    // #3002 known-origin transport: whose band the AI declares (`origin`, required in the tool schema), with its quote, cited
    // source or Olumi's own basis. An absent or unknown origin is never written.
    links: readonly { from_label: string; to_label: string; strength: 'weak' | 'moderate' | 'strong' | 'very strong'; from_words?: string;
      origin?: 'user' | 'third_party' | 'olumi'; source?: string; basis?: string }[];
    rationale: string;
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). */
  proposeGoalTarget?(ctx: AgentToolContext, args: {
    reframe?: unknown;
    constraint_type?: 'at_least' | 'at_most'; value?: number; unit?: string; rationale?: string;
    /** The goal's level today, when the user stated it beside the target: ONE card, ONE approval (AIQ 5913897396). */
    current_level?: { value: number; unit: string };
    /** What the figure is a figure OF, in the user's words; a restatement corrects the saved goal on its own card. */
    measures?: string;
    governing_outcome?: string;
    goal_change_quote?: string;
    later_ambition_quote?: string;
    deadline_words?: string;
    remove_mechanisms?: readonly { kind: 'factor' | 'risk' | 'link'; id?: string; label?: string; to_id?: string; to_label?: string; quote: string }[];
  }): Promise<ToolResult>;
  /** SYSTEM 1: the user's own statement about ONE subject, read, bound and verified by the ONE door, as ONE card. */
  proposeStatement?(ctx: AgentToolContext, args: { subject?: unknown; statements?: unknown; correction?: unknown }): Promise<ToolResult>;
  /** S-E GOALS: the user's current-team duration, proposed for approval. */
  proposeTeamTime?(ctx: AgentToolContext, args: { quote?: string; low_months?: number; high_months?: number; statements?: readonly StatementArgs[] }): Promise<ToolResult>;
  /** E5: the user's hiring times per option, quoted, proposed on ONE card for approval. */
  proposeHiringTimes?(ctx: AgentToolContext, args: { options: { option_id: string; starts: { quote: string; months?: number }[] }[] }): Promise<ToolResult>;
  /** The coaching loop: the user's new figure for a share of time an unresolved option changes, on ONE card. */
  /** S-E GOALS: the user's stated deadline as a date on the goal, proposed for approval. */
  proposeGoalDeadline?(ctx: AgentToolContext, args: { deadline_words: string; rationale: string; reference_date?: string; deadline_date?: string; deliverable?: string }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). MG F1 T6. */
  proposeOptionStatus?(ctx: AgentToolContext, args: {
    option_label: string; status: 'removed' | 'infeasible' | 'feasible'; rationale: string;
  }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). S5 (DL 15 Oct): propose_change's remove/set_zero ops. */
  proposeRemoval?(ctx: AgentToolContext, args: {
    kind: 'factor' | 'risk' | 'link'; label: string; to_label?: string; id?: string; to_id?: string; quote: string;
    /** op set_zero: the card shows that "zero" is read as removing the direct link (AIE 6188873084). */
    zero?: boolean;
  }): Promise<ToolResult>;
  /** Several existing correction adapters, prepared on one saved graph and approved as one candidate. */
  proposeChangeSet?(ctx: AgentToolContext, args: { ops: readonly unknown[] }): Promise<ToolResult>;
  /** Optional: propose_change's rename op (S5): the user's own new name for ONE option, factor or risk. */
  proposeRename?(ctx: AgentToolContext, args: { kind: 'option' | 'factor' | 'risk'; label: string; id?: string; new_label: string; quote: string }): Promise<ToolResult>;
  /** Optional: a capability set without it refuses the tool plainly (`dispatchTool`). SLICE C2. */
  proposeNewRisk?(ctx: AgentToolContext, args: {
    label: string; rationale: string;
    /** The host resolves and verifies this label; the model never supplies the node's relies_on stamp. */
    relies_on_option?: string;
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
  /**
   * `afterCommittedChange` is the ROUTE's own automatic Run after a committed change (Paul, #94 6166259456). The Agent's
   * `run_analysis` tool never passes it (`runAgentTool` hands over `(ctx, args)` only).
   */
  runAnalysis(ctx: AgentToolContext, args: { reason: string; effects_timing: EffectsTiming | null }, opts?: { readonly afterCommittedChange?: boolean }): Promise<ToolResult>;
  buildModelFromBrief(ctx: AgentToolContext, args: { brief: string; explicit_rebuild_request?: string }): Promise<ToolResult>;
  proposeAssumptions(ctx: AgentToolContext, args: {
    // `revise` is in the tool's schema (above) and read by the capability (`a?.revise === true`); the type now says so.
    assumptions: readonly { factor_id?: string; factor_label: string; value: number; unit: string; basis: string; user_stated: boolean; revise?: boolean; keep?: boolean }[];
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
    assumptions: readonly { factor_label: string; value: number; unit: string; basis: string; user_stated: boolean }[];
    option_levels: readonly { option_label: string; factor_label: string; value: number; basis: string; user_stated?: boolean; unmodelled_mechanisms?: readonly string[] }[];
  }): Promise<ToolResult>;
  /** The goal's current level as the user stated it — held for approval (`../goal-current-level.ts`). */
  reconcileGoalScope?(ctx: AgentToolContext, args: ReconcileGoalScopeArgs): Promise<ToolResult>;
  proposeGoalCurrentLevel(ctx: AgentToolContext, args: {
    goal_label: string; value: number; unit: string; goal_is?: 'at_least' | 'above' | 'at_most' | 'below'; user_stated: boolean;
  }): Promise<ToolResult>;
  /** The user confirms Olumi's reading of their goal as a product (`../identity-card.ts`). Optional: absent ⇒ refused plainly. */
  proposeIdentity?(ctx: AgentToolContext, args?: { parts: readonly { part_label: string; value: number; unit: string }[] }): Promise<ToolResult>;
  /** C5: the Agent's own provisional view on a withheld turn (`../provisional-view.ts`). Optional: absent ⇒ refused plainly. */
  giveProvisionalView?(ctx: AgentToolContext, args: { view: string; reasoning: string; confirm_step: string }): Promise<ToolResult>;
  /**
   * Whether a search control quoting this query would reach the user on this turn (the final egress gate's own chip
   * rule, read by the route from its readback). Absent ⇒ every sendable query is accepted, as before.
   */
  researchControlShowable?(ctx: AgentToolContext, query: string): Promise<boolean>;
}

/** A tool whose read of the model did not finish in its budget (S1): the call's outcome is not known here. */
export const STATE_READ_UNFINISHED = 'state_read_unfinished';

/**
 * ⭐ ONE BOUNDARY FOR EVERY TOOL CALL (S1, RCA 14 Oct 16:18Z). A read of the model that does not finish inside its
 * budget (`AnalysisReadDeadlineError`) throws out of the capability. With no boundary it ended the whole turn as a 502,
 * after the model had been saved: the build tool's read-back hit the deadline, and the reply was lost.
 *
 * Here that throw becomes a typed result the AI and the route can act on. The result says only what is known: the read
 * did not finish, so whether this call changed the model is UNKNOWN (`outcome_unknown`). It never says saved, never
 * says failed, and is never "no Run". `mutated: false` keeps a change that is not verified from triggering anything
 * that depends on a commit. The route's own final read of the turn decides what the user sees. Every other error
 * (a model read failure, a revision conflict) keeps its own handling in the route.
 */
export async function dispatchTool(
  name: string,
  rawArgs: string,
  ctx: AgentToolContext,
  caps: AgentCapabilities,
  mode: AgentLaneMode = 'full',
): Promise<ToolResult> {
  try {
    return await dispatchToolUnbounded(name, rawArgs, ctx, caps, mode);
  } catch (err) {
    if (!(err instanceof AnalysisReadDeadlineError)) throw err;
    log.warn({ event: 'agent_lane.tool_read_unfinished', tool: name, scenario_id: ctx.scenario_id, err: String(err) },
      'agent-lane: a tool\u2019s read of the model did not finish in time; its outcome is unknown, the turn continues');
    return {
      ok: false, mutated: false, refusal: STATE_READ_UNFINISHED, outcome_unknown: true,
      detail: 'A read of the model did not finish in time, so whether this call changed the model is not known. '
        + 'Do not say it was saved or that it failed.',
    };
  }
}

async function dispatchToolUnbounded(
  name: string,
  rawArgs: string,
  ctx: AgentToolContext,
  caps: AgentCapabilities,
  mode: AgentLaneMode,
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
    case 'propose_statement':
      return caps.proposeStatement !== undefined ? caps.proposeStatement(ctx, args as never) : { ok: false, mutated: false, refusal: 'unsupported' };
    case 'propose_team_time':
      return caps.proposeTeamTime !== undefined ? caps.proposeTeamTime(ctx, args as never) : { ok: false, mutated: false, refusal: 'unsupported' };
    case 'propose_hiring_times':
      return caps.proposeHiringTimes !== undefined ? caps.proposeHiringTimes(ctx, args as never) : { ok: false, mutated: false, refusal: 'unsupported' };
    case 'propose_goal_deadline':
      return caps.proposeGoalDeadline !== undefined
        ? caps.proposeGoalDeadline(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'A deadline cannot be recorded here. Nothing was changed.' };
    case 'propose_option_status':
      return caps.proposeOptionStatus !== undefined
        ? caps.proposeOptionStatus(ctx, args as never)
        : { ok: false, mutated: false, refusal: 'unknown_tool', detail: 'An option cannot be taken out or put back here. Nothing was changed.' };
    case 'propose_change': {
      // Singletons keep their existing proposer; a bounded set composes those same adapters before one approved save.
      const ops = Array.isArray(args?.ops) ? args.ops as unknown[] : [];
      if (ops.length > 1 && caps.proposeChangeSet !== undefined) return caps.proposeChangeSet(ctx, { ops });
      const op = ops.length === 1 && ops[0] !== null && typeof ops[0] === 'object' ? ops[0] as Record<string, unknown> : undefined;
      if ((op?.op === 'remove' || (op?.op === 'set_zero' && op.kind === 'link')) && caps.proposeRemoval !== undefined) {
        return caps.proposeRemoval(ctx, { kind: op.kind, label: op.label, to_label: op.to_label, id: op.id, to_id: op.to_id, quote: op.quote,
          ...(op.op === 'set_zero' ? { zero: true } : {}) } as never);
      }
      // ⭐ S5 op option_timing: the door's existing option-lead row (M3c), the same card and press as propose_statement's lead.
      if (op?.op === 'option_timing' && op.kind === 'option' && caps.proposeStatement !== undefined) {
        return caps.proposeStatement(ctx, { subject: { kind: 'option', label: op.label, ...(op.id !== undefined ? { id: op.id } : {}), field: 'lead' },
          statements: [{ quote: op.quote, ...(op.reading_words !== undefined ? { reading_words: op.reading_words } : {}),
            ...(op.answering !== undefined ? { answering: op.answering } : {}) }] } as never);
      }
      if (op?.op === 'rename' && caps.proposeRename !== undefined) {
        return caps.proposeRename(ctx, { kind: op.kind, label: op.label, id: op.id, new_label: op.new_label, quote: op.quote } as never);
      }
      return { ok: false, mutated: false, refusal: 'unsupported_change',
        detail: 'No whole-model replacement or unsupported edit was prepared. Retain the complete correction and its context. Use the existing targeted value, statement, goal, deadline or structural operations for supported parts; explain any remaining limitation and continue useful qualitative reasoning without claiming a save or asking for retained facts again.' };
    }
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
        ? caps.proposeIdentity(ctx, args as never)
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
