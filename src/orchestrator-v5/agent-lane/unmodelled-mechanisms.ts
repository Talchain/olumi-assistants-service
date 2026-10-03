/**
 * ⭐ B3 MODEL FIDELITY — WHAT AN OPTION DOES THAT THE MODEL DOES NOT CARRY, TYPED INSTEAD OF SAID.
 *
 * MEASURED (Paul's 2 Oct pricing test, `olumi-programme-docs` `output/b3-model-fidelity/BRIEF.md`): the Agent wrote
 * "Raise Pro to £59 with introductory offer of 1 month free" with ONLY the ongoing price and said so — "the free month
 * and its revenue effects are not represented yet" — and added "per-seat pricing" with a per-seat price and no seats,
 * saying "billable seat counts are not yet represented". Both limitations lived in the reply text and died there:
 * neither tool had a typed field for them, so admission read both options as complete and RANKED them.
 *
 * The carrier is the one the product already has: an option's `unresolved_targets` (with `user_questions` naming the
 * ask), which `computeAnalysisReadyStatusWithReason` (`cee/transforms/option-status.ts`) already turns into
 * `needs_user_mapping`, and which the run gate (`analysable-option-gate.ts`) now keeps out of the comparison.
 *
 * ⛔ NOTHING HERE READS THE USER'S WORDS. The nouns are the Agent's typed declaration (`unmodelled_mechanisms`), kept as
 * written after trimming; no regex over a label or a reply decides that something is missing.
 */

/** At most this many gaps per option are kept: a declaration longer than this is a description, not a list of gaps. */
export const UNMODELLED_MECHANISMS_MAX = 5;
/** One gap is a short noun phrase ("free first month", "billable seats"). */
export const UNMODELLED_MECHANISM_MAX_CHARS = 80;

/**
 * The Agent's declaration for one option, normalised: `undefined` when it declared nothing (the option's stored gaps are
 * left exactly as they are), `[]` when it declared that nothing is missing (the stored gaps are cleared), otherwise the
 * trimmed, de-duplicated nouns in the order given. A non-string or an empty entry is dropped, never coerced.
 */
export function normaliseUnmodelledMechanisms(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const noun = entry.replace(/\s+/g, ' ').trim();
    if (noun === '' || noun.length > UNMODELLED_MECHANISM_MAX_CHARS) continue;
    const key = noun.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(noun);
    if (out.length === UNMODELLED_MECHANISMS_MAX) break;
  }
  return out;
}

/** Several declarations for ONE option (one per level in a proposal) become one list: undefined only if none declared. */
export function mergeUnmodelledMechanisms(
  declarations: ReadonlyArray<readonly string[] | undefined>,
): string[] | undefined {
  const declared = declarations.filter((d): d is readonly string[] => d !== undefined);
  if (declared.length === 0) return undefined;
  return normaliseUnmodelledMechanisms(declared.flat()) ?? [];
}

/** The ask the readiness surfaces for one gap: names the option and the missing mechanism, and what would resolve it. */
export function unmodelledMechanismQuestion(optionLabel: string, mechanism: string): string {
  return `"${optionLabel}" does not model the ${mechanism} yet, so it is left out of the comparison. `
    + `What does the ${mechanism} change, and by how much?`;
}

/**
 * The option-node fields one declaration writes. `null` means CLEAR both fields (declared: nothing missing); a value
 * means SET both. Written together so `needs_user_mapping` always says what it is waiting for (`v3-validator`
 * `MISSING_USER_QUESTIONS`).
 */
export function optionGapFields(
  optionLabel: string,
  mechanisms: readonly string[],
): { unresolved_targets: string[]; user_questions: string[] } | null {
  if (mechanisms.length === 0) return null;
  return {
    unresolved_targets: [...mechanisms],
    user_questions: mechanisms.map((m) => unmodelledMechanismQuestion(optionLabel, m)),
  };
}

/**
 * Apply one option's declaration to a node, returning a NEW node (never mutating): `undefined` leaves it untouched,
 * `[]` removes both fields, a list sets both.
 */
