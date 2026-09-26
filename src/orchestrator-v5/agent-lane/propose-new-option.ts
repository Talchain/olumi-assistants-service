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
  /** Factors this change ADDS (`planNewFactors`): an `acts_on` label naming one links the option to it. */
  readonly newFactors?: readonly PlannedNewFactor[];
}

/**
 * ⭐ A FACTOR THE MODEL LACKS, ADDED IN THE SAME CHANGE AS THE OPTION THAT ACTS ON IT (DL 5843303596; Canonical's
 * ruling 5843972346 as corrected 5843988693). Paul's "Keep £49 and add a paid AI add-on" had no add-on factor, so the
 * option could not be added at all. The user names what the new factor changes and which way; nothing is guessed.
 */
export interface NewFactorRequest {
  readonly label: string;
  readonly affects: readonly { readonly label: string; readonly direction?: 'positive' | 'negative' }[];
}

export interface PlannedNewFactor {
  /** The batch-local handle an intervention names it by (`factor_key`); the product derives its id. */
  readonly key: string;
  readonly label: string;
  readonly affects: readonly { readonly node_id: string; readonly label: string; readonly effect_direction: 'positive' | 'negative' }[];
}

export interface NewFactorRefusal {
  readonly ok: false;
  readonly refusal:
    | 'new_factor_label_taken'
    | 'new_factor_affects_nothing'
    | 'new_factor_direction_unstated'
    | 'no_such_target'
    | 'ambiguous_target'
    | 'target_is_a_lever'
    | 'target_not_linkable';
  readonly detail: string;
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
  /** Factors this same change adds, that this option acts on (by `key`). */
  readonly newActsOn: readonly { readonly key: string; readonly label: string; readonly direction: 'positive' | 'negative' }[];
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
  const newActsOn: { key: string; label: string; direction: 'positive' | 'negative' }[] = [];
  const unresolved: string[] = [];
  for (const wanted of named) {
    const factor = nodes.find((n) => n.kind === 'factor'
      && (norm(n.label) === norm(wanted.label) || norm(n.description) === norm(wanted.label)));
    if (factor === undefined) {
      const added = (req?.newFactors ?? []).find((f) => norm(f.label) === norm(wanted.label));
      if (added === undefined) { unresolved.push(wanted.label); continue; }
      if (!newActsOn.some((a) => a.key === added.key)) newActsOn.push({ key: added.key, label: added.label, direction: wanted.direction });
      continue;
    }
    if (actsOn.some((a) => a.id === factor.id)) continue;
    actsOn.push({ id: factor.id, label: String(factor.label ?? factor.id), direction: wanted.direction });
  }

  // ⛔ PARTIAL RESOLUTION IS A REFUSAL, NOT A BEST EFFORT. Adding an option wired
  // to some of what the user asked for, silently, is the "approved a set that
  // could never be written" failure in a new costume.
  if (unresolved.length > 0 && actsOn.length === 0 && newActsOn.length === 0) {
    // Nothing it names exists: "retry without the missing ones" would leave it linked to nothing, and the only way
    // to add it then is a link it does not have (#1953 review). Say so, and offer the factor instead.
    return {
      ok: false,
      refusal: 'no_such_factor',
      detail:
        `The model has no factor called ${unresolved.map((u) => `"${u}"`).join(' or ')}, and nothing else this option acts on. `
        + 'Nothing was prepared. If you used a different name for a factor the model has, use its label from get_canonical_state. '
        + 'Otherwise never link it to an unrelated factor. If the user wants it added, add the missing factor IN THE SAME CHANGE: '
        + 'call propose_new_option again with that factor in `new_factors` (what it changes, and which way, in the user\u2019s words '
        + '\u2014 ask if they have not said), and name it in `acts_on`.',
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
        + 'part of the option the model does not yet represent. Never present it as fully represented. But if what it would set on '
        + 'those factors is what the model already has today (keeping a price at its current level, say), it could not be told apart '
        + 'from carrying on as now and would vanish into it in the results: then do not add it; say which part the model does not '
        + 'represent and offer to add it: a missing factor can be added in the same change, through `new_factors`.',
      unresolved_labels: unresolved,
    };
  }

  const taken = new Set(nodes.map((n) => n.id));
  return {
    ok: true,
    optionId: mintOptionId(taken),
    label,
    actsOn,
    newActsOn,
    publicLabel: `Add the option "${label}", acting on ${[...actsOn.map((a) => a.label), ...newActsOn.map((a) => `the new factor "${a.label}"`)].join(', ')}`,
  };
}

