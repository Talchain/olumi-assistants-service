/**
 * M1 (finish-line criterion 7) — INGRESS half of the option-targeted
 * counterfactual: which option did the user actually name?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS EXISTS TO CLOSE. Asked *"what would make Engage Offshore
 * Partner win?"*, the `what_would_flip` answer runs on the GENERIC flip set and
 * reports whichever alternative winner the flip rows happen to agree on. On the
 * captured HEAD behaviour it answered, verbatim:
 *
 *     "… If that happened, Hire Two Senior Engineers Locally would lead instead."
 *
 * — naming a DIFFERENT option from the one the question was about, and never
 * mentioning the option asked about at all. The user's question carries an
 * option identity; the answer ignored it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NO NEW INTAKE MECHANISM. This follows the pattern the estate already uses for
 * a user-named entity: `findNamedFactor` in `context/projection-summaries.ts`
 * mechanically substring-matches the user message against FACTOR node labels,
 * longest label first, and feeds `named_factor_label` to the
 * `explain_from_structure` composer. This module is the same read against
 * OPTION identities. Pure pattern matching; no LLM, no new wire field, no
 * change to the strict turn schema.
 *
 * Note what is NOT used: `proposal.entity`. The routing layer DOES resolve a
 * graph-validated entity for `what_would_flip` (`validation-registry.ts`
 * declares `accepted_entity_kinds: ['goal','option']`), but `entity` is
 * REQUIRED on every proposal, so the router fills it on a GENERIC flip question
 * too. Reading it as "the user named this option" would mis-address every
 * untargeted turn. The current user's own words remain the strongest evidence;
 * the canonical-context wrapper below may additionally use one fully resolved
 * canvas selection for a deictic follow-up. Model-authored router guesses are
 * never referent authority.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY EXACTLY-ONE, AND WHY THAT IS NOT A HAND-KEPT PHRASE LIST. A message that
 * names TWO options is a comparison ("would A or B be better?"), not a question
 * about one option, so it resolves to nothing and the existing generic answer is
 * preserved byte-for-byte. That gate is DERIVED from the graph's own option set
 * — not from a list of question phrasings a human must remember to sync
 * (CLAUDE.md trap #12). There is deliberately no "what would make … win?" regex
 * anywhere in this lane.
 *
 * IDs are the identity; labels are matched against the user's text and then
 * carried for DISPLAY only. Two options may share a display label (the
 * collision case UI #492's resolver had to handle), so a label that maps to more
 * than one id resolves to nothing rather than picking one.
 */

import {
  isSelectedContextGraphSnapshot,
  type ContextGraphSelection,
} from '../../../context/context-graph-snapshot.js';
import type { TurnSelection } from '../../../build-turn-context.js';

/** An option identity read off the graph. `label` is display copy only. */
export interface TargetOption {
  /** Authoritative identity. Matched against `alternative_winner_id`. */
  readonly id: string;
  /** Display name, as it appears on the graph the user is looking at. */
  readonly label: string;
}

/** Why no single target option was resolved. Bounded, stable codes. */
export type TargetOptionMissReason =
  /** Empty / absent user message (chip-click and system paths). */
  | 'no_message'
  /** The graph carried no readable option identities. */
  | 'no_options'
  /** The user named no option label at all — an untargeted flip question. */
  | 'no_option_named'
  /** Two or more DISTINCT options were named — a comparison, not a target. */
  | 'multiple_options_named'
  /** The named label maps to more than one option id — identity is ambiguous. */
  | 'label_collision'
  /** Canonical option rows disagree about the label for one identity. */
  | 'identity_collision'
  /** A selection cannot license a target without an attested canonical graph. */
  | 'selection_not_canonical'
  /** The selected reference was not one fully resolved canonical option. */
  | 'selection_not_unique';

