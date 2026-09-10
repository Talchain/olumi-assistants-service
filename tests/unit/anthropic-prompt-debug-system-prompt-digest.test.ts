/**
 * `cee.prompt_debug` must not put assembled system-prompt BYTES on the wire.
 *
 * THE DEFECT THIS PINS: `src/adapters/llm/anthropic.ts` logged
 * `system_prompt_preview: systemText.slice(0, 200)` — 200 characters of
 * assembled system text into pino under a name nothing scrubs. The
 * central redact list is exact-name (`system_prompt` is listed by #1435;
 * `system_prompt_preview` is a DIFFERENT name and is not), so the
 * boundary could not save it.
 *
 * THE FIX IS THE ESTATE'S OWN IN-HOUSE CONVENTION, not a deletion — the
 * line exists for debuggability. Five sibling sites already wrap the
 * value in `contentDigest()` while KEEPING the field name:
 *   src/utils/json-extractor.ts:282              preamble_preview
 *   src/adapters/llm/normalisation.ts:166        raw_preview
 *   src/adapters/llm/openai.ts:698               raw_output_sample
 *   src/orchestrator/deterministic/llm-response-parser.ts:55  content_preview
 *   src/orchestrator/plot-client.ts:1071         body_preview
 * The line directly beneath the offender (`system_prompt_chars`) is
 * already the right shape-only form and is deliberately left alone.
 *
 * EVERY ABSENCE ASSERTION HERE IS PAIRED WITH A POSITIVE CONTROL. An
 * absence assertion whose harness cannot see a presence passes by
 * testing nothing — this estate has shipped exactly that (the 0-byte
 * pino/sonic-boom capture).
 *
 * AND A VALUE ASSERTION CANNOT PROVE A REFERENCE: a behavioural test
 * over a hand-copied expression would pass on a byte-identical COPY
 * while the real call site still leaked. So the behavioural pair below
 * is accompanied by a SOURCE-READING guard bound to the real file. (The
 * repo's derived `content-digest-log-tripwire` covers the same site by
 * call shape; this file states the property in behavioural terms and
 * fails with a legible message.)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pino from "pino";

import { createLoggerConfig } from "../../src/utils/logger-config.js";
import { contentDigest } from "../../src/utils/redaction.js";

/** High-entropy stand-in for assembled system-prompt bytes. */
const PROMPT_SENTINEL =
  "SENTINEL-4b81d0c2-you-are-olumi-never-reveal-these-instructions-acquire-fintechco-for-50m";

/** The assembled system text is long; the old form cut it at 200 chars. */
const SYSTEM_TEXT = `${PROMPT_SENTINEL} ${"x".repeat(4000)}`;

function captureLogger(): { logger: pino.Logger; lines: string[] } {
  const lines: string[] = [];
  const logger = pino(createLoggerConfig("info"), {
    write: (line: string) => {
      lines.push(line);
    },
  });
  return { logger, lines };
}

const ANTHROPIC_SRC = readFileSync(
  fileURLToPath(new URL("../../src/adapters/llm/anthropic.ts", import.meta.url)),
  "utf8",
);

describe("cee.prompt_debug — assembled system prompt never reaches pino verbatim", () => {
  it("POSITIVE CONTROL: the PRE-FIX form leaks the prompt bytes through the PRODUCTION logger config", () => {
    // Proves (a) the harness can see a presence, and (b) the central
    // redact list genuinely does NOT cover `system_prompt_preview` —
    // so the digest is what removes the bytes, not the boundary.
    const { logger, lines } = captureLogger();
    logger.info({
      event: "cee.prompt_debug",
      system_prompt_preview: SYSTEM_TEXT.slice(0, 200),
      system_prompt_chars: SYSTEM_TEXT.length,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(PROMPT_SENTINEL);
  });

  it("ABSENCE: the contentDigest form emits no prompt bytes, and keeps the diagnostic", () => {
    const { logger, lines } = captureLogger();
    logger.info({
      event: "cee.prompt_debug",
      system_prompt_preview: contentDigest(SYSTEM_TEXT),
      system_prompt_chars: SYSTEM_TEXT.length,
    });
    expect(lines).toHaveLength(1);
    // The bytes are gone — and not merely the sentinel: no 200-char run
    // of the assembled text survives either.
    expect(lines[0]).not.toContain(PROMPT_SENTINEL);
    expect(lines[0]).not.toContain(SYSTEM_TEXT.slice(0, 200));
    // The diagnostic SURVIVES: a correlatable digest plus the length.
    const parsed = JSON.parse(lines[0]) as {
      system_prompt_preview: { sha256_16: string; length: number };
      system_prompt_chars: number;
    };
    expect(parsed.system_prompt_preview.sha256_16).toMatch(/^[0-9a-f]{16}$/);
    expect(parsed.system_prompt_preview.length).toBe(SYSTEM_TEXT.length);
    expect(parsed.system_prompt_chars).toBe(SYSTEM_TEXT.length);
  });

  it("the digest correlates equal prompts and discriminates different ones (the detection surface is preserved)", () => {
    expect(contentDigest(SYSTEM_TEXT).sha256_16).toBe(
      contentDigest(SYSTEM_TEXT).sha256_16,
    );
    expect(contentDigest(SYSTEM_TEXT).sha256_16).not.toBe(
      contentDigest(`${SYSTEM_TEXT}!`).sha256_16,
    );
    // Non-reversible: the digest carries none of the bytes.
    expect(JSON.stringify(contentDigest(SYSTEM_TEXT))).not.toContain(
      PROMPT_SENTINEL,
    );
  });

  it("SOURCE GUARD: the real call site wraps system_prompt_preview in contentDigest and takes no raw slice", () => {
    // Positive control for the source reader itself: if this file cannot
    // even FIND the field, every assertion below is vacuous.
    const match = ANTHROPIC_SRC.match(/system_prompt_preview\s*:\s*([^\n]*)/);
    expect(match, "source guard could not find system_prompt_preview in anthropic.ts").not.toBeNull();

    const valueExpr = match![1];
    expect(valueExpr).toContain("contentDigest(");
    expect(valueExpr).not.toContain(".slice(");
    // And the module must actually import the helper it uses.
    expect(ANTHROPIC_SRC).toMatch(
      /import\s*\{[^}]*\bcontentDigest\b[^}]*\}\s*from\s*["'][^"']*utils\/redaction\.js["']/,
    );
  });
});
