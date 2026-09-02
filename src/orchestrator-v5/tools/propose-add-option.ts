/**
 * `propose_add_option` — the FOCUSED model call for the add-option text leg,
 * and the deterministic validator that is its trust core (1 Sep 2026).
 *
 * WHAT THIS REPLACES. A typed "Add 'Partner with a local distributor' as an
 * option" turn used to be authored by the ~29k-character generic `edit_graph`
 * prompt, which owns every semantic operation at once. This module gives that
 * ONE operation its own small tool: a grounding table of the decision, the
 * options already on the model and the factors, and a schema that can express
 * an option and its links and NOTHING ELSE.
 *
 * ⭐ NEVER INVENT A NUMBER — ENFORCED BY THE SCHEMA, NOT BY THE PROMPT. The
 * tool has NO field for an effect value. A proposed link therefore carries a
 * factor and a reason and no magnitude, and the transaction writes the
 * option->factor edge with no `interventions` entry — which the canonical
 * status owner reads as `needs_encoding` ("Connected to N factor(s); awaiting
 * effect value(s)", `cee/transforms/option-status.ts`) and the readiness
 * intake turns into a question for the user. A prompt rule can be
 * out-competed; a missing field cannot. (The route's own recogniser
 * additionally declines any message that STATES a value, because writing that
 * number is the existing edit lane's job — so the two halves agree.)
 *
 * ⭐ GROUNDING, AND THE LABEL ECHO. Every id the model returns must resolve in
 * the persisted graph, and for each one it must also echo that entity's exact
 * LABEL. A wrong-but-plausible target (the substitution class: the user names
 * 'Gross margin', the model links 'Margin') fails the echo and REJECTS THE
 * WHOLE PROPOSAL. Borrowed from `propose-structural-edit.ts` G3/G6, for the
 * same reason and with the same fail-closed shape.
 *
 * ⭐ REJECT, NEVER REPAIR. One model call, no retry, no corrective round. On
 * any failure this module returns NO proposal — not a filtered subset — and
 * the caller falls through to the existing edit lane. A partially-salvaged
 * proposal is a proposal the user never described.
 *
 * The CONTRACT (grounding + schema + validator) is pure and unit-testable
 * without an LLM; `composeAddOption` is the only part that talks to an
 * adapter. Same split, and the same budget helper, as the structural composer.
 */

import { z } from 'zod';

import { log } from '../../utils/telemetry.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  CallOpts,
  ToolDefinition,
} from '../../adapters/llm/types.js';

export const PROPOSE_ADD_OPTION_TOOL_NAME = 'propose_add_option';

/**
 * How many factor links one proposal may carry. Small on purpose: an option
 * that plausibly touches everything is a modelling smell, and every link is a
 * question the user then has to answer. Two or three justified links is the
 * shape this path is for.
 */
export const MAX_ADD_OPTION_LINKS = 4;

// ---------------------------------------------------------------------------
// Grounding — built from the PERSISTED graph only.
// ---------------------------------------------------------------------------

export interface GroundedDecision {
  readonly id: string;
  readonly label: string;
}
export interface GroundedFactor {
  readonly id: string;
  readonly label: string;
  /** Unit of the observed value, when the model records one. */
  readonly unit?: string;
  /** controllable / observable / external, when classified. */
  readonly category?: string;
  /** A short human description, when the model records one. */
  readonly description?: string;
}
export interface GroundedOption {
  readonly id: string;
  readonly label: string;
  /** Factor ids this existing option already links to (the modelling precedent). */
  readonly linkedFactorIds: readonly string[];
}