export type TargetOptionResolution =
  | { readonly kind: 'resolved'; readonly option: TargetOption }
  | { readonly kind: 'none'; readonly reason: TargetOptionMissReason };

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function nonEmptyString(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const trimmed = x.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Keep all option rows so duplicate identities cannot be hidden by a map. */
function collectGraphOptionRows(graph: unknown): readonly TargetOption[] {
  const g = asRecord(graph);
  if (g === null) return [];

  const rows: TargetOption[] = [];
  const take = (raw: unknown): void => {
    const r = asRecord(raw);
    if (r === null) return;
    const id = nonEmptyString(r.id) ?? nonEmptyString(r.option_id);
    const label = nonEmptyString(r.label);
    if (id !== null && label !== null) rows.push({ id, label });
  };

  if (Array.isArray(g.options)) for (const option of g.options) take(option);
  if (Array.isArray(g.nodes)) {
    for (const node of g.nodes) {
      const r = asRecord(node);
      if (r !== null && r.kind === 'option') take(r);
    }
  }
  return rows;
}

function hasConflictingOptionIdentity(rows: readonly TargetOption[]): boolean {
  const labelById = new Map<string, string>();
  for (const row of rows) {
    const prior = labelById.get(row.id);
    if (prior !== undefined && prior !== row.label) return true;
    labelById.set(row.id, row.label);
  }
  return false;
}

/**
 * Read `{id, label}` for every option on the RAW, unparsed graph.
 *
 * Deliberately mirrors `context/option-identity.ts:extractGraphOptionIds` —
 * SAME dual-source union, for the same reason: production sends options as a
 * top-level `options[]` array (the CEEGraphResponseV3 / ISL ingress shape —
 * verified against `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`,
 * whose graph nodes are factor/risk/goal/outcome only), while some fixtures and
 * canvas layers carry them as nodes with `kind === 'option'`. Reading one source
 * would silently see zero options on the other shape and never address anything.
 *
 * Tolerates `id` OR `option_id` because BOTH spellings are live in this estate:
 * the `OptionForAnalysis` schema declares `id`, and the captured staging
 * `analysis_ready.options[]` carries `option_id`. Requiring one spelling is the
 * hand-maintained-mirror failure in miniature.
 *
 * No schema parse: the raw read must still work when `GraphStateIngressSchema`
 * would have failed, exactly as the sibling module documents.
 */
export function collectGraphOptionIdentities(graph: unknown): readonly TargetOption[] {
  const byId = new Map<string, string>();
  for (const row of collectGraphOptionRows(graph)) {
    if (!byId.has(row.id)) byId.set(row.id, row.label);
  }
  return Array.from(byId, ([id, label]) => ({ id, label }));
}

/** Escape a label for use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the ONE option the user named in this message, or a typed miss.
 *
 * Longest-label-first, and each match CONSUMES its span before shorter labels
 * are tried. Without the consume step, a graph carrying both "Hire Two Senior
 * Engineers" and "Hire Two Senior Engineers Locally" would read a message naming
 * only the longer one as naming TWO options, and refuse to address a perfectly
 * unambiguous question. Longest-match-wins is the same precedence
 * `findNamedFactor` uses ("Engineering Capacity" beats the substring
 * "Capacity"); consuming the span is what makes that precedence hold when the
 * shorter label is a PREFIX of the longer one rather than merely similar.
 *
 * Pure. No telemetry, no I/O.
 */
export function resolveTargetOptionFromMessage(
  messageText: string | null | undefined,
  graph: unknown,
): TargetOptionResolution {
  const message = typeof messageText === 'string' ? messageText : '';
  if (message.trim().length === 0) return { kind: 'none', reason: 'no_message' };

  const options = collectGraphOptionIdentities(graph);
  if (options.length === 0) return { kind: 'none', reason: 'no_options' };

  // Longest label first so a longer label wins over any shorter one nested in it.
  const ordered = options.slice().sort((a, b) => b.label.length - a.label.length);

  let haystack = message.toLowerCase();
  const matched: TargetOption[] = [];
  const matchedLabels = new Set<string>();

  for (const option of ordered) {
    const needle = option.label.toLowerCase();
    if (!haystack.includes(needle)) continue;
    matched.push(option);
    matchedLabels.add(needle);
    // Consume EVERY occurrence of this label so a shorter nested label cannot
    // re-match the same span.
    haystack = haystack.replace(new RegExp(escapeRegExp(needle), 'g'), ' ');
  }

  if (matched.length === 0) return { kind: 'none', reason: 'no_option_named' };

  // Label collision: the matched label is shared by more than one option id, so
  // the user's words do not pick out a single identity. Refuse rather than guess
  // (the #738 lesson — match on ids, never fold two targets into one label).
  for (const label of matchedLabels) {
    const sharing = options.filter((o) => o.label.toLowerCase() === label);
    if (sharing.length > 1) return { kind: 'none', reason: 'label_collision' };
  }

  // Two or more DISTINCT options named ⇒ a comparison question, not a target.
  const distinctIds = new Set(matched.map((m) => m.id));
  if (distinctIds.size > 1) return { kind: 'none', reason: 'multiple_options_named' };

  return { kind: 'resolved', option: matched[0]! };
}

/**
 * Resolve a `what_would_flip` target from one attested canonical snapshot.
 *
 * Current-turn words outrank canvas focus: an explicit option label is the
 * user's strongest evidence. Focus is consulted only for a genuinely deictic
 * message, and only when exactly one canonical option was fully resolved.
 * Request/provisional bytes, degraded reads and hand-built snapshot lookalikes
 * never become referent authority.
 */
export function resolveTargetOptionFromCanonicalContext(
  messageText: string | null | undefined,
  graphSelection: ContextGraphSelection,
  selection: TurnSelection | null | undefined,
): TargetOptionResolution {
  if (
    !isSelectedContextGraphSnapshot(graphSelection) ||
    graphSelection.status !== 'canonical'
  ) {
    return { kind: 'none', reason: 'selection_not_canonical' };
  }

  const rows = collectGraphOptionRows(graphSelection.graph);
  if (hasConflictingOptionIdentity(rows)) {
    return { kind: 'none', reason: 'identity_collision' };
  }

  const explicit = resolveTargetOptionFromMessage(messageText, graphSelection.graph);
  if (explicit.kind === 'resolved' || explicit.reason !== 'no_option_named') {
    return explicit;
  }

  if (
    selection === null ||
    selection === undefined ||
    selection.graph_read !== 'ok_present' ||
    selection.requested_ids.length !== 1 ||
    selection.elements.length !== 1 ||
    selection.unresolved_ids.length !== 0 ||
    selection.unreadable_ref_ids.length !== 0
  ) {
    return selection == null
      ? explicit
      : { kind: 'none', reason: 'selection_not_unique' };
  }

  const selected = selection.elements[0]!;
  if (selected.kind !== 'option' || selected.id !== selection.requested_ids[0]) {
    return { kind: 'none', reason: 'selection_not_unique' };
  }

  const exactRows = rows.filter(
    (row) => row.id === selected.id && row.label === selected.label,
  );
  const sameLabelOtherIds = rows.some(
    (row) =>
      row.id !== selected.id &&
      row.label.toLowerCase() === selected.label.toLowerCase(),
  );
  if (exactRows.length === 0 || sameLabelOtherIds) {
    return { kind: 'none', reason: 'label_collision' };
  }

  return {
    kind: 'resolved',
    option: { id: selected.id, label: exactRows[0]!.label },
  };
}
