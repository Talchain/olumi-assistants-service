/**
 * Label-value divergence detector — the deterministic cross-check that a
 * label edit whose text carries a CHANGED quantitative value has not silently
 * diverged from the node's modelled value.
 *
 * The live P0 (user-seat critique, build e7f312d, scenario 7b0f2246): the user
 * asked to "change the raise option from $49 to $39". `change` is deliberately
 * excluded from the value-update gate's suppressor (routing/value-update-gate),
 * so the turn dispatched to the edit_graph LLM, which emitted a LABEL-ONLY
 * `update_node` — renaming the option label to embed "$39" while touching NO
 * intervention. The deterministic receipt treated the label-only op as cosmetic
 * ("Renamed …") and claimed success, but the option's `fac_price` intervention
 * stayed 0.49: the label now says $39 while every re-run computes $49, and the
 * receipt lies about it. This is the THIRD leg of the silent-wrong-value family
 * (the typed-chip and typed-text value legs are already closed).
 *
 * Doctrine (b), consent-first: apply the label rename the op asked for, but
 * NEVER silently mutate the modelled value on top of it (a value change is a
 * different consent class — it affects model outputs and re-runs, and its
 * unit/derivation is exactly what the value-update path exists to get right).
 * Instead DISCLOSE the divergence honestly and offer the typed configure
 * affordance. This module is the single detector both surfaces derive from:
 *
 *   - the applied-changes receipt (`buildAppliedChanges`) uses
 *     `buildLabelValueDivergenceDescription` so the structured card can never
 *     read as a completed value change, and
 *   - the edit handler appends `buildLabelValueDivergenceNote` to the assistant
 *     text and `buildLabelValueDivergenceActions` to the suggested actions.
 *
 * Safe-biased and tightly scoped so a plain rename is never disturbed: a
 * divergence requires (1) an `update_node` op that changes the label but
 * changes NO modelled value, on a node that (2) actually carries a modelled
 * numeric value, and (3) a label that now ASSERTS a quantity the model does
 * not hold. A pure rename, a REMOVED quantity, or a formatting-only change is
 * NOT a divergence.
 *
 * (3) has TWO legs, because the harm has two shapes:
 *
 *   LEG 1 — REPLACED. A token present before is gone and a different one took
 *   its place (an old-only AND a new-only quantity). The old label is the
 *   authority for what the model was said to hold. This is the original #647
 *   shape above and its behaviour is UNCHANGED.
 *
 *   LEG 2 — ADD-ONLY. The old label carried NO quantity and the new one gains
 *   exactly one. Captured live on staging build `69d6e6e` (golden-journey run
 *   `20260811T012704Z-fresh-5e036e`, 2026-08-11): "Change Annual CRM Spend to
 *   £63,000." routed to the edit_graph LLM, which renamed the factor to
 *   "Annual CRM Spend (£63,000)" while `observed_state` stayed byte-identical
 *   at `raw_value: 50000` / `display_value: "£50k"`. The product renamed a node
 *   to ASSERT a figure it does not hold, the LLM's success sentence tripped the
 *   finaliser egress guard and was replaced wholesale by the neutral fallback,
 *   and the user was told NOTHING. This leg was excluded BY DESIGN — the old
 *   label has no token to compare against — so the authority has to be the
 *   NODE'S OWN MODELLED MAGNITUDE instead (`modelledMagnitudeOf`).
 *
 * ⚠ LEG 2 IS DELIBERATELY SILENT WHERE IT CANNOT NAME A TRUE NUMBER. A
 * disclosure that states a magnitude is itself a claim; getting it wrong would
 * be the same class of harm one level up. Four conditions, all necessary:
 *
 *   1. exactly ONE quantity was added (several ⇒ no defensible value claim);
 *   2. every magnitude source on the node AGREES (drift ⇒ nothing quotable);
 *   3. the magnitude is DENOMINATED — a bare number is a score, not a quantity;
 *   4. the added token is denominated THE SAME WAY (`unitKindOfToken`).
 *
 * (3) and (4) are the same principle from opposite ends, and both were learned
 * from an outside corpus rather than from this author's head: (3) because a
 * normalised 0.4 reached the user through `display_value` after the first
 * revision excluded it only by FIELD NAME, and (4) because without it LEG 2
 * fired on any added digit — "FY26", "(Phase 2)", "top 3 vendors" — while
 * offering a chip that would have committed the wrong number to the model.
 *
 * The classes this drops are pinned BY NAME in the tests
 * (`label-value-divergence-added-quantity.test.ts`) so each gap stays visible
 * and REDs if it silently widens or narrows. Known-dropped today: several added
 * tokens; undenominated units (weeks, users, headcount); and a cross-unit
 * assertion (a currency figure appearing on a percent node).
 *
 * Both legs are DISCLOSURE ONLY: nothing in this module writes to a graph, an
 * op, or a value, and a test asserts that against deep-frozen inputs.
 *
 * ⭐ THE DISCLOSURE MUST KEEP THREE CARRIERS, AND THE CHAT ONE IS THE WEAK ONE.
 * Measured on the live capture and confirmed by review: the finaliser egress
 * guard (`edit-graph-dispatch.ts`) replaces the WHOLE `assistant_text` when any
 * part of it trips a fatal-class phrase — on the captured turn the LLM's own
 * success sentence did exactly that, so a chat-only disclosure would have died
 * with it. `buildLabelValueDivergenceNote` is therefore the PROBABILISTIC
 * carrier; `buildLabelValueDivergenceDescription` (the applied-changes receipt)
 * and `buildLabelValueDivergenceActions` (the typed chip) survive that rewrite
 * and are the RELIABLE ones. Anyone consolidating these surfaces later must not
 * route the disclosure through the chat path alone.
 */

