/**
 * Replacement conversation layer — the ONE tool that puts a whole repair set to
 * the user.
 *
 * ⭐ WHAT IT REPLACES, AND THE SENTENCE IT EXISTS TO MAKE FALSE.
 * Before this, the only way the model could learn what was missing was to
 * propose a run and be refused: `run_analysis` turns a rich per-gap record into
 * a prose bullet list via `readinessQuestions`, and that projection drops
 * `obligation`, `provenance`, `option_id` and `factor_id`. The refusal then
 * tells the model *"the missing judgements are theirs"* — of every gap — and
 * *"one at a time if that reads better"*. On 21 Sep (`48a1ce84`) that produced
 * nine exchanges, one number per turn, the same four-item list four times, and:
 *
 *   "Tackling them together isn't possible in one step. Each mapping is a
 *    separate fix, so pick one option to start with."
 *
 * ── THE SHAPE, AND WHY IT IS THIS SHAPE ──────────────────────────────────
 *
 * ONE call returns TWO groups with DIFFERENT instructions, because they are
 * different acts:
 *
 *   · **OFFERS** — numbers Olumi already holds and can stand behind. The model
 *     shows each number and asks whether it is about right. The user may agree
 *     to the whole set in one breath, or change any single one.
 *   · **ASKS** — gaps Olumi has no basis to fill, carrying the readiness
 *     authority's own words. Split again by `obligation`, because INV-P6 says a
 *     gap over structure OLUMI authored may be OFFERED and never DEMANDED.
 *
 * ⛔ THE COPY BELOW IS INSTRUCTION TO THE MODEL, NOT PRODUCT VOICE. Every other
 * tool in this layer works the same way and `composeTurn` deliberately does not
 * rewrite model prose (the retired path had five egress rewriters and destroyed
 * correct answers). The user-facing wording is Paul's call; what is built here
 * is the SHAPE and the property it enforces — that the two groups can never be
 * spoken as one undifferentiated list of chores.
 *
 * ⚠ ONE THING THIS TOOL DOES NOT DO, STATED SO NOBODY INFERS IT. Agreeing to an
 * offer writes the value through the ordinary edit path; what provenance stamp
 * that write lands is the applier's business, and this module makes no claim
 * that confirming an estimate converts it to user-authored. It must not: the
 * 20 Sep ruling in `obligation-provenance.ts` is explicit that ratification is
 * NOT authorship, and a bulk confirm that earned authorship credit would be
 * exactly the harm `user_ratified` was minted to prevent.
 */

import { buildRepairPlan, planIsEmpty, type RepairAsk, type RepairPlan } from './repair-plan.js';
import { resolveRunAdmission as defaultResolveRunAdmission } from '../tools/handlers/analysis-ready-core.js';

import type { AgentTool, AgentToolOutcome, ProposedPart } from './agent-loop.js';
import type { RunAdmission } from '../tools/handlers/analysis-ready-core.js';

/** The tool's name, exported so callers advertise it without a literal. */
export const PROPOSE_REPAIRS_TOOL_NAME = 'propose_repairs';

export const PROPOSE_REPAIRS_NO_GRAPH =
  'There is no model on screen yet, so there is nothing to repair. Talk the decision through first.';

export const PROPOSE_REPAIRS_NOTHING_TO_DO =
  'THERE IS NOTHING TO REPAIR. The model can be analysed as it stands and no value in it is one ' +
  'of mine that the user has not seen. Offer to run the analysis instead of asking them for ' +
  'anything.';

export interface ProposeRepairsToolDeps {
  /** The graph as it stands. `null`/`undefined` when the session has none. */
  readonly getGraph: () => unknown | null | undefined;
  /** The admission authority. Injected only so tests can drive branches without
   *  hand-building a graph for each; production takes the default, which is the
   *  same function the run path uses. */
  readonly resolveAdmission?: (graph: unknown) => RunAdmission;
}

/** One line per offer. Plain, short, and it always carries the number. */
function offerLines(plan: RepairPlan): string[] {
  return plan.offers.map(
    (o) => `  · ${o.option_label} → ${o.factor_label}: my estimate is ${o.value}`,
  );
}

