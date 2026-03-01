/**
 * DSK bundle linter CLI.
 *
 * Usage:
 *   pnpm dsk:lint                         # lint data/dsk/v1.json
 *   pnpm dsk:lint path/to/bundle.json     # lint a specific file
 *   pnpm dsk:lint --fix-order             # rewrite bundle with canonical id order
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DSKBundle } from "../src/dsk/types.js";
import { lintBundle, fixOrder } from "../src/dsk/linter.js";
import { computeDSKHash } from "../src/dsk/hash.js";

const args = process.argv.slice(2);
const fixOrderFlag = args.includes("--fix-order");
const filePath = args.find((a) => !a.startsWith("--")) ?? "data/dsk/v1.json";
const resolved = resolve(filePath);

async function main(): Promise<void> {
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

  const result = lintBundle(bundle);

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
