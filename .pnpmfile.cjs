/**
 * PATH-B (19 Oct 2026): the OpenAI Agents SDK (`@openai/agents`, pinned in package.json) declares `zod ^4` as a PEER, and
 * this service is on zod 3 everywhere else. A peer always resolves to the root's zod 3, and the SDK fails at import
 * (agents-core `types/protocol` uses the zod 4 API). This hook gives the SDK packages their own zod 4 as a plain dependency,
 * pinned, so the rest of the service keeps zod 3 untouched. Remove it when the service moves to zod 4.
 */
const SDK_PACKAGES = new Set(['@openai/agents', '@openai/agents-core', '@openai/agents-openai', '@openai/agents-realtime']);
const SDK_ZOD = '4.6.1';
const MCP_PACKAGES = new Set(['@modelcontextprotocol/client', '@modelcontextprotocol/core']);
const MCP_CLIENT = '2.2.0';

function readPackage(pkg) {
  if (SDK_PACKAGES.has(pkg.name) && pkg.peerDependencies && pkg.peerDependencies.zod !== undefined) {
    delete pkg.peerDependencies.zod;
    pkg.dependencies = { ...(pkg.dependencies || {}), zod: SDK_ZOD };
  }
  // The SDK's MCP client is unused here (no MCP server is connected), but agents-core's ESM build imports it when the module
  // loads, so a build without it crashes at boot (CI boot-smoke, 19 Oct). It is pinned to a release at least two weeks old,
  // and its packages get the same pinned zod 4 as the SDK.
  if (pkg.name === '@openai/agents-core' && pkg.optionalDependencies && pkg.optionalDependencies['@modelcontextprotocol/client'] !== undefined) {
    pkg.optionalDependencies['@modelcontextprotocol/client'] = MCP_CLIENT;
  }
  if (MCP_PACKAGES.has(pkg.name) && pkg.dependencies && pkg.dependencies.zod !== undefined) pkg.dependencies.zod = SDK_ZOD;
  // The SDK's client (openai v7, also imported directly as `openai-v7` for its fetch hook) takes zod only as an OPTIONAL
  // peer for helpers this service does not use. Dropping it keeps ONE openai v7 instance, so the client the service builds
  // is the very type the SDK's Responses model accepts.
  if (pkg.name === 'openai' && /^7\./.test(pkg.version) && pkg.peerDependencies && pkg.peerDependencies.zod !== undefined) {
    delete pkg.peerDependencies.zod;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.zod;
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
