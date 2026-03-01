/**
 * DSK canonical hash CLI — compute and print the SHA-256 hash.
 *
 * Usage:
 *   pnpm dsk:hash                         # hash data/dsk/v1.json
 *   pnpm dsk:hash path/to/bundle.json     # hash a specific file
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DSKBundle } from "../src/dsk/types.js";
import { computeDSKHash } from "../src/dsk/hash.js";

const filePath = process.argv[2] ?? "data/dsk/v1.json";
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

  const hash = computeDSKHash(bundle);
  console.log(hash);
}

main();
