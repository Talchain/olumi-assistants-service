/**
 * CEE prompt safety linter (skeleton, dev-only)
 *
 * This script lints prompt/role definitions for basic safety and privacy
 * invariants. It is intentionally conservative and works entirely locally.
 *
 * Usage (from repo root):
 *
 *   # Lint prompts from a JSON file mapping IDs to prompt text
 *   pnpm cee:prompt-lint path/to/prompts.json
 *
 *   # Or read the same shape from stdin
 *   cat prompts.json | pnpm cee:prompt-lint
 */

import { readFile } from "node:fs/promises";

export interface PromptCheckResult {
  id: string;
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Core lint helper: metadata-only checks over a single prompt string.
 * The helper never logs or emits the full prompt text; callers are expected to
 * handle prompt contents locally.
 */
export function lintPromptText(id: string, text: string): PromptCheckResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const lower = text.toLowerCase();

  const bannedPhrases: string[] = [
    "log user prompt verbatim",
    "store raw user text",
    "record the entire prompt",
    "save full prompt",
    "include original prompt in logs",
  ];

  for (const phrase of bannedPhrases) {
    if (lower.includes(phrase)) {
      errors.push(`Banned phrase detected: "${phrase}"`);
    }
  }

  if (
    lower.includes("log") &&
    lower.includes("prompt") &&
    (lower.includes("datadog") || lower.includes("sentry") || lower.includes("analytics"))
  ) {
    warnings.push(
      "Prompt mentions logging prompts to telemetry/analytics; ensure no raw user content is recorded.",
    );
  }

  if (lower.includes("pii") && lower.includes("log")) {
    warnings.push(
      "Prompt references logging PII; ensure only redacted or aggregate data is logged.",
    );
  }

  return {
    id,
    ok: errors.length === 0,
    warnings,
    errors,
  };
}

interface PromptInputItem {
  id: string;
  text: string;
}

function normalisePromptInput(json: unknown): PromptInputItem[] {
  if (!json || typeof json !== "object") return [];

  if (Array.isArray(json)) {
    return json
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const anyItem = item as any;
        const id = typeof anyItem.id === "string" ? anyItem.id : undefined;
        const text = typeof anyItem.text === "string" ? anyItem.text : undefined;
        if (!id || !text) return null;
        return { id, text };
      })
      .filter((v): v is PromptInputItem => v !== null);
  }

  const result: PromptInputItem[] = [];
  for (const [key, value] of Object.entries(json)) {
    if (typeof value === "string") {
      result.push({ id: key, text: value });
    } else if (value && typeof value === "object" && typeof (value as any).text === "string") {
      result.push({ id: key, text: (value as any).text as string });
    }
  }
  return result;
}

type OutputFormat = "pretty" | "json";

interface CliOptions {
  inputPath?: string;
  format: OutputFormat;
}

function parseArgs(argv: string[]): CliOptions {
  let inputPath: string | undefined;
  let format: OutputFormat = "pretty";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" || arg === "-i") {
      inputPath = argv[i + 1];
      i += 1;
    } else if (arg === "--format" || arg === "-f") {
      const value = argv[i + 1];
      if (value === "pretty" || value === "json") {
        format = value;
      } else {
        throw new Error(`Unknown --format value: ${value}`);
      }
      i += 1;
    }
  }

  return { inputPath, format };
}

async function readJsonFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk as Buffer);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-prompt-lint] Argument error:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
    return;
  }

  let raw: string;
  if (options.inputPath && options.inputPath !== "-") {
    raw = await readFile(options.inputPath, "utf8");
  } else {
    raw = await readJsonFromStdin();
  }

  if (!raw.trim()) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-prompt-lint] No input provided. Use --input <file> or pipe JSON to stdin.",
    );
    process.exit(1);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      "[cee-prompt-lint] Failed to parse JSON:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }

  const prompts = normalisePromptInput(json);
  if (prompts.length === 0) {
    // eslint-disable-next-line no-console
    console.error("[cee-prompt-lint] No prompts found in input JSON.");
    process.exit(1);
  }

  const results = prompts.map((p) => lintPromptText(p.id, p.text));
  const hasErrors = results.some((r) => !r.ok);

  if (options.format === "json") {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of results) {
      // eslint-disable-next-line no-console
      console.log(
        `[${r.id}] ok=${r.ok} warnings=${r.warnings.length} errors=${r.errors.length}`,
      );
      for (const w of r.warnings) {
        // eslint-disable-next-line no-console
        console.log(`  warning: ${w}`);
      }
      for (const e of r.errors) {
        // eslint-disable-next-line no-console
        console.log(`  error: ${e}`);
      }
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

if (typeof require !== "undefined" && require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error("[cee-prompt-lint] Unexpected error:", error);
    process.exit(1);
  });
}