import type { SuggestedAction } from '../orchestrator/types.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../cee/extraction/numeric-parser.js';
import { buildConfigureOptionChip } from './configure-option-chip-text.js';
import { thousands } from './compose/format-factor-value.js';

type Dict = Record<string, unknown>;

export interface LabelValueDivergence {
  /** Index of the operation within the batch. */
  readonly index: number;
  /** Node id (op.path). Internal — never rendered to the user. */
  readonly path: string;
  /** Render-safe resolved label (post-edit). */
  readonly label: string;
  readonly oldLabel: string;
  readonly newLabel: string;
  /**
   * What the model actually holds, as a render-safe token (e.g. "$49").
   * On LEG 1 this is the quantity the old LABEL carried; on LEG 2 the old label
   * carried none, so it is the node's own modelled magnitude (e.g. "£50k").
   */
  readonly oldValueToken: string;
  /** The quantity the new label now ASSERTS (e.g. "$39", "£63,000"). */
  readonly newValueToken: string;
  /** True when the node is an option (drives the configure-option affordance). */
  readonly isOption: boolean;
}

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function nodesOf(graph: unknown): Dict[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  return (graph.nodes as unknown[]).filter(isPlainObject);
}

function nodeById(graph: unknown, id: string): Dict | undefined {
  return nodesOf(graph).find((n) => n.id === id);
}

/** True when an intervention bundle carries at least one finite numeric value. */
function bundleHasNumericValue(bundle: unknown): boolean {
  if (!isPlainObject(bundle)) return false;
  for (const iv of Object.values(bundle)) {
    if (finiteNum(iv) !== undefined) return true;
    if (isPlainObject(iv) && (finiteNum(iv.value) !== undefined || finiteNum(iv.raw_value) !== undefined)) return true;
  }
  return false;
}

/**
 * True when the node carries a modelled numeric value whose display the label
 * is expected to track: an option with a numeric intervention, or a
 * factor/other node with a numeric `observed_state.value` / top-level `value`.
 * A node with no modelled value (a purely nominal "Phase 3" factor) is not in
 * scope — its label numbers are a name, not a quantity.
 */
function nodeHasModelledValue(node: Dict): boolean {
  if (bundleHasNumericValue(node.interventions)) return true;
  const data = node.data;
  if (isPlainObject(data) && bundleHasNumericValue(data.interventions)) return true;
  const obs = node.observed_state;
  if (isPlainObject(obs) && finiteNum(obs.value) !== undefined) return true;
  if (finiteNum(node.value) !== undefined) return true;
  return false;
}

/** True when this op's value payload changes a modelled value (not just a label). */
function opChangesModelledValue(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (finiteNum(value.value) !== undefined) return true;
  if (value.interventions != null) return true;
  if (value.observed_state != null) return true;
  if (finiteNum(value.raw_value) !== undefined) return true;
  const data = value.data;
  if (isPlainObject(data) && data.interventions != null) return true;
  return false;
}

