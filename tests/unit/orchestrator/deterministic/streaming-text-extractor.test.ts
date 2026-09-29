/**
 * Streaming Text Extractor Tests
 *
 * Verifies progressive extraction of the "text" field from streaming JSON,
 * including escape handling, chunk boundary splitting, and fallback behaviour.
 */

import { describe, it, expect } from "vitest";
import { StreamingTextExtractor } from "../../../../src/orchestrator/deterministic/streaming-text-extractor.js";

function createExtractor() {
  const deltas: string[] = [];
  let completed = false;
  const extractor = new StreamingTextExtractor({
    onTextDelta: (text) => deltas.push(text),
    onTextComplete: () => { completed = true; },
  });
  return { extractor, deltas, isComplete: () => completed };
}

describe('StreamingTextExtractor', () => {
  it('extracts text progressively from normal JSON stream', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"Hello');
    expect(deltas).toEqual(['Hello']);
    expect(extractor.getState()).toBe('streaming');

    extractor.push(' world.');
    expect(deltas).toEqual(['Hello', ' world.']);

    extractor.push('","insights":[]}');
    expect(isComplete()).toBe(true);
    expect(extractor.getState()).toBe('buffering');

    extractor.finish();
    expect(extractor.getState()).toBe('complete');
    expect(deltas.join('')).toBe('Hello world.');
  });

  it('handles escaped quotes in text', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // {"text":"She said \"hello\"","insights":[]}
    extractor.push('{"text":"She said \\"hello\\"","insights":[]}');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('She said "hello"');
  });

  it('handles newlines in text', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"Line one.\\nLine two.","insights":[]}');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('Line one.\nLine two.');
  });

  it('handles unicode escapes', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"Quote: \\u0027test\\u0027","insights":[]}');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe("Quote: 'test'");
  });

  it('falls back when text is not the first field', () => {
    const { extractor, deltas } = createExtractor();

    extractor.push('{"insights":[],"text":"Late text"}');

    expect(extractor.getState()).toBe('fallback');
    expect(deltas).toHaveLength(0);
  });

  it('falls back on malformed JSON (random prose)', () => {
    const { extractor, deltas } = createExtractor();

    extractor.push('Here is my analysis of the decision.');

    expect(extractor.getState()).toBe('fallback');
    expect(deltas).toHaveLength(0);
  });

  it('handles empty text field gracefully', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"","insights":[]}');

    // Empty text — closing quote found immediately, no deltas emitted
    expect(isComplete()).toBe(true);
    expect(deltas).toHaveLength(0);
    expect(extractor.getState()).toBe('buffering');
  });

  it('handles large response without truncation', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // Build a text with 500+ words
    const words = Array.from({ length: 550 }, (_, i) => `word${i}`);
    const longText = words.join(' ');
    const json = JSON.stringify({ text: longText, insights: [], recommended_actions: [] });

    // Push in realistic multi-character chunks (50-100 chars each)
    for (let i = 0; i < json.length; i += 75) {
      extractor.push(json.slice(i, i + 75));
    }

    extractor.finish();
    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe(longText);
  });

  it('handles chunk boundaries splitting mid-escape sequence', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // Push chunks that split the escape sequence \" across boundaries
    extractor.push('{"text":"She said \\');  // backslash at end
    expect(extractor.getState()).toBe('streaming');
    expect(deltas).toEqual(['She said ']);

    extractor.push('"hello\\');  // another backslash at end
    // The \" should have been unescaped to "
    expect(deltas.join('')).toContain('She said "hello');

    extractor.push('"","insights":[]}');
    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('She said "hello"');
  });

  it('handles chunk boundary splitting mid-unicode escape', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"A\\u00');
    expect(extractor.getState()).toBe('streaming');

    extractor.push('27B","insights":[]}');
    expect(isComplete()).toBe(true);
    // \u0027 = single quote
    expect(deltas.join('')).toBe("A'B");
  });

  it('handles braces inside quoted strings (e.g. ranges)', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    const text = 'The range {0.3-0.5} is moderate.';
    extractor.push(JSON.stringify({ text, insights: [], recommended_actions: [] }));

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe(text);
  });

  it('handles backslash-backslash followed by quote', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // In JSON: "path: C:\\\\dir\\\\" — represents path: C:\\dir\\
    // Then the next " closes the text value
    extractor.push('{"text":"path: C:\\\\\\\\dir\\\\\\\\","insights":[]}');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('path: C:\\\\dir\\\\');
  });

  it('handles tab and carriage return escapes', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text":"col1\\tcol2\\rcol3","insights":[]}');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('col1\tcol2\rcol3');
  });

  it('preserves full buffer for post-stream parsing', () => {
    const { extractor } = createExtractor();

    const json = '{"text":"Hello","insights":[{"type":"bias_detected","description":"Test","severity":"info"}],"recommended_actions":[]}';
    extractor.push(json);
    extractor.finish();

    expect(extractor.getFullBuffer()).toBe(json);
  });

  it('transitions through states correctly', () => {
    const { extractor } = createExtractor();

    expect(extractor.getState()).toBe('seeking');

    extractor.push('{"text":"');
    expect(extractor.getState()).toBe('streaming');

    extractor.push('hello","insights');
    expect(extractor.getState()).toBe('buffering');

    extractor.finish();
    expect(extractor.getState()).toBe('complete');
  });

  it('ignores pushes after complete', () => {
    const { extractor, deltas } = createExtractor();

    extractor.push('{"text":"done","insights":[]}');
    extractor.finish();
    const count = deltas.length;

    extractor.push('more data');
    expect(deltas.length).toBe(count);
  });

  it('ignores pushes after fallback', () => {
    const { extractor, deltas } = createExtractor();

    extractor.push('Not JSON at all, just prose.');
    expect(extractor.getState()).toBe('fallback');
    const count = deltas.length;

    extractor.push('more data');
    expect(deltas.length).toBe(count);
  });

  it('waits for enough buffer before deciding in seeking state', () => {
    const { extractor } = createExtractor();

    extractor.push('{"te');  // Only 4 chars — not enough to decide
    expect(extractor.getState()).toBe('seeking');

    extractor.push('xt":"Hello","insights":[]}');
    expect(extractor.getState()).toBe('buffering'); // text fully extracted
  });

  it('handles whitespace in JSON opening', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('  { "text" : "spaced" , "insights": [] }');

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('spaced');
  });

  it('keeps seeking when chunk ends after colon-space (before opening quote)', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"text": ');  // Valid prefix but no opening quote yet
    expect(extractor.getState()).toBe('seeking');  // Must NOT be fallback

    extractor.push('"Hello world.","insights":[]}');
    expect(extractor.getState()).toBe('buffering');
    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('Hello world.');
  });

  it('preserves full buffer in fallback mode across multiple chunks', () => {
    const { extractor, deltas } = createExtractor();

    extractor.push('{"insights":[],');
    expect(extractor.getState()).toBe('fallback');
    expect(deltas).toHaveLength(0);

    // Continue pushing — buffer must accumulate even in fallback
    extractor.push('"text":"Late text",');
    extractor.push('"recommended_actions":[]}');

    extractor.finish();

    // Full buffer should contain ALL chunks for post-stream parsing
    expect(extractor.getFullBuffer()).toBe('{"insights":[],"text":"Late text","recommended_actions":[]}');
    expect(extractor.getState()).toBe('complete');
  });

  it('keeps seeking when chunk ends mid-field-name', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    extractor.push('{"tex');
    expect(extractor.getState()).toBe('seeking');

    extractor.push('t":"Found it.","insights":[]}');
    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe('Found it.');
  });

  it('handles markdown bold markers inside text field', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // Reproduces the P0 scenario: text containing \n\n and **bold** markdown
    const text = 'Three directions worth considering, each structurally different:\n\n1. **Partnership or co-marketing** — lower acquisition risk.\n2. **Self-serve trial** — reduces sales cycle length.\n3. **Usage-based pricing** — aligns cost with customer value.';
    const json = JSON.stringify({ text, insights: [], recommended_actions: [] });

    extractor.push(json);
    extractor.finish();

    expect(isComplete()).toBe(true);
    expect(extractor.getState()).toBe('complete');
    expect(deltas.join('')).toBe(text);
  });

  it('handles markdown bold split across chunk boundary', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    const text = 'Start.\n\n1. **Bold heading** and more text.';
    const json = JSON.stringify({ text, insights: [], recommended_actions: [] });

    // Split mid-bold-marker: "**B" in one chunk, "old..." in next
    const splitAt = json.indexOf('**B') + 2;
    extractor.push(json.slice(0, splitAt));
    extractor.push(json.slice(splitAt));
    extractor.finish();

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe(text);
  });

  it('handles \\n escape split across chunk boundary', () => {
    const { extractor, deltas, isComplete } = createExtractor();

    // Simulate the exact pattern from the P0 report: \n\n before markdown
    const text = 'Consider these options:\n\n1. Option A.\n2. Option B.';
    const json = JSON.stringify({ text, insights: [], recommended_actions: [] });

    // Find a \n escape in the JSON and split mid-escape
    const firstEscape = json.indexOf('\\n');
    expect(firstEscape).toBeGreaterThan(-1);

    // Split so the backslash is at the end of one chunk, 'n' starts the next
    extractor.push(json.slice(0, firstEscape + 1)); // ends with '\'
    extractor.push(json.slice(firstEscape + 1));     // starts with 'n...'
    extractor.finish();

    expect(isComplete()).toBe(true);
    expect(deltas.join('')).toBe(text);
  });

  it('handles full buffer parseable after streaming markdown content', () => {
    const { extractor } = createExtractor();

    const text = 'Response with **bold** and\n\ncontent.';
    const json = JSON.stringify({ text, insights: [], recommended_actions: [] });

    // Push in small chunks (5 chars at a time)
    for (let i = 0; i < json.length; i += 5) {
      extractor.push(json.slice(i, i + 5));
    }
    extractor.finish();

    // Full buffer must be the original JSON for post-stream parsing
    expect(extractor.getFullBuffer()).toBe(json);
    expect(extractor.getState()).toBe('complete');
  });

  it('fallback state is detectable before finish() for telemetry', () => {
    const { extractor } = createExtractor();

    extractor.push('{"insights":[],"text":"Late"}');
    // Fallback triggered because text is not first field
    expect(extractor.getState()).toBe('fallback');

    // Capture state BEFORE finish (this is how pipeline.ts detects it)
    const wasFallback = extractor.getState() === 'fallback';

    extractor.finish();
    // After finish, state transitions to 'complete'
    expect(extractor.getState()).toBe('complete');
    // But the pre-finish capture is what matters for telemetry
    expect(wasFallback).toBe(true);
  });
});