export function withOptionGaps<N extends { readonly id?: unknown; readonly label?: unknown; readonly unresolved_targets?: unknown; readonly user_questions?: unknown }>(
  node: N,
  mechanisms: readonly string[] | undefined,
): N | (Omit<N, 'unresolved_targets' | 'user_questions'> & { unresolved_targets?: string[]; user_questions?: string[] }) {
  if (mechanisms === undefined) return node;
  const { unresolved_targets: _t, user_questions: _q, ...rest } = node;
  const label = typeof node.label === 'string' ? node.label : String(node.id ?? 'this option');
  const fields = optionGapFields(label, mechanisms);
  return fields === null ? rest : { ...rest, ...fields };
}

/** The approval card's words for one option's declaration, so the user approves the gap with the level. */
export function optionGapCardWords(optionLabel: string, mechanisms: readonly string[]): string {
  return mechanisms.length > 0
    ? `${optionLabel} does not model the ${mechanisms.join(' and the ')} yet, so it stays out of the comparison until it does`
    : `${optionLabel} no longer lists anything it does not model`;
}

/**
 * The gaps an approved proposal carries, read off its `set_option_intervention` operations (each op of an option
 * carries that option's whole declaration). One entry per option, first op wins; an op with no declaration adds none.
 */
export function optionGapsOfLevelOps(
  ops: ReadonlyArray<{ readonly op: string; readonly path: string; readonly value?: unknown }>,
): { option_id: string; mechanisms: string[] }[] {
  const out = new Map<string, string[]>();
  for (const o of ops) {
    if (o.op !== 'set_option_intervention') continue;
    const optionId = o.path.split('::')[0] ?? '';
    if (optionId === '' || out.has(optionId)) continue;
    const declared = normaliseUnmodelledMechanisms((o.value as { unmodelled_mechanisms?: unknown } | undefined)?.unmodelled_mechanisms);
    if (declared !== undefined) out.set(optionId, declared);
  }
  return [...out].map(([option_id, mechanisms]) => ({ option_id, mechanisms }));
}

/** LANDED = WHAT THE MODEL HOLDS: every declared gap read back on its option node exactly (a cleared one: absent). */
export function optionGapsHeld(
  nodes: ReadonlyArray<{ readonly id?: unknown; readonly kind?: unknown; readonly unresolved_targets?: unknown }>,
  gaps: ReadonlyArray<{ readonly option_id: string; readonly mechanisms: readonly string[] }>,
): boolean {
  return gaps.every((g) => {
    const node = nodes.find((n) => n.id === g.option_id && n.kind === 'option');
    if (node === undefined) return false;
    const held = node.unresolved_targets;
    if (g.mechanisms.length === 0) return held === undefined;
    return Array.isArray(held) && held.length === g.mechanisms.length && g.mechanisms.every((m, i) => held[i] === m);
  });
}

/**
 * What an option DECLARES it does not model, read off the stored graph: its node's `unresolved_targets` (the Agent
 * writer's carrier) unioned with its top-level `options[]` entry's (the drafter's), in that order. `[]` when none.
 */
export function declaredGapsOf(rawGraph: unknown, optionId: string): string[] {
  const g = (rawGraph ?? {}) as { nodes?: unknown; options?: unknown };
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);
  const of = (xs: unknown): string[] => (Array.isArray(xs)
    ? xs.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && (x as { id?: unknown }).id === optionId)
      .flatMap((x) => strings(x.unresolved_targets))
    : []);
  // A target that is a node of the model is an unsettled relationship, not a missing mechanism (the run gate's rule).
  const nodeIds = new Set(Array.isArray(g.nodes)
    ? g.nodes.flatMap((n) => (n !== null && typeof n === 'object' && typeof (n as { id?: unknown }).id === 'string' ? [(n as { id: string }).id] : []))
    : []);
  return [...new Set([...of(g.nodes), ...of(g.options)])].filter((t) => !nodeIds.has(t));
}