/**
 * Extract quantitative tokens from a label: optional currency, a number (with
 * thousands separators / decimals), optional percent or magnitude suffix.
 */
const TOKEN_RE = /[£$€]?-?\d[\d,]*(?:\.\d+)?(?:%|bn|k|m|b)?/gi;

interface ValueToken {
  readonly raw: string;
  /** Magnitude+unit key used for equivalence (ignores currency + separators). */
  readonly key: string;
}

/** Canonical key for a token so formatting differences ($49 vs 49) compare equal. */
function tokenKey(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/[£$€,\s]/g, '');
  const isPct = t.endsWith('%');
  if (isPct) t = t.slice(0, -1);
  let mult = 1;
  const suffix = t.match(/(bn|k|m|b)$/);
  if (suffix) {
    const s = suffix[1];
    mult = s === 'k' ? 1e3 : s === 'm' ? 1e6 : 1e9; // bn / b
    t = t.slice(0, -s.length);
  }
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return '';
  return `${n * mult}${isPct ? '%' : ''}`;
}

function extractValueTokens(label: string): ValueToken[] {
  const out: ValueToken[] = [];
  const matches = label.match(TOKEN_RE) ?? [];
  for (const raw of matches) {
    const key = tokenKey(raw);
    if (key.length > 0) out.push({ raw, key });
  }
  return out;
}

/** Tokens present (by key, as a multiset) in `a` but not `b`. */
function tokensOnlyIn(a: ValueToken[], b: ValueToken[]): ValueToken[] {
  const remaining = b.map((t) => t.key);
  const only: ValueToken[] = [];
  for (const t of a) {
    const at = remaining.indexOf(t.key);
    if (at === -1) only.push(t);
    else remaining.splice(at, 1);
  }
  return only;
}

/**
 * A magnitude the node genuinely holds, with a render-safe way to say it.
 * `display` is what the user is shown; `key` is its comparison key, produced by
 * running `tokenKey` over that SAME rendered string.
 *
 * ⚠ THE KEY IS DERIVED FROM `display`, NEVER FROM THE BARE NUMBER, and the
 * distinction is load-bearing rather than stylistic. The first revision keyed on
 * `tokenKey(String(value))`, which drops the unit: a percent node holding 5
 * keyed as `"5"` while every label token `"5%"` keys as `"5%"`, so the two could
 * never compare equal. That produced a FALSE SENTENCE in one direction ("will
 * still use 5%, not 5%" on a label that AGREED) and TOTAL SILENCE in the other
 * (a real 5%→8% divergence read as "sources disagree"). Currency was unaffected,
 * which is precisely why an all-currency corpus could not see it — the docstring
 * here even claimed the alphabets matched, and it was false for `%`.
 */
interface ModelledMagnitude {
  readonly key: string;
  readonly display: string;
  readonly unit: UnitKind;
}

/**
 * What a rendered quantity is denominated in. This is a TYPE, and LEG 2 uses it
 * as a type check rather than as a phrase list — which is why it does not
 * reopen the natural-language oscillation class.
 */
type UnitKind = 'currency' | 'percent' | 'none';

/**
 * The denomination of a rendered token. Derived from the canonical currency
 * vocabulary, never from a re-spelled list.
 */
/**
 * The canonical symbols, listed once. Hoisted out of {@link unitKindOfToken}:
 * `CURRENCY_SYMBOL_TO_CODE` is a module constant, so `Object.keys` was
 * allocating a fresh ten-element array on every token classified.
 */
const CURRENCY_SYMBOLS: readonly string[] = Object.keys(CURRENCY_SYMBOL_TO_CODE);

function unitKindOfToken(raw: string): UnitKind {
  const t = raw.trim();
  if (t.endsWith('%')) return 'percent';
  for (const symbol of CURRENCY_SYMBOLS) {
    if (t.startsWith(symbol) || t.endsWith(symbol)) return 'currency';
  }
  return 'none';
}

