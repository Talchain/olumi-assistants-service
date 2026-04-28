/**
 * V5 — routing prompt loader.
 *
 * Loads `Prompts/v40.txt` once at module import. Exposes the prompt text
 * plus observability primitives (version, hash, systemChars) for the
 * routing call and lifecycle logs (Phase 2.5).
 *
 * Missing/corrupt prompt at init is fatal — process fails to start. This is
 * intentional: deploying without the prompt would produce a silent routing
 * regression (the previous 662-char constant would still route). Fail fast.
 *
 * Path resolution uses `process.cwd()` — the established pattern in this
 * repo for external data files (see dsk-loader.ts, routing-log.ts,
 * draft-coaching-log.ts). The prompt lives under `Prompts/v40.txt`
 * (capital P). Casing matters on Linux/Render — hard-coded lowercase
 * would compile on macOS and 500 at module init on deploy.
 *
 * Test seam: `loadRoutingPrompt(pathResolver)` accepts an injectable path
 * resolver so load-failure tests can point at a missing file without
 * mutating the filesystem or destabilising unrelated module imports.
 *
 * Sanity range [18500, 20500] is a range check, not a correctness field.
 * Hash + version are the primary proof of installation. The check exists
 * to catch "wrong file copied" or "accidental truncation" at init.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export const ROUTING_PROMPT_VERSION = 'v40';

/**
 * Sanity range for the prompt size. Range, not equality — lets a small
 * editorial edit land without a deploy block, while catching wrong-file
 * / truncation disasters at module init.
 */
export const EXPECTED_SYSTEM_CHARS_MIN = 18_500;
export const EXPECTED_SYSTEM_CHARS_MAX = 22_000;

export interface LoadedPrompt {
  readonly text: string;
  /** 16-char lowercase hex prefix of SHA-256(text). Stable per content. */
  readonly hash: string;
  readonly systemChars: number;
  readonly version: typeof ROUTING_PROMPT_VERSION;
}

/**
 * Default resolver — exported so tests can replace it via the
 * `loadRoutingPrompt` seam without touching `fs` or env vars.
 */
export function defaultPromptPath(): string {
  return resolve(process.cwd(), 'Prompts', 'v40.txt');
}

/**
 * Load the routing prompt and compute observability primitives. Non-cached
 * — call sites should use `LOADED_PROMPT` below; this factory exists for
 * isolated tests.
 */
export function loadRoutingPrompt(
  resolvePath: () => string = defaultPromptPath,
): LoadedPrompt {
  const path = resolvePath();
  const text = readFileSync(path, 'utf-8');
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const systemChars = text.length;
  if (
    systemChars < EXPECTED_SYSTEM_CHARS_MIN ||
    systemChars > EXPECTED_SYSTEM_CHARS_MAX
  ) {
    throw new Error(
      `Routing prompt size ${systemChars} outside expected range ` +
        `[${EXPECTED_SYSTEM_CHARS_MIN}, ${EXPECTED_SYSTEM_CHARS_MAX}]. ` +
        `Likely wrong file at "${path}" or truncation. Refusing to start.`,
    );
  }
  return { text, hash, systemChars, version: ROUTING_PROMPT_VERSION };
}

/**
 * Module-level eager load. Throws at import time if the prompt is missing
 * or out-of-range. Downstream modules import this constant directly.
 */
export const LOADED_PROMPT: LoadedPrompt = loadRoutingPrompt();
