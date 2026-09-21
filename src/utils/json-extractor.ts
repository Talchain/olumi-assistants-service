/**
 * JSON Extractor Utility
 *
 * Extracts valid JSON from LLM responses that may contain conversational
 * preamble, suffix text, or markdown code blocks.
 *
 * This is particularly useful for Claude models which may add conversational
 * text like "I'll construct a graph for you..." before the JSON output,
 * even when instructed to output only JSON.
 */

import { log, emit, TelemetryEvents } from "./telemetry.js";
import { contentDigest } from "./redaction.js";

/**
 * Result of JSON extraction
 */
export interface JsonExtractionResult {
  /** The extracted and parsed JSON */
  json: unknown;
  /** Whether extraction was needed (true if raw content wasn't valid JSON) */
  wasExtracted: boolean;
  /** The raw content that was successfully parsed */
  extractedContent?: string;
  /** Characters of preamble text that was stripped */
  preambleLength?: number;
  /** Characters of suffix text that was stripped */
  suffixLength?: number;
  /** The extraction method used */
  extractionMethod?: "fast_path" | "code_block" | "boundary" | "bracket_matching" | "document_selection";
  /** The full raw content before extraction (for debugging) */
  rawContent?: string;
  /**
   * ROADMAP 2.996 — index (within the response's top-level JSON documents) of
   * the document that was selected by `acceptDocument`. Present ONLY when a
   * LATER document displaced the first one; absent on every other result, so a
   * first-document outcome is byte-identical to the pre-2.996 result.
   */
  documentIndex?: number;
}

/**
 * ROADMAP 2.996 — the total number of top-level JSON documents the selector
 * will ever evaluate for one response, INCLUDING the core extractor's own
 * result. Bounds the cost of `acceptDocument` (which on the draft path runs a
 * schema parse + a full graph validation per candidate).
 */
export const MAX_SELECTABLE_DOCUMENTS = 8;

/**
 * ROADMAP 2.996 — how many CONSECUTIVE unmatched `{`/`[` the document scan will
 * probe before giving up. See the note in `enumerateTopLevelJsonDocuments`:
 * the scan is quadratic in a run of unmatched brackets, and real responses need
 * ZERO failed probes before each document.
 */
const MAX_CONSECUTIVE_FAILED_PROBES = 64;

/**
 * Options for JSON extraction
 */
export interface JsonExtractionOptions {
  /** Task name for telemetry (e.g., "draft_graph") */
  task?: string;
  /** Model name for telemetry */
  model?: string;
  /** Correlation ID for logging */
  correlationId?: string;
  /** Whether to log warnings when extraction is needed */
  logWarnings?: boolean;
  /** Whether to include raw content in result (for debugging) */
  includeRawContent?: boolean;
  /**
   * ROADMAP 2.996 — OPT-IN multi-document selection.
   *
   * When supplied, the caller's predicate decides whether the document the core
   * extractor chose is USABLE. If it is, that result is returned verbatim and
   * nothing else is parsed. If it is NOT, the remaining top-level documents in
   * the response are tried in order and the FIRST accepted one is returned.
   *
   * Why: on the no-structured-outputs draft path the model often emits a
   * deliberately-partial first object, then prose ("let me actually build this
   * out properly"), then a second COMPLETE object. First-document-wins
   * discarded the finished graph in 7 of 15 captures on 2026-08-09.
   *
   * Two properties this shape guarantees, and they are why it is a predicate
   * rather than a score:
   *   1. A document the predicate ACCEPTS is never displaced.
   *   2. When NO document is accepted, the core extractor's result is returned
   *      unchanged.
   *
   * Stated exactly, and this is the whole of it: THE SELECTOR ONLY EVER
   * REPLACES A DOCUMENT THAT FAILS THE PREDICATE WITH ONE THAT PASSES IT.
   *
   * ⚠ It does NOT follow that an outcome which would have been usable is
   * preserved. That stronger claim needs the predicate to be at least as
   * PERMISSIVE as the consuming pipeline, and the draft path's predicate is
   * not — see the gap documented on `isUsableDraftDocument`
   * (adapters/llm/draft-document-acceptance.ts). A caller whose pipeline
   * REPAIRS documents before using them can have a repairable document
   * displaced by a cleanly-valid but different one.
   *
   * The predicate must be TOTAL: a throw is treated as a rejection.
   */
  acceptDocument?: (json: unknown) => boolean;
}

