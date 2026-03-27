/**
 * Streaming XML Envelope Stripper
 *
 * Incrementally strips orchestrator XML envelope tags from text deltas
 * during SSE streaming. Handles tag boundaries that span multiple deltas.
 *
 * Design:
 * - Uses a simple state machine: PASSTHROUGH → IN_DIAGNOSTICS → PASSTHROUGH
 * - Strips all known envelope tags (open + close) via regex
 * - Suppresses content within <diagnostics> and <blocks> sections
 * - Buffers trailing partial tags (e.g. `<respon`) until next delta resolves them
 * - On flush(true), emits any remaining buffered text with tags stripped
 *
 * Does NOT modify the final parsed response — that still goes through
 * response-parser.ts on message_complete.
 */

// Known XML envelope tags to strip.
// These are the structural tags from the orchestrator prompt contract.
// Content tags (<content>) are included because artefact HTML arrives
// through block events, not text deltas.
const ENVELOPE_TAG_NAMES = [
  'response', 'assistant_text', 'diagnostics',
  'blocks', 'block', 'type', 'artefact_type',
  'title', 'description', 'content',
  'suggested_actions', 'actions', 'action',
  'label', 'message', 'role', 'tone',
];

// Regex matching any complete open/close envelope tag
const ENVELOPE_TAG_RE = new RegExp(
  `</?(?:${ENVELOPE_TAG_NAMES.join('|')})>`,
  'g',
);

/**
 * States for content suppression.
 * EMIT: text passes through (inside <assistant_text> or fallback)
 * SUPPRESS_DIAGNOSTICS: inside <diagnostics>…</diagnostics>
 * SUPPRESS_BLOCKS: inside <blocks>…</blocks>
 * SUPPRESS_BLOCK: inside bare <block>…</block> (fallback when model omits <blocks> wrapper)
 * SUPPRESS_ACTIONS: inside <suggested_actions>…</suggested_actions>
 */
type StripperState = 'EMIT' | 'SUPPRESS_DIAGNOSTICS' | 'SUPPRESS_BLOCKS' | 'SUPPRESS_BLOCK' | 'SUPPRESS_ACTIONS';

/**
 * Safety limit for the internal buffer (512 KB).
 * LLM output per turn is bounded by max_tokens (typically 4K-16K tokens ≈ 16-64 KB).
 * This limit is generous enough to never trigger in normal operation but prevents
 * unbounded growth from malformed or runaway streams.
 */
const MAX_BUFFER_BYTES = 512 * 1024;

export class StreamingEnvelopeStripper {
  private buffer = '';
  private state: StripperState = 'EMIT';

  /**
   * Process an incoming text delta.
   * Returns the clean text to emit (may be empty string).
   */
  process(delta: string): string {
    this.buffer += delta;

    // Safety valve: if the buffer grows beyond MAX_BUFFER_BYTES, force-drain
    // everything to prevent memory exhaustion. This discards suppression state
    // but is preferable to OOM.
    if (this.buffer.length > MAX_BUFFER_BYTES) {
      this.state = 'EMIT';
      return this.drain(true);
    }

    return this.drain(false);
  }

  /**
   * Flush remaining buffer (call on stream end).
   * Returns any remaining clean text.
   */
  flush(): string {
    return this.drain(true);
  }

  private drain(final: boolean): string {
    let output = '';

    // Process complete tag transitions in the buffer
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.state === 'SUPPRESS_DIAGNOSTICS') {
        const endIdx = this.buffer.indexOf('</diagnostics>');
        if (endIdx === -1) {
          // Still inside diagnostics — suppress everything
          if (!final) return output;
          // Final: discard remaining diagnostics content
          this.buffer = '';
          return output;
        }
        // Skip past closing tag
        this.buffer = this.buffer.substring(endIdx + '</diagnostics>'.length);
        this.state = 'EMIT';
        continue;
      }

      if (this.state === 'SUPPRESS_BLOCKS') {
        const endIdx = this.buffer.indexOf('</blocks>');
        if (endIdx === -1) {
          if (!final) return output;
          this.buffer = '';
          return output;
        }
        this.buffer = this.buffer.substring(endIdx + '</blocks>'.length);
        this.state = 'EMIT';
        continue;
      }

      if (this.state === 'SUPPRESS_BLOCK') {
        const endIdx = this.buffer.indexOf('</block>');
        if (endIdx === -1) {
          if (!final) return output;
          this.buffer = '';
          return output;
        }
        this.buffer = this.buffer.substring(endIdx + '</block>'.length);
        this.state = 'EMIT';
        continue;
      }

      if (this.state === 'SUPPRESS_ACTIONS') {
        const endIdx = this.buffer.indexOf('</suggested_actions>');
        if (endIdx === -1) {
          if (!final) return output;
          this.buffer = '';
          return output;
        }
        this.buffer = this.buffer.substring(endIdx + '</suggested_actions>'.length);
        this.state = 'EMIT';
        continue;
      }

      // State: EMIT — look for section openers to suppress
      const diagIdx = this.buffer.indexOf('<diagnostics>');
      const blocksIdx = this.buffer.indexOf('<blocks>');
      const actionsIdx = this.buffer.indexOf('<suggested_actions>');
      // Bare <block> fallback: if the model omits <blocks> wrapper, suppress individual blocks
      // to prevent artefact HTML from leaking. Only search when <blocks> isn't found first.
      const bareBlockIdx = blocksIdx === -1 ? this.buffer.indexOf('<block>') : -1;

      // Find the earliest suppression trigger
      const candidates: Array<{ idx: number; tag: string; state: StripperState }> = [];
      if (diagIdx !== -1) candidates.push({ idx: diagIdx, tag: '<diagnostics>', state: 'SUPPRESS_DIAGNOSTICS' });
      if (blocksIdx !== -1) candidates.push({ idx: blocksIdx, tag: '<blocks>', state: 'SUPPRESS_BLOCKS' });
      if (bareBlockIdx !== -1) candidates.push({ idx: bareBlockIdx, tag: '<block>', state: 'SUPPRESS_BLOCK' });
      if (actionsIdx !== -1) candidates.push({ idx: actionsIdx, tag: '<suggested_actions>', state: 'SUPPRESS_ACTIONS' });

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.idx - b.idx);
        const first = candidates[0];

        // Emit everything before the suppression section (with tags stripped)
        const before = this.buffer.substring(0, first.idx);
        output += stripEnvelopeTags(before);

        // Move buffer past the opening tag and switch state
        this.buffer = this.buffer.substring(first.idx + first.tag.length);
        this.state = first.state;
        continue;
      }

      // No suppression triggers found — emit safe content
      break;
    }

    // In EMIT state with no suppression triggers
    if (!final) {
      // Check for a partial tag at the end of the buffer
      const lastLt = this.buffer.lastIndexOf('<');
      if (lastLt !== -1) {
        const afterLt = this.buffer.substring(lastLt);
        // If there's no '>' after the last '<', it might be a partial tag
        if (!afterLt.includes('>')) {
          const safe = this.buffer.substring(0, lastLt);
          this.buffer = afterLt;
          output += stripEnvelopeTags(safe);
          return output;
        }
      }

      // All tags are complete — strip and emit
      output += stripEnvelopeTags(this.buffer);
      this.buffer = '';
      return output;
    }

    // Final flush — strip and emit everything
    output += stripEnvelopeTags(this.buffer);
    this.buffer = '';
    return output;
  }
}

/** Strip complete XML envelope tags from text. */
function stripEnvelopeTags(text: string): string {
  return text.replace(ENVELOPE_TAG_RE, '');
}