export interface AddOptionGrounding {
  readonly decisions: readonly GroundedDecision[];
  readonly options: readonly GroundedOption[];
  readonly factors: readonly GroundedFactor[];
  readonly goalLabels: readonly string[];
  readonly labelById: ReadonlyMap<string, string>;
  readonly kindById: ReadonlyMap<string, string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Project the persisted graph into the add-option grounding.
 *
 * Duck-typed rather than strict-parsed, deliberately and narrowly: this is a
 * READ for a prompt, and it must not acquire the power to reject a graph the
 * transaction builder (which does its own validation against the same graph)
 * would have accepted. Returns null only when there is no readable node list —
 * and a null grounding means the tool DOES NOT ENGAGE, never a call against
 * nothing.
 */
export function buildAddOptionGrounding(persistedGraph: unknown): AddOptionGrounding | null {
  const graph = asRecord(persistedGraph);
  if (graph === null || !Array.isArray(graph.nodes)) return null;

  const decisions: GroundedDecision[] = [];
  const factors: GroundedFactor[] = [];
  const goalLabels: string[] = [];
  const optionSeed: Array<{ id: string; label: string }> = [];
  const labelById = new Map<string, string>();
  const kindById = new Map<string, string>();

  for (const raw of graph.nodes) {
    const node = asRecord(raw);
    if (node === null) continue;
    const id = readString(node.id);
    const kind = readString(node.kind);
    const label = readString(node.label);
    if (id === undefined || kind === undefined || label === undefined) continue;
    labelById.set(id, label);
    kindById.set(id, kind);
    if (kind === 'decision') decisions.push({ id, label });
    else if (kind === 'option') optionSeed.push({ id, label });
    else if (kind === 'goal') goalLabels.push(label);
    else if (kind === 'factor') {
      const observed = asRecord(node.observed_state);
      const factor: GroundedFactor = {
        id,
        label,
        ...(observed !== null && readString(observed.unit) !== undefined
          ? { unit: readString(observed.unit)! }
          : {}),
        ...(readString(node.category) !== undefined ? { category: readString(node.category)! } : {}),
        ...(readString(node.description) !== undefined
          ? { description: readString(node.description)! }
          : {}),
      };
      factors.push(factor);
    }
  }

  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const linksByOption = new Map<string, string[]>();
  for (const raw of edges) {
    const edge = asRecord(raw);
    if (edge === null) continue;
    const from = readString(edge.from);
    const to = readString(edge.to);
    if (from === undefined || to === undefined) continue;
    if (kindById.get(from) !== 'option' || kindById.get(to) !== 'factor') continue;
    const list = linksByOption.get(from);
    if (list === undefined) linksByOption.set(from, [to]);
    else list.push(to);
  }

  const options: GroundedOption[] = optionSeed.map((o) => ({
    id: o.id,
    label: o.label,
    linkedFactorIds: linksByOption.get(o.id) ?? [],
  }));

  return { decisions, options, factors, goalLabels, labelById, kindById };
}

/** Render the grounding for the tool description. Ids and labels, no prose. */
export function renderAddOptionGrounding(grounding: AddOptionGrounding): string {
  const decisionLines = grounding.decisions.map((d) => `  ${d.id} | ${d.label}`);
  const factorLines = grounding.factors.map((f) => {
    const bits = [f.unit !== undefined ? `unit: ${f.unit}` : null, f.category ?? null]
      .filter((b): b is string => b !== null)
      .join(', ');
    return `  ${f.id} | ${f.label}${bits.length > 0 ? ` (${bits})` : ''}`;
  });
  const optionLines = grounding.options.map((o) => {
    const linked = o.linkedFactorIds
      .map((id) => grounding.labelById.get(id) ?? id)
      .join(', ');
    return `  ${o.id} | ${o.label}${linked.length > 0 ? ` — changes: ${linked}` : ' — no factor links yet'}`;
  });
  return [
    `WHAT THE MODEL IS WORKING TOWARDS: ${grounding.goalLabels.join('; ') || '(not stated)'}`,
    '',
    `DECISIONS (${grounding.decisions.length}) — id | label`,
    ...(decisionLines.length > 0 ? decisionLines : ['  (none)']),
    '',
    `OPTIONS ALREADY ON THE MODEL (${grounding.options.length}) — id | label`,
    ...(optionLines.length > 0 ? optionLines : ['  (none)']),
    '',
    `FACTORS (${grounding.factors.length}) — id | label`,
    ...(factorLines.length > 0 ? factorLines : ['  (none)']),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The tool.
// ---------------------------------------------------------------------------

/**
 * ⚠ EVERY object in this schema declares `additionalProperties: false`
 * EXPLICITLY. Anthropic rejects `true` AND rejects the key being omitted —
 * both forms 400'd the structural composer in production, a fortnight apart
 * (see `propose-structural-edit.ts` ROADMAP 2.655). Do not "tidy" one away.
 */
export function buildProposeAddOptionTool(grounding: AddOptionGrounding): ToolDefinition {
  return {
    name: PROPOSE_ADD_OPTION_TOOL_NAME,
    description:
      'Add ONE new option to the decision model, and say which factors it ' +
      'changes.\n' +
      '\n' +
      'GROUND EVERYTHING IN THE MODEL BELOW. `parent_decision_id` and every ' +
      '`factor_id` must be an id from the table, and you must echo that ' +
      "entity's exact label alongside it. An id that is not in the table, or " +
      'a label that does not match the id you named, REJECTS THE WHOLE ' +
      'PROPOSAL — nothing is added. Do not guess an id to make a proposal ' +
      'look complete.\n' +
      '\n' +
      'LINK A FACTOR ONLY WHERE THE MODEL ALREADY SUPPORTS IT. Propose a link ' +
      'when this option plainly changes that factor, given what the model ' +
      'says the factor is and how the existing options are linked. One or two ' +
      'well-justified links is a better answer than five speculative ones. If ' +
      'nothing in the model is clearly affected, propose no links at all: the ' +
      'option is still worth adding on its own.\n' +
      '\n' +
      'PREFER FACTORS MARKED `controllable`. Those are the things a choice ' +
      'actually sets. Factors marked `observable` or `external` are context — ' +
      'they move the outcome but an option does not set them, so linking one ' +
      'adds a line to the model that leads nowhere.\n' +
      '\n' +
      'YOU CANNOT STATE A SIZE OF EFFECT, AND YOU MUST NOT TRY. There is no ' +
      'field for a number here, by design. A link means "this option changes ' +
      'this factor"; the user is asked for the size afterwards. Never put a ' +
      'number, a percentage or a money amount in a rationale as if it were ' +
      'the effect — say why the link exists, in one short sentence.\n' +
      '\n' +
      'IF YOU CANNOT TELL WHICH DECISION THIS OPTION BELONGS TO, ask instead ' +
      'of choosing: fill in `clarification` and leave `parent_decision_id` ' +
      'out. Guessing the parent puts the option in the wrong contest.\n' +
      '\n' +
      'THE CURRENT MODEL:\n' +
      `${renderAddOptionGrounding(grounding)}\n` +
      '\n' +
      'The option is held for the user to confirm; nothing moves in the model ' +
      'until they do. Do not say the change has been made.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        label: {
          type: 'string',
          description:
            "The option's name, as the user would write it on the model. Keep " +
            "the user's own words; tidy the capitalisation only. Do not " +
            'include the word "option".',
        },
        parent_decision_id: {
          type: 'string',
          description:
            'The id of the decision this option belongs to, from the table ' +
            'above. Omit it and fill in `clarification` if more than one ' +
            'decision could plausibly own it.',
        },
        parent_decision_label: {
          type: 'string',
          description:
            "That decision's exact label, copied from the table. Required " +
            'whenever `parent_decision_id` is given.',
        },
        links: {
          type: 'array',
          maxItems: MAX_ADD_OPTION_LINKS,
          description:
            'The factors this option changes. May be empty. Never more than ' +
            `${MAX_ADD_OPTION_LINKS}.`,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              factor_id: {
                type: 'string',
                description: 'The factor id, from the table above.',
              },
              factor_label: {
                type: 'string',
                description: "That factor's exact label, copied from the table.",
              },
              rationale: {
                type: 'string',
                description:
                  'One short sentence on why this option changes this factor. ' +
                  'No numbers.',
              },
            },
            required: ['factor_id', 'factor_label', 'rationale'],
          },
        },
        unknowns: {
          type: 'array',
          description:
            'Anything the user named that is NOT in the model above — say it ' +
            'here rather than linking something else that looks similar.',
          items: { type: 'string' },
        },
        clarification: {
          type: 'object',
          additionalProperties: false,
          description:
            'Use ONLY when you cannot tell which decision owns this option.',
          properties: {
            question: {
              type: 'string',
              description: 'One short question for the user.',
            },
            candidate_decision_ids: {
              type: 'array',
              description: 'The decision ids the option could belong to.',
              items: { type: 'string' },
            },
          },
          required: ['question', 'candidate_decision_ids'],
        },
      },
      required: ['label'],
    },
  };
}

