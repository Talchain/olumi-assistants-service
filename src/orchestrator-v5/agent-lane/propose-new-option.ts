/**
 * ⭐ ADDING AN OPTION THE USER PICKED.
 *
 * THE GAP, in RC's own words (fast-path directive, AI COACHING lane): *"the Agent
 * currently ideates an option but cannot execute 'let's add that'."*
 *
 * Measured against a COMPLETE manifest of the lane's eight tools: every one of
 * them mutates an entity that already exists. `propose_model_change` relates two
 * labels that must already be there; `propose_assumptions` says "only factors the
 * model actually has"; `propose_option_interventions` and `propose_starting_point`
 * set levels and values on existing entities; `build_model_from_brief` refuses a
 * model that is not empty. So the most natural request a user makes of a reasoning
 * assistant — "add that one" — had no tool behind it.
 *
 * ⛔ WHY THIS IS A SEPARATE MODULE AND NOT A BRANCH IN `authoriseChange`.
 * That function accepts `COMPOUND_ORDER = ['set_factor_value',
 * 'set_option_intervention']` and refuses everything else as
 * `unsupported_compound`. Creating an entity is a different write family with its
 * own ordering, so it gets its own route rather than widening a compound whose
 * whole safety property is that it is narrow.
 *
 * ⭐ IT CREATES, IT DOES NOT VALUE. The option is added and linked to the factors
 * it acts on — and NOTHING ELSE. Setting what it does to each factor is
 * `propose_option_interventions`, which already exists, already reads the user's
 * number against a declared range, and already refuses to invent a scale. Doing
 * both here would duplicate that judgement in a second place, which is how this
 * estate has grown five producers of the same answer before.
 *
 * ⚠ AND THE USER IS TOLD, because a linked option that sets nothing is not
 * harmless: `get_canonical_state` reports it in `options_that_change_nothing`, and
 * such an option blocks the comparison for EVERY option, not only itself. So the
 * result says plainly that levels are still needed.
 *
 * ⛔ AND THE DECISION SELECTS IT (served `52453d3`, witness c14, scenario 8efc70af).
 * The option and its factor links landed and NOTHING linked it from the decision,
 * so readiness blocked with OPTION_NOT_LINKED_TO_DECISION straight after the user
 * approved. Every constructor-built option carries a decision → option edge; that
 * edge is topology ("the decision can choose this"), not a value anyone states, so
 * it is part of creating the option rather than a second thing to ask for. The
 * plan resolves the decision here; a model with no decision — or with more than
 * one, where picking would be a guess — keeps the old behaviour and SAYS SO.
 */

import { randomUUID } from 'node:crypto';

/** What the caller must supply. Labels, never ids — ids are never shown to a user. */
export interface NewOptionRequest {
  readonly label: string;
  readonly acts_on: readonly { readonly factor_label: string; readonly direction: 'positive' | 'negative' }[];
  readonly rationale: string;
}

export interface NewOptionRefusal {
  readonly ok: false;
  readonly refusal:
    | 'empty_proposal'
    | 'label_already_exists'
    | 'no_such_factor'
    | 'no_factors_named';
  readonly detail: string;
  readonly unresolved_labels?: readonly string[];
}

/** Why an added option is NOT linked from a decision — the model gives nothing unambiguous to link from. */
export type DecisionLinkGap = 'no_decision_in_model' | 'several_decisions';

export interface NewOptionPlan {
  readonly ok: true;
  readonly optionId: string;
  readonly label: string;
  /** Factor ids this option will be linked to, in the order given. */
  readonly actsOn: readonly { readonly id: string; readonly label: string; readonly direction: 'positive' | 'negative' }[];
  readonly publicLabel: string;
  /** The decision that will select this option — the model's ONLY decision, or null. */
  readonly decision: { readonly id: string; readonly label: string } | null;
  /** Set exactly when `decision` is null: why no decision → option link will be written. */
  readonly decisionGap: DecisionLinkGap | null;
}

interface GraphNodeLike { readonly id: string; readonly kind?: string; readonly label?: string; readonly description?: string }

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase();

/**
 * ⚠ A NEW ID MUST NOT COLLIDE — `structural_add` refuses `node_id_collision`
 * (`structural-add.ts:452`), and a refusal after the user has approved is the
 * failure this lane keeps meeting. A fresh uuid segment is checked against the
 * graph before it is offered.
 */
function mintOptionId(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 8; i += 1) {
    const candidate = randomUUID().replace(/-/g, '').slice(0, 8);
    if (!taken.has(candidate)) return candidate;
  }
  return randomUUID();
}

/**
 * Plan the addition. PURE — it reads the graph and decides; it writes nothing and
 * dispatches nothing. The caller turns this into a stored proposal.
 */
