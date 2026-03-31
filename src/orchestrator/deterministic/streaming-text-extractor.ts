/**
 * Streaming Text Extractor
 *
 * Progressively extracts the "text" field content from a streaming JSON response.
 *
 * Exploits the v30.5 prompt's JSON structure where "text" is always the first field:
 *   {"text":"...","insights":[...],"recommended_actions":[...]}
 *
 * State machine:
 *   seeking → accumulating chunks, looking for the "text" field opening
 *   streaming → inside the text string value, emitting unescaped deltas
 *   buffering → text value closed, silently accumulating remainder
 *   complete → stream ended, full buffer available for parsing
 *   fallback → structure doesn't match expected pattern, single-delta mode
 */

// ============================================================================
// Types
// ============================================================================

export type ExtractorState = 'seeking' | 'streaming' | 'buffering' | 'complete' | 'fallback';

export interface StreamingTextExtractorOptions {
  /** Called with unescaped text content as it streams. */
  onTextDelta: (text: string) => void;
  /** Called when the text field value is fully extracted. */
  onTextComplete: () => void;
}

// ============================================================================
// JSON Escape Handling
// ============================================================================

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  'n': '\n',
  'r': '\r',
  't': '\t',
  'b': '\b',
  'f': '\f',
};

// ============================================================================
// Streaming Text Extractor
// ============================================================================

// Matches the opening of a JSON object with "text" as the first string field.
const TEXT_FIELD_OPENING = /^\s*\{\s*"text"\s*:\s*"/;

export class StreamingTextExtractor {
  private state: ExtractorState = 'seeking';
  private buffer = '';
  /** Partial escape sequence carried across chunk boundaries (e.g., "\\" or "\\u00"). */
  private pendingEscape = '';
  private readonly onTextDelta: (text: string) => void;
  private readonly onTextComplete: () => void;

  constructor(opts: StreamingTextExtractorOptions) {
    this.onTextDelta = opts.onTextDelta;
    this.onTextComplete = opts.onTextComplete;
  }

  getState(): ExtractorState {
    return this.state;
  }

  getFullBuffer(): string {
    return this.buffer;
  }

  /**
   * Push a chunk from the streaming LLM response.
   * May trigger onTextDelta callbacks.
   */
  push(chunk: string): void {
    if (this.state === 'complete' || this.state === 'fallback') return;

    this.buffer += chunk;

    if (this.state === 'seeking') {
      this.handleSeeking();
    } else if (this.state === 'streaming') {
      this.processStreamingChunk(chunk);
    }
    // 'buffering' — just accumulate silently
  }

  /**
   * Signal that the stream has ended.
   */
  finish(): void {
    if (this.state === 'streaming') {
      // Stream ended mid-text — flush any pending escape raw
      if (this.pendingEscape.length > 0) {
        this.onTextDelta(this.pendingEscape);
        this.pendingEscape = '';
      }
      this.onTextComplete();
    }

    this.state = this.state === 'seeking' ? 'fallback' : 'complete';
  }

  // ── Seeking State ─────────────────────────────────────────────────────────

  private handleSeeking(): void {
    // Need enough buffer to test the opening pattern
    if (this.buffer.length < 9) return;

    const match = this.buffer.match(TEXT_FIELD_OPENING);
    if (match) {
      const textValueStart = match[0].length;
      this.state = 'streaming';

      // Process any content already in the buffer past the opening quote
      if (textValueStart < this.buffer.length) {
        this.processStreamingChunk(this.buffer.slice(textValueStart));
      }
    } else {
      this.state = 'fallback';
    }
  }

  // ── Streaming State ───────────────────────────────────────────────────────

  /**
   * Process raw chunk characters while inside the JSON text value.
   * Unescapes JSON sequences and emits clean text via onTextDelta.
   * Detects the closing unescaped " that ends the text field.
   */
  private processStreamingChunk(chunk: string): void {
    let emitted = '';

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      // ── Inside a pending escape sequence ──
      if (this.pendingEscape.length > 0) {
        this.pendingEscape += ch;

        if (this.pendingEscape.length === 2) {
          const escChar = this.pendingEscape[1];
          if (escChar === 'u') {
            // \uXXXX — need 4 more hex digits
            continue;
          }
          const replacement = SIMPLE_ESCAPES[escChar];
          emitted += replacement ?? this.pendingEscape;
          this.pendingEscape = '';
        } else if (this.pendingEscape.length === 6) {
          // \uXXXX complete
          const codePoint = parseInt(this.pendingEscape.slice(2), 16);
          emitted += !isNaN(codePoint)
            ? String.fromCharCode(codePoint)
            : this.pendingEscape;
          this.pendingEscape = '';
        }
        // else: \u + 1-3 hex digits — keep accumulating
        continue;
      }

      // ── Start of escape sequence ──
      if (ch === '\\') {
        this.pendingEscape = '\\';
        continue;
      }

      // ── Unescaped closing quote → text value ends ──
      if (ch === '"') {
        if (emitted.length > 0) this.onTextDelta(emitted);
        this.state = 'buffering';
        this.onTextComplete();
        return;
      }

      // ── Regular character ──
      emitted += ch;
    }

    // Chunk exhausted without finding the closing quote — emit what we have
    if (emitted.length > 0) {
      this.onTextDelta(emitted);
    }
  }
}
