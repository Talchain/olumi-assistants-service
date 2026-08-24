/**
 * ⭐⭐ MUTATION WARRANT — the predicate behind INV-1, the action-layer
 * guarantee "nothing is written to the user's model unless the user asked
 * for a change".
 *
 * WITNESSED (staging CEE `8687a31`, 6 Aug 2026, walk 2.634 §J7 —
 * `PHASE0-EVIDENCE-2026-07-28/walk-2634-findings-2026-08-07.md`): the user
 * typed a pure READ request,
 *
 *   "Open the analysis panel and show me the option comparison"
 *
 * and the assistant EDITED the model — "Added constraint: churn could rise
 * ceiling must be at most 3%.", marked "Applied", with NO confirm chip.
 *
 * ── WHY THE EXISTING CONSENT MACHINERY DID NOT CATCH IT ───────────────────
 * `mutation-consent.ts` detects WITHHELD consent — the user saying *do not
 * apply this yet*. On a read request the user says no such thing, so it
 * correctly stands down. Traced at `8687a311`, constraint writes were inside
 * NO consent regime at all:
 *   · Sonnet tool-use routing (`tool_choice:"auto"`) may emit an execute-class
 *     `add_constraint` on any utterance;
 *   · the D1 lifecycle validates then executes immediately — there is no hold;
 *   · the Graph-Management referee's op vocabulary structurally cannot hold
 *     `add_constraint`.
 * No guard anywhere asked the AFFIRMATIVE question: *did the user request a
 * change at all?* This module is that question.
 *
 * ── WHAT THIS MODULE IS AND IS NOT ────────────────────────────────────────
 * A PURE PREDICATE over the turn's own INGRESS — the user's message, the
 * chip they clicked, and whether the turn is resuming a proposal they already
 * confirmed. It has no opinion about routing, handlers or graphs. Its output
 * is consumed by the turn-executor at the ACTION layer, which is where the
 * guarantee lives: a warrantless mutating proposal is DEMOTED to the
 * propose-confirm channel (chip + pending) rather than executed, and the
 * graph commit chokepoint strips a handler mutation from such a turn as a
 * second, list-free backstop. **Response wording enforces nothing.**
 *
 * Deliberately evaluable BEFORE any model call, for the same reason
 * `detectWithheldConsent` is: the guarantee cannot depend on what the model
 * decides, because on the witnessed turn the model decided to mutate.
 *
 * ── FAIL-SAFE DIRECTION (⚠ INVERTED RELATIVE TO WITHHELD CONSENT) ─────────
 * Read this before adding a pattern. For `detectWithheldConsent` a false
 * POSITIVE is cheap, so its judgement calls resolve toward withholding. Here
 * the polarity flips:
 *
 *   false NEGATIVE (no warrant found, user did want the change)
 *       → the change is OFFERED as a chip. Costs one click.
 *   false POSITIVE (warrant found, user did not ask for a change)
 *       → the model is silently rewritten. This is the witnessed defect.
 *
 * So every judgement call below resolves toward NOT granting, and every
 * pattern demands BOTH a deontic frame ("keep", "must", "limit", "can't
 * exceed") AND a number. A merely DESCRIPTIVE sentence about a bound —
 * "there's about a 70% chance churn stays below 3%" — is a forecast, not an
 * instruction, and must not grant. That exact utterance is in the negative
 * corpus.
 *
 * ── WHY THERE IS A HAND-WRITTEN CORPUS (CLAUDE.md trap 12d) ───────────────
 * `MUTATION_SIGNAL_PATTERNS` in `analytical-intent.ts` is the canonical
 * mutation-shape list, and it was SHORT: it recognises "set X to N" and "add
 * a Y" but no constraint phrasing at all, so "Keep churn below 3%." carried
 * no signal. A guard derived from that list would have agreed with it
 * perfectly and still missed every constraint the product can write. The
 * corpus in `__tests__/mutation-warrant.test.ts` is hand-written, carries
 * both directions, and is what notices the list is short. The UNION
 * assertion there is the derived half: everything the canonical list
 * recognises must also grant a warrant, so the two can never fork.
 */

import { hasMutationSignal } from './analytical-intent.js';
import { isAnalyticalQuestion } from './analytical-question-guard.js';
import { isStateQueryQuestionShape } from './state-query-guard.js';
import {
  EDIT_GRAPH_POSITIVE_REGEX,
  EDIT_GRAPH_NEGATIVE_REGEX,
} from '../../orchestrator/routing/edit-graph-intent-regex.js';

/**
 * Constraint-shaped mutation phrasings the canonical
 * `MUTATION_SIGNAL_PATTERNS` does not carry.
 *
 * ⚠ EVERY PATTERN REQUIRES A DEONTIC FRAME **AND** A DIGIT. Dropping either
 * requirement flips this module's fail-safe direction (see the header): a
 * bare `stays below` would grant a warrant on "there's a 70% chance churn
 * stays below 3%", which is the calibration forecast #831 and ROADMAP 2.627
 * exist to keep OUT of the write path.
 *
 * Kept as a separate export rather than appended to
 * `MUTATION_SIGNAL_PATTERNS` deliberately: that list has six read-side
 * consumers (run-comparison, stale-rerun, vague-edit, post-analysis-label,
 * no-analysis, post-analysis-advice) whose short-circuit behaviour inverts on
 * a mutation hit, and widening it would change all six at once for reasons
 * none of them asked for. The union assertion in the spec keeps this list a
 * strict SUPERSET, which is the only relationship the warrant needs.
 */