/**
 * ⚠ DERIVED, NEVER RE-SPELLED. A second hand-written currency vocabulary is
 * exactly the mirror CLAUDE.md trap 12 describes, and the union guard in
 * `cee/extraction/__tests__/currency-vocabulary.union.test.ts` RED-ed this file
 * for minting one (it caught a literal `new Set(['£','$','€'])` here). The
 * canonical map is the single source of truth; a symbol added there reaches
 * this formatter for free.
 *
 * `unit` arrives in both spellings across the estate — as a symbol ("£", the
 * shape on the captured node) and as an ISO code ("GBP", the shape in the
 * option fixtures) — so both are resolved off the same map rather than listed.
 */
const CURRENCY_CODE_TO_SYMBOL: ReadonlyMap<string, string> = new Map(
  Object.entries(CURRENCY_SYMBOL_TO_CODE).map(([symbol, code]) => [code, symbol]),
);

/** The symbol to render for a `unit`, or null when it names no currency. */
function currencySymbolFor(unit: string): string | null {
  if (Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL_TO_CODE, unit)) return unit;
  return CURRENCY_CODE_TO_SYMBOL.get(unit) ?? null;
}

/**
 * Group a number's integer part in threes, without locale/ICU dependence.
 *
 * The grouping itself is `compose/format-factor-value.ts`'s {@link thousands} —
 * imported, not re-spelled (CLAUDE.md trap 12). The exponent guard, the sign and
 * the fraction re-attachment stay here: they are THIS formatter's rules.
 */
function withThousands(value: number): string {
  const asString = Math.abs(value).toString();
  if (asString.includes('e') || asString.includes('E')) return String(value);
  const [intPart, fracPart] = asString.split('.');
  const grouped = thousands(Number(intPart ?? '0'));
  return `${value < 0 ? '-' : ''}${grouped}${fracPart !== undefined ? `.${fracPart}` : ''}`;
}

/** Render a modelled magnitude the way the product states quantities. */
function formatMagnitude(value: number, unit: unknown): string {
  const n = withThousands(value);
  if (typeof unit === 'string') {
    const u = unit.trim();
    if (u === '%') return `${n}%`;
    const symbol = currencySymbolFor(u);
    if (symbol !== null) {
      // Alphabetic codes ("CHF", "kr") read as a trailing unit; sigils prefix.
      return /^[A-Za-z]+$/.test(symbol) ? `${n} ${symbol}` : `${symbol}${n}`;
    }
  }
  return n;
}

/**
 * Every source on the node that states a real-world magnitude.
 *
 * ⚠ `observed_state.value` is deliberately ABSENT. It is the NORMALISED
 * unit-interval value (on the captured node, `value: 1` against `cap: 50000`
 * for a raw_value of 50000) — comparing a label's "£63,000" against it would be
 * a category error, and would let the product state a confident, false number.
 * Only `raw_value` (wherever it appears) and the rendered `display_value` are
 * magnitudes. `display_value` is tokenised rather than trusted verbatim, so a
 * range or a non-numeric placeholder registers as ambiguity, not as a value.
 */
function collectMagnitudeCandidates(node: Dict): { magnitude: ModelledMagnitude; fromDisplayValue: boolean }[] {
  const out: { magnitude: ModelledMagnitude; fromDisplayValue: boolean }[] = [];
  const push = (value: number, unit: unknown): void => {
    const display = formatMagnitude(value, unit);
    // Key off the RENDERED string, so the unit is part of the key. See the
    // warning on ModelledMagnitude — keying off `String(value)` here is the
    // defect that made every percent node uncomparable.
    const key = tokenKey(display);
    if (key.length > 0) {
      out.push({ magnitude: { key, display, unit: unitKindOfToken(display) }, fromDisplayValue: false });
    }
  };

  const obs = node.observed_state;
  if (isPlainObject(obs)) {
    const raw = finiteNum(obs.raw_value);
    if (raw !== undefined) push(raw, obs.unit);
  }
  const topLevelRaw = finiteNum(node.raw_value);
  if (topLevelRaw !== undefined) push(topLevelRaw, isPlainObject(obs) ? obs.unit : node.unit);

  for (const bundle of [node.interventions, isPlainObject(node.data) ? node.data.interventions : undefined]) {
    if (!isPlainObject(bundle)) continue;
    for (const iv of Object.values(bundle)) {
      if (!isPlainObject(iv)) continue;
      const raw = finiteNum(iv.raw_value);
      if (raw !== undefined) push(raw, iv.unit);
    }
  }

  // The rendered string the user actually sees on the node. Every token counts:
  // "£50k–£60k" yields two disagreeing keys and therefore blocks the claim.
  if (typeof node.display_value === 'string') {
    for (const token of extractValueTokens(node.display_value)) {
      out.push({
        magnitude: { key: token.key, display: token.raw, unit: unitKindOfToken(token.raw) },
        fromDisplayValue: true,
      });
    }
  }

  return out;
}