// ---------------------------------------------------------------------------
// Validation — deterministic, fail-closed, and the only authority.
// ---------------------------------------------------------------------------

const LinkSchema = z.object({
  factor_id: z.string().min(1),
  factor_label: z.string().min(1),
  rationale: z.string().min(1),
});

const ProposalSchema = z.object({
  label: z.string().min(1),
  parent_decision_id: z.string().min(1).optional(),
  parent_decision_label: z.string().min(1).optional(),
  links: z.array(LinkSchema).default([]),
  unknowns: z.array(z.string()).default([]),
  clarification: z
    .object({
      question: z.string().min(1),
      candidate_decision_ids: z.array(z.string()).default([]),
    })
    .optional(),
});

export const ADD_OPTION_REJECTION_CODES = [
  'SCHEMA_INVALID',
  'NO_DECISION_IN_MODEL',
  'UNKNOWN_DECISION_ID',
  'NOT_A_DECISION',
  'DECISION_LABEL_MISMATCH',
  'UNKNOWN_FACTOR_ID',
  'NOT_A_FACTOR',
  'FACTOR_LABEL_MISMATCH',
  'DUPLICATE_FACTOR',
  'TOO_MANY_LINKS',
  'DUPLICATE_OPTION_LABEL',
  'LABEL_COLLIDES_WITH_EXISTING_NODE',
  'LABEL_IS_THE_PARENT_DECISION',
  'LABEL_UNUSABLE',
] as const;
export type AddOptionRejectionCode = (typeof ADD_OPTION_REJECTION_CODES)[number];