export const CONSTRAINT_MUTATION_SIGNAL_PATTERNS: readonly RegExp[] = [
  // "Keep churn below 3%." · "Hold spend under 50k." · "Maintain uptime above 99%."
  /\b(?:keep|hold|maintain)\b[^.?!\n]{0,60}\b(?:below|under|above|over|beneath|beyond|at\s+or\s+(?:below|above)|within)\b[^.?!\n]{0,24}\d/i,
  // "Churn must be at most 3%." · "It has to be at least 1%." · "must stay under 3%"
  /\b(?:must|should|needs?\s+to|has\s+to|have\s+to)\b[^.?!\n]{0,40}\b(?:at\s+most|at\s+least|no\s+more\s+than|no\s+less\s+than|no\s+higher\s+than|no\s+lower\s+than|below|under|above|over|beneath)\b[^.?!\n]{0,24}\d/i,
  // "Churn can't exceed 3%." · "must not go above 3%" · "shouldn't rise above 3%"
  /\b(?:can(?:'|’)?t|cannot|can\s+not|must\s+not|mustn(?:'|’)?t|should\s+not|shouldn(?:'|’)?t|won(?:'|’)?t|may\s+not)\b[^.?!\n]{0,24}\b(?:exceed|surpass|go\s+(?:above|below|over|under|past)|rise\s+(?:above|over|past)|fall\s+below|drop\s+below|climb\s+(?:above|over))\b[^.?!\n]{0,24}\d/i,
  // "Limit churn to 3%." · "Cap spend at 50k." · "Constrain churn to 3%."
  /\b(?:limit|cap|restrict|constrain|bound|ceiling|floor)\b[^.?!\n]{0,60}\b(?:to|at|of)\b[^.?!\n]{0,24}\d/i,
  // "Make sure churn stays below 3%." · "Ensure uptime remains above 99%."
  /\b(?:make\s+sure|ensure|guarantee)\b[^.?!\n]{0,60}\b(?:stays?|remains?|sits?|is|are)\b[^.?!\n]{0,40}\b(?:below|under|above|over|beneath|at\s+or\s+(?:below|above))\b[^.?!\n]{0,24}\d/i,
  // "Don't let churn rise above 3%." · "Never let spend exceed 50k."
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never)\s+(?:let|allow)\b[^.?!\n]{0,60}\b(?:exceed|surpass|go\s+(?:above|below|over|under)|rise\s+(?:above|over)|fall\s+below|drop\s+below|get\s+(?:above|below))\b[^.?!\n]{0,24}\d/i,
  // Bare imperative constraint: "No more than 3% churn." · "At most 3% churn."
  /^\s*(?:no\s+(?:more|less|higher|lower)\s+than|at\s+most|at\s+least|up\s+to)\b[^.?!\n]{0,40}\d/im,
  // ⭐ THE CONVERSATIONAL CONSTRAINT — how users actually state a bound in
  // chat, and the shape the repo's OWN journey fixtures use:
  //   "We can't spend more than £50,000 on marketing."
  //   "Yes, we don't want to spend more than £50k on this."
  // A negated capability/desire plus a comparative bound plus a number. It is
  // an instruction, not a report, because of the negation — "we spent more than
  // £50k" carries no negation and does not match.
  /\b(?:do\s*n(?:o|')?t|don\s*'?\s*t|do\s+not|never|can(?:'|’)?t|cannot|can\s+not|won(?:'|’)?t|will\s+not|must\s+not|mustn(?:'|’)?t)\b[^.?!\n]{0,60}\b(?:more|less|higher|lower|greater|bigger|smaller)\s+than\b[^.?!\n]{0,24}[£$€]?\s?\d/i,
];

/**
 * Does the message carry a CONSTRAINT-shaped mutation instruction? Narrow by
 * construction — see the fail-safe note above.
 */
export function hasConstraintMutationSignal(message: string): boolean {
  if (typeof message !== 'string') return false;
  for (const re of CONSTRAINT_MUTATION_SIGNAL_PATTERNS) {
    if (re.test(message)) return true;
  }
  return false;
}

/**
 * Edit verbs the V5 mutating handlers serve that `EDIT_GRAPH_POSITIVE_REGEX`
 * does not carry — because that regex gates the STRUCTURAL edit_graph lane,
 * whose vocabulary is add/remove/rename, while these three handlers also serve
 * strength and intervention edits.
 *
 * ⚠ MEASURED, not guessed. Each entry is here because a real request in the
 * repo's own behavioural suite carries it and would otherwise cost the user a
 * chip click on a change they plainly asked for:
 *   strengthen/weaken  ← "strengthen the link from marketing budget to revenue"
 *   make X strong(er)  ← "Make the marketing budget effect on revenue strong"
 *   revise / configure ← "revise the Launch now option so its churn ... is lower",
 *                         "Help me configure Launch now."
 *   reduces / raises … ← "Launching reduces Customer churn to 2%" (the third-person
 *                         inflections `\breduce\b` misses)
 *   "X is now N"       ← "Customer churn is now 2%" — the DECLARATIVE value answer,
 *                         which is the affordance this product explicitly asks for
 *                         ("where does churn currently sit?"). Kept narrow: it
 *                         requires a copula, a nowness marker AND a number, so a
 *                         forecast ("a 70% chance churn stays below 3%") does not
 *                         match — that sentence is in the negative corpus.
 */
const WARRANT_EXTRA_EDIT_VERB_PATTERNS: readonly RegExp[] = [
  /\b(?:strengthen|strengthens|weaken|weakens|rename|renames|relabel|revise|revises|configure|configures)\b/i,
  /\bmake\b[^.?!\n]{0,80}\b(?:strong|stronger|strongest|weak|weaker|higher|lower|bigger|smaller|negative|positive)\b/i,
  /\b(?:reduces|increases|decreases|raises|lowers|changes|updates|adjusts|sets|removes|deletes|adds)\b/i,
  /\b(?:is|are|sits|sat|stands|runs)\s+(?:now|currently|at|about|around|roughly|approximately)\s+[-+]?[£$€]?\s?\d/i,
];

/**
 * The message half of the warrant: does the user's own text ask for a change?
 *
 * ⭐ THE UNION IS THE POINT, AND THE THIRD TERM IS WHERE THE PARITY LIVES.
 *
 *  1. `hasMutationSignal` — the canonical concrete-edit list ("set X to N",
 *     "add a Y"). Included wholesale so the two predicates cannot fork.
 *  2. `hasConstraintMutationSignal` — the constraint phrasings above, which
 *     term 1 carries none of.
 *  3. THE PRODUCT'S OWN EDIT-INTENT DOOR: the exact predicate
 *     `orchestrator/route-v2.ts` uses to decide whether a message is an edit
 *     request at all (`EDIT_GRAPH_POSITIVE_REGEX && !EDIT_GRAPH_NEGATIVE_REGEX`,
 *     minus the analytical-question and state-query suppressors it also
 *     applies), plus the verb extension above.
 *
 * ⚠ WHY TERM 3 RATHER THAN A LONGER BESPOKE LIST — this IS the consent parity
 * the fix is named for. The Graph-Management channel has always asked this
 * question at its door; the executor asked nothing, which is why the walk's
 * read request could reach a write there and not there. Reusing the same
 * predicate makes the two doors ask the same question by construction instead
 * of by a second list somebody has to remember to sync (CLAUDE.md trap 12), and
 * it inherits that regex's hardening against read markers — `EDIT_GRAPH_NEGATIVE_REGEX`
 * already excludes "show me", "explain", "compare", "tell me", "describe",
 * "why", "how does", "what would", which is the entire read vocabulary the walk
 * exercised.
 *
 * ⚠ WHAT TERM 3 DELIBERATELY DOES NOT SUBTRACT: route-v2 also suppresses on
 * `shouldSuppressEditDispatchForValueUpdate`. That is a ROUTING suppressor — it
 * sends "set X to N" down the deterministic D1 path INSTEAD of edit_graph — not
 * a judgement that the message is not an edit. Subtracting it here would strip
 * the warrant from the most unambiguous edit requests the product accepts.
 *
 * The result is a strict superset of `hasMutationSignal`; the union assertion
 * in the spec pins that, so the canonical list can never recognise an edit this
 * predicate refuses.
 */
export function hasMutationWarrantSignal(message: string): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  if (hasMutationSignal(message)) return true;
  if (hasConstraintMutationSignal(message)) return true;
  return isEditRequestShape(message);
}

/**
 * The small, answer-seeking class that must never be converted into an edit.
 *
 * These are analytical questions whose wording is not covered by the older
 * what-would-flip taxonomy: safety under missing information, a request for
 * the next fact to gather, or a direct challenge to an existing result.  The
 * browser-witnessed prompts often finish with "do not change the model";
 * `hasMutationSignal` sees the bare word "change" and therefore cannot be the
 * discriminator by itself.
 *
 * We first require an answer-seeking shape, then remove only the explicit
 * negative-scope clause and ask the existing mutation authorities whether an
 * affirmative edit remains.  That last step is the contrast guard for
 * "Set X to 0.7 and do not change anything else": it remains an edit.
 */
const BOUNDED_NON_MUTATION_ANALYTICAL_PATTERNS: readonly RegExp[] = [
  /\b(?:is\s+it\s+safe|safest\s+way|safe\s+to\s+run|safe\s+way)\b/i,
  /\b(?:challenge|critique)\b[^.?!\n]{0,120}\b(?:result|analysis|outcome)\b/i,
  /\b(?:strongest\s+reason|strongest\s+challenge)\b[^.?!\n]{0,120}\b(?:misleading|result|analysis|outcome)\b/i,
  /\b(?:which|what)\s+(?:single\s+)?(?:missing\s+)?(?:fact|piece\s+of\s+evidence)\b/i,
  /\bdoes\b[^.?!\n]{0,80}\bresult\b[^.?!\n]{0,80}\bjustify\b/i,
];

/**
 * A bounded token recognizer for explicit model-change vetoes.
 *
 * This deliberately does not grow another edit-intent regex. Text is first
 * normalized and split into clauses; exact lexemes then establish three facts
 * inside one clause: a prohibitive cue, a mutation word, and an exact
 * model/graph object. Exact tokens keep `model`/`graph` prefix collisions out,
 * while the small bridge vocabulary admits ordinary grammatical permutations
 * such as "without edits being made to my current causal graph".
 */
/**
 * ⭐⭐ THE VERBS THAT AUTHORISE A WRITE ARE THE VERBS THAT CAN FORBID ONE.
 *
 * This is the canonical base vocabulary, and `deterministic-value-update.ts`
 * builds its `EDIT_VERB_PATTERN` from it rather than keeping a second copy.
 *
 * ⚠ WHY IT IS DERIVED AND NOT MIRRORED (SENDABLE P0, 24 Aug 2026). The grant
 * side dispatched on ten verbs; this veto knew nine, and they OVERLAPPED ON
 * THREE — change, update, adjust. So `increase`, `decrease`, `reduce`, `raise`,
 * `lower`, `set` and `make` could each authorise a canonical write while no
 * prohibition using them could stop one.
 *
 * `set` is the worst of the seven, because it is not an edge case: the product
 * dispatches `set_factor_value`, and its own coaching copy tells the user to
 * type "Set the … option's effect on Rep Adoption Quality to 0.6". So the
 * product taught a verb its own prohibition vocabulary could not hear. Measured
 * on staging: "Whatever you do, don't set Rep Adoption Quality to 0.2" wrote the
 * value and replied "Updated Rep Adoption Quality from 0.7 to 0.2."
 *
 * Two lists standing for one concept is this estate's dominant defect. One list,
 * two consumers.
 */
export const EDIT_VERB_BASES = [
  'increase', 'decrease', 'reduce', 'raise', 'lower',
  'set', 'change', 'update', 'make', 'adjust',
] as const;

/**
 * Inflections stay local to the token matcher: English morphology is irregular
 * (`set`→`set`, `make`→`made`) and generating it would be a worse mirror than
 * writing it. What must AGREE across the two sides is the base vocabulary
 * above, and that is imported, not copied.
 */
const MUTATION_VERB_LEXEMES = new Set([
  ...EDIT_VERB_BASES,
  'increases', 'increased', 'increasing',
  'decreases', 'decreased', 'decreasing',
  'reduces', 'reduced', 'reducing',
  'raises', 'raised', 'raising',
  'lowers', 'lowered', 'lowering',
  'sets', 'setting',
  'changes', 'changed', 'changing',
  'updates', 'updated', 'updating',
  'makes', 'made', 'making',
  'adjusts', 'adjusted', 'adjusting',
  // Retained beyond the grant vocabulary: these forbid writes the LLM route can
  // still perform even where the deterministic path never dispatches on them.
  'edit', 'edits', 'edited', 'editing',
  'modify', 'modifies', 'modified', 'modifying',
  'mutate', 'mutates', 'mutated', 'mutating',
  'touch', 'touches', 'touched', 'touching',
  'alter', 'alters', 'altered', 'altering',
  'rewrite', 'rewrites', 'rewrote', 'rewritten', 'rewriting',
]);

const MUTATION_NOUN_LEXEMES = new Set([
  'change', 'changes',
  'edit', 'edits',
  'update', 'updates',
  'modification', 'modifications',
  'mutation', 'mutations',
  'adjustment', 'adjustments',
  'alteration', 'alterations',
  'rewrite', 'rewrites',
]);

const MUTATION_LEXEMES = new Set([
  ...MUTATION_VERB_LEXEMES,
  ...MUTATION_NOUN_LEXEMES,
]);

const MODEL_OBJECT_LEXEMES = new Set(['model', 'models', 'graph', 'graphs']);
const MODEL_QUALIFIER_LEXEMES = new Set([
  'a', 'an', 'the', 'this', 'that',
  'my', 'our', 'your', 'their', 'its',
  'current', 'existing', 'working', 'underlying',
  'causal', 'shared', 'strategic', 'decision',
]);
const CUE_FILLER_LEXEMES = new Set([
  'please', 'just', 'ever', 'directly', 'deliberately', 'accidentally',
  'now', 'immediately', 'under', 'a', 'an', 'any', 'circumstances', 'in', 'way',
  'additional', 'further', 'other',
]);
const MUTATION_OBJECT_BRIDGE_LEXEMES = new Set([
  ...MODEL_QUALIFIER_LEXEMES,
  'any', 'no', 'to', 'of', 'in', 'on', 'for', 'about', 'within', 'from',
  'be', 'being', 'been', 'is', 'are', 'was', 'were',
  'get', 'gets', 'getting', 'got',
  'make', 'making', 'made', 'apply', 'applying', 'applied',
  'at', 'all', 'it', 'itself', 'them', 'themselves',
  'additional', 'further', 'other',
]);
const MUTATION_OPERATORS = new Set(['make', 'making', 'apply', 'applying']);
const MUTATION_CONTROLS = new Set(['let', 'allow', 'have']);
const SCOPED_TAIL_LEXEMES = new Set(['additional', 'further', 'other']);
const MODEL_CONNECTOR_LEXEMES = new Set(['to', 'of', 'in', 'on', 'within']);
const MAX_CUE_WINDOW_TOKENS = 14;
const MAX_MODEL_QUALIFIERS = 5;

interface NoChangeCandidate {
  readonly start: number;
  readonly end: number;
  readonly scopedTail: boolean;
  readonly cue: 'do_not' | 'never' | 'without' | 'no';
}

interface NoChangeClause {
  readonly tokens: readonly string[];
  readonly question: boolean;
}

function isWordCharacter(character: string | undefined): boolean {
  if (!character) return false;
  const code = character.toLowerCase().charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function isCompleteQuotedNoChangePhrase(quoted: string): boolean {
  const normalized = quoted
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/\bdon\s*'\s*t\b/gi, 'do not')
    .toLowerCase();
  const tokens = tokenizeNoChangeClause(normalized);
  const hasCue = tokens.some((token, index) =>
    token === 'without' || token === 'never' || token === 'no' ||
    (token === 'do' && tokens[index + 1] === 'not'));
  return hasCue && tokens.some((token) => MUTATION_LEXEMES.has(token)) &&
    tokens.some((token) => MODEL_OBJECT_LEXEMES.has(token));
}

/** Remove complete quoted mentions; an unmatched quote is left untouched. */
function maskQuotedMentions(message: string): string {
  const characters = [...message];
  for (let start = 0; start < characters.length; start += 1) {
    const opening = characters[start];
    const doubleQuote = opening === '"' || opening === '“';
    const singleQuote = (opening === "'" || opening === '‘') &&
      !isWordCharacter(characters[start - 1]) && isWordCharacter(characters[start + 1]);
    if (!doubleQuote && !singleQuote) continue;
    const closing = opening === '“' ? '”' : opening === '‘' ? '’' : opening;
    let end = start + 1;
    while (end < characters.length) {
      const matchesDelimiter = characters[end] === closing;
      const contractionApostrophe = singleQuote &&
        isWordCharacter(characters[end - 1]) && isWordCharacter(characters[end + 1]);
      if (matchesDelimiter && !contractionApostrophe) break;
      end += 1;
    }
    if (end >= characters.length) continue;
    const quoted = characters.slice(start + 1, end).join('');
    const hasOutsideContext = characters.slice(0, start).some(isWordCharacter) ||
      characters.slice(end + 1).some(isWordCharacter);
    if (hasOutsideContext && isCompleteQuotedNoChangePhrase(quoted)) {
      for (let cursor = start; cursor <= end; cursor += 1) characters[cursor] = ' ';
    }
    start = end;
  }
  return characters.join('');
}

function tokenizeNoChangeClause(clause: string): readonly string[] {
  return clause.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
}

function splitNoChangeClauses(message: string): NoChangeClause[] {
  const normalized = maskQuotedMentions(message)
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/\bdon\s*'\s*t\b/gi, 'do not')
    .toLowerCase();
  const clauses: NoChangeClause[] = [];
  let buffer = '';
  const pushClause = (question: boolean): void => {
    const tokens = tokenizeNoChangeClause(buffer);
    if (tokens.length > 0) clauses.push({ tokens, question });
    buffer = '';
  };
  for (const character of normalized) {
    if (character === '?') {
      pushClause(true);
    } else if (character === '.' || character === '!' || character === ';' ||
      character === '\n' || character === '\r') {
      pushClause(false);
    } else {
      buffer += character === ':' || character === '—' || character === '–' ? ' ' : character;
    }
  }
  pushClause(false);
  return clauses;
}

function skipCueFillers(tokens: readonly string[], from: number, limit: number): number {
  let cursor = from;
  while (cursor < limit && CUE_FILLER_LEXEMES.has(tokens[cursor]!)) cursor += 1;
  return cursor;
}

/**
 * The model's OWN ENTITY LABELS, tokenised, so a prohibition naming a factor is
 * recognised as a prohibition about the model.
 *
 * ⭐ WHY THIS EXISTS. `MODEL_OBJECT_LEXEMES` is four tokens standing in for an
 * unbounded class: every entity label in the user's graph. The GRANT side
 * already resolves those labels against the live graph
 * (`deterministic-value-update.ts` — `normMessage.indexOf(normLabel)`); the
 * VETO side did not. That asymmetry was the whole of SENDABLE P0 (24 Aug 2026):
 * "Whatever you do, don't set Rep Adoption Quality to 0.2" produced NO veto
 * candidate at all, because the walk in `findModelObjectAfter` hit "rep" —
 * neither a model object nor a bridge lexeme — and aborted. The product then
 * performed the edit and reported "Updated Rep Adoption Quality from 0.7 to 0.2".
 *
 * The same sentence was specific enough to AUTHORISE a write and not specific
 * enough to FORBID one. This closes that, using the caller's own graph rather
 * than a fifth hand-maintained lexeme — the tail vocabulary is an open class and
 * a longer list is the next round of the same mistake.
 */
type LabelRun = readonly string[];

function tokeniseEntityLabels(labels: readonly string[] | undefined): readonly LabelRun[] {
  if (!labels || labels.length === 0) return EMPTY_LABEL_RUNS;
  const runs: LabelRun[] = [];
  for (const raw of labels) {
    if (typeof raw !== 'string') continue;
    const run = tokenizeNoChangeClause(raw.toLowerCase());
    if (run.length === 0) continue;
    runs.push(run);
  }
  return runs;
}

const EMPTY_LABEL_RUNS: readonly LabelRun[] = [];

/** Does one of the model's entity labels start exactly at `cursor`? */
function labelRunEndAt(
  tokens: readonly string[],
  cursor: number,
  labelRuns: readonly LabelRun[],
): number | null {
  for (const run of labelRuns) {
    if (cursor + run.length > tokens.length) continue;
    let hit = true;
    for (let offset = 0; offset < run.length; offset += 1) {
      if (tokens[cursor + offset] !== run[offset]) { hit = false; break; }
    }
    // Return the LAST token of the label, so any scoped-tail scan that follows
    // starts after the whole object rather than inside it.
    if (hit) return cursor + run.length - 1;
  }
  return null;
}

function findModelObjectAfter(
  tokens: readonly string[],
  from: number,
  limit: number,
  labelRuns: readonly LabelRun[] = EMPTY_LABEL_RUNS,
): number | null {
  for (let cursor = from; cursor < limit; cursor += 1) {
    if (MODEL_OBJECT_LEXEMES.has(tokens[cursor]!)) return cursor;
    const labelEnd = labelRunEndAt(tokens, cursor, labelRuns);
    if (labelEnd !== null) return labelEnd;
    if (!MUTATION_OBJECT_BRIDGE_LEXEMES.has(tokens[cursor]!)) return null;
  }
  return null;
}

function parseModelObjectAt(
  tokens: readonly string[],
  from: number,
  limit: number,
  labelRuns: readonly LabelRun[] = EMPTY_LABEL_RUNS,
): number | null {
  const objectLimit = Math.min(limit, from + MAX_MODEL_QUALIFIERS + 1);
  for (let cursor = from; cursor < objectLimit; cursor += 1) {
    const token = tokens[cursor]!;
    if (MODEL_OBJECT_LEXEMES.has(token)) return cursor;
    const labelEnd = labelRunEndAt(tokens, cursor, labelRuns);
    if (labelEnd !== null) return labelEnd;
    if (!MODEL_QUALIFIER_LEXEMES.has(token)) return null;
  }
  return null;
}

function findMutationAfter(
  tokens: readonly string[],
  from: number,
  limit: number,
  nounsOnly = false,
): number | null {
  const lexemes = nounsOnly ? MUTATION_NOUN_LEXEMES : MUTATION_LEXEMES;
  for (let cursor = from; cursor < limit; cursor += 1) {
    if (lexemes.has(tokens[cursor]!)) return cursor;
    if (!MUTATION_OBJECT_BRIDGE_LEXEMES.has(tokens[cursor]!)) return null;
  }
  return null;
}

function hasScopedTailMarker(
  tokens: readonly string[],
  start: number,
  end: number,
): boolean {
  for (let cursor = start; cursor <= end; cursor += 1) {
    if (SCOPED_TAIL_LEXEMES.has(tokens[cursor]!)) return true;
    if (tokens[cursor] === 'anything' && tokens[cursor + 1] === 'else') return true;
  }
  return false;
}

function makeCandidate(
  tokens: readonly string[],
  start: number,
  end: number,
  cue: NoChangeCandidate['cue'],
): NoChangeCandidate {
  return {
    start,
    end,
    cue,
    scopedTail: hasScopedTailMarker(tokens, start, tokens.length - 1),
  };
}

function findDirectNoChangeCandidate(
  tokens: readonly string[],
  cueStart: number,
  cueEnd: number,
  cue: 'do_not' | 'never' | 'without',
  labelRuns: readonly LabelRun[] = EMPTY_LABEL_RUNS,
): NoChangeCandidate | null {
  const limit = Math.min(tokens.length, cueEnd + MAX_CUE_WINDOW_TOKENS);
  const first = skipCueFillers(tokens, cueEnd, limit);
  if (first >= limit) return null;
  const firstToken = tokens[first]!;

  if (MUTATION_LEXEMES.has(firstToken)) {
    const object = findModelObjectAfter(tokens, first + 1, limit, labelRuns);
    if (object !== null) return makeCandidate(tokens, cueStart, object, cue);
    // ⚠ FALL THROUGH, do not return null. A verb can be BOTH a mutation lexeme
    // and an operator over a mutation noun: "make any changes to the model"
    // reads `make` as the verb here, finds no model object directly after it,
    // and must still be parsed by the operator/noun route below. Returning null
    // at this point silently un-vetoed all three of
    // "Never make any changes to our causal graph.",
    // "Do not make further changes to the current causal model." and
    // "Without making any changes to the current model." the moment `make`
    // joined the shared edit vocabulary — caught by the existing suite.
  }

  if (MUTATION_OPERATORS.has(firstToken)) {
    const afterOperator = skipCueFillers(tokens, first + 1, limit);
    const mutation = findMutationAfter(tokens, afterOperator, limit, true);
    if (mutation !== null) {
      const object = findModelObjectAfter(tokens, mutation + 1, limit, labelRuns);
      if (object !== null) return makeCandidate(tokens, cueStart, object, cue);
    }
    const object = parseModelObjectAt(tokens, afterOperator, limit, labelRuns);
    if (object !== null) {
      const noun = findMutationAfter(tokens, object + 1, limit, true);
      if (noun !== null) return makeCandidate(tokens, cueStart, noun, cue);
    }
    return null;
  }

  if (MUTATION_CONTROLS.has(firstToken)) {
    const objectStart = skipCueFillers(tokens, first + 1, limit);
    const mutationFirst = findMutationAfter(tokens, objectStart, limit);
    if (mutationFirst !== null) {
      const objectAfter = findModelObjectAfter(tokens, mutationFirst + 1, limit);
      if (objectAfter !== null) return makeCandidate(tokens, cueStart, objectAfter, cue);
    }
    const object = parseModelObjectAt(tokens, objectStart, limit, labelRuns);
    if (object === null) return null;
    const mutation = findMutationAfter(tokens, object + 1, limit);
    return mutation === null ? null : makeCandidate(tokens, cueStart, mutation, cue);
  }

  const object = parseModelObjectAt(tokens, first, limit);
  if (object === null) return null;
  const mutation = findMutationAfter(tokens, object + 1, limit);
  return mutation === null ? null : makeCandidate(tokens, cueStart, mutation, cue);
}

/**
 * The bare `no` form is intentionally narrower than `do not` / `without`.
 * It must be the compact noun construction "no changes to/of/in/on/within
 * [model]", or the symmetric object-first fragment "no model changes".
 * Directive-vs-description classification happens after the bounded phrase is
 * found, so merely mentioning that such changes were recorded is not a veto.
 */
function findNarrowNoCandidate(
  tokens: readonly string[],
  noIndex: number,
  labelRuns: readonly LabelRun[] = EMPTY_LABEL_RUNS,
): NoChangeCandidate | null {
  const limit = Math.min(tokens.length, noIndex + MAX_CUE_WINDOW_TOKENS);
  let cursor = noIndex + 1;
  while (cursor < limit && (tokens[cursor] === 'any' || SCOPED_TAIL_LEXEMES.has(tokens[cursor]!))) {
    cursor += 1;
  }

  if (MUTATION_NOUN_LEXEMES.has(tokens[cursor]!)) {
    const connector = tokens[cursor + 1];
    if (!MODEL_CONNECTOR_LEXEMES.has(connector!)) return null;
    const object = parseModelObjectAt(tokens, cursor + 2, limit, labelRuns);
    if (object === null) return null;
    const start = MUTATION_OPERATORS.has(tokens[noIndex - 1]!) ? noIndex - 1 : noIndex;
    return makeCandidate(tokens, start, object, 'no');
  }

  const object = parseModelObjectAt(tokens, cursor, limit, labelRuns);
  if (object === null) return null;
  const noun = findMutationAfter(tokens, object + 1, limit, true);
  if (noun === null) return null;
  const start = MUTATION_OPERATORS.has(tokens[noIndex - 1]!) ? noIndex - 1 : noIndex;
  return makeCandidate(tokens, start, noun, 'no');
}

function findNoChangeCandidates(
  tokens: readonly string[],
  labelRuns: readonly LabelRun[] = EMPTY_LABEL_RUNS,
): NoChangeCandidate[] {
  const candidates: NoChangeCandidate[] = [];
  for (let cursor = 0; cursor < tokens.length; cursor += 1) {
    let candidate: NoChangeCandidate | null = null;
    if (tokens[cursor] === 'do' && tokens[cursor + 1] === 'not') {
      candidate = findDirectNoChangeCandidate(tokens, cursor, cursor + 2, 'do_not', labelRuns);
    } else if (tokens[cursor] === 'never') {
      candidate = findDirectNoChangeCandidate(tokens, cursor, cursor + 1, 'never', labelRuns);
    } else if (tokens[cursor] === 'without') {
      candidate = findDirectNoChangeCandidate(tokens, cursor, cursor + 1, 'without', labelRuns);
    } else if (tokens[cursor] === 'no') {
      candidate = findNarrowNoCandidate(tokens, cursor, labelRuns);
    }
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

const IMPERATIVE_MAIN_LEXEMES = new Set([
  'answer', 'analyse', 'analyze', 'assess', 'calculate', 'challenge', 'check',
  'clarify', 'compare', 'continue', 'critique', 'ensure', 'evaluate', 'explain',
  'find', 'give', 'help', 'identify', 'keep', 'make', 'proceed', 'run', 'set',
  'show', 'tell', 'use', 'verify',
]);
const QUESTION_MAIN_LEXEMES = new Set([
  'can', 'could', 'do', 'does', 'how', 'is', 'may', 'should', 'what', 'which',
  'will', 'would', 'why',
]);
const MAIN_CLAUSE_FILLERS = new Set(['and', 'then', 'please']);
const NO_FRAGMENT_FILLERS = new Set(['and', 'only', 'please', 'with']);
const DEONTIC_DIRECTIVE_LEXEMES = new Set(['must', 'need', 'needs', 'shall', 'should']);

function noChangeRemainderTokens(
  tokens: readonly string[],
  candidate: NoChangeCandidate,
): readonly string[] {
  return tokens.filter(
    (_, tokenIndex) => tokenIndex < candidate.start || tokenIndex > candidate.end,
  );
}

function hasDirectiveMainClause(tokens: readonly string[]): boolean {
  let first = 0;
  while (first < tokens.length && MAIN_CLAUSE_FILLERS.has(tokens[first]!)) first += 1;
  if (first >= tokens.length) return true;
  const firstToken = tokens[first]!;
  return IMPERATIVE_MAIN_LEXEMES.has(firstToken) || QUESTION_MAIN_LEXEMES.has(firstToken);
}

/**
 * `without` also introduces historical adjuncts ("the team ran it without
 * changing the model"). It is a veto only when its containing clause is
 * itself directive/question-shaped, or when the no-change phrase stands alone.
 */
function isDirectiveNoChangeCandidate(
  clause: NoChangeClause,
  candidate: NoChangeCandidate,
): boolean {
  if (candidate.cue === 'without') {
    if (clause.question) return true;
    return hasDirectiveMainClause(noChangeRemainderTokens(clause.tokens, candidate));
  }
  if (candidate.cue !== 'no') return true;

  const remainder = noChangeRemainderTokens(clause.tokens, candidate)
    .filter((token) => !NO_FRAGMENT_FILLERS.has(token));
  if (remainder.length === 0) return true;
  return hasDirectiveMainClause(remainder) ||
    remainder.some((token) => DEONTIC_DIRECTIVE_LEXEMES.has(token));
}

const EPISTEMIC_BRIDGE_LEXEMES = new Set([
  'understand', 'know', 'explain', 'clarify', 'confirm', 'check', 'verify',
  'tell', 'show', 'why', 'whether', 'how', 'what',
]);

function hasInstructionalPassiveBridge(tokens: readonly string[], setIndex: number): boolean {
  const from = Math.max(0, setIndex - 14);
  const beforeSet = tokens.slice(from, setIndex);
  const ensureIndex = beforeSet.lastIndexOf('ensure');
  let makeSureIndex = -1;
  for (let index = 0; index < beforeSet.length - 1; index += 1) {
    if (beforeSet[index] === 'make' && beforeSet[index + 1] === 'sure') {
      makeSureIndex = index;
    }
  }
  const seeIndex = beforeSet.lastIndexOf('see');
  const bridgeIndex = Math.max(ensureIndex, makeSureIndex, seeIndex);
  if (bridgeIndex < 0) return false;
  return !beforeSet.slice(bridgeIndex + 1).some((token) => EPISTEMIC_BRIDGE_LEXEMES.has(token));
}

/** Mask a descriptive "is/was/has been set to" in the scoped-tail remainder. */
function maskDescriptivePassiveSet(tokens: readonly string[]): string[] {
  return tokens.map((token, index) => {
    if (token !== 'set') return token;
    const directPassive = ['is', 'are', 'was', 'were'].includes(tokens[index - 1]!);
    const perfectPassive = tokens[index - 1] === 'been' &&
      ['has', 'have', 'had'].includes(tokens[index - 2]!);
    if ((!directPassive && !perfectPassive) || hasInstructionalPassiveBridge(tokens, index)) {
      return token;
    }
    return 'equals';
  });
}

interface LocatedNoChangeCandidate {
  readonly clauseIndex: number;
  readonly candidate: NoChangeCandidate;
}

function hasAffirmativeMutationOutsideCandidates(
  clauses: readonly NoChangeClause[],
  candidates: readonly LocatedNoChangeCandidate[],
): boolean {
  const omittedByClause = new Map<number, Set<number>>();
  for (const { clauseIndex, candidate } of candidates) {
    const omitted = omittedByClause.get(clauseIndex) ?? new Set<number>();
    for (let index = candidate.start; index <= candidate.end; index += 1) {
      omitted.add(index);
    }
    omittedByClause.set(clauseIndex, omitted);
  }
  const remainderClauses = clauses
    .map(({ tokens }, index) => {
      const omitted = omittedByClause.get(index);
      return omitted ? tokens.filter((_, tokenIndex) => !omitted.has(tokenIndex)) : [...tokens];
    })
    .map(maskDescriptivePassiveSet);
  const remainder = remainderClauses
    .map((tokens) => tokens.join(' '))
    .join('. ');
  return hasMutationWarrantSignal(remainder) || remainderClauses.some(hasImperativeMakeValueEdit);
}

function hasImperativeMakeValueEdit(tokens: readonly string[]): boolean {
  let first = 0;
  while (first < tokens.length && MAIN_CLAUSE_FILLERS.has(tokens[first]!)) first += 1;
  if (tokens[first] !== 'make' || tokens[first + 1] === 'sure') return false;
  for (let cursor = first + 2; cursor < tokens.length; cursor += 1) {
    if (Number.isFinite(Number(tokens[cursor]))) return true;
  }
  return false;
}

/**
 * Did the user explicitly withhold model-change authority, with no affirmative
 * edit left after that protective clause is removed?
 *
 * The contrast is load-bearing: "do not change the model" is a veto, while
 * "Set X to 0.7 and do not change anything else" remains an authorised edit.
 * Deterministic mutation pre-routes reuse this predicate so the action-layer
 * warrant and the fast path cannot disagree about the same sentence.
 */
export function hasExplicitNoModelChangeIntent(
  message: string,
  modelEntityLabels?: readonly string[],
): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  const clauses = splitNoChangeClauses(trimmed);
  const labelRuns = tokeniseEntityLabels(modelEntityLabels);
  const scopedCandidates: LocatedNoChangeCandidate[] = [];
  for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex += 1) {
    const clause = clauses[clauseIndex]!;
    for (const candidate of findNoChangeCandidates(clause.tokens, labelRuns)) {
      if (!isDirectiveNoChangeCandidate(clause, candidate)) continue;
      if (!candidate.scopedTail) return true;
      scopedCandidates.push({ clauseIndex, candidate });
    }
  }
  if (scopedCandidates.length === 0) return false;
  return !hasAffirmativeMutationOutsideCandidates(clauses, scopedCandidates);
}

export function isBoundedNonMutationAnalyticalRequest(message: string): boolean {
  if (typeof message !== 'string') return false;
  const trimmed = message.trim();
  if (trimmed.length === 0) return false;
  if (!BOUNDED_NON_MUTATION_ANALYTICAL_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }

  if (hasExplicitNoModelChangeIntent(trimmed)) return true;
  return !(
    hasMutationSignal(trimmed) ||
    hasConstraintMutationSignal(trimmed) ||
    isEditRequestShape(trimmed)
  );
}

export type BoundedNonMutationHandler = 'explain_from_structure' | 'explain_results';

/** One state-dependent, non-mutating destination for the bounded re-election. */
export function selectBoundedNonMutationHandler(
  message: string,
  analysisPresent: boolean,
): BoundedNonMutationHandler | null {
  if (!isBoundedNonMutationAnalyticalRequest(message)) return null;
  return analysisPresent ? 'explain_results' : 'explain_from_structure';
}

/**
 * Term 3 of the warrant union — the product's own edit-intent door.
 * Exported so the spec can assert it against the SAME regexes route-v2 uses
 * rather than against a copy of them.
 */
export function isEditRequestShape(message: string): boolean {
  if (typeof message !== 'string' || message.trim().length === 0) return false;
  const carriesEditVerb =
    EDIT_GRAPH_POSITIVE_REGEX.test(message) ||
    WARRANT_EXTRA_EDIT_VERB_PATTERNS.some((re) => re.test(message));
  if (!carriesEditVerb) return false;
  // The read-marker guard and the two question-shape suppressors, in the same
  // combination route-v2 applies at the edit_graph door.
  if (EDIT_GRAPH_NEGATIVE_REGEX.test(message)) return false;
  if (isAnalyticalQuestion(message)) return false;
  if (isStateQueryQuestionShape(message)) return false;
  return true;
}

/**
 * Which of the three ratified sources authorised this turn to mutate.
 *
 *  - `message_signal`      — the user's own words carry a mutation instruction.
 *  - `typed_mutation_chip` — the user clicked a chip whose WIRE TYPE is a
 *                            mutation (`chip.action_type` ∈ the mutation
 *                            action types). A click on a typed mutation chip
 *                            IS the request; there is no text to read.
 *  - `confirm_resume`      — the turn is resuming a proposal or held op the
 *                            user already confirmed. The warrant was given on
 *                            the turn that emitted it.
 *
 * A plain-message chip (no `action_type`) is NOT a source in its own right:
 * it replays a MESSAGE through the ordinary pipeline, so it is judged by
 * `message_signal` like anything else. That is deliberate and load-bearing —
 * the calibration confirm chip ("Use 70%") replays "Set <factor> to 70%.",
 * which carries a mutation signal, so the calibration flow keeps working
 * through the message half rather than through a blanket chip exemption.
 */
export type MutationWarrantSource =
  | 'message_signal'
  | 'typed_mutation_chip'
  | 'confirm_resume';

export type MutationWarrant =
  | { readonly granted: false }
  | { readonly granted: true; readonly source: MutationWarrantSource };

/**
 * The turn ingress the warrant is derived from. Everything here is known
 * before the model is consulted.
 */
export interface MutationWarrantInput {
  /** The user's message text. */
  readonly message: string;
  /** `payload.source` — 'composer' | 'chip' | 'chip_click' | 'retry'. */
  readonly turnSource: string | undefined;
  /** `payload.chip?.action_type` — the chip's WIRE TYPE, not its copy. */
  readonly chipActionType: string | undefined;
  /**
   * True when this turn resumed a pending action / held proposal the user
   * confirmed. Derived by the caller from the executor's own
   * `consumedPendingAction`, never guessed from text.
   */
  readonly isConfirmResume: boolean;
}

/**
 * The V5 chip `action_type` values that are themselves mutations. Imported
 * shape rather than re-listed: `typed-chip-mutation-proposal.ts` is the
 * CEE-side authority for which typed chips carry an edit spec, and the
 * manifest spec asserts this set and `GRAPH_MUTATING_HANDLER_IDS` agree.
 */
export function isMutationChipActionType(
  actionType: string | undefined,
  mutationActionTypes: ReadonlySet<string>,
): boolean {
  return actionType !== undefined && mutationActionTypes.has(actionType);
}

/**
 * Did this turn carry an affirmative warrant to mutate the graph?
 *
 * Order is evidential, not preferential: a confirm-resume is the strongest
 * claim (the user clicked confirm on a change we showed them), then a typed
 * mutation chip (the click IS the instruction), then the message text.
 */
export function detectMutationWarrant(
  input: MutationWarrantInput,
  mutationActionTypes: ReadonlySet<string>,
): MutationWarrant {
  if (input.isConfirmResume) {
    return { granted: true, source: 'confirm_resume' };
  }
  const isChipTurn = input.turnSource === 'chip_click' || input.turnSource === 'chip';
  if (isChipTurn && isMutationChipActionType(input.chipActionType, mutationActionTypes)) {
    return { granted: true, source: 'typed_mutation_chip' };
  }
  if (hasMutationWarrantSignal(input.message)) {
    return { granted: true, source: 'message_signal' };
  }
  return { granted: false };
}

/**
 * The demotion reply: a mutating proposal arrived on a turn the user never
 * asked to change anything, so it is OFFERED rather than applied.
 *
 * Composed HERE rather than by the model, for the same reason the
 * withheld-consent copy is: on the witnessed turn the model narrated an
 * "Applied" receipt for a change the user had not requested. A string built
 * from a template cannot narrate.
 *
 * It states the outcome in the FIRST clause. "Nothing has been changed" is
 * true by construction at this point — control has not reached a handler.
 *
 * ── INV-2 (ROADMAP 2.659 rider) ───────────────────────────────────────────
 * `residualDisclosure` carries the second sentence for the REPAIR shape: the
 * `add_constraint` idempotency key is `(node_id, operator)`, so a proposal
 * whose operator differs from an existing constraint on the same node CANNOT
 * update it — it can only append, leaving the defective row in place. The
 * walk witnessed exactly that (one unevaluable constraint became two, both
 * blamed on "conditions you set"). Where the product cannot repair, it must
 * SAY SO rather than let the user believe the old row is gone. The
 * remove/replace capability itself is ROADMAP 2.659, not this fix.
 */
export function buildMutationWarrantDemotionText(
  changeDescription: string,
  residualDisclosure: string | null,
): string {
  const opening =
    `Nothing has been changed. You did not ask me to edit the model, ` +
    `so I have not — but ${changeDescription} looks like it would help. ` +
    `Say the word and I will make it.`;
  return residualDisclosure === null ? opening : `${opening} ${residualDisclosure}`;
}

/**
 * The INV-2 residual sentence, when a proposed constraint cannot replace the
 * one already on the same node.
 *
 * Deliberately names what SURVIVES, not what is added: the user's complaint
 * in the walk was not that a constraint appeared, it was that the broken one
 * stayed and nothing said so.
 */
export function buildResidualConstraintDisclosure(existingLabel: string | null): string {
  const subject =
    existingLabel === null || existingLabel.trim().length === 0
      ? 'the limit already on that factor'
      : `"${existingLabel.trim()}"`;
  return (
    `Note that this would be a second limit: I cannot yet change or remove ` +
    `${subject}, so it would stay in place alongside the new one.`
  );
}