/**
 * Extract JSON from LLM response that may contain conversational preamble/suffix.
 *
 * Strategy (in order):
 * 1. Try parsing raw content as-is (fast path for well-behaved models)
 * 2. Try extracting from markdown code blocks (```json ... ```) - scans ALL blocks
 * 3. Try bracket-matching from each candidate `{` or `[` position until valid JSON found
 *
 * ROADMAP 2.996: when `options.acceptDocument` is supplied this delegates to
 * `extractJsonFromResponseCore` FIRST and returns its result untouched unless
 * the predicate rejects it — see `selectAcceptedDocument` below. Without the
 * option, this function is exactly `extractJsonFromResponseCore`.
 *
 * @param content - Raw LLM response content
 * @param options - Extraction options for telemetry
 * @returns Extraction result with parsed JSON and metadata
 * @throws Error if no valid JSON can be extracted
 */
export function extractJsonFromResponse(
  content: string,
  options: JsonExtractionOptions = {}
): JsonExtractionResult {
  const coreResult = extractJsonFromResponseCore(content, options);
  const { acceptDocument } = options;
  if (!acceptDocument) return coreResult;
  return selectAcceptedDocument(content, coreResult, acceptDocument, options) ?? coreResult;
}

/**
 * The extraction algorithm. UNCHANGED by 2.996 — every pre-2.996 call reaches
 * this directly, and a 2.996 caller whose first document is accepted gets this
 * result verbatim.
 */