/** A validated proposal, in the shape `buildAddOptionTransaction` consumes. */
export interface ValidatedAddOption {
  readonly label: string;
  readonly parentDecisionId: string;
  /** One entry per link, ALWAYS `value: null` — this path states no magnitudes. */
  readonly interventions: ReadonlyArray<{ readonly factor_id: string; readonly value: null }>;
  readonly rationales: ReadonlyArray<{ readonly factorId: string; readonly rationale: string }>;
  readonly unknowns: readonly string[];
}

export type AddOptionValidation =
  | { readonly ok: true; readonly proposal: ValidatedAddOption }
  | {
      readonly ok: false;
      readonly kind: 'rejected';
      readonly code: AddOptionRejectionCode;
      readonly reason: string;
    }
  | {
      readonly ok: false;
      readonly kind: 'clarify';
      readonly question: string;
      readonly candidates: ReadonlyArray<{ readonly id: string; readonly label: string }>;
      readonly label: string;
    };

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The nouns a decision's label ends in when it is named after its subject —
 * "Pricing decision", "Expansion strategy", "Hiring plan", "The build-or-buy
 * question".
 *
 * ⭐ A CLOSED LIST, AND THAT IS THE POINT. Extending this list adds no
 * judgement over natural language, so it cannot oscillate: a member is either
 * a head noun or it is not. Contrast the rule that was PROPOSED and rejected
 * for this seam — "refuse a single-word label that is a whole word of the
 * decision's subject" — which closes 4 lies and opens 14 gaps on the
 * archetypal decision shape ("Build or buy" -> the options ARE "Build" and
 * "Buy"), and whose disjunction-aware escape re-opens 5 lies. See the note on
 * `labelIsTheDecisionItself` for where that class actually has to be solved.
 */
