import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = resolve(HERE, "../..");

/**
 * The SDK's exports map blocks `@anthropic-ai/sdk/package.json` subpath
 * imports, so read the installed package manifest directly.
 */
export function anthropicSdkVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(TOOL_ROOT, "node_modules/@anthropic-ai/sdk/package.json"), "utf-8")
    ) as { version?: string };
    return manifest.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
