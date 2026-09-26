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

export interface NewOptionPlan {
  readonly ok: true;
  readonly optionId: string;
  readonly label: string;
  /** Factor ids this option will be linked to, in the order given. */
  readonly actsOn: readonly { readonly id: string; readonly label: string; readonly direction: 'positive' | 'negative' }[];
  readonly publicLabel: string;
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
        + 'Name the factors this option would change. If the model has no factor it acts on, never link it to an unrelated one: '
        + 'tell the user the model does not represent what it changes yet, and offer to add that factor first.',
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
  if (unresolved.length > 0 && actsOn.length === 0) {
    // Nothing it names exists: "retry without the missing ones" would leave it linked to nothing, and the only way
    // to add it then is a link it does not have (#1953 review). Say so, and offer the factor instead.
    return {
      ok: false,
      refusal: 'no_such_factor',
      detail:
        `The model has no factor called ${unresolved.map((u) => `"${u}"`).join(' or ')}, and nothing else this option acts on. `
        + 'Nothing was prepared. If you used a different name for a factor the model has, use its label from get_canonical_state. '
        + 'Otherwise do not add it, and never link it to an unrelated factor: tell the user plainly that the model does not '
        + 'represent what this option changes yet, and offer to add that factor first.',
      unresolved_labels: unresolved,
    };
  }
  if (unresolved.length > 0) {
    return {
      ok: false,
      refusal: 'no_such_factor',
      detail:
        `The model has no factor called ${unresolved.map((u) => `"${u}"`).join(' or ')}. Nothing was prepared. `
        + 'If you used a different name for a factor the model has, use its label from get_canonical_state. Otherwise add the option '
        + 'NOW against the factors it does have (call propose_new_option again without the missing one), and tell the user plainly which '
        + 'part of the option the model does not yet represent. Never present it as fully represented.',
      unresolved_labels: unresolved,
    };
  }

  const taken = new Set(nodes.map((n) => n.id));
  return {
    ok: true,
    optionId: mintOptionId(taken),
    label,
    actsOn,
    publicLabel: `Add the option "${label}", acting on ${actsOn.map((a) => a.label).join(', ')}`,
  };
}