const DECISION_HEAD_NOUN = /\s+(?:decision|decisions|strategy|choice|question|problem|call|plan)$/;
const LEADING_ARTICLE_IN_LABEL = /^(?:the|a|an)\s+/;

/** A decision label reduced to its SUBJECT: "Pricing decision" -> "pricing". */
function decisionSubject(label: string): string {
  return normaliseLabel(label).replace(LEADING_ARTICLE_IN_LABEL, '').replace(DECISION_HEAD_NOUN, '').trim();
}

/**
 * ⭐ IS THIS PROPOSED NAME JUST THE DECISION ITSELF, MINUS ITS HEAD NOUN?
 *
 * The second layer under the recogniser's target/label screen, and it exists
 * because the recogniser CANNOT reach this class. "Add an option for pricing"
 * and "add an option for licensing" are the same shape — a bare gerund after a
 * preposition — so a graph-blind rule can only tell them apart by guessing.
 * This one is GRAPH-AWARE: `pricing` is the parent decision "Pricing decision"
 * with its head noun removed, and offering the user "Pricing" as an option
 * under "Pricing decision" is the lie the whole screen exists to stop.
 * `licensing` matches no decision and passes.
 *
 * ⚠ DELIBERATELY NOT the broader "label is a whole-word substring of a
 * decision label" form. Measured against that form, a decision phrased as a
 * question — "Should we expand into Germany?" — refuses its own best option,
 * "Expand into Germany", which is a legitimate answer and the single most
 * useful thing this path can produce. Equality-after-stripping catches every
 * case the corpus found without that cost. A false refusal here is only a GAP
 * (the generic edit lane serves the turn); a false accept is a LIE. That
 * asymmetry justifies a rule this tight, not a rule this loose.
 *
 * ⭐⭐ KNOWN-OPEN, AND THE RULE-ADDING APPROACH IS FINISHED HERE. A single-word
 * label that is only PART of the decision's subject still passes: "Expansion"
 * under "Geographic expansion strategy", "Germany" under "Should we expand
 * into Germany?". The obvious next rule was run as a probe BEFORE being
 * written, and it oscillates:
 *
 *   · refuse a single-word label that is a whole word of the subject
 *       -> closes 4 lies, OPENS 14 GAPS on the archetypal decision shape,
 *          where the label names its own alternatives: "Build or buy" ->
 *          "Build"/"Buy"; "Lease vs purchase"; "Repair or replace";
 *          "Should we expand into Germany or France?" -> "Germany"/"France".
 *   · switch that off when the subject carries a disjunction marker
 *       -> closes the 14, RE-OPENS 5 LIES, because a marker ANYWHERE disables
 *          the rule for EVERY word: "Expansion" under "Expansion strategy for
 *          Germany or France", "Vendor" under "Vendor selection: Oracle or SAP".
 *
 * The discriminator is whether the single word is a DISJUNCT of the decision
 * or a FRAGMENT of its topic — a syntactic-role judgement. "Expansion or
 * consolidation strategy" and "Expansion strategy for Germany or France" carry
 * the same word and the same marker and need opposite answers. No string rule
 * reaches that, and a sixth round would be sunk cost wearing engineering
 * clothes.
 *
 * ⭐ THE SUCCESSOR WORK IS THE `clarify` ARM OF THIS FUNCTION'S OWN RETURN
 * TYPE, not a fifth rule. Where a single word appears in the parent decision's
 * label, the honest answer is neither refuse nor accept but ASK — "an option
 * called Build, or are you naming the decision?" `AddOptionValidation` already
 * carries `kind: 'clarify'`. ⚠ THE ROUTE DOES NOT RENDER IT — `route-v2.ts`
 * branches only on `composed.status === 'composed'` and every other status
 * falls through to the generic edit lane (`fell_through:text_clarify`). The
 * clarify arm that IS wired asks WHICH DECISION owns the option, not what the
 * LABEL should be. The successor has to WIRE this as well as call it. Make the
 * ambiguity the product; that is the documented exit for an unwinnable parse.
 */