function extractJsonFromResponseCore(
  content: string,
  options: JsonExtractionOptions = {}
): JsonExtractionResult {
  const { task, model, correlationId, logWarnings = true, includeRawContent = false } = options;
  const trimmed = content.trim();

  // === Fast path: Already valid JSON ===
  // Most responses from OpenAI with json_object mode will be valid JSON
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json = JSON.parse(trimmed);
      return {
        json,
        wasExtracted: false,
        extractionMethod: "fast_path",
        rawContent: includeRawContent ? content : undefined,
      };
    } catch {
      // May have trailing text after valid JSON - try bracket matching from start first
      // This is an early-exit optimization that avoids code block scanning when
      // the JSON is at the start but has trailing content (common with some models)
      const earlyExitResult = extractJsonWithBracketMatching(trimmed, 0);
      if (earlyExitResult) {
        const suffixLength = trimmed.length - earlyExitResult.content.length;
        if (suffixLength > 0) {
          if (logWarnings) {
            log.warn(
              { task, model, correlationId, extraction_method: "boundary", suffix_length: suffixLength },
              "JSON extracted via early-exit bracket matching (trailing content stripped)"
            );
          }
          emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
            task, model, preamble_length: 0, suffix_length: suffixLength, extraction_method: "boundary",
          });
        }
        return {
          json: earlyExitResult.json,
          wasExtracted: suffixLength > 0,
          extractedContent: earlyExitResult.content,
          preambleLength: 0,
          suffixLength,
          extractionMethod: "boundary",
          rawContent: includeRawContent ? content : undefined,
        };
      }
      // Early exit failed, continue to full extraction
    }
  }

  // === Try ALL markdown code blocks ===
  // Claude often wraps JSON in ```json ... ``` blocks
  // Scan all blocks and return the first one with valid JSON
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let codeBlockMatch;
  while ((codeBlockMatch = codeBlockRegex.exec(trimmed)) !== null) {
    const blockContent = codeBlockMatch[1].trim();
    try {
      const json = JSON.parse(blockContent);
      const preambleLength = codeBlockMatch.index;
      const blockEnd = codeBlockMatch.index + codeBlockMatch[0].length;
      const suffixLength = trimmed.length - blockEnd;

      // Log and emit telemetry (telemetry always emits, logging respects logWarnings)
      if (logWarnings) {
        log.warn(
          {
            task,
            model,
            correlationId,
            extraction_method: "code_block",
            preamble_length: preambleLength,
            suffix_length: suffixLength,
          },
          "JSON extracted from markdown code block"
        );
      }

      // Always emit telemetry regardless of logWarnings setting
      emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
        task,
        model,
        preamble_length: preambleLength,
        suffix_length: suffixLength,
        extraction_method: "code_block",
      });

      return {
        json,
        wasExtracted: true,
        extractedContent: blockContent,
        preambleLength,
        suffixLength,
        extractionMethod: "code_block",
        rawContent: includeRawContent ? content : undefined,
      };
    } catch {
      // This code block wasn't valid JSON, try the next one
      continue;
    }
  }

  // === Bracket-matching extraction: Try each candidate JSON start ===
  // Find ALL positions of { and [ and try bracket-matching from each
  // This handles cases where preamble contains braces (e.g., "Use `{foo}` for...")
  const candidates: Array<{ index: number; char: "{" | "[" }> = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{" || trimmed[i] === "[") {
      candidates.push({ index: i, char: trimmed[i] as "{" | "[" });
    }
  }

  if (candidates.length === 0) {
    throw new Error("No JSON structure found in response: missing opening delimiter");
  }

  // Try each candidate position, returning the first valid JSON found
  for (const candidate of candidates) {
    const bracketResult = extractJsonWithBracketMatching(trimmed, candidate.index);
    if (bracketResult) {
      const preambleLength = candidate.index;
      const jsonEndIndex = candidate.index + bracketResult.content.length;
      const suffixLength = trimmed.length - jsonEndIndex;

      // Determine if this is "boundary" (first candidate worked) or "bracket_matching"
      const extractionMethod = candidate.index === candidates[0].index ? "boundary" : "bracket_matching";

      // Log warning if there was preamble/suffix text (respects logWarnings)
      if ((preambleLength > 0 || suffixLength > 0) && logWarnings) {
        const preamblePreview = preambleLength > 0
          ? trimmed.substring(0, Math.min(50, preambleLength))
          : undefined;

        log.warn(
          {
            task,
            model,
            correlationId,
            extraction_method: extractionMethod,
            preamble_length: preambleLength,
            suffix_length: suffixLength,
            // Digest model preamble — never place model output on the wire verbatim (see contentDigest).
            preamble_preview: contentDigest(preamblePreview),
            candidates_tried: candidates.indexOf(candidate) + 1,
            total_candidates: candidates.length,
          },
          "JSON extraction required - model returned conversational preamble/suffix"
        );
      }

      // Always emit telemetry when extraction is performed (decoupled from logging)
      emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
        task,
        model,
        preamble_length: preambleLength,
        suffix_length: suffixLength,
        extraction_method: extractionMethod,
        candidates_tried: candidates.indexOf(candidate) + 1,
      });

      return {
        json: bracketResult.json,
        wasExtracted: true,
        extractedContent: bracketResult.content,
        preambleLength,
        suffixLength,
        extractionMethod,
        rawContent: includeRawContent ? content : undefined,
      };
    }
  }

  // All extraction methods failed
  throw new Error(
    `Failed to extract valid JSON from response: tried ${candidates.length} candidate position(s)`
  );
}

/**
 * ROADMAP 2.996 — enumerate the NON-OVERLAPPING top-level JSON documents in a
 * response, left to right.
 *
 * Uses the SAME bracket matcher the core extractor uses, so a "document" here
 * is exactly what the core extractor would have accepted at that offset — there
 * is no second parser and no second definition of a document. A position whose
 * bracket match does not parse is skipped (this is how brace-bearing prose,
 * e.g. "use `{foo}`", is stepped over).
 *
 * @param trimmed - the TRIMMED response text (offsets are relative to it)
 * @param maxDocuments - hard cap on documents returned (cost bound)
 */