/**
 * Asks, split by whose gap it is.
 *
 * ⛔ THE SPLIT IS THE POINT AND IT IS NOT COSMETIC. `obligation` is the
 * readiness authority's own ruling on whether a gap may be put as a demand. A
 * surface that cannot see it asks the user to supply values for links, options
 * and factors the product invented — which is the failure INV-P6 was written
 * for and the one Paul described as being made to understand causal-model
 * internals.
 */
function askSections(asks: readonly RepairAsk[]): string[] {
  const required = asks.filter((a) => a.obligation === 'required');
  const offered = asks.filter((a) => a.obligation !== 'required');
  const out: string[] = [];

  if (required.length > 0) {
    out.push(
      '',
      'ONLY THEY CAN ANSWER THESE — these are over things they told you, so ask directly:',
      ...required.map((a) => `  · ${a.prompt}`),
    );
  }
  if (offered.length > 0) {
    out.push(
      '',
      'THESE ARE GAPS IN STRUCTURE I BUILT, SO INVITE — NEVER DEMAND. Do not tell the user they ' +
        'must supply these. Offer to work them through together, and say plainly that I put this ' +
        'part of the model there, not them:',
      ...offered.map(
        (a) => `  · ${a.prompt}${a.waived_by_exclusion ? ' (the run would leave this option out)' : ''}`,
      ),
    );
  }
  return out;
}

/**
 * ⭐⭐⭐ THE SECTION THAT CLEARS THE BLOCKER NO VALUE CAN CLEAR.
 *
 * The readiness authority's own prompt for a link-blocked option asks the user
 * to *"choose which factor <option> changes and by how much"* — a FACTOR
 * question for a RISK blocker, on an option that already carries its effect
 * values. Answering it perfectly changes nothing. That prompt is deliberately
 * NOT relayed; it is kept on the item as `authority_prompt` so the disagreement
 * is on the record rather than silently dropped.
 */
function blockedLinkSection(plan: RepairPlan): string[] {
  if (plan.blocked_links.length === 0) return [];
  const out: string[] = [
    '',
    'THESE OPTIONS ARE HELD BACK BY A LINK, NOT BY A MISSING NUMBER. Nothing they could tell you '
      + 'about a value will free these up — the only thing that will is a decision about the link '
      + 'itself. Do NOT ask them for a number here:',
  ];
  for (const link of plan.blocked_links) {
    out.push(
      `  · "${link.option_label}" is linked to the risk "${link.risk_label}", and the checker `
        + `cannot put a number on an option→risk link.`,
      `      I have offered: ${link.resolutions[0]!.summary.toLowerCase()}.`,
      `      ${link.resolutions[0]!.caveat ?? ''}`.trimEnd(),
      `      If they would rather drop the link altogether, use resolve_blocked_link with `
        + `resolution "remove_link" and amends_proposal_id set to that offer.`,
    );
  }
  return out.filter((line) => line.trim().length > 0 || line === '');
}

/** The standing instructions, and the two they exist to forbid. */
function tail(plan: RepairPlan): string[] {
  const out: string[] = [
    '',
    'HOW TO PUT THIS:',
    '  · Say all of it in ONE message. Do NOT work through it one item at a time, and do not ' +
      'repeat a list they have already seen.',
  ];
  if (plan.offers.length > 0) {
    out.push(
      '  · Say which numbers are MINE and which judgements are THEIRS. They are different things ' +
        'and running them together is the thing to avoid.',
      '  · They can agree to every estimate at once — accept_proposal takes the whole set and saves ' +
        'it in one go. They can also change any single one ("make the SMB one 0.6"); that is an ' +
        'amendment to that one offer and leaves the rest standing.',
    );
  }
  out.push(
    '  · Use their language. Do not ask them about normalised shares, scale frames, or option × ' +
      'factor mappings.',
    '  · Do not invent a number to get past a gap. If I had one, it is in the list above.',
  );
  if (plan.deferred.length > 0) {
    out.push(
      `  · ${plan.deferred.length} more of my estimates did not fit in this set and are NOT being ` +
        'offered yet. Say there are more coming, and offer them on the next turn once these are settled.',
    );
  }
  if (!plan.analysable) {
    out.push('  · The model cannot be analysed until the gaps above are settled. Say so once, plainly.');
  } else if (plan.offers.length > 0) {
    out.push(
      '  · The model CAN be analysed as it stands — but it would be running on my estimates. Say ' +
        'that, and let them decide whether to settle these first.',
    );
  }
  return out;
}

