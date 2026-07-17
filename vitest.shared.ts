/**
 * Shared vitest exclusion fragments — the SINGLE source of truth consumed by
 * BOTH vitest.config.ts (default / advisory Full Test Suite) and
 * vitest.required.config.ts (the required CI gate).
 *
 * Extracted because the tools/graph-evaluator exclusion was hand-duplicated
 * in the two configs, each side carrying a "mirrors … keep in sync" comment —
 * and a hand-maintained mirror WILL drift silently (derive, don't mirror).
 *
 * Node16 note: both consumers import this with an explicit `.js` extension
 * (`./vitest.shared.js`), which node16 module resolution requires and tsc maps
 * back to this .ts file — so the full-typecheck ratchet stays clean.
 */

/**
 * Standalone tool package — `tools/graph-evaluator` is a self-contained
 * evaluator with its OWN package.json, dependencies (e.g. gray-matter) and
 * vitest runner. Its tests must not be collected by the repo-root configs,
 * which install only product deps — collecting it throws ERR_MODULE_NOT_FOUND
 * on the tool-local imports. Excluded as a package boundary, NOT because it
 * is red; deliberately NOT broadened to tools/** (other tools' tests resolve
 * against product deps and keep running). NOTE: with both root configs
 * excluding it, the tool has NO repo-root CI execution at all until the
 * dedicated graph-evaluator job lands (Phase 2 wiring); it still runs in the
 * tool's own runner (`cd tools/graph-evaluator && npm test`).
 */
export const STANDALONE_TOOL_EXCLUSIONS = ["tools/graph-evaluator/**"];