export function enumerateTopLevelJsonDocuments(
  trimmed: string,
  maxDocuments: number = MAX_SELECTABLE_DOCUMENTS
): Array<{ json: unknown; content: string; startIndex: number }> {
  const documents: Array<{ json: unknown; content: string; startIndex: number }> = [];
  let i = 0;
  // ⚠ CONSECUTIVE FAILED PROBES ARE BOUNDED, AND THE COST WITHOUT THE BOUND IS
  // QUADRATIC. Every `{`/`[` runs the full bracket matcher; on a run of
  // UNMATCHED brackets each probe scans to the end and fails. Measured on this
  // tip in isolation: 4,000 -> 25.5 ms, 8,000 -> 101.7 ms, 16,000 -> 436.1 ms
  // (x4 cost for x2 input, twice over). A response is model output on a request
  // path, so its length is not ours to choose.
  //
  // The counter is of FAILED probes and RESETS on every accepted document, so
  // it bounds a RUN of brace-bearing prose rather than a total: a long, healthy
  // multi-document response is unaffected. Real data needs ZERO failed probes
  // before each document, which is what makes this a bound nobody reaches
  // rather than a behaviour change.
  //
  // ⚠ It caps the SELECTOR's contribution, not the hazard: the pre-existing
  // core scan is the larger half of the cost at that input size, and is rowed
  // separately. Stated here so the next reader does not mistake this for a fix
  // to the quadratic response-scan problem in general.
  let failedProbes = 0;
  while (i < trimmed.length && documents.length < maxDocuments) {
    const ch = trimmed[i];
    if (ch !== "{" && ch !== "[") {
      i++;
      continue;
    }
    const match = extractJsonWithBracketMatching(trimmed, i);
    if (!match) {
      if (++failedProbes >= MAX_CONSECUTIVE_FAILED_PROBES) break;
      i++;
      continue;
    }
    failedProbes = 0;
    documents.push({ json: match.json, content: match.content, startIndex: i });
    i += match.content.length;
  }
  return documents;
}

/**
 * ROADMAP 2.996 — return a LATER document that the predicate accepts, or `null`
 * to keep the core extractor's result.
 *
 * Returns `null` (i.e. changes nothing) in every one of these cases:
 *   - the core result is already accepted;
 *   - the whole response was a single document (`fast_path` — nothing follows);
 *   - the response holds only one top-level document;
 *   - no later document is accepted.
 *
 * A predicate that throws counts as a rejection: extraction must never fail
 * because a caller's scorer did.
 */
function selectAcceptedDocument(
  content: string,
  coreResult: JsonExtractionResult,
  acceptDocument: (json: unknown) => boolean,
  options: JsonExtractionOptions
): JsonExtractionResult | null {
  const { task, model, correlationId, logWarnings = true, includeRawContent = false } = options;

  // ⚠ THE SEPARATE `budget` COUNTER IS GONE. It was seeded to
  // `MAX_SELECTABLE_DOCUMENTS`, decremented by the first call below (against
  // the core result, before the scan begins), and guarded a loop that
  // `enumerateTopLevelJsonDocuments(trimmed, MAX_SELECTABLE_DOCUMENTS)` already
  // bounds — so it could only ever subtract from the count the constant's own
  // name promises. It happened not to bite, because document 0 is skipped by
  // the identity check below WITHOUT consuming budget; that is a coincidence of
  // the current control flow, not a property anyone stated. One bound, in one
  // place, named for what it bounds.
  const accepts = (json: unknown): boolean => {
    try {
      return acceptDocument(json);
    } catch {
      return false;
    }
  };

  if (accepts(coreResult.json)) return null;

  // `fast_path` means the ENTIRE response parsed as one JSON value: there is no
  // second document to find, so the scan is provably pointless.
  if (coreResult.extractionMethod === "fast_path") return null;

  const trimmed = content.trim();
  const documents = enumerateTopLevelJsonDocuments(trimmed, MAX_SELECTABLE_DOCUMENTS);
  if (documents.length <= 1) return null;

  for (let index = 0; index < documents.length; index++) {
    const doc = documents[index];
    // Skip the document the core extractor already chose (and we already
    // rejected) rather than paying for the predicate twice. Identified by
    // POSITION as well as content: a response can repeat the same document
    // text, and matching on content alone would skip every one of them
    // (assertions and skips alike must bind to the object, not to a value
    // another object can satisfy).
    if (doc.startIndex === coreResult.preambleLength && doc.content === coreResult.extractedContent) {
      continue;
    }
    if (!accepts(doc.json)) continue;

    const suffixLength = trimmed.length - (doc.startIndex + doc.content.length);
    if (logWarnings) {
      log.warn(
        {
          task,
          model,
          correlationId,
          extraction_method: "document_selection",
          document_index: index,
          total_documents: documents.length,
          rejected_first_document_bytes: coreResult.extractedContent?.length,
          selected_document_bytes: doc.content.length,
        },
        "Multi-document response: the first JSON document was rejected by the caller's acceptance predicate; a later complete document was selected (ROADMAP 2.996)"
      );
    }
    // Reuses the EXISTING extraction event rather than minting a new name.
    // This is the same question that event already answers — "how was JSON
    // extracted from this response?" — discriminated by `extraction_method`,
    // exactly as `code_block` and `bracket_matching` already are. A separate
    // event name would be a second concept for one question (and would grow a
    // frozen registry mirrored across four sites).
    emit(TelemetryEvents.JsonExtractionRequired ?? "llm.json_extraction.required", {
      task,
      model,
      preamble_length: doc.startIndex,
      suffix_length: suffixLength,
      extraction_method: "document_selection",
      document_index: index,
      total_documents: documents.length,
      selected_document_bytes: doc.content.length,
      rejected_first_document_bytes: coreResult.extractedContent?.length ?? 0,
    });

    return {
      json: doc.json,
      wasExtracted: true,
      extractedContent: doc.content,
      preambleLength: doc.startIndex,
      suffixLength,
      extractionMethod: "document_selection",
      documentIndex: index,
      rawContent: includeRawContent ? content : undefined,
    };
  }

  return null;
}

