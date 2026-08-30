/**
 * PROMPT -> CONSUMER CONFORMANCE: the pure checker.
 * =================================================
 *
 * THE QUESTION THIS ANSWERS, and it is not the one any existing gate answers:
 *
 *   Is the shape the SERVED PROMPT instructs the model to EMIT a shape the
 *   CONSUMER will ACCEPT?
 *
 * The motivating class (platform doctrine, and it has happened here): a served
 * routing prompt once forbade the exact representation the value binder
 * required, so the product was instructed never to say the one thing it could
 * hear. Recovery measured 0 of 13. No suite could see it, because prompts and
 * consumers had never been checked against each other in this direction.
 *
 * WHAT ALREADY EXISTS, AND WHY THIS IS NOT IT
 * -------------------------------------------
 *   - `prompt-pack-sanction.gate.test.ts` is the INPUT direction: every
 *     model-facing ContextPack field must be NAMED in the prompt. One route
 *     (`routing`), inputs only.
 *   - `tests/prompt-contract/prompt-contract.test.ts` validates JSON examples
 *     against PLoT's canonical field list. Two things disqualify it as an
 *     answer here, both disclosed in its own header: it reads the FALLBACK
 *     files (`edit-graph-v6.ts`, `defaults-v187.ts`) rather than the served
 *     bytes -- "If the active staging prompts differ from these files, the test
 *     may not cover what's live" -- and its consumer expectation is a
 *     hand-copied mirror of another repo's allow-list stamped
 *     "Last synced: 2026-03-26".
 *
 * This checker reads the SERVED bytes and asks the ACTUAL consumer object.
 *
 * DERIVED, NOT MIRRORED (platform trap 12)
 * ----------------------------------------
 *   - the accepted shape comes from the grammar OBJECT the adapter attaches,
 *     imported live (`buildDraftRecordsSchema()`, `buildOlumiActionTool()`,
 *     `ANTHROPIC_EDIT_GRAPH_SCHEMA`) -- never a transcription. A grammar edit
 *     moves this checker's expectations with it, by construction.
 *   - the instructed shape is EXTRACTED from the prompt bytes by the existing
 *     balanced-brace JSON extractor -- never a hand list of "keys the prompt
 *     mentions".
 *   - enum vocabulary lists are recognised by MAJORITY MEMBERSHIP in the
 *     enum itself, so no rule anywhere names a section of any prompt.
 *
 * Everything here is PURE: no network, no filesystem, no clock. That is what
 * makes each discriminator positive-controllable against a frozen historical
 * artefact (trap 13 -- an absence probe with no positive control proves
 * nothing; trap 12b -- a control pinned to "current" decays into a tautology
 * the first time current changes).
 */

import { extractPromptExamples } from '../extract-prompt-examples.js';

export type JsonSchemaNode = Record<string, unknown>;

export type ViolationKind =
  /** The prompt instructs a JSON shape no node of the grammar can accept. */
  | 'unacceptable_example'
  /** The prompt teaches a value for an enum field that the enum rejects. */
  | 'enum_stray'
  /** The grammar REQUIRES a key the prompt never names. */
  | 'unnamed_required_key';

export interface Violation {
  readonly kind: ViolationKind;
  /** Stable identity for waiver keying: kind + the offending token/offset. */
  readonly id: string;
  /** Character offset in the prompt, where the checker can attribute one. */
  readonly offset: number;
  readonly detail: string;
}

// ---------------------------------------------------------------------------
// Grammar introspection -- all of it derived from the schema object
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function props(node: unknown): Record<string, unknown> | undefined {
  if (!isPlainObject(node)) return undefined;
  const p = node.properties;
  return isPlainObject(p) ? p : undefined;
}

/**
 * Every schema node in the grammar that DECLARES PROPERTIES, with its path.
 *
 * Nodes without `properties` are deliberately excluded: a free-form
 * `{ type: "object" }` (or a stringified payload slot such as edit_graph's
 * `operations[].value`, which is `type: "string"`) adjudicates nothing, so
 * counting it as an "accepting node" would make this checker vacuously green
 * -- a guard agreeing with itself (trap 13b).
 */