/** A batch-local handle for a new factor: its label, slugged; unique within the batch. */
function keyOf(label: string, taken: ReadonlySet<string>): string {
  const base = norm(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'factor';
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

/**
 * Plan the factors ONE change adds. PURE. Each must be new (no node of any kind by that name), must change something the
 * model already has — the goal, an outcome, a risk, or a factor no option sets — and must say which way, from the user.
 * Anything missing is refused with what to ask; nothing is guessed. Whether a target reaches the goal is the builder's
 * check (`new_factor_unreachable`), run on the same spec before anything is sent.
 */
export function planNewFactors(
  nodes: readonly (GraphNodeLike & { readonly category?: string })[],
  requested: readonly NewFactorRequest[] | undefined,
): { readonly ok: true; readonly factors: readonly PlannedNewFactor[] } | NewFactorRefusal {
  const factors: PlannedNewFactor[] = [];
  const keys = new Set<string>();
  for (const r of requested ?? []) {
    const label = String(r?.label ?? '').trim();
    const clash = nodes.find((n) => norm(n.label) === norm(label)) ?? factors.find((f) => norm(f.label) === norm(label));
    if (label === '' || clash !== undefined) {
      return { ok: false, refusal: 'new_factor_label_taken',
        detail: label === ''
          ? 'A new factor needs a name. Nothing was prepared.'
          : `The model already has "${String(clash!.label)}". Nothing was prepared: name it in acts_on instead of adding it again.` };
    }
    const wanted = (r?.affects ?? []).map((a) => ({ label: String(a?.label ?? '').trim(), direction: a?.direction })).filter((a) => a.label !== '');
    if (wanted.length === 0) {
      return { ok: false, refusal: 'new_factor_affects_nothing',
        detail: `"${label}" would change nothing the model has, so it could not affect the comparison. Nothing was prepared. Ask the user what it changes (the goal, or something already in the model).` };
    }
    const affects: { node_id: string; label: string; effect_direction: 'positive' | 'negative' }[] = [];
    for (const a of wanted) {
      const hits = nodes.filter((n) => ['goal', 'outcome', 'risk', 'factor'].includes(String(n.kind))
        && (norm(n.label) === norm(a.label) || norm(n.description) === norm(a.label)));
      if (hits.length === 0) {
        return { ok: false, refusal: 'no_such_target',
          detail: `The model has nothing called "${a.label}" for "${label}" to change. Nothing was prepared. Use a label exactly as get_canonical_state gives it.` };
      }
      if (hits.length > 1) {
        return { ok: false, refusal: 'ambiguous_target',
          detail: `More than one thing in the model is called "${a.label}". Nothing was prepared; ask the user which one "${label}" changes.` };
      }
      const target = hits[0]!;
      if (target.kind === 'factor' && target.category === 'controllable') {
        return { ok: false, refusal: 'target_is_a_lever',
          detail: `"${String(target.label)}" is something an option sets, not something "${label}" changes. Nothing was prepared. Ask what "${label}" changes (the goal, say).` };
      }
      // The builder links a new factor only to the goal, an outcome, a risk, or an observable/external factor
      // (`isAffectsTarget`, add-option-transaction.ts). Refused here with the reason, never a bare "not prepared" later.
      if (target.kind === 'factor' && target.category !== 'observable' && target.category !== 'external') {
        return { ok: false, refusal: 'target_not_linkable',
          detail: `The model does not record "${String(target.label)}" as something outside the options' control, so a new factor cannot be linked to it. Nothing was prepared. Ask whether "${label}" changes the goal, an outcome or a risk instead.` };
      }
      if (a.direction !== 'positive' && a.direction !== 'negative') {
        return { ok: false, refusal: 'new_factor_direction_unstated',
          detail: `Whether "${label}" raises or lowers "${String(target.label)}" was not said. Nothing was prepared. Ask the user; never assume it.` };
      }
      if (!affects.some((x) => x.node_id === target.id)) affects.push({ node_id: target.id, label: String(target.label ?? target.id), effect_direction: a.direction });
    }
    const key = keyOf(label, keys);
    keys.add(key);
    // No unit here (Canonical 5844014025): with no value on this path there is nothing for it to belong to.
    factors.push({ key, label, affects });
  }
  return { ok: true, factors };
}