/**
 * The single magnitude this node can be honestly said to hold, or null when
 * there isn't one. Null when no source states a magnitude, and null when the
 * sources DISAGREE — a node whose `display_value` has drifted from its
 * `raw_value` cannot be quoted at the user without picking a number we cannot
 * defend, so the product says nothing instead.
 */
function modelledMagnitudeOf(node: Dict): ModelledMagnitude | null {
  const candidates = collectMagnitudeCandidates(node);
  if (candidates.length === 0) return null;
  const agreedKey = candidates[0]!.magnitude.key;
  if (candidates.some((c) => c.magnitude.key !== agreedKey)) return null;
  // All sources agree, so preferring the rendered string costs no accuracy and
  // matches what the user can see on the canvas ("£50k", not "£50,000").
  const rendered = candidates.find((c) => c.fromDisplayValue);
  const magnitude = (rendered ?? candidates[0]!).magnitude;

  // ⭐ THE SEMANTIC, NOT THE FIELD NAME. A magnitude may be quoted at the user
  // only if it is a REAL-WORLD QUANTITY — one that carries a denomination. The
  // first revision excluded normalised values by naming the field
  // (`observed_state.value`), and that guard was trivially bypassed: the
  // captured graph's own `fac_platform_capability` carries no `raw_value` but a
  // `display_value` of "Moderate (0.4)", so the score 0.4 walked in through the
  // other door and the product would have said "will still use 0.4". A bare
  // number is not a quantity, wherever it was read from.
  return magnitude.unit === 'none' ? null : magnitude;
}

function detectOne(
  op: unknown,
  index: number,
  preGraph: unknown,
  postGraph: unknown,
  valueChangedPaths: ReadonlySet<string>,
): LabelValueDivergence | null {
  if (!isPlainObject(op) || op.op !== 'update_node' || typeof op.path !== 'string') return null;
  const value = op.value;
  if (!isPlainObject(value)) return null;
  const newLabel = typeof value.label === 'string' ? value.label : null;
  if (newLabel === null) return null; // no label change → not this class
  if (opChangesModelledValue(value)) return null; // the LLM already changed the model too
  if (valueChangedPaths.has(op.path)) return null; // a sibling op changed this node's value

  const preNode = nodeById(preGraph, op.path);
  const oldValue = op.old_value;
  const oldLabel =
    isPlainObject(oldValue) && typeof oldValue.label === 'string'
      ? oldValue.label
      : preNode && typeof preNode.label === 'string'
        ? preNode.label
        : null;
  if (oldLabel === null) return null;

  // The node whose modelled value the label is supposed to track.
  const node = preNode ?? nodeById(postGraph, op.path);
  if (!node || !nodeHasModelledValue(node)) return null;

  const oldTokens = extractValueTokens(oldLabel);
  const newTokens = extractValueTokens(newLabel);
  const oldOnly = tokensOnlyIn(oldTokens, newTokens);
  const newOnly = tokensOnlyIn(newTokens, oldTokens);
  // Nothing new is being ASSERTED — a pure rename, a REMOVED quantity, or a
  // formatting-only change. Nothing to disclose, on either leg.
  if (newOnly.length === 0) return null;

  let oldValueToken: string;
  if (oldOnly.length > 0) {
    // LEG 1 — REPLACED. The old label is the authority. Unchanged behaviour.
    oldValueToken = oldOnly[0]!.raw;
  } else {
    // LEG 2 — ADD-ONLY. The old label states nothing, so the node's own
    // modelled magnitude is the authority.
    //
    // Exactly one added token, deliberately: with several ("(£63,000 over 3
    // years)") there is no defensible way to tell which one is the value claim,
    // and naming the wrong one would be a confident falsehood rather than a
    // gap. Silence is the honest answer; the dropped class is pinned by test.
    if (newOnly.length !== 1) return null;
    const modelled = modelledMagnitudeOf(node);
    if (modelled === null) return null; // no magnitude we can defend naming

    // ⭐ UNIT AGREEMENT — the added token must be DENOMINATED THE SAME WAY as
    // the value it is being read against. This is a type check, not a phrase
    // list, which is why it does not reopen the natural-language oscillation
    // class that has cost this repo five rounds elsewhere.
    //
    // Without it, LEG 2 fired on ANY added digit, because LEG 1's
    // replaced-token requirement had been the only thing holding that line.
    // Measured on the captured node: "FY26" produced "not 26", "(Phase 2)"
    // produced "not 2", "top 3 vendors" produced "not 3" — and the chips those
    // offered were NOT inert, so one click would have set Annual CRM Spend to
    // 2026. Honesty was also resting on how many digits the user happened to
    // type: "(renewal Q1 2027)" escaped only by adding two tokens.
    const addedUnit = unitKindOfToken(newOnly[0]!.raw);
    if (addedUnit !== modelled.unit) return null;

    if (modelled.key === newOnly[0]!.key) return null; // the label AGREES — no harm
    oldValueToken = modelled.display;
  }

  const postNode = nodeById(postGraph, op.path);
  const label = (postNode && typeof postNode.label === 'string' ? postNode.label : newLabel) || oldLabel;

  return {
    index,
    path: op.path,
    label,
    oldLabel,
    newLabel,
    oldValueToken,
    newValueToken: newOnly[0]!.raw,
    isOption: node.kind === 'option',
  };
}