export function declaredObjectNodes(
  node: unknown,
  path = '$',
  out: Array<{ path: string; schema: JsonSchemaNode }> = [],
): Array<{ path: string; schema: JsonSchemaNode }> {
  if (!isPlainObject(node)) return out;
  if (props(node)) out.push({ path, schema: node });
  for (const [k, v] of Object.entries(props(node) ?? {})) {
    declaredObjectNodes(v, `${path}.${k}`, out);
  }
  if (node.items !== undefined) declaredObjectNodes(node.items, `${path}[]`, out);
  return out;
}

/** Every string-enum field the grammar declares, with its allowed values. */
export function declaredStringEnums(
  node: unknown,
  path = '$',
  out: Array<{ path: string; field: string; values: readonly string[] }> = [],
): Array<{ path: string; field: string; values: readonly string[] }> {
  if (!isPlainObject(node)) return out;
  if (Array.isArray(node.enum) && node.type === 'string') {
    out.push({
      path,
      field: path.split('.').pop()!.replace(/\[\]$/, ''),
      values: node.enum as readonly string[],
    });
  }
  for (const [k, v] of Object.entries(props(node) ?? {})) {
    declaredStringEnums(v, `${path}.${k}`, out);
  }
  if (node.items !== undefined) declaredStringEnums(node.items, `${path}[]`, out);
  return out;
}

/**
 * Would THIS schema node accept this value outright?
 *
 * Closed-world only where the schema says so: a node without
 * `additionalProperties: false` cannot reject an unknown key, and saying it
 * did would manufacture violations the consumer would never raise.
 */