export function planNewOption(
  nodes: readonly GraphNodeLike[],
  req: NewOptionRequest,
): NewOptionPlan | NewOptionRefusal {
  const label = String(req?.label ?? '').trim();
  if (label === '') {
    return { ok: false, refusal: 'empty_proposal', detail: 'No option label was given.' };
  }

  // ⛔ NEVER a second option by the same name. Two options a user cannot tell
  // apart is worse than a refusal, and the multi-option notice already has to
  // fence labels because 3.96% of real ones collide.
  const clash = nodes.find((n) => n.kind === 'option' && norm(n.label) === norm(label));
  if (clash !== undefined) {
    return {
      ok: false,
      refusal: 'label_already_exists',
      detail: `The model already has an option called "${clash.label}". Say what would differ, or set what that one does instead.`,
    };
  }

  const named = (req?.acts_on ?? [])
    .map((a) => ({ label: String(a?.factor_label ?? '').trim(), direction: a?.direction === 'negative' ? 'negative' as const : 'positive' as const }))
    .filter((a) => a.label !== '');
  if (named.length === 0) {
    return {
      ok: false,
      refusal: 'no_factors_named',
      detail:
        'An option that is linked to nothing cannot be compared, and it blocks the comparison for every other option too. '
        + 'Name the factors this option would change.',
    };
  }

  const actsOn: { id: string; label: string; direction: 'positive' | 'negative' }[] = [];
  const unresolved: string[] = [];
  for (const wanted of named) {
    const factor = nodes.find((n) => n.kind === 'factor'
      && (norm(n.label) === norm(wanted.label) || norm(n.description) === norm(wanted.label)));
    if (factor === undefined) { unresolved.push(wanted.label); continue; }
    if (actsOn.some((a) => a.id === factor.id)) continue;
    actsOn.push({ id: factor.id, label: String(factor.label ?? factor.id), direction: wanted.direction });
  }

  // ⛔ PARTIAL RESOLUTION IS A REFUSAL, NOT A BEST EFFORT. Adding an option wired
  // to some of what the user asked for, silently, is the "approved a set that
  // could never be written" failure in a new costume.
  if (unresolved.length > 0) {
    return {
      ok: false,
      refusal: 'no_such_factor',
      detail:
        `The model has no factor called ${unresolved.map((u) => `"${u}"`).join(' or ')}. `
        + 'Use the labels get_canonical_state returned, or add the option against the factors it does have.',
      unresolved_labels: unresolved,
    };
  }

  const taken = new Set(nodes.map((n) => n.id));
  // ⚠ EXACTLY ONE decision, or none linked: with several, choosing one would be a guess.
  const decisions = nodes.filter((n) => n.kind === 'decision');
  const only = decisions.length === 1 ? decisions[0] : undefined;
  return {
    ok: true,
    optionId: mintOptionId(taken),
    label,
    actsOn,
    publicLabel: `Add the option "${label}", acting on ${actsOn.map((a) => a.label).join(', ')}`,
    decision: only !== undefined ? { id: only.id, label: String(only.label ?? only.id) } : null,
    decisionGap: only !== undefined ? null : decisions.length === 0 ? 'no_decision_in_model' : 'several_decisions',
  };
}

/** What the Agent (and the user) is told when no decision → option link is written, and why. */
export function decisionGapNote(gap: DecisionLinkGap): string {
  return gap === 'no_decision_in_model'
    ? 'The model has no decision to connect this option from, so it is added without that link.'
    : 'The model has more than one decision, so this option is not connected from any of them. Say which decision it belongs to and that link can be added.';
}

/**
 * What the Agent must tell the user after this applies.
 *
 * ⚠ Deliberately NOT optimistic. The option exists and is linked, and it still
 * cannot be compared until each link carries a level — so the copy says that
 * rather than implying the model is ready.
 */
export function newOptionFollowUp(
  plan: Pick<NewOptionPlan, 'label' | 'actsOn'>,
  decisionGap: DecisionLinkGap | null = null,
): string {
  const one = plan.actsOn.length === 1;
  return (
    `"${plan.label}" is in the model and linked to ${plan.actsOn.map((a) => a.label).join(', ')}. `
    + `It does not yet say what it does to ${one ? 'that factor' : 'those factors'}, so it cannot be compared yet `
    + '— and until it can, it holds up the comparison for every option. '
    + 'Say what it would change and by how much, in your own units, and it can be set.'
    // ⚠ Only the GAP is said: a written decision link is structure, and naming it would be noise.
    + (decisionGap !== null ? ` ${decisionGapNote(decisionGap)}` : '')
  );
}
