import { defineConfig, type Plugin } from "vitest/config";

/**
 * The repo's src/ files use NodeNext-style relative imports with a `.js`
 * extension (e.g. `./assist.js`) that resolve to `.ts` sources. Vite's
 * resolver does not always apply that mapping for files outside the test
 * root, so this tiny pre-resolver tries the `.ts` sibling first.
 */
const tsJsExtension: Plugin = {
  name: "bakeoff-ts-js-extension",
  enforce: "pre",
  async resolveId(source, importer) {
    if (importer && source.startsWith(".") && source.endsWith(".js")) {
      const resolved = await this.resolve(source.slice(0, -3) + ".ts", importer, {
        skipSelf: true,
      });
      if (resolved) return resolved;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [tsJsExtension],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