export function createProposeRepairsTool(deps: ProposeRepairsToolDeps): AgentTool {
  const resolveAdmission = deps.resolveAdmission ?? defaultResolveRunAdmission;

  const execute = (): AgentToolOutcome => {
    const graph = deps.getGraph();
    if (graph === null || graph === undefined) {
      return { type: 'refused', content: PROPOSE_REPAIRS_NO_GRAPH };
    }

    // ONE assessment, passed down. Two independent assessments of one graph can
    // in principle disagree — the hazard `analysis-ready-core.ts` exists to
    // remove, and re-deriving inside the plan would reintroduce it.
    const admission = resolveAdmission(graph);
    const plan = buildRepairPlan({ admission, graph });

    if (planIsEmpty(plan)) {
      return { type: 'refused', content: PROPOSE_REPAIRS_NOTHING_TO_DO };
    }

    const asks = askSections(plan.asks);

    // ── Nothing of mine to offer: the whole plan is questions ──────────────
    //
    // Returned as a RESULT, not a proposal. There is no number to stage, so
    // there is nothing to consent to — and staging an empty proposal so the
    // shape looks uniform would be a change that writes nothing wearing a
    // receipt. The coherence Paul asked for is in the MESSAGE, not in a
    // proposal object.
    // ⭐ A LINK RESOLUTION IS A STAGED CHANGE, so it rides as a part alongside
    // the estimates — one set, one write. Only the FIRST (non-destructive)
    // resolution is staged; the destructive one is reached by amending, so a
    // user cannot accidentally agree to deleting their own modelling.
    const linkParts: ProposedPart[] = plan.blocked_links.map((l) => ({
      summary: l.resolutions[0]!.summary,
      operations: l.resolutions[0]!.operations,
    }));

    if (plan.offers.length === 0 && linkParts.length === 0) {
      return {
        type: 'result',
        content: [
          'THE MODEL NEEDS THESE SETTLED, AND I HAVE NO NUMBER OF MY OWN FOR ANY OF THEM.',
          ...asks,
          ...tail(plan),
        ].join('\n'),
      };
    }

    // ── One part per offer: many proposals, one write ─────────────────────
    //
    // Each part becomes its own durable proposal, so any single one can be
    // amended without disturbing the rest, and the whole set is saved in ONE
    // write through `operationsToApplyBatch`. See `ProposedPart`'s docblock for
    // why this is not one proposal carrying many operations.
    // Link resolutions FIRST: they are the only repairs that can unblock a
    // run, so they lead the set rather than trailing a list of estimates.
    const parts: ProposedPart[] = [
      ...linkParts,
      ...plan.offers.map((o) => ({ summary: o.summary, operations: o.operations })),
    ];

    const head =
      plan.offers.length === 0
        ? []
        : [
            `THESE ${plan.offers.length === 1 ? 'IS A NUMBER' : 'ARE NUMBERS'} I FILLED IN MYSELF. ` +
              'The user has never seen them. Show each one and ask whether it is about right:',
            ...offerLines(plan),
          ];

    return {
      type: 'proposed',
      summary:
        parts.length === 1
          ? parts[0]!.summary
          : `${parts.length} changes to get this model ready`,
      // Not staged — `parts` is the complete list. Kept non-empty so the
      // outcome is well-formed on its own terms.
      operations: parts[0]!.operations,
      parts,
      content: [...head, ...blockedLinkSection(plan), ...asks, ...tail(plan)].join('\n'),
    };
  };

  return {
    kind: 'propose',
    definition: {
      name: PROPOSE_REPAIRS_TOOL_NAME,
      description:
        'Get everything standing between this model and an analysis it can be trusted, as ONE set. ' +
        'Returns the numbers I estimated myself (which the user has never confirmed) separately ' +
        'from the judgements only they can give. Reach for this whenever the model cannot be ' +
        'analysed, whenever the user asks what is missing or what to do next, and before asking ' +
        'them for any single value — it will tell you whether I already have a number to put to ' +
        'them instead. Proposes only: nothing is saved until they agree, and they can agree to the ' +
        'whole set at once.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    execute,
  };
}

/** The amend/choose route for a blocked link. */
export const RESOLVE_BLOCKED_LINK_TOOL_NAME = 'resolve_blocked_link';

/**
 * ⭐ THE OTHER WAY TO CLEAR A LINK BLOCK — and deliberately NOT a second
 * producer of the operations.
 *
 * Both resolutions are built by {@link buildLinkResolution}, the one function
 * `propose_repairs` also calls, so the offer the user saw and the amendment
 * they ask for cannot drift apart (CLAUDE.md trap 12).
 *
 * ⛔ IT IS `kind: 'propose'`, LIKE THE AMEND ROUTE ON `set_option_effect`. An
 * amendment goes BACK to the user: accepting here would save the resolution WE
 * chose rather than the one they asked for, which is the harm the third verb
 * exists to prevent. Removing a causal relationship is exactly the change that
 * must not happen on an inferred yes.
 */
export function createResolveBlockedLinkTool(deps: ProposeRepairsToolDeps): AgentTool {
  const resolveAdmission = deps.resolveAdmission ?? defaultResolveRunAdmission;
  return {
    kind: 'propose',
    definition: {
      name: RESOLVE_BLOCKED_LINK_TOOL_NAME,
      description:
        'Choose how to clear an option that is blocked by a link to a risk. Two choices and no '
        + 'others: "keep_out_of_comparison" keeps the link on the model but stops the engine trying '
        + 'to put a number on it, and "remove_link" takes the link out altogether. No effect value '
        + 'can clear this block, so do not ask them for one. If they are changing an answer you '
        + 'already offered, set amends_proposal_id to that offer. Proposes only: nothing is saved '
        + 'until they agree.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          option_id: { type: 'string', description: 'The blocked option.' },
          risk_id: { type: 'string', description: 'The risk it is linked to.' },
          resolution: {
            type: 'string',
            enum: ['keep_out_of_comparison', 'remove_link'],
            description:
              'What the user chose. "remove_link" deletes their link — only when they asked for it.',
          },
          amends_proposal_id: {
            type: 'string',
            description: 'Only when they are changing an answer you already offered them.',
          },
        },
        required: ['option_id', 'risk_id', 'resolution'],
      },
    },
    execute: (raw): AgentToolOutcome => {
      const graph = deps.getGraph();
      if (graph === null || graph === undefined) {
        return { type: 'refused', content: PROPOSE_REPAIRS_NO_GRAPH };
      }
      const optionId = typeof raw.option_id === 'string' ? raw.option_id : '';
      const riskId = typeof raw.risk_id === 'string' ? raw.risk_id : '';
      const kind = raw.resolution === 'remove_link' ? 'remove_link' : 'keep_out_of_comparison';

      // ⛔ BOUND TO A BLOCK THE AUTHORITY ACTUALLY REPORTS. Without this the
      // tool would let a model delete any option→risk edge it liked by calling
      // it a repair — a topology change nobody asked for, dressed as one.
      const plan = buildRepairPlan({ admission: resolveAdmission(graph), graph });
      const link = plan.blocked_links.find(
        (l) => l.option_id === optionId && l.risk_id === riskId,
      );
      if (link === undefined) {
        const open = plan.blocked_links
          .map((l) => `${l.option_id} → ${l.risk_id} (${l.option_label} → ${l.risk_label})`)
          .join(', ');
        return {
          type: 'refused',
          content:
            open.length === 0
              ? 'No option is blocked by a link to a risk, so there is nothing to resolve here. '
                + 'Use propose_repairs to see what is actually outstanding.'
              : `That pair is not one of the blocked links. Blocked: ${open}.`,
        };
      }

      const chosen = link.resolutions.find((r) => r.kind === kind)!;
      const amends =
        typeof raw.amends_proposal_id === 'string' && raw.amends_proposal_id.length > 0
          ? raw.amends_proposal_id
          : undefined;

      return {
        type: 'proposed',
        summary: chosen.summary,
        operations: chosen.operations,
        ...(amends !== undefined ? { amends } : {}),
        content: [
          amends !== undefined
            ? 'This replaces the earlier offer. Put the NEW choice to them in their own terms and '
              + 'wait for them to agree — it is not saved yet.'
            : 'Put this to them and wait for them to agree — it is not saved yet.',
          chosen.caveat ?? '',
          kind === 'remove_link'
            ? 'This DELETES a relationship they put on the model. Say so plainly, and make sure it '
              + 'is what they asked for rather than what you offered.'
            : '',
          `Once this is settled, "${link.option_label}" can be compared with the others.`,
        ]
          .filter((s) => s.length > 0)
          .join('\n\n'),
      };
    },
  };
}