/**
 * Extract JSON using bracket matching (handles nested structures and trailing text).
 *
 * Scans from a starting position, counting brackets to find the complete
 * JSON structure, properly handling strings and escape sequences.
 */
function extractJsonWithBracketMatching(
  content: string,
  startIndex: number
): { json: unknown; content: string } | null {
  const openBracket = content[startIndex];
  if (openBracket !== "{" && openBracket !== "[") {
    return null;
  }
  const _closeBracket = openBracket === "{" ? "}" : "]"; // Used for type safety, depth tracking handles matching

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{" || char === "[") depth++;
    if (char === "}" || char === "]") depth--;

    if (depth === 0) {
      // Found the complete JSON structure
      const jsonStr = content.slice(startIndex, i + 1);
      try {
        const json = JSON.parse(jsonStr);
        return { json, content: jsonStr };
      } catch {
        // Bracket matching found a structure but it wasn't valid JSON
        return null;
      }
    }
  }

  // Unbalanced brackets
  return null;
}

/**
 * Convenience function that returns just the parsed JSON.
 *
 * Use this when you don't need the extraction metadata.
 *
 * @param content - Raw LLM response content
 * @param options - Extraction options
 * @returns Parsed JSON
 * @throws Error if no valid JSON can be extracted
 */
export function extractJson(content: string, options?: JsonExtractionOptions): unknown {
  return extractJsonFromResponse(content, options).json;
}

/**
 * SALVAGE a JSON document that was cut off mid-stream (a max_tokens truncation).
 *
 * 2026-07-23 firefight: when a draft generation hits the derived token budget,
 * the tail is unparseable — the stream stops mid-object/array/string. This
 * recovers the largest STRUCTURALLY-COMPLETE prefix by:
 *   1. single-pass scanning to the last byte offset where every open container
 *      is "between elements" (an object after a complete `"key": value` pair, an
 *      array after a complete element, or a freshly-opened empty container) — a
 *      point where appending the open containers' closers yields valid JSON;
 *   2. dropping the incomplete trailing element and any trailing comma;
 *   3. appending the closing `}` / `]` for every still-open container.
 *
 * It is deliberately CONSERVATIVE — it never fabricates keys or values, only
 * closes containers around already-complete data. It returns `null` when there
 * is no recoverable prefix (e.g. truncated before the first complete value). The
 * caller MUST re-validate the result against the real schema: a partial that is
 * missing required fields (e.g. a draft cut inside `nodes`, before `edges`) will
 * parse as JSON but fail schema validation, and must be rejected there. This
 * function only guarantees SYNTACTIC validity, never semantic completeness.
 *
 * @param content Raw (possibly preamble-wrapped) LLM text that failed to parse.
 * @returns A syntactically-valid JSON string, or `null` if nothing is recoverable.
 */
export function closeTruncatedJson(content: string): string | null {
  const trimmed = content.trim();
  // Locate the first structural opener; tolerate conversational preamble.
  const startIndex = (() => {
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === "{" || trimmed[i] === "[") return i;
    }
    return -1;
  })();
  if (startIndex === -1) return null;

  type Frame = {
    container: "{" | "[";
    // 'empty'  — freshly opened, no element yet (closable)
    // 'value'  — last element complete, awaiting ',' or close (closable)
    // 'key'    — object: after a complete key string, before ':'   (NOT closable)
    // 'colon'  — object: after ':', before the value               (NOT closable)
    // 'element'— array/object: expecting the next element after ',' (NOT closable)
    state: "empty" | "value" | "key" | "colon" | "element";
  };

  const stack: Frame[] = [];
  let inString = false;
  let escape = false;
  let inLiteral = false; // number / true / false / null
  let safeEnd = -1; // exclusive offset of the last complete-element boundary
  let safeStack: ("{" | "[")[] = []; // container closers owed at safeEnd

  // The TOP frame is closable only "between elements" (empty / value). Every
  // NON-top frame is always closable: its pending slot ('colon' → value,
  // 'element' → next element) is filled by the child frame(s) above it, which
  // are closed first. So only the top frame's state gates a safe boundary.
  const topClosable = (): boolean => {
    const top = stack[stack.length - 1];
    return !!top && (top.state === "empty" || top.state === "value");
  };

  // Record a safe boundary at the completion of a COMPLETE element. Two callers:
  //  - a container POP (`}` / `]`): the whole object/array element just closed —
  //    always a clean boundary, so `mark()` is called unconditionally.
  //  - a SCALAR value: only a complete element when it is a DIRECT array element.
  //    A scalar that is an OBJECT FIELD value (e.g. a node's `"id"` before its
  //    `kind`/`label`) is NOT a complete element — closing there would append a
  //    half-built object (`{"id":"c"}`) that then fails schema validation and
  //    sinks an otherwise-salvageable graph. `markScalar()` gates on that.
  // Never marked right after an opener (would append a junk empty `{}` / `[]`).
  const mark = (endExclusive: number): void => {
    if (!inString && !inLiteral && topClosable()) {
      safeEnd = endExclusive;
      safeStack = stack.map((f) => f.container);
    }
  };
  const markScalar = (endExclusive: number): void => {
    const top = stack[stack.length - 1];
    if (top && top.container === "[") mark(endExclusive);
  };

  // Called when a scalar/container VALUE just completed inside the current frame.
  const completeValueInCurrentFrame = (): void => {
    const top = stack[stack.length - 1];
    if (!top) return; // top-level scalar — not a draft shape; mark won't fire
    top.state = "value";
  };

  for (let i = startIndex; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
        // A closed string is either an object KEY or a VALUE, per frame state.
        const top = stack[stack.length - 1];
        if (top && top.container === "{" && (top.state === "empty" || top.state === "element")) {
          top.state = "key";
        } else {
          completeValueInCurrentFrame();
          markScalar(i + 1);
        }
      }
      continue;
    }

    if (inLiteral) {
      // Literal ends at any structural/whitespace terminator; finalise, then
      // REPROCESS the terminator char below by NOT continuing.
      if (
        ch === "," || ch === "}" || ch === "]" ||
        ch === " " || ch === "\n" || ch === "\r" || ch === "\t"
      ) {
        inLiteral = false;
        completeValueInCurrentFrame();
        markScalar(i); // literal ended at the char BEFORE this terminator
        // fall through to handle `ch` as a normal structural char
      } else {
        continue; // still consuming the literal
      }
    }

    if (ch === '"') {
      inString = true;
      escape = false;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push({ container: ch, state: "empty" });
      continue;
    }

    if (ch === "}" || ch === "]") {
      // Close the current container; it becomes a completed value in its parent.
      stack.pop();
      completeValueInCurrentFrame();
      mark(i + 1); // a popped container is always a complete element
      continue;
    }

    if (ch === ":") {
      const top = stack[stack.length - 1];
      if (top && top.state === "key") top.state = "colon";
      continue;
    }

    if (ch === ",") {
      const top = stack[stack.length - 1];
      if (top) top.state = "element";
      continue;
    }

    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      continue;
    }

    // Start of a bare literal (number, true, false, null). The frame is now
    // mid-value until the literal terminates.
    inLiteral = true;
  }

  // A literal running right up to the truncation point is complete IFF the model
  // stopped cleanly — which for a max_tokens cut it did not. Treat a dangling
  // literal as incomplete: only positions recorded in `safeEnd` are trusted.
  if (safeEnd === -1) return null;

  const closers = safeStack
    .slice()
    .reverse()
    .map((c) => (c === "{" ? "}" : "]"))
    .join("");
  const candidate = trimmed.slice(startIndex, safeEnd) + closers;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}
