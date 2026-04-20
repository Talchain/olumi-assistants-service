// Local ambient shim for compromise-numbers. The package ships .d.ts files
// but its `exports` map omits them, so the import cannot resolve types
// without help. We only need enough typing to call `numbers().json()` on a
// compromise View.

declare module 'compromise-numbers' {
  const plugin: unknown;
  export default plugin;
}