/**
 * Detect every operation in the batch that renames a label so its embedded
 * quantity changes while the node's modelled value does not.
 */
export function detectLabelValueDivergences(
  operations: unknown,
  preGraph: unknown,
  postGraph: unknown,
): LabelValueDivergence[] {
  if (!Array.isArray(operations)) return [];

  // Paths whose modelled value changed anywhere in the batch — a label rename
  // on such a node is a legitimate accompaniment, not a divergence.
  const valueChangedPaths = new Set<string>();
  for (const op of operations) {
    if (isPlainObject(op) && op.op === 'update_node' && typeof op.path === 'string' && opChangesModelledValue(op.value)) {
      valueChangedPaths.add(op.path);
    }
  }

  const out: LabelValueDivergence[] = [];
  operations.forEach((op, index) => {
    const d = detectOne(op, index, preGraph, postGraph, valueChangedPaths);
    if (d) out.push(d);
  });
  return out;
}

/**
 * The honest description for the applied-changes receipt: the label DID change,
 * but only the display text — the modelled value did not.
 */
export function buildLabelValueDivergenceDescription(d: LabelValueDivergence): string {
  const kind = d.isOption ? 'option' : 'factor';
  return (
    `Renamed the ${kind} to "${d.newLabel}" — display text only. ` +
    `The modelled value is unchanged (still ${d.oldValueToken}, not ${d.newValueToken}).`
  );
}

/**
 * The honest assistant-text disclosure for a set of divergences. Returns null
 * when there are none so callers can omit it cleanly.
 */
export function buildLabelValueDivergenceNote(divergences: readonly LabelValueDivergence[]): string | null {
  if (divergences.length === 0) return null;
  const sentences = divergences.map((d) => {
    const kind = d.isOption ? 'option' : 'factor';
    return (
      `Heads up — that changed the label text only. The ${kind} now reads "${d.newLabel}", ` +
      `but its modelled value is unchanged, so re-running the analysis will still use ${d.oldValueToken}, ` +
      `not ${d.newValueToken}. Want me to update the modelled value to ${d.newValueToken}?`
    );
  });
  return sentences.join('\n\n');
}

/**
 * The typed affordance that actually changes the value. For an option this is
 * the canonical configure-option chip (its replayed message routes to the
 * configure-option lane that WRITES interventions); for a factor it is a
 * value-set prompt the deterministic value path can serve.
 */
export function buildLabelValueDivergenceActions(divergences: readonly LabelValueDivergence[]): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const seen = new Set<string>();
  for (const d of divergences) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    if (d.isOption) {
      const chip = buildConfigureOptionChip(d.label);
      actions.push({ label: chip.label, prompt: chip.message, role: 'facilitator' });
    } else {
      actions.push({
        label: `Update ${d.label}`,
        prompt: `set ${d.label} to ${d.newValueToken}`,
        role: 'facilitator',
      });
    }
  }
  return actions;
}
