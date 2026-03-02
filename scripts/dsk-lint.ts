/**
 * DSK bundle linter CLI.
 *
 * Usage:
 *   pnpm dsk:lint                               # lint data/dsk/v1.json
 *   pnpm dsk:lint path/to/bundle.json           # lint a specific file
 *   pnpm dsk:lint --fix-order                   # rewrite bundle with canonical id order
 *   pnpm dsk:lint --context-tags path/vocab.json # override vocabulary file
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { DSKBundle } from "../src/dsk/types.js";
import { lintBundle, fixOrder } from "../src/dsk/linter.js";
import { computeDSKHash } from "../src/dsk/hash.js";

// Resolve repo root: scripts/ is one level below repo root
const __filename = fileURLToPath(import.meta.url);
const repoRoot = dirname(dirname(__filename));

const args = process.argv.slice(2);
const fixOrderFlag = args.includes("--fix-order");

// --context-tags <path>
const contextTagsIdx = args.indexOf("--context-tags");
if (contextTagsIdx !== -1) {
  const nextArg = args[contextTagsIdx + 1];
  if (nextArg === undefined || nextArg.startsWith("--")) {
    console.error("Error: --context-tags requires a path argument");
    process.exit(1);
  }
}
const contextTagsArg =
  contextTagsIdx !== -1 ? args[contextTagsIdx + 1] : undefined;
const vocabPath =
  contextTagsArg !== undefined
    ? resolve(contextTagsArg)
    : resolve(repoRoot, "data/dsk/context-tags.json");

// Bundle file path — first non-flag, non-value argument
const filePath =
  args.find((a, i) => {
    if (a.startsWith("--")) return false;
    // Skip if it's the value of --context-tags
    if (contextTagsIdx !== -1 && i === contextTagsIdx + 1) return false;
    return true;
  }) ?? "data/dsk/v1.json";
const resolved = resolve(filePath);

async function loadVocab(): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(vocabPath, "utf-8");
  } catch {
    console.error(
      `Missing ${vocabPath} — run dsk:init to generate`,
    );
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === "string")) {
      console.error(`Error: ${vocabPath} must be a JSON array of strings`);
      process.exit(1);
    }
    return parsed as string[];
  } catch (e) {
    console.error(`Error: Malformed JSON in ${vocabPath}`);
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const contextVocab = await loadVocab();

  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch {
    console.error(`Error: Cannot read file: ${resolved}`);
    process.exit(1);
  }

  let bundle: DSKBundle;
  try {
    bundle = JSON.parse(raw) as DSKBundle;
  } catch (e) {
    console.error(`Error: Malformed JSON in ${resolved}`);
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  if (!Array.isArray(bundle.objects)) {
    console.error("Error: Bundle missing 'objects' array");
    process.exit(1);
  }

  // Fix ordering if requested
  if (fixOrderFlag) {
    const fixed = fixOrder(bundle);
    // Recompute hash for the reordered bundle
    fixed.dsk_version_hash = computeDSKHash(fixed);
    const output = JSON.stringify(fixed, null, 2) + "\n";
    await writeFile(resolved, output, "utf-8");
    console.log(`Rewrote ${resolved} with objects in canonical id order.`);
    console.log(`Updated dsk_version_hash: ${fixed.dsk_version_hash}`);
    // Re-lint the fixed bundle
    bundle = fixed;
  }

  const result = lintBundle(bundle, contextVocab);

  // Print errors
  for (const d of result.errors) {
    console.error(`ERROR  [${d.objectId}] ${d.fieldPath}: ${d.message}`);
  }

  // Print warnings
  for (const d of result.warnings) {
    console.warn(`WARN   [${d.objectId}] ${d.fieldPath}: ${d.message}`);
  }

  // Summary
  const total = result.errors.length + result.warnings.length;
  if (total === 0) {
    console.log("DSK bundle is valid — no issues found.");
  } else {
    console.log(
      `\n${result.errors.length} error(s), ${result.warnings.length} warning(s).`,
    );
  }

  process.exit(result.exitCode);
}

main();