export function nodeAccepts(value: unknown, schema: unknown): boolean {
  if (Array.isArray(value)) {
    const items = isPlainObject(schema) ? schema.items : undefined;
    return value.every((v) => nodeAccepts(v, items ?? {}));
  }
  if (!isPlainObject(value)) {
    if (isPlainObject(schema) && Array.isArray(schema.enum) && typeof value === 'string') {
      return (schema.enum as unknown[]).includes(value);
    }
    return true;
  }
  const p = props(schema);
  if (!p) {
    // No declared properties: only a closed object can reject anything, and a
    // closed object with no properties accepts nothing but `{}`.
    return isPlainObject(schema) && schema.additionalProperties === false
      ? Object.keys(value).length === 0
      : true;
  }
  const closed = isPlainObject(schema) && schema.additionalProperties === false;
  for (const [k, v] of Object.entries(value)) {
    if (!(k in p)) {
      if (closed) return false;
      continue;
    }
    if (!nodeAccepts(v, p[k])) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// C1 -- EXAMPLE CONFORMANCE
// ---------------------------------------------------------------------------

/**
 * A prompt's JSON example is conformant when SOME node of the grammar accepts
 * it. Not the root node: prompts legitimately show fragments (one node, one
 * edge) in the middle of prose, and checking every fragment against the root
 * would be an oracle error -- a perfect score on the wrong exam (trap 13c).
 * Measured: the naive root-only form reported 60 "violations" on draft_graph
 * and 7 on edit_graph, most of them fragments held against a schema they were
 * never meant to satisfy.
 *
 * "Accepted NOWHERE in the grammar" is the conservative, sound predicate: the
 * consumer has no slot for this shape at all, so a model that follows the
 * instruction emits something that cannot be parsed.
 */
export function checkExampleConformance(
  promptText: string,
  grammar: JsonSchemaNode,
): Violation[] {
  const nodes = declaredObjectNodes(grammar);
  const out: Violation[] = [];
  for (const ex of extractPromptExamples(promptText)) {
    if (nodes.some((n) => nodeAccepts(ex.json, n.schema))) continue;
    const keys = Array.isArray(ex.json)
      ? '[array]'
      : Object.keys(ex.json as Record<string, unknown>).join(',');
    out.push({
      kind: 'unacceptable_example',
      id: `unacceptable_example:${keys}`,
      offset: ex.offset,
      detail:
        `the prompt instructs {${keys}} but no node of the consumer grammar accepts it ` +
        `(${nodes.length} declared object nodes checked)`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// C2 -- ENUM VOCABULARY CONFORMANCE
// ---------------------------------------------------------------------------

/** A prompt is teaching a closed vocabulary when most of its list IS that vocabulary. */
export const ENUM_LIST_RECOGNITION_THRESHOLD = 0.5;

/**
 * Bare-token bullet lists are how prose prompts teach enum vocabularies --
 * `routing` carries zero JSON examples but a `- handler_id: description` list.
 *
 * The list is recognised as an ENUM VOCABULARY only when a MAJORITY of its
 * tokens are members of that enum. That is what keeps this derived rather than
 * a rule naming a prompt section: an unrelated bullet list scores near zero
 * membership and is ignored, and a genuine handler list scores high and has its
 * outliers reported. It also self-controls -- if a future prompt renames every
 * handler, membership collapses, the list stops being recognised, and C3
 * (unnamed required keys) is what fires instead.
 */
export function checkEnumVocabulary(
  promptText: string,
  grammar: JsonSchemaNode,
): Violation[] {
  const bullets = [...promptText.matchAll(/^[-*]\s+([a-z][a-z0-9_]{2,40}):/gm)].map((m) => ({
    token: m[1]!,
    offset: m.index!,
  }));
  if (bullets.length === 0) return [];

  const out: Violation[] = [];
  for (const e of declaredStringEnums(grammar)) {
    const members = bullets.filter((b) => e.values.includes(b.token));
    if (members.length / bullets.length < ENUM_LIST_RECOGNITION_THRESHOLD) continue;
    for (const stray of bullets.filter((b) => !e.values.includes(b.token))) {
      out.push({
        kind: 'enum_stray',
        id: `enum_stray:${e.field}:${stray.token}`,
        offset: stray.offset,
        detail:
          `the prompt teaches "${stray.token}" in a list that is ${members.length}/${bullets.length} ` +
          `members of ${e.path}, but the consumer enum admits only ` +
          `[${e.values.join(' | ')}] -- the model is being taught a value the consumer rejects`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// C3 -- REQUIRED-KEY COVERAGE (the other direction)
// ---------------------------------------------------------------------------

/**
 * Every key the grammar REQUIRES at its root must be named somewhere the model
 * can read it: the served prompt, or a declared second system block appended
 * after it. A required key named nowhere is the recovery-fiasco shape in its
 * purest form -- the consumer will accept only an output the prompt never asks
 * for.
 *
 * `additionalText` exists because CEE genuinely appends code-owned blocks after
 * the PMS bytes (`DRAFT_RECORDS_INSTRUCTION` is appended after the draft cache
 * breakpoint). Passing it is how a route declares that second half; omitting it
 * where one exists would manufacture a false violation.
 */
export function checkRequiredKeyCoverage(
  promptText: string,
  grammar: JsonSchemaNode,
  additionalText = '',
): Violation[] {
  const required = Array.isArray(grammar.required) ? (grammar.required as string[]) : [];
  const haystack = `${promptText}\n${additionalText}`;
  return required
    .filter((k) => !haystack.includes(k))
    .map((k) => ({
      kind: 'unnamed_required_key' as const,
      id: `unnamed_required_key:${k}`,
      offset: -1,
      detail:
        `the consumer grammar REQUIRES "${k}" but neither the served prompt nor any ` +
        `declared second system block names it -- the model is never told to emit it`,
    }));
}

// ---------------------------------------------------------------------------
// The whole check, for one route
// ---------------------------------------------------------------------------

export interface ConformanceInput {
  readonly route: string;
  readonly promptText: string;
  readonly grammar: JsonSchemaNode;
  /** Code-owned system blocks appended after the served bytes, if any. */
  readonly additionalText?: string;
}

/**
 * FAIL-LOUD PRECONDITIONS. A probe that extracted nothing agrees with every
 * other probe that extracted nothing (platform doctrine, learned through a zsh
 * history-modifier defect that made `diff` compare two empty files and exit 0).
 * So this throws rather than returning a comfortable empty array.
 */
export function checkRoute(input: ConformanceInput): Violation[] {
  if (input.promptText.length < 1000) {
    throw new Error(
      `[${input.route}] prompt text is ${input.promptText.length} chars -- refusing to ` +
        `report conformance on what is almost certainly an unread or truncated prompt`,
    );
  }
  if (declaredObjectNodes(input.grammar).length === 0) {
    throw new Error(
      `[${input.route}] the consumer grammar declares no object node with properties -- ` +
        `there is nothing to conform TO, so a green result here would be vacuous`,
    );
  }
  return [
    ...checkExampleConformance(input.promptText, input.grammar),
    ...checkEnumVocabulary(input.promptText, input.grammar),
    ...checkRequiredKeyCoverage(input.promptText, input.grammar, input.additionalText),
  ];
}
