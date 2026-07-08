import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Hex } from "../util/stable.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROMPTS_DIR = resolve(HERE, "../../prompts");

/**
 * Prompt files are SLOTS, not authored copy. Every file must open with a
 * `#`-comment header carrying the BENCHMARK-ONLY banner. A header line
 * containing PLACEHOLDER marks the prompt as smoke-test-only; output produced
 * under any placeholder prompt is never reported as meaningful (the report
 * watermark is forced on). Real prompt text is authored separately and
 * dropped in by removing the PLACEHOLDER line — the banner line stays.
 */
export interface LoadedPrompt {
  name: string;
  /** Prompt body with the `#` header block removed. */
  body: string;
  /** sha256 of the FULL raw file (header included) — provenance identity. */
  hash: string;
  placeholder: boolean;
}

const BANNER = "BENCHMARK-ONLY";

export async function loadPrompt(name: string, baseDir: string = PROMPTS_DIR): Promise<LoadedPrompt> {
  const path = join(baseDir, name);
  const raw = await readFile(path, "utf-8");
  return parsePrompt(name, raw);
}

export function parsePrompt(name: string, raw: string): LoadedPrompt {
  const lines = raw.split("\n");
  let i = 0;
  const header: string[] = [];
  while (i < lines.length && (lines[i].startsWith("#") || lines[i].trim() === "")) {
    if (lines[i].startsWith("#")) header.push(lines[i]);
    i++;
    if (header.length > 0 && i < lines.length && !lines[i].startsWith("#") && lines[i].trim() !== "") break;
  }
  if (!header.some((l) => l.includes(BANNER))) {
    throw new Error(`prompt ${name}: missing required "${BANNER}" header line — refusing to load`);
  }
  const body = lines.slice(i).join("\n").trim();
  if (body.length === 0) throw new Error(`prompt ${name}: empty body`);
  return {
    name,
    body,
    hash: sha256Hex(raw),
    placeholder: header.some((l) => l.includes("PLACEHOLDER")),
  };
}

/** Fill {{slot}} markers; any unfilled slot left in the output is an error. */
export function fillSlots(prompt: LoadedPrompt, slots: Record<string, string>): string {
  let out = prompt.body;
  for (const [key, value] of Object.entries(slots)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  const unfilled = out.match(/\{\{[a-z0-9_]+\}\}/gi);
  if (unfilled) {
    throw new Error(`prompt ${prompt.name}: unfilled slots ${[...new Set(unfilled)].join(", ")}`);
  }
  return out;
}

export interface PromptSet {
  armA: LoadedPrompt;
  armB: LoadedPrompt;
  armCM1: LoadedPrompt;
  armCM2: LoadedPrompt;
  armDExecutor: LoadedPrompt;
  holisticJudge: LoadedPrompt;
}

/**
 * Load the six prompt slots. `setName` selects a named prompt-set directory
 * under PROMPTS_DIR (e.g. "v0.4.3-B", "m2-evidence-verbatim"); a prompt-set
 * directory is COMPLETE (all six slot files). Undefined = the default
 * PROMPTS_DIR (the v0.4.3 baseline). This is the axis that runs named variants
 * without file swaps (empowerment contract §3): the run records the set name +
 * per-file hashes for provenance.
 */
export async function loadPromptSet(setName?: string): Promise<PromptSet> {
  const dir = setName ? join(PROMPTS_DIR, setName) : PROMPTS_DIR;
  const [armA, armB, armCM1, armCM2, armDExecutor, holisticJudge] = await Promise.all([
    loadPrompt("arm-a.system.txt", dir),
    loadPrompt("arm-b.system.txt", dir),
    loadPrompt("arm-c.m1.system.txt", dir),
    loadPrompt("arm-c.m2.system.txt", dir),
    loadPrompt("arm-d.executor.system.txt", dir),
    loadPrompt("holistic-judge.system.txt", dir),
  ]);
  return { armA, armB, armCM1, armCM2, armDExecutor, holisticJudge };
}

export function anyPlaceholder(set: PromptSet): boolean {
  return Object.values(set).some((p) => p.placeholder);
}

export function promptHashes(set: PromptSet): Record<string, string> {
  return Object.fromEntries(Object.values(set).map((p) => [p.name, p.hash]));
}