function labelIsTheDecisionItself(label: string, decisionLabel: string): boolean {
  const l = normaliseLabel(label).replace(LEADING_ARTICLE_IN_LABEL, '').trim();
  const d = normaliseLabel(decisionLabel).replace(LEADING_ARTICLE_IN_LABEL, '').trim();
  if (l.length === 0 || d.length === 0) return false;
  // Either side may be the one carrying the head noun.
  return l === decisionSubject(d) || decisionSubject(l) === d || decisionSubject(l) === decisionSubject(d);
}

/**
 * Validate a raw tool payload against the grounding. PURE; never throws.
 *
 * The order is deliberate: schema, then the clarify exit, then identity. A
 * clarify that also named a bad factor is still a clarify — the user is being
 * asked a question, and there is no mutation to protect.
 */
export function validateProposedAddOption(
  raw: unknown,
  grounding: AddOptionGrounding,
): AddOptionValidation {
  const parsed = ProposalSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, kind: 'rejected', code: 'SCHEMA_INVALID', reason: 'unreadable tool payload' };
  }
  const p = parsed.data;

  const label = p.label.replace(/\s+/g, ' ').trim();
  if (label.length < 2 || label.length > 120 || !/[a-z]/i.test(label)) {
    return { ok: false, kind: 'rejected', code: 'LABEL_UNUSABLE', reason: 'the proposed name is not usable' };
  }

  // The clarify exit — asked for explicitly, or forced because the model gave
  // no parent and the model has more than one decision to choose between.
  const needsParent = p.parent_decision_id === undefined;
  if (p.clarification !== undefined || needsParent) {
    if (grounding.decisions.length === 0) {
      return {
        ok: false,
        kind: 'rejected',
        code: 'NO_DECISION_IN_MODEL',
        reason: 'the model has no decision for an option to hang off',
      };
    }
    // Exactly one decision and no explicit ask: there is nothing to clarify.
    if (p.clarification === undefined && grounding.decisions.length === 1) {
      p.parent_decision_id = grounding.decisions[0]!.id;
      p.parent_decision_label = grounding.decisions[0]!.label;
    } else {
      const named = (p.clarification?.candidate_decision_ids ?? []).filter((id) =>
        grounding.decisions.some((d) => d.id === id),
      );
      const candidates = (named.length > 0 ? named : grounding.decisions.map((d) => d.id)).map(
        (id) => ({ id, label: grounding.labelById.get(id) ?? id }),
      );
      return {
        ok: false,
        kind: 'clarify',
        question:
          p.clarification?.question ??
          'Which decision should this option sit under?',
        candidates,
        label,
      };
    }
  }

  const parentId = p.parent_decision_id!;
  const parentKind = grounding.kindById.get(parentId);
  if (parentKind === undefined) {
    return {
      ok: false,
      kind: 'rejected',
      code: 'UNKNOWN_DECISION_ID',
      reason: 'the proposed parent decision is not in the model',
    };
  }
  if (parentKind !== 'decision') {
    return { ok: false, kind: 'rejected', code: 'NOT_A_DECISION', reason: 'the proposed parent is not a decision' };
  }
  // The LABEL ECHO — the anti-substitution guard.
  const parentLabel = grounding.labelById.get(parentId);
  if (
    p.parent_decision_label !== undefined &&
    parentLabel !== undefined &&
    normaliseLabel(p.parent_decision_label) !== normaliseLabel(parentLabel)
  ) {
    return {
      ok: false,
      kind: 'rejected',
      code: 'DECISION_LABEL_MISMATCH',
      reason: 'the parent decision named does not match the id given',
    };
  }

  // ⭐ AN OPTION MAY NOT BE NAMED AFTER SOMETHING THE MODEL ALREADY IS.
  //
  // The second layer under the recogniser's target/label boundary, and it is
  // deliberately GRAPH-AWARE where that one is graph-blind. If a target
  // reference ever reaches here as a label — "Pricing decision", or the parent
  // decision's own name — this refuses it even though every id resolved and
  // every label echoed perfectly. That is the point: a guard binding LABEL to
  // ID cannot see a correctly-labelled WRONG target, so the check that can see
  // it has to ask a different question — is this name already something else
  // on this model?
  //
  // Checked over EVERY node, not just decisions: an option named after a goal
  // or a factor is the same confusion wearing a different kind.
  for (const [id, existing] of grounding.labelById) {
    if (normaliseLabel(existing) !== normaliseLabel(label)) continue;
    if (grounding.kindById.get(id) === 'option') break; // the option-specific code below owns it
    return {
      ok: false,
      kind: 'rejected',
      code: 'LABEL_COLLIDES_WITH_EXISTING_NODE',
      reason: 'the proposed name is already the name of something else on the model',
    };
  }

  // ...and an option may not be named after the DECISION IT HANGS OFF, even
  // when the two strings differ. See `labelIsTheDecisionItself`.
  for (const d of grounding.decisions) {
    if (!labelIsTheDecisionItself(label, d.label)) continue;
    return {
      ok: false,
      kind: 'rejected',
      code: 'LABEL_IS_THE_PARENT_DECISION',
      reason: 'the proposed name is the decision itself, not an option for it',
    };
  }

  // A name the model already carries is not a new option.
  if (grounding.options.some((o) => normaliseLabel(o.label) === normaliseLabel(label))) {
    return {
      ok: false,
      kind: 'rejected',
      code: 'DUPLICATE_OPTION_LABEL',
      reason: 'an option with that name is already on the model',
    };
  }

  if (p.links.length > MAX_ADD_OPTION_LINKS) {
    return { ok: false, kind: 'rejected', code: 'TOO_MANY_LINKS', reason: 'too many factor links proposed' };
  }

  const seen = new Set<string>();
  const interventions: Array<{ factor_id: string; value: null }> = [];
  const rationales: Array<{ factorId: string; rationale: string }> = [];
  for (const link of p.links) {
    if (seen.has(link.factor_id)) {
      return { ok: false, kind: 'rejected', code: 'DUPLICATE_FACTOR', reason: 'the same factor was linked twice' };
    }
    seen.add(link.factor_id);
    const kind = grounding.kindById.get(link.factor_id);
    if (kind === undefined) {
      return {
        ok: false,
        kind: 'rejected',
        code: 'UNKNOWN_FACTOR_ID',
        reason: 'a linked factor is not in the model',
      };
    }
    if (kind !== 'factor') {
      return { ok: false, kind: 'rejected', code: 'NOT_A_FACTOR', reason: 'a link named something that is not a factor' };
    }
    const factorLabel = grounding.labelById.get(link.factor_id);
    if (factorLabel !== undefined && normaliseLabel(link.factor_label) !== normaliseLabel(factorLabel)) {
      return {
        ok: false,
        kind: 'rejected',
        code: 'FACTOR_LABEL_MISMATCH',
        reason: 'a linked factor name does not match the id given',
      };
    }
    interventions.push({ factor_id: link.factor_id, value: null });
    rationales.push({ factorId: link.factor_id, rationale: link.rationale });
  }

  return {
    ok: true,
    proposal: {
      label,
      parentDecisionId: parentId,
      interventions,
      rationales,
      unknowns: p.unknowns.filter((u) => typeof u === 'string' && u.trim().length > 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Transport — one call, one validation, one answer.
// ---------------------------------------------------------------------------

export interface AddOptionComposerAdapter {
  readonly name?: string;
  chatWithTools?: (
    args: ChatWithToolsArgs,
    opts: CallOpts,
  ) => Promise<ChatWithToolsResult>;
}

export interface AddOptionComposeInput {
  readonly adapter: AddOptionComposerAdapter;
  readonly grounding: AddOptionGrounding;
  /** The user's request, verbatim. */
  readonly message: string;
  /** The option name the deterministic recogniser extracted (a strong hint). */
  readonly detectedLabel: string;
  readonly requestId: string;
  readonly scenarioId: string;
  /** Derived by the caller from what is LEFT of the turn. No default here. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export type AddOptionComposeOutcome =
  | { readonly status: 'composed'; readonly proposal: ValidatedAddOption }
  | {
      readonly status: 'clarify';
      readonly question: string;
      readonly candidates: ReadonlyArray<{ readonly id: string; readonly label: string }>;
      readonly label: string;
    }
  | { readonly status: 'rejected'; readonly code: AddOptionRejectionCode; readonly reason: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'no_tool_adapter' | 'call_failed' | 'no_tool_call';
    };

const COMPOSER_SYSTEM_PROMPT =
  'You are helping someone build a decision model. They have asked for a new ' +
  'option to be added. Call the `propose_add_option` tool exactly once.\n' +
  '\n' +
  'Work only from the model in the tool description. Name the option the way ' +
  'the user named it. Link it to the factors it plainly changes, and say in ' +
  'one line why each link is there. You have no way to state how big an ' +
  'effect is, and you must not imply one: the user is asked for the numbers ' +
  'after they confirm the option.\n' +
  '\n' +
  'If the user named something that is not in the model, put it in ' +
  '`unknowns` rather than linking whatever looks closest. A wrong link is ' +
  'worse than a missing one.\n' +
  '\n' +
  'Do not claim the option has been added. It is held for the user to confirm.';

const COMPOSER_MAX_TOKENS = 1500;

/**
 * Compose ONE add-option proposal. Never throws: an adapter failure resolves
 * to `unavailable`, which the caller reports as an inability to compose — not
 * as a refusal of the request, and never as a silent no-op.
 */
export async function composeAddOption(
  input: AddOptionComposeInput,
): Promise<AddOptionComposeOutcome> {
  const chatWithTools = input.adapter.chatWithTools;
  if (typeof chatWithTools !== 'function') {
    return { status: 'unavailable', reason: 'no_tool_adapter' };
  }

  const tool = buildProposeAddOptionTool(input.grounding);
  let result: ChatWithToolsResult;
  try {
    result = await chatWithTools.call(
      input.adapter,
      {
        system: COMPOSER_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content:
              `${input.message}\n\n` +
              `(The option to add is: "${input.detectedLabel}".)`,
          },
        ],
        tools: [tool],
        tool_choice: { type: 'tool', name: PROPOSE_ADD_OPTION_TOOL_NAME },
        temperature: 0,
        maxTokens: COMPOSER_MAX_TOKENS,
      },
      {
        requestId: input.requestId,
        timeoutMs: input.timeoutMs,
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
      },
    );
  } catch (err) {
    log.warn(
      {
        event: 'v5.add_option_proposal.call_failed',
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        err:
          err instanceof Error
            ? { name: err.name, message: err.message }
            : { message: String(err) },
      },
      'V5 propose_add_option — composer call failed; the turn defers to the edit lane rather than guessing',
    );
    return { status: 'unavailable', reason: 'call_failed' };
  }

  const toolUse = result.content.find(
    (block): block is Extract<typeof block, { type: 'tool_use' }> =>
      block.type === 'tool_use' && block.name === PROPOSE_ADD_OPTION_TOOL_NAME,
  );
  if (toolUse === undefined) {
    return { status: 'unavailable', reason: 'no_tool_call' };
  }

  const validation = validateProposedAddOption(toolUse.input, input.grounding);

  // No telemetry event of its own, deliberately: the CALLER emits
  // `v5.add_option_transaction` with an `origin: 'text'` and an outcome that
  // already names every branch below (`fell_through:text_rejected` carries the
  // rejection code). A second event would duplicate that at the cost of
  // widening a frozen registry, and would still not know what the TURN did.
  if (validation.ok) return { status: 'composed', proposal: validation.proposal };
  if (validation.kind === 'clarify') {
    return {
      status: 'clarify',
      question: validation.question,
      candidates: validation.candidates,
      label: validation.label,
    };
  }
  return { status: 'rejected', code: validation.code, reason: validation.reason };
}
